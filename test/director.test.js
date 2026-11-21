// Director "What to shoot today": day template, AI on top of the template, what is already shot, editing in frame order. Network and AI are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCENARIOS, LIGHT, pickScenario, aiScenario, coverage, orderByScenario, dayKey } from '../core/director.js';
import { KINDS } from '../core/stories.js';
import { createStudio } from '../core/studio.js';
import { setVault } from '../core/settings.js';
import { fakeVault } from './vault.js';

setVault(fakeVault());
const NOW = new Date('2026-11-16T12:00:00').getTime();

test('templates: one per story type, every shot has light without flash and labels', () => {
  assert.deepEqual(new Set(SCENARIOS.map((s) => s.kind)), new Set(KINDS));
  for (const s of SCENARIOS) for (const x of s.shots) {
    assert.equal(x.light, LIGHT);
    assert.ok(x.labels.length && x.what && x.angle && x.secs);
    assert.doesNotMatch(`${x.what} ${x.angle}`, /вспышк|белый свет/i);
  }
});

test('pickScenario: shot numbers, date, hands reminder; does not repeat the last calendar type', () => {
  const s = pickScenario({ now: NOW });
  assert.equal(s.date, dayKey(NOW));
  assert.equal(s.source, 'шаблон');
  assert.deepEqual(s.shots.map((x) => x.n), s.shots.map((_, i) => i + 1));
  assert.match(s.note, /без лица/);
  const again = pickScenario({ now: NOW, history: [{ kind: 'calm', at: 1 }, { kind: s.kind, at: 2 }] });
  assert.notEqual(again.kind, s.kind);
  const older = pickScenario({ now: NOW, history: [{ kind: s.kind, at: 2 }, { kind: 'zzz', at: 1 }] });
  assert.notEqual(older.kind, s.kind, 'last — by time, not by list order');
});

const fakeAi = (reply) => ({ enabled: true, async json() { if (reply instanceof Error) throw reply; return reply; } });

test('aiScenario: AI texts over the template, labels and light stay ours', async () => {
  const base = pickScenario({ now: NOW });
  const s = await aiScenario(fakeAi({ title: 'Новый', hook: 'Смотри!', shots: base.shots.map((_, i) => ({ what: `кадр ${i}`, angle: 'сбоку', secs: '10 с' })) }), base);
  assert.equal(s.source, 'ИИ');
  assert.equal(s.title, 'Новый');
  assert.equal(s.shots[0].what, 'кадр 0');
  assert.deepEqual(s.shots.map((x) => x.labels), base.shots.map((x) => x.labels));
  assert.ok(s.shots.every((x) => x.light === LIGHT));
});

test('aiScenario: no key, incomplete response, flash or error — template with a reason', async () => {
  const base = pickScenario({ now: NOW });
  assert.equal(await aiScenario({ enabled: false }, base), base);
  const short = await aiScenario(fakeAi({ title: 'x', hook: 'y', shots: [] }), base);
  assert.equal(short.source, 'шаблон'); assert.match(short.fallbackReason, /неполный/);
  const flash = await aiScenario(fakeAi({ title: 'x', hook: 'y', shots: base.shots.map(() => ({ what: 'снимай со вспышкой', angle: 'a', secs: '1' })) }), base);
  assert.equal(flash.title, base.title); assert.match(flash.fallbackReason, /вредно/);
  const down = await aiScenario(fakeAi(new Error('сеть упала')), base);
  assert.match(down.fallbackReason, /ИИ недоступен/);
});

test('coverage: fresh good plans of own pet cover shots; defective, foreign and yesterday ones do not', () => {
  const sc = { date: dayKey(NOW), shots: [{ n: 1, labels: ['ест'] }, { n: 2, labels: ['прыжок'] }, { n: 3, labels: ['спит'] }] };
  const today = NOW - 3600e3;
  const clips = [
    { id: 'a', name: 'a.mp4', addedAt: today, shots: [{ labels: ['ест'], defects: [] }, { labels: ['прыжок'], defects: ['размыто'] }] },
    { id: 'b', name: 'b.mp4', addedAt: today, pet: false, shots: [{ labels: ['прыжок'], defects: [] }] },
    { id: 'c', name: 'c.mp4', addedAt: NOW - 2 * 864e5, shots: [{ labels: ['спит'], defects: [] }] },
  ];
  const c = coverage(sc, clips);
  assert.deepEqual(c.shots.map((s) => s.have), [true, false, false]);
  assert.equal(c.done, 1); assert.equal(c.total, 3);
  assert.deepEqual(c.missing, [2, 3]);
  assert.deepEqual(c.shots[0].found, [{ clip: 'a', shot: 0, name: 'a.mp4' }]);
});

test('orderByScenario: clips in shot order, captions and "hold" stay in place', () => {
  const sc = SCENARIOS.find((s) => s.kind === 'top5');
  const L = { p1: ['умывается'], p2: ['ест'], p3: ['прыжок'] };
  const story = { kind: 'top5', pieces: [
    { id: 'p1', caption: '№3' }, { id: 'p2', caption: '№2' }, { id: 'p3', caption: '№1', hold: true },
  ] };
  const out = orderByScenario(story, sc, (p) => L[p.id]);
  assert.deepEqual(out.pieces.map((p) => p.id), ['p2', 'p3', 'p1']);
  assert.deepEqual(out.pieces.map((p) => p.caption), ['№3', '№2', '№1']);
  assert.deepEqual(out.pieces.map((p) => Boolean(p.hold)), [false, false, true]);
  assert.equal(out.byScenario, 'five');
});

test('orderByScenario: other type, "day" and "first/then" are left alone', () => {
  const day = SCENARIOS.find((s) => s.kind === 'day');
  const st = { kind: 'day', pieces: [{ id: 'x' }, { id: 'y' }] };
  assert.equal(orderByScenario(st, day, () => ['ест']), st);
  const top = { kind: 'top5', pieces: [{ id: 'x' }] };
  assert.equal(orderByScenario(top, day, () => []), top);
  assert.equal(orderByScenario(top, null, () => []), top);
});

test('studio.today: scenario once a day, without key — template, "Another scenario" rewrites it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-today-'));
  let calls = 0;
  const aiFactory = () => ({ enabled: false, async json() { calls++; return {}; } });
  const studio = createStudio({ path: join(root, 'cfg', 'settings.json'), dataRoot: join(root, 'data'), media: { tools: {} }, aiFactory, now: () => NOW });
  const a = await studio.today();
  assert.equal(a.scenario.source, 'шаблон');
  assert.equal(a.coverage.total, a.scenario.shots.length);
  assert.ok(existsSync(join(root, 'data', '.today.json')));
  const b = await studio.today();
  assert.deepEqual(b.scenario, a.scenario);
  const c = await studio.today({ refresh: true });
  assert.equal(c.scenario.date, a.scenario.date);
  assert.equal(calls, 0);
});

test('ai.json via OpenRouter: response per schema; network error — exception with no key in the text', async () => {
  const { createAi } = await import('../core/ai.js');
  const KEY = 'sk-or-v1-REDACTEDcdef'; // fake
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"title":"Т","hook":"К","shots":[]}' }, finish_reason: 'stop' }] }) });
  assert.deepEqual(await createAi({ apiKey: KEY, fetchImpl: ok }).json({ content: 'x', schema: {} }), { title: 'Т', hook: 'К', shots: [] });
  const bad = async () => { throw new Error(`упало ${KEY}`); };
  await assert.rejects(createAi({ apiKey: KEY, fetchImpl: bad }).json({ content: 'x', schema: {} }), (e) => !e.message.includes(KEY));
  await assert.rejects(createAi({}).json({ content: 'x', schema: {} }), /no AI key/);
});
