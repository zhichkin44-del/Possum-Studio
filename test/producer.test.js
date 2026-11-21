// Stage 2, step 4: producer (batch → analysis → stories → packages → calendar) on fake media, library and Haiku.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createProducer, titleB, applyPick, diskFree, HOOKS, isNight } from '../core/producer.js';
import { createCalendar } from '../core/calendar.js';
import { createVision } from '../core/vision.js';
import { KINDS } from '../core/stories.js';
import { countSupply } from '../core/library.js';
import * as privacyMod from '../core/privacy.js';
import { createAi } from '../core/ai.js';

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();

function shot(from, len, labels, score = 0.6, extra = {}) {
  return { from, len, score, best: { t: from + len / 2, kind: 'move', score }, peaks: [], labels, defects: [], why: `план ${labels.join(',')}`, hash: null, ...extra };
}

const unmarked = (c) => c?.pet == null && (Boolean(c?.petUnsure) || (Boolean(c?.vision?.by) && c.vision.by !== 'claude'));

/** Fake library with the core/library.js contract: ingest by the template from sig.tpl. */
function fakeLib(now = () => NOW) {
  const db = {};
  return {
    all: () => Object.values(db),
    get: (id) => db[id] ?? null,
    realPath: (c) => (c.missing ? null : `/v/${c.name}`),
    ingest(file, sig) {
      const id = basename(file);
      if (db[id]) return { clip: db[id], added: false };
      db[id] = { id, name: id, orient: 'vertical', hasAudio: true, created: null, night: false, labels: [], stars: 0, used: [], vision: null, ...sig.tpl };
      return { clip: db[id], added: true };
    },
    setVision(id, v) { db[id].vision = { by: v.by, mood: v.mood ?? null, asmr: Boolean(v.asmr), cost: v.cost ?? 0 }; return db[id]; },
    setPet(id, yes, { by = 'owner', why = null } = {}) { const c = db[id]; c.pet = Boolean(yes); c.petBy = by; c.petWhy = why; c.petUnsure = false; if (!c.pet) for (const s of c.shots) { s.defects.push('не ваш зверёк'); s.score = 0; } return c; },
    markUnsure(id) { const c = db[id]; if (c && c.pet == null) c.petUnsure = true; return c; },
    pending: () => Object.values(db).filter(unmarked),
    isFree(id, i) { const c = db[id]; const s = c?.shots[i]; if (!s || s.defects.length || unmarked(c)) return false; return !c.used.some((u) => u.shot === i && now() - u.at < 7 * DAY); },
    markUsed(id, s, story, at) { db[id].used.push({ shot: s, story, at }); },
    markNoPet(id, s) { const x = db[id]?.shots[s]; if (!x) return null; x.defects.push('нет зверька'); x.score = 0; return x; },
    supply() { return countSupply(Object.values(db), (id, i) => this.isFree(id, i)); },
    stats: () => ({ clips: Object.keys(db).length }),
  };
}

/** Fake ffmpeg: creates the result file (the last argument). */
function fakeMedia(world, { failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    tools: { ffmpeg: 'fake', ffprobe: 'fake' },
    async probe(file) { const w = world[basename(file)]; if (!w) throw new Error('битый файл'); return w.info; },
    async signals(file) { return { tpl: world[basename(file)].tpl }; },
    async ffmpeg(args) {
      calls.push(args);
      const out = args[args.length - 1];
      if (failOn && String(out).includes(failOn)) throw new Error('ffmpeg упал');
      mkdirSync(join(out, '..'), { recursive: true });
      writeFileSync(out, 'x');
    },
  };
}

/** A world of 12 clips: movement, sleep, IR night, ASMR crunch, jumps. */
function world(more = 0) {
  const w = {};
  const add = (name, labels, extra = {}) => { w[name] = { info: { duration: 8, width: 1080, height: 1920, hasAudio: true }, tpl: { shots: [shot(0, 4, labels, 0.6 + Object.keys(w).length * 0.01, extra.shot ?? {})], ...(extra.clip ?? {}) } }; };
  for (let k = 0; k < 5 + more; k++) add(`move${k}.mp4`, ['движение', 'играет']);
  add('rest.mp4', ['спокойно']);
  add('sleep.mp4', ['спит', 'спокойно']);
  add('wash.mp4', ['умывается']);
  add('night.mp4', ['ИК', 'движение'], { clip: { night: true } });
  add('crunch.mp4', ['ест', 'asmr?']);
  add('jump1.mp4', ['прыжок', 'движение'], { shot: { peaks: [{ t: 1, kind: 'move', score: 0.9 }] } });
  add('jump2.mp4', ['прыжок', 'движение'], { shot: { peaks: [{ t: 1, kind: 'move', score: 0.8 }] } });
  w['short.mp4'] = { info: { duration: 0.4, width: 1080, height: 1920, hasAudio: true }, tpl: { shots: [] } };
  return w;
}

function setup(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'possum-prod-'));
  let t = NOW;
  const now = () => t;
  const W = world(opts.more ?? 0);
  const media = fakeMedia(W, opts);
  const lib = fakeLib(now);
  const calendar = createCalendar({ path: join(root, 'calendar.json'), now });
  const calls = [];
  const client = { messages: { create: async (req) => { calls.push(req); return { content: [{ type: 'text', text: JSON.stringify({ mood: 'игривый', asmr: false, frames: [] }) }], usage: { input_tokens: 1500, output_tokens: 120 } }; } } };
  const vision = createVision({ apiKey: opts.noKey ? '' : 'test-key-not-real', client: opts.noKey ? null : client, cachePath: join(root, 'cost.json'), now });
  const producer = createProducer({ lib, calendar, vision, media, outRoot: join(root, 'Готово'), workRoot: join(root, 'work'), now, minFreeBytes: 0, species: opts.species, ...opts.prod });
  const files = Object.keys(W).map((n) => join(root, 'in', n));
  return { root, lib, calendar, vision, producer, files, media, calls, setNow: (x) => { t = x; } };
}

test('batch of 13 videos → analysis, 3 stories of different kinds, A/B packages, calendar slots, decisions', async () => {
  const { producer, files, calendar, calls } = setup();
  const prog = [];
  const r = await producer.run(files, (p) => prog.push(p));
  assert.equal(r.files.length, 13);
  assert.equal(r.files.find((f) => f.file.endsWith('short.mp4')).skipped, 'короче секунды — пропущен');
  assert.equal(r.made.length, 3);
  assert.equal(r.made.length, 3);
  assert.equal(new Set(r.made.map((m) => m.kind)).size, 3, 'three different kinds');
  for (const m of r.made) {
    assert.ok(KINDS.includes(m.kind));
    for (const f of ['video.mp4', 'cover.jpg', 'manifest.json', 'пост.txt']) assert.ok(existsSync(join(m.dir, f)), `${f} in ${m.dir}`);
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.equal(man.outputs.reels, join(m.dir, 'video.mp4'));
    assert.notEqual(man.titles.A.ru, man.titles.B.ru);
    assert.ok(man.packagesA.youtube.title && man.packagesB.youtube.title);
    assert.ok(m.day, 'has a day in the calendar');
    assert.ok(m.why);
    // where each moment comes from: time in the video and in the source — and in the notes, to check by hand
    assert.equal(man.sources.length, man.story.pieces.length);
    assert.match(man.sources[0].at, /^0:00$/);
    for (const s of man.sources) assert.match(s.from + s.till, /^\d+:\d\d\d+:\d\d$/);
    const notes = readFileSync(join(m.dir, 'заметки.txt'), 'utf8');
    assert.match(notes, /Из чего собран ролик/);
    assert.ok(notes.includes(man.sources[0].file), 'source video name in the notes');
  }
  assert.equal(calendar.free(), 11);
  assert.ok(r.decisions.some((d) => d.type === 'publish' && /в 18:00\?$/.test(d.text)));
  assert.equal(r.decisions.filter((d) => d.type === 'title').length, 1);
  // progress: analysis per file, editing, done; ETA appears from the second step
  assert.equal(prog.filter((p) => p.stage === 'разбор').length, 13);
  assert.equal(prog[0].eta, null);
  assert.equal(typeof prog[1].eta, 'number');
  assert.equal(prog.at(-1).stage, 'готово');
  // the texts do not advise repeating the trick and do not ask for light
  for (const d of r.decisions) assert.doesNotMatch(d.text, /повтор|включите свет|вспышк/i);
});

test('repeated batch of the same files: Haiku is not paid a second time, shots are busy — fewer new stories or "add more"', async () => {
  const { producer, files, calls } = setup();
  await producer.run(files);
  const n = calls.length;
  const r2 = await producer.run(files);
  assert.equal(calls.length, n, 'already analysed clips are not sent to Haiku');
  assert.ok(r2.files.filter((f) => f.id).every((f) => f.added === false));
  const r3 = await producer.run(files);
  if (!r3.made.length) assert.ok(r3.decisions.some((d) => d.type === 'more'));
});

test('without API key — analysis by signals, clips are still assembled', async () => {
  const { producer, files, calls, lib } = setup({ noKey: true });
  const r = await producer.run(files);
  assert.equal(calls.length, 0);
  assert.ok(r.files.filter((f) => f.id).every((f) => f.by === 'сигналы'));
  assert.ok(r.decisions.some((d) => d.type === 'confirm'));
  for (const c of lib.pending()) lib.setPet(c.id, true);
  assert.ok((await producer.build()).made.length >= 1);
});

test('a broken file and a failed edit do not break the batch', async () => {
  const { producer, files, root } = setup({ failOn: 'top5' });
  const r = await producer.run([...files, join(root, 'in', 'битый.mp4')]);
  assert.ok(r.errors.some((e) => e.file === 'битый.mp4'));
  assert.ok(r.errors.some((e) => String(e.story).startsWith('top5')));
  assert.ok(r.made.length >= 1, 'other stories assembled');
});

test('calendar is full — no new clips are edited, it says why', async () => {
  const { producer, files, calendar } = setup();
  for (let k = 0; k < 14; k++) calendar.add({ id: `old${k}`, kind: 'day' });
  const r = await producer.run(files);
  assert.equal(r.made.length, 0);
  assert.ok(r.decisions.some((d) => d.type === 'full'));
});

test('fewer than three free days — as many stories as days', async () => {
  const { producer, files, calendar } = setup();
  for (let k = 0; k < 13; k++) calendar.add({ id: `old${k}`, kind: 'day' });
  const r = await producer.run(files);
  assert.equal(r.made.length, 1);
  assert.equal(calendar.free(), 0);
});

test('little disk space — editing does not start', async () => {
  const { files, lib, calendar, vision, media, root } = setup();
  const p = createProducer({ lib, calendar, vision, media, outRoot: join(root, 'o'), workRoot: join(root, 'w'), now: () => NOW, minFreeBytes: Number.MAX_SAFE_INTEGER });
  const r = await p.run(files);
  if (r.disk === null) return; // statfs unavailable — nothing to check
  assert.equal(r.files.length, 0);
  assert.ok(r.decisions.some((d) => d.type === 'disk'));
});

test('night story — note about IR without light; fails — "check"', async () => {
  const { producer, files } = setup({ prod: { maxStories: 6 } });
  const r = await producer.run(files);
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.ok(man.welfare.length >= 1, 'care note in each clip');
    for (const w of man.welfare) assert.doesNotMatch(w, /включите свет|поднесите/i);
    if (man.needsReview) {
      assert.equal(man.advice.verdict, 'посмотрите перед выкладкой');
      assert.ok(r.decisions.some((d) => d.type === 'review' && d.id === m.id));
    }
  }
  assert.ok(!r.decisions.some((d) => d.type === 'claude'), 'the "Claude not connected" badge is gone');
});

test('without Claude the species is not checked: first a mark by frame sheets, "not him" does not go into clips', async () => {
  const { producer, files, lib } = setup({ noKey: true });
  const r = await producer.run(files);
  assert.equal(r.made.length, 0, 'clips are not assembled before the mark');
  const ask = r.decisions.find((d) => d.type === 'confirm');
  assert.ok(ask, 'asks for a mark');
  assert.equal(ask.clips.length, 12, 'all videos with analysis, except the too-short one');
  for (const c of ask.clips) assert.ok(c.id && c.name);
  assert.match(ask.text, /где ваш зверёк/);
  // marked: jumps — "not him", the rest — "mine"
  for (const c of ask.clips) lib.setPet(c.id, !c.id.startsWith('jump'));
  assert.equal(lib.pending().length, 0);
  const r2 = await producer.build();
  assert.ok(r2.made.length >= 1);
  assert.ok(!r2.decisions.some((d) => d.type === 'confirm'));
  for (const m of r2.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.ok(!man.story.pieces.some((p) => p.clip.startsWith('jump')), 'marked "not him" is not taken');
  }
});

test('choosing title B rewrites packages and post.txt', async () => {
  const { producer, files } = setup();
  const r = await producer.run(files);
  const m = r.made[0];
  const man = applyPick(m.dir, 'B');
  assert.equal(man.pick, 'B');
  assert.equal(man.packages.youtube.title, man.packagesB.youtube.title);
  assert.match(readFileSync(join(m.dir, 'пост.txt'), 'utf8'), new RegExp(man.packagesB.youtube.title.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(applyPick(m.dir, 'Z').pick, 'B', 'foreign variant is ignored');
});

test('hooks B: for each kind, without the pet name', () => {
  for (const k of ['top5', 'day', 'beforeAfter', 'calm', 'asmr']) assert.ok(HOOKS[k].ru && HOOKS[k].en);
  assert.ok(!HOOKS.fails, 'no fails');
  for (const v of Object.values(HOOKS)) assert.doesNotMatch(v.ru, /досмотрите|до №1|проснулся/i);
  const s = titleB({ kind: 'series', title: { ru: 'Поссум ест · эпизод 2', en: 'x' } });
  assert.match(s.ru, /эпизод 2/);
  assert.ok(diskFree(tmpdir()) === null || diskFree(tmpdir()) > 0);
});

test('clip folder is named after the day of its slot, not after today', async () => {
  const { producer, files } = setup();
  const r = await producer.run(files);
  assert.ok(r.made.length >= 2);
  for (const m of r.made) assert.ok(basename(m.dir).startsWith(m.day), `${basename(m.dir)} ↔ ${m.day}`);
  assert.equal(new Set(r.made.map((m) => m.day)).size, r.made.length);
});

test('B title depends on the story variant', async () => {
  const { titleB, HOOK_VARIANTS } = await import('../core/producer.js');
  assert.deepEqual(titleB({ kind: 'top5', variant: 1, title: { ru: 'x', en: 'x' } }), HOOK_VARIANTS.top5[1]);
  assert.deepEqual(titleB({ kind: 'top5', title: { ru: 'x', en: 'x' } }), HOOK_VARIANTS.top5[0]);
  for (const v of Object.values(HOOK_VARIANTS)) for (const t of v) assert.doesNotMatch(t.ru, /Пип|повтор|ещё раз|свет|вспышк/i);
});

test('"Remove moment" in top-5: shot marked "no pet", replaced by a fresh moment, captions №N…№1, post and notes redone', async () => {
  const { producer, files, lib, calendar, media } = setup({ more: 6 }); // series take up to 4 moments — the replacement needs spare
  const r = await producer.run(files);
  const m = r.made.find((x) => x.kind === 'top5') ?? r.made[0];
  const before = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
  const gone = before.story.pieces[1];
  const nCalls = media.calls.length;
  assert.equal(before.story.kind, 'top5', 'the test world has a top-5');
  const { manifest, replaced } = await producer.removePiece(m.dir, 1);
  assert.equal(replaced, true);
  assert.ok(media.calls.length > nCalls, 'clip re-edited');
  assert.ok(lib.get(gone.clip).shots[gone.shot].defects.includes('нет зверька'));
  assert.equal(lib.isFree(gone.clip, gone.shot), false, 'removed shot no longer goes into stories');
  const ps = manifest.story.pieces;
  assert.equal(ps.length, before.story.pieces.length);
  assert.ok(!ps.some((p) => p.clip === gone.clip && p.shot === gone.shot), 'removed moment is absent');
  assert.deepEqual(ps.map((p) => p.caption), ps.map((_, k) => `№${ps.length - k}`));
  assert.equal(manifest.sources.length, ps.length);
  assert.equal(manifest.removed.length, 1);
  assert.ok(manifest.removed[0].removedAt);
  const per = {}; for (const p of ps) per[p.clip] = (per[p.clip] ?? 0) + 1;
  assert.ok(Object.values(per).every((n) => n <= 2), 'no more than 2 moments from one video');
  const notes = readFileSync(join(m.dir, 'заметки.txt'), 'utf8');
  assert.ok(notes.includes(manifest.sources[0].file));
  assert.equal(calendar.all().find((s) => s.id === m.id || s.dir === m.dir)?.why, manifest.story.why);
});

test('"Remove moment": a short clip is not reassembled — asks for "Do not publish"; foreign number — error', async () => {
  const { producer, files } = setup();
  const r = await producer.run(files);
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    await assert.rejects(producer.removePiece(m.dir, 99), /Такого момента/);
    if (man.story.kind !== 'top5' && man.story.pieces.length === 2) {
      await assert.rejects(producer.removePiece(m.dir, 0), /Не выкладывать/);
      assert.equal(JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8')).story.pieces.length, 2, 'clip untouched');
    }
  }
});

test('calendar: update changes only the explanation and length', () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-cal-'));
  const cal = createCalendar({ path: join(root, 'c.json'), now: () => NOW });
  const { id } = cal.add({ id: 'x1', kind: 'top5', why: 'старое', total: 15 });
  const u = cal.update(id, { why: 'новое', total: 12, status: 'published' });
  assert.equal(u.why, 'новое'); assert.equal(u.total, 12); assert.notEqual(u.status, 'published');
  assert.equal(cal.update('нет-такого', { why: 'x' }), null);
});

test('assembled less than asked — the reason is honest: how many suitable pieces, how many busy, what did not fit', async () => {
  const { producer, files } = setup({ prod: { maxStories: 12 } });
  const r = await producer.run(files);
  const more = r.decisions.find((d) => d.type === 'more');
  assert.ok(more, JSON.stringify(r.decisions.map((d) => d.type)));
  assert.match(more.text, /^Не хватило видео ещё на \d+ ролик(а|ов)?: (все \d+ куск\S* видео со зверьком уже в роликах|со зверьком \d+ куск\S* видео, в роликах уже \d+, свободных \d+)/);
  assert.match(more.text, /добавьте новые видео$/);
  assert.doesNotMatch(more.text, /Собрал|за неделю| из \d+:|отложено|моментов|копия/);
  assert.doesNotMatch(more.text, /уже в 2 роликах/);
  assert.doesNotMatch(more.text, /повтор|включите свет|вспышк/i);
});

// ── Species without a key: local frame model + reference of "my critter" (core/species.js). The person sees only the unsure ones. ──
/** Fake species judgement: the verdict by file name, the rest — "mine". */
test('faces and cigarettes: the filter cuts the moment out of the shot, a whole shot with a person — to spare; a second run does not check again', async () => {
  const scanned = [];
  const privacy = { available: true, async scan(file) { scanned.push(basename(file)); const n = basename(file); if (n === 'move0.mp4') return [0, 1, 2, 3].map((t) => ({ t, kind: t <= 1 ? 'сигарета' : null })); if (n === 'move1.mp4') return [0, 1, 2, 3].map((t) => ({ t, kind: 'люди' })); return [0, 1, 2, 3].map((t) => ({ t, kind: null })); } };
  const { producer, files, lib } = setup({ noKey: true, species: fakeSpecies(), prod: { privacy, privacyPad: 0 } });
  lib.setPrivacy = (id, hits, opts) => { const { markPrivate } = privacyMod; const c = lib.get(id); const r = markPrivate(c.shots, hits, { step: 1, ...opts }); c.privacy = { checked: true, ...r }; return r; };
  const r = await producer.run(files);
  const f = (n) => r.files.find((x) => x.file.endsWith(n));
  assert.deepEqual(f('move0.mp4').privacy, { cut: 1, dropped: 0, kinds: ['сигарета'] });
  assert.deepEqual([lib.get('move0.mp4').shots[0].from, lib.get('move0.mp4').shots[0].len], [1.5, 2.5], 'cigarette before 1.5 s is cut');
  assert.deepEqual(f('move1.mp4').privacy, { cut: 0, dropped: 1, kinds: ['люди'] });
  assert.deepEqual(lib.get('move1.mp4').shots[0].defects, ['люди']);
  assert.equal(f('move2.mp4').privacy, undefined, 'clean video — no mark');
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    for (const p of man.story.pieces.filter((x) => x.clip === 'move0.mp4')) assert.ok(p.from >= 1.5, 'piece with a cigarette did not get into the clip');
    assert.ok(!man.story.pieces.some((p) => p.clip === 'move1.mp4'), 'shot with a person did not get into the clip');
  }
  const n = scanned.length;
  await producer.run(files);
  assert.equal(scanned.length, n, 'checked video is not scanned a second time');
});

function fakeSpecies(verdicts = {}, { ref = true } = {}) {
  const judged = []; const learned = [];
  return {
    judged, learned, available: true,
    hasReference: () => ref, setRef(v) { ref = v; },
    async judge(file, id) { judged.push(id); if (!ref) return { verdict: 'unsure', score: null }; const v = verdicts[basename(file)] ?? 'mine'; return { verdict: v, score: v === 'mine' ? 0.95 : 0.8, animal: v === 'empty' ? 0.1 : 1 }; },
    learn(id) { learned.push(id); return true; },
  };
}
const SPECIES_WORDS = /поссум|sugar ?glider|possum|glider/i;

test('no key, with reference: own — straight into clips, foreign and empty — no, asks only about unsure ones', async () => {
  const species = fakeSpecies({ 'jump1.mp4': 'other', 'jump2.mp4': 'empty', 'wash.mp4': 'unsure' });
  const { producer, files, lib } = setup({ noKey: true, species });
  const r = await producer.run(files);
  assert.ok(r.made.length >= 1, 'clips assembled without marking each video');
  const ask = r.decisions.find((d) => d.type === 'confirm');
  assert.ok(ask, 'unsure ones — in one batch');
  assert.deepEqual(ask.clips.map((c) => c.name), ['wash.mp4']);
  assert.match(ask.text, /^Не уверен в 1 видео/);
  assert.doesNotMatch(ask.text, /повтор|включите свет|вспышк/i);
  assert.equal(lib.get('jump1.mp4').pet, false);
  assert.equal(lib.get('jump2.mp4').pet, false);
  assert.equal(lib.get('move0.mp4').pet, true);
  const f = (n) => r.files.find((x) => x.file.endsWith(n));
  assert.deepEqual([f('jump1.mp4').notPet, f('jump1.mp4').why], [true, 'на видео не ваш зверёк'], 'what the model discarded is visible in the result with a reason');
  assert.deepEqual([f('jump2.mp4').notPet, f('jump2.mp4').why], [true, 'зверька в кадре почти нет']);
  assert.equal(f('wash.mp4').notPet, false, 'unsure one is not discarded — waits for a person');
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.ok(!man.story.pieces.some((p) => /^(jump|wash)/.test(p.clip)), 'foreign, empty and unsure are not taken');
  }
});

test('no key, model present, no reference: asks for 3–5 photos once, no clips and no "add more"; reference given — assembles', async () => {
  const species = fakeSpecies({}, { ref: false });
  const { producer, files } = setup({ noKey: true, species });
  const r = await producer.run(files);
  assert.equal(r.made.length, 0);
  const ref = r.decisions.find((d) => d.type === 'reference');
  assert.ok(ref, JSON.stringify(r.decisions.map((d) => d.type)));
  assert.match(ref.text, /3–5/);
  for (const t of ['confirm', 'more', 'missing']) assert.ok(!r.decisions.some((d) => d.type === t), `no "${t}"`);
  species.setRef(true);
  await producer.rejudge();
  const r2 = await producer.build();
  assert.ok(r2.made.length >= 1);
  assert.ok(!r2.decisions.some((d) => d.type === 'reference'));
});

test('key present, Claude says "pet present", but the model says "foreign": we do not take silently, we ask', async () => {
  const species = fakeSpecies({ 'jump1.mp4': 'other' });
  const { producer, files } = setup({ species });
  const r = await producer.run(files);
  const ask = r.decisions.find((d) => d.type === 'confirm');
  assert.deepEqual(ask?.clips.map((c) => c.name), ['jump1.mp4']);
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.ok(!man.story.pieces.some((p) => p.clip === 'jump1.mp4'));
  }
});

test('until the species is confirmed, texts do not name it; once confirmed — they can', async () => {
  const species = fakeSpecies();
  const { producer, files } = setup({ noKey: true, species });
  const r = await producer.run(files);
  assert.ok(r.made.length >= 1);
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    const texts = JSON.stringify({ t: man.titles, a: man.packagesA, b: man.packagesB, p: man.packages, w: man.welfare });
    assert.doesNotMatch(texts, SPECIES_WORDS);
    assert.doesNotMatch(readFileSync(join(m.dir, 'пост.txt'), 'utf8'), SPECIES_WORDS);
  }
  for (const d of r.decisions) assert.doesNotMatch(d.text, SPECIES_WORDS);
  const s2 = setup({ noKey: true, species: fakeSpecies(), prod: { speciesName: { ru: 'сахарный поссум', en: 'sugar glider', tag: 'сахарныйпоссум' } } });
  const r2 = await s2.producer.run(s2.files);
  const man2 = JSON.parse(readFileSync(join(r2.made[0].dir, 'manifest.json'), 'utf8'));
  assert.match(JSON.stringify(man2.packagesA), /сахарныйпоссум/);
});

test('night care note — if at least one piece of the clip is at night, not only the majority', () => {
  const lib = { get: (id) => ({ n: { night: true }, d1: { night: false }, d2: { night: false } })[id] };
  assert.equal(isNight({ pieces: [{ clip: 'd1' }, { clip: 'd2' }, { clip: 'n' }] }, lib), true);
  assert.equal(isNight({ pieces: [{ clip: 'd1' }, { clip: 'd2' }] }, lib), false);
});

// The owner enters the Claude key — entering it means he agrees to the calls. The text source — by the fact of the answer.
const aiClient = (reply) => {
  const asked = [];
  return { asked, beta: { messages: { create: async (req) => { asked.push(req); if (reply instanceof Error) throw reply; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] }; } } } };
};
const CLAUDE_TEXT = { titleRu: 'Зверёк нашёл тыкву и не отдаёт', titleEn: 'Found a pumpkin, not sharing', descRu: 'Ночной обход: тыква, апельсин и ни капли стыда.', tags: ['тыква', 'зверёк'] };

test('key present: texts A from Claude, texts.source = claude, post with Claude text; B — fallback template', async () => {
  const c = aiClient(CLAUDE_TEXT);
  const ai = createAi({ apiKey: 'test-key-not-real', client: c });
  const { producer, files } = setup({ prod: { ai } });
  const r = await producer.run(files);
  assert.ok(r.made.length >= 1);
  assert.equal(c.asked.length, r.made.length, 'one call per clip');
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.equal(man.texts.source, 'claude');
    assert.equal(man.titles.A.ru, CLAUDE_TEXT.titleRu);
    assert.match(man.packagesA.youtube.title, /тыкву/);
    assert.match(man.packagesA.instagram.caption, /апельсин/);
    assert.doesNotMatch(man.packagesB.youtube.title, /тыкву/, 'B stays a template');
    assert.match(readFileSync(join(m.dir, 'пост.txt'), 'utf8'), /тыкву/);
    assert.equal(m.textsSource, 'claude');
  }
});

test('key present, network down: template and an honest reason; without key — template without calls', async () => {
  const c = aiClient(new Error('getaddrinfo ENOTFOUND api.anthropic.com'));
  const { producer, files } = setup({ prod: { ai: createAi({ apiKey: 'test-key-not-real', client: c }) } });
  const r = await producer.run(files);
  assert.ok(r.made.length >= 1 && c.asked.length >= 1);
  const man = JSON.parse(readFileSync(join(r.made[0].dir, 'manifest.json'), 'utf8'));
  assert.equal(man.texts.source, 'шаблон');
  assert.match(man.texts.reason, /Claude недоступен/);
  assert.doesNotMatch(man.texts.reason, /test-key-not-real/);
  assert.equal(r.made[0].textsSource, 'шаблон');

  const s2 = setup({ noKey: true, species: fakeSpecies(), prod: { ai: createAi({ apiKey: '' }) } });
  const r2 = await s2.producer.run(s2.files);
  const man2 = JSON.parse(readFileSync(join(r2.made[0].dir, 'manifest.json'), 'utf8'));
  assert.equal(man2.texts.source, 'шаблон');
  assert.match(man2.texts.reason, /нет ключа/);
});

test('Claude sent forbidden content (light, flash, repeat) — the text is not taken, template with a reason', async () => {
  const c = aiClient({ ...CLAUDE_TEXT, descRu: 'Включите свет и снимите со вспышкой!' });
  const { producer, files } = setup({ prod: { ai: createAi({ apiKey: 'test-key-not-real', client: c }) } });
  const r = await producer.run(files);
  const man = JSON.parse(readFileSync(join(r.made[0].dir, 'manifest.json'), 'utf8'));
  assert.equal(man.texts.source, 'шаблон');
  assert.match(man.texts.reason, /не подошёл/);
  assert.doesNotMatch(JSON.stringify(man.packagesA), /вспышк|включите свет/i);
});

test('template texts name the species if the owner confirmed it', async () => {
  const { storyTexts, withSpecies } = await import('../core/producer.js');
  const sp = { ru: 'сахарный поссум', en: 'sugar glider' };
  const story = { kind: 'top5', variant: 2 };
  const t = withSpecies({ ru: 'Пять моментов из жизни зверька', en: '5 moments' }, sp);
  assert.equal(t.ru, 'Сахарный поссум: пять моментов из жизни зверька');
  assert.match(t.en, /^Sugar glider: /);
  assert.match(storyTexts(story, t, sp).descRu, /^Сахарный поссум\. /);
  assert.deepEqual(withSpecies({ ru: 'Пять', en: 'Five' }, null), { ru: 'Пять', en: 'Five' }, 'species not confirmed — we do not name it');
  assert.doesNotMatch(storyTexts(story, { ru: 'x', en: 'x' }, null).descRu, /поссум/i);
});

// The batch was analysed while there was no model (or the check failed): before the stories, the build re-checks the videos itself.
// Otherwise a hand with a cigarette from an unchecked video gets into the video (IMG_0125, run of 15.11).
const privSetLib = (lib) => { lib.setPrivacy = (id, hits, opts) => { const c = lib.get(id); const r = privacyMod.markPrivate(c.shots, hits, { step: 1, ...opts }); c.privacy = { checked: true, ...r }; return r; }; };
const smoke = (bad) => async (file) => { const n = basename(file); return [0, 1, 2, 3].map((t) => ({ t, kind: n === bad ? 'сигарета' : null })); };
const pieces = async (made) => made.flatMap((m) => JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8')).story.pieces);

test('privacy: a video analysed without a check — assembly inspects it before stories; a cigarette does not get into the clip', async () => {
  const scanned = [];
  const privacy = { available: false, async scan(f) { scanned.push(basename(f)); return smoke('move0.mp4')(f); } };
  const { producer, files, lib } = setup({ noKey: true, species: fakeSpecies(), prod: { privacy, privacyPad: 0 } });
  privSetLib(lib);
  for (const f of files) { try { await producer.ingestOne(f); } catch { /* broken — skipped */ } }
  assert.equal(scanned.length, 0, 'there was no model during analysis');
  privacy.available = true;
  const r = await producer.build();
  assert.ok(scanned.includes('move0.mp4'), 'unchecked video was inspected during assembly');
  assert.equal(lib.get('move0.mp4').privacy?.checked, true);
  assert.ok(r.made.length > 0);
  assert.ok(!(await pieces(r.made)).some((p) => p.clip === 'move0.mp4'), 'shot with a cigarette did not get into the clip');
  const n = scanned.length;
  await producer.build();
  assert.equal(scanned.length, n, 'checked video is not scanned a second time');
});

test('privacy: video check failed — the video does not go into clips, the error is visible, not swallowed', async () => {
  const privacy = { available: true, async scan(f) { if (basename(f) === 'move0.mp4') throw new Error('модель не открылась'); return smoke(null)(f); } };
  const { producer, files, lib } = setup({ noKey: true, species: fakeSpecies(), prod: { privacy, privacyPad: 0 } });
  privSetLib(lib);
  const r = await producer.run(files);
  assert.ok(r.made.length > 0);
  assert.ok(!(await pieces(r.made)).some((p) => p.clip === 'move0.mp4'), 'unchecked video did not get into the clip');
  const e = r.errors.find((x) => x.file === 'move0.mp4');
  assert.ok(e, 'check error in the batch result');
  assert.match(e.error, /лиц и сигарет/);
});

test('privacy: no model — clips are assembled, but each marked "face and cigarette check was not done"', async () => {
  const { producer, files } = setup({ noKey: true, species: fakeSpecies(), prod: { privacy: { available: false, async scan() { return []; } } } });
  const r = await producer.run(files);
  assert.ok(r.made.length > 0);
  for (const m of r.made) assert.match(m.needsReview ?? '', /лиц и сигарет/);
  assert.ok(r.decisions.some((d) => d.type === 'privacy' && /не было/.test(d.text)));
});
