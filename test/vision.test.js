// Stage 2, step 3: Haiku review (3×3 sheet) — no key, fake client, cache, ceiling, refusal, error with a key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VISION_MODEL, ACTIONS, pickSheetFrames, sheetArgs, signalVision, toVision, costOf, createVision } from '../core/vision.js';
import { createLibrary } from '../core/library.js';

const shot = (from, len, score, labels = [], defects = []) => ({ from, len, score, best: { t: from + len / 2, kind: 'move', score }, peaks: [], labels, defects, why: '', hash: null });
const clip = (shots, extra = {}) => ({ id: 'clip1', name: 'a.mp4', shots, ...extra });
const IMG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function fakeClient(reply, usage = { input_tokens: 1300, output_tokens: 250 }, extra = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(req) {
        calls.push(req);
        if (extra.throw) throw new Error(extra.throw);
        return { stop_reason: extra.stop ?? 'end_turn', usage, content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] };
      },
    },
  };
}

test('sheet: 9 frames from good plans in time order, defective ones skipped', () => {
  const c = clip([shot(0, 4, 0.9), shot(4, 4, 0.99, [], ['размыто']), shot(8, 6, 0.5)]);
  const fr = pickSheetFrames(c, 9);
  assert.equal(fr.length, 9);
  assert.ok(fr.every((f) => f.shot !== 1), 'defective plan is not on the sheet');
  assert.deepEqual(fr.map((f) => f.t), [...fr.map((f) => f.t)].sort((a, b) => a - b));
  assert.ok(fr.every((f) => { const s = c.shots[f.shot]; return f.t >= s.from && f.t < s.from + s.len; }));
  assert.deepEqual(pickSheetFrames(clip([]), 9), []);
  const allBad = pickSheetFrames(clip([shot(0, 3, 0.4, [], ['тёмное-чёрное'])]), 9);
  assert.equal(allBad.length, 9, 'if none is good — take what there is, the sheet is still built');
});

test('sheet: ffmpeg arguments — 9 inputs (padding), xstack grid 1152×648', () => {
  const args = sheetArgs({ src: 'in.mp4', frames: [{ t: 1 }, { t: 2.5 }], out: 's.jpg' });
  assert.equal(args.filter((a) => a === '-i').length, 9);
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /xstack=inputs=9:layout=0_0\|384_0\|768_0\|0_216\|384_216\|768_216\|0_432\|384_432\|768_432/);
  assert.equal(args.at(-1), 's.jpg');
  assert.ok(args.includes('2.500'));
});

test('no key — labels from signals, honestly "without Claude", free', async () => {
  const v = createVision({});
  assert.equal(v.enabled, false);
  assert.equal(v.model, VISION_MODEL);
  assert.equal(VISION_MODEL, 'claude-haiku-5-5');
  const r = await v.analyze({ clip: clip([shot(0, 5, 0.5, ['спокойно', 'asmr?'])]), image: IMG, frames: [{ shot: 0, t: 2 }] });
  assert.equal(r.by, 'сигналы'); assert.equal(r.note, 'без Claude'); assert.equal(r.cost, 0); assert.equal(r.asmr, true);
  assert.equal(signalVision(clip([shot(0, 5, 0.5, ['asmr?'], ['размыто'])])).asmr, false);
});

test('fake Haiku: model is hardcoded, JSON schema, image; response → plan labels', async () => {
  const frames = [{ shot: 0, t: 1 }, { shot: 1, t: 5 }, { shot: 2, t: 9 }];
  const client = fakeClient({ frames: [{ n: 1, action: 'ест', stress: false }, { n: 2, action: 'прыжок', stress: false }, { n: 3, action: 'не видно', stress: false }], mood: 'игривый', best: 2, asmr: true });
  const v = createVision({ client });
  const r = await v.analyze({ clip: clip([shot(0, 4, 0.5), shot(4, 4, 0.6), shot(8, 4, 0.4)]), image: IMG, frames });
  const req = client.calls[0];
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.deepEqual(req.output_config.format.schema.properties.frames.items.properties.action.enum, [...ACTIONS, 'не видно']);
  assert.equal(req.messages[0].content[0].type, 'image');
  assert.equal(req.messages[0].content[0].source.data, IMG.toString('base64'));
  assert.doesNotMatch(req.messages[0].content[1].text, /вспышк[уа] включ|включите свет/i);
  assert.equal(r.by, 'claude');
  assert.deepEqual(r.frames, [{ shot: 0, labels: ['ест'] }, { shot: 1, labels: ['прыжок', 'движение'] }, { shot: 2, labels: ['нет зверька'] }]);
  assert.equal(r.notPet, false);
  assert.equal(r.mood, 'игривый'); assert.equal(r.asmr, true); assert.equal(r.bestShot, 1); assert.equal(r.bestT, 5);
  assert.ok(Math.abs(r.cost - costOf({ input_tokens: 1300, output_tokens: 250 })) < 1e-9);
});

test('stress from Haiku → plan goes to library defects, not to stories', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-vis-'));
  const base = join(root, 'Поссум'); mkdirSync(join(base, 'Входящие'), { recursive: true });
  const lib = createLibrary({ path: join(base, 'library.json'), baseDir: base, now: () => 1_700_000_000_000 });
  const file = join(base, 'Входящие', 'a.mp4'); writeFileSync(file, 'x'.repeat(2000));
  const n = 24; const s = { step: 0.25, motion: [], loud: [], luma: [], sat: [], sharp: [], hash: [], info: { hasAudio: true, width: 1080, height: 1920, duration: 12 } };
  for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) { s.motion.push(i === 0 && k ? 80 : 2); s.loud.push(-40); s.luma.push(120); s.sat.push(40); s.sharp.push(0.5); s.hash.push(k ? 'ffffffffffffffff' : '0000000000000000'); }
  const { clip: c } = lib.ingest(file, s);
  assert.equal(c.shots.length, 2);
  const frames = pickSheetFrames(c, 9);
  const stressN = frames.findIndex((f) => f.shot === 1) + 1;
  const client = fakeClient({ frames: [{ n: stressN, action: 'прячется', stress: true }], mood: 'насторожен', best: 1, asmr: false });
  const v = await createVision({ client }).analyze({ clip: c, image: IMG, frames });
  const after = lib.setVision(c.id, v);
  assert.ok(after.shots[1].defects.includes('стресс'));
  assert.equal(after.shots[1].score, 0);
  assert.equal(lib.isFree(c.id, 1), false);
  assert.equal(after.vision.by, 'claude');
});

test('cache by clip id: second time without a call, survives restart; daily spend accumulates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-vis-'));
  const cachePath = join(dir, 'cache', 'vision.json');
  const client = fakeClient({ frames: [{ n: 1, action: 'спит', stress: false }], mood: 'сонный', best: 1, asmr: false });
  const now = () => Date.UTC(2026, 10, 15, 10);
  const v = createVision({ client, cachePath, now });
  const c = clip([shot(0, 4, 0.5)]);
  const a = await v.analyze({ clip: c, image: IMG, frames: [{ shot: 0, t: 1 }] });
  const b = await v.analyze({ clip: c, image: IMG, frames: [{ shot: 0, t: 1 }] });
  assert.equal(client.calls.length, 1);
  assert.equal(b.fromCache, true); assert.deepEqual(b.frames, a.frames);
  assert.ok(existsSync(cachePath));
  assert.ok(!readFileSync(cachePath, 'utf8').includes(IMG.toString('base64')), 'no image in the cache');
  const v2 = createVision({ client, cachePath, now });
  assert.equal((await v2.analyze({ clip: c, image: IMG, frames: [{ shot: 0, t: 1 }] })).fromCache, true);
  assert.equal(client.calls.length, 1);
  assert.ok(v2.spentToday() > 0);
  assert.deepEqual(v2.cached('clip1').frames, a.frames);
});

test('daily $ cap: beyond it — signals until tomorrow, no call', async () => {
  const client = fakeClient({ frames: [], mood: 'спокойный', best: 1, asmr: false }, { input_tokens: 1_000_000, output_tokens: 0 });
  let t = Date.UTC(2026, 10, 15, 10);
  const v = createVision({ client, dailyCapUsd: 0.05, now: () => t });
  await v.analyze({ clip: clip([shot(0, 4, 0.5)], { id: 'a' }), image: IMG, frames: [{ shot: 0, t: 1 }] });
  assert.ok(v.spentToday() >= 0.05);
  const r = await v.analyze({ clip: clip([shot(0, 4, 0.5)], { id: 'b' }), image: IMG, frames: [{ shot: 0, t: 1 }] });
  assert.equal(client.calls.length, 1);
  assert.equal(r.by, 'сигналы'); assert.match(r.note, /потолок/);
  t += 24 * 3600 * 1000;
  await v.analyze({ clip: clip([shot(0, 4, 0.5)], { id: 'c' }), image: IMG, frames: [{ shot: 0, t: 1 }] });
  assert.equal(client.calls.length, 2, 'next day it is allowed again');
});

test('no frames — no call; model refusal — signals, spend counted, not cached', async () => {
  const client = fakeClient('', undefined, { stop: 'refusal' });
  const v = createVision({ client });
  const none = await v.analyze({ clip: clip([]), image: null, frames: [] });
  assert.match(none.note, /нет кадров/); assert.equal(client.calls.length, 0);
  const r = await v.analyze({ clip: clip([shot(0, 4, 0.5)]), image: IMG, frames: [{ shot: 0, t: 1 }] });
  assert.equal(r.by, 'сигналы'); assert.match(r.note, /отказался/);
  assert.ok(v.spentToday() > 0);
  assert.equal(v.cached('clip1'), null);
});

test('network error with key in the text — no key in the note', async () => {
  const key = 'sk-ant-REDACTEDCRET';
  const client = fakeClient({}, undefined, { throw: `401 invalid x-api-key ${key}` });
  const r = await createVision({ apiKey: key, client }).analyze({ clip: clip([shot(0, 4, 0.5)]), image: IMG, frames: [{ shot: 0, t: 1 }] });
  assert.equal(r.by, 'сигналы');
  assert.match(r.note, /Claude недоступен/);
  assert.ok(!r.note.includes('SECRET'), r.note);
  const bad = await createVision({ client: fakeClient('не json') }).analyze({ clip: clip([shot(0, 4, 0.5)]), image: IMG, frames: [{ shot: 0, t: 1 }] });
  assert.equal(bad.by, 'сигналы', 'broken JSON — we do not crash');
});

test('model response: pet name is removed from mood, foreign shot numbers and actions are ignored', () => {
  const frames = [{ shot: 0, t: 1 }];
  const v = toVision({ frames: [{ n: 1, action: 'танцует', stress: false }, { n: 7, action: 'ест', stress: true }], mood: 'Бублик доволен', best: 9, asmr: 'да' }, frames, { petNames: ['Бублик'] });
  assert.deepEqual(v.frames, []);
  assert.ok(!/Бублик/i.test(v.mood), v.mood);
  assert.equal(v.asmr, false, 'only true means yes');
  assert.equal(v.bestShot, null);
  assert.deepEqual(toVision(null, frames).frames, []);
});

test('price: per the Haiku 5.5 price table, input cache is counted as input', () => {
  assert.equal(costOf({ input_tokens: 1_000_000 }), 0.10);
  assert.equal(costOf({ output_tokens: 1_000_000 }), 0.50);
  assert.ok(Math.abs(costOf({ input_tokens: 1300, output_tokens: 250 }) - 0.000255) < 1e-9);
  assert.equal(costOf({ cache_read_input_tokens: 500_000, cache_creation_input_tokens: 500_000 }), 0.10);
  assert.equal(costOf(), 0);
});

test('pet species: "not visible" and "not your pet" — plans do not go to stories; without a pet answer the clip is left alone', () => {
  const base = mkdtempSync(join(tmpdir(), 'vis-pet-')); mkdirSync(join(base, 'Входящие'));
  const lib = createLibrary({ path: join(base, 'library.json'), baseDir: base, now: () => 1_700_000_000_000 });
  const mk = (name) => {
    const file = join(base, 'Входящие', name); writeFileSync(file, name.repeat(500));
    const n = 24; const s = { step: 0.25, motion: [], loud: [], luma: [], sat: [], sharp: [], hash: [], info: { hasAudio: true, width: 1080, height: 1920, duration: 12 } };
    for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) { s.motion.push(i === 0 && k ? 80 : 2); s.loud.push(-40); s.luma.push(120); s.sat.push(40); s.sharp.push(0.5); s.hash.push(k ? 'ffffffffffffffff' : '0000000000000000'); }
    return lib.ingest(file, s).clip;
  };
  const a = mk('a.mp4');
  const frames = [{ shot: 0, t: 1 }, { shot: 1, t: 7 }];
  const v = toVision({ frames: [{ n: 1, action: 'не видно', stress: false }, { n: 2, action: 'ест', stress: false }], mood: 'спокойный', best: 2, asmr: false, pet: true }, frames);
  assert.equal(v.notPet, false);
  const after = lib.setVision(a.id, v);
  assert.ok(after.shots[0].defects.includes('нет зверька'));
  assert.equal(lib.isFree(a.id, 0), false);
  assert.equal(lib.isFree(a.id, 1), true);
  const b = mk('b.mp4');
  const cat = toVision({ frames: [{ n: 2, action: 'играет', stress: false }], mood: 'игривый', best: 2, asmr: false, pet: false }, frames);
  assert.equal(cat.notPet, true);
  lib.setVision(b.id, cat);
  assert.equal(lib.isFree(b.id, 0), false);
  assert.equal(lib.isFree(b.id, 1), false);
  assert.equal(lib.get?.(b.id)?.vision?.notPet ?? true, true);
});
