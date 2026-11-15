// Круг 16 (замечания директора по r2): рука — всплеск, а не держание; окно «мордочки» у подтверждённого видео;
// второй чистый кусок плана не теряется; отказ — с подсказкой, как переснять.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privacyHits, markPrivate, momentWindow, createPrivacy } from '../core/privacy.js';
import { petFate } from '../core/producer.js';
import { createLibrary } from '../core/library.js';

const nrm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
// подписи: 0 — рука, 1 — зверёк, 2 — сигарета
const P = { labels: ['hand', 'animal', 'cigarette'], kind: ['рука', null, 'сигарета'], vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], scale: 10 };
const calm = nrm([0.9, 1, 0]);   // доля руки около 0,3: зверёк на ладони, видно мордочку
const grab = [1, 0, 0];          // рука во весь кадр

test('рука: всплеск относительно обычного для ролика — дефект, держание в ладони весь ролик — нет', () => {
  const spike = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => ({ t, v: t === 5 || t === 6 ? grab : calm }));
  const r = privacyHits(spike, { ...P, only: 'рука', threshold: 0.5, rise: 0.25, minRun: 2 });
  assert.deepEqual(r.filter((h) => h.kind).map((h) => h.t), [5, 6]);
  const hold = [0, 1, 2, 3, 4, 5].map((t) => ({ t, v: grab }));
  assert.deepEqual(privacyHits(hold, { ...P, only: 'рука', threshold: 0.5, rise: 0.25, minRun: 2 }).filter((h) => h.kind), [], 'держание весь ролик — не «рука у морды»');
  assert.equal(privacyHits(hold, { ...P, only: 'рука', threshold: 0.5, minRun: 2 }).filter((h) => h.kind).length, 6, 'без rise — старое правило порога');
});

test('рука: в настройках прохода «рука» правило всплеска', () => {
  const p = JSON.parse(readFileSync(new URL('../core/clip-labels.json', import.meta.url), 'utf8')).privacy;
  const pass = p.passes.find((x) => x.kind === 'рука');
  assert.ok(pass.rise > 0 && pass.rise < 0.5, 'rise задан');
  assert.ok(p.moment && p.moment.len >= 2 && p.moment.len <= 3, 'окно мордочки 2–3 с');
});

test('сигарета: кулак (доля руки выше доли сигареты) — не сигарета', () => {
  const fist = nrm([1, 0.2, 0.95]);   // доля руки выше
  const cig = nrm([0.3, 0.2, 1]);     // сигарета явно
  const fr = [0, 0.5, 1, 1.5].map((t) => ({ t, v: t < 1 ? fist : cig }));
  const r = privacyHits(fr, { ...P, only: 'сигарета', threshold: 0.3, minRun: 2, over: ['рука'] });
  assert.deepEqual(r.map((h) => h.kind), [null, null, 'сигарета', 'сигарета']);
  const p = JSON.parse(readFileSync(new URL('../core/clip-labels.json', import.meta.url), 'utf8')).privacy;
  assert.deepEqual(p.passes.find((x) => x.kind === 'сигарета').over, ['рука']);
});

// кадры: фон одинаковый, на 9–10,5 с — мордочка крупно (новый вид кадра)
const A = nrm([1, 0.1, 0, 0]), B = nrm([0.7, 0.7, 0.1, 0]);
const film = (f) => Array.from({ length: 29 }, (_, k) => k * 0.5).map((t) => ({ t, v: f(t) }));

test('окно мордочки: самое новое по виду место ролика 2 с, вне вырезанных моментов', () => {
  const m = momentWindow(film((t) => (t >= 9 && t <= 10.5 ? B : A)), { len: 2 });
  assert.ok(m, 'окно найдено');
  assert.ok(m.from >= 8.5 && m.to <= 11.5, `окно ${m.from}–${m.to}`);
  assert.ok(m.t >= 9 && m.t <= 10.5);
  const skip = momentWindow(film((t) => (t >= 9 && t <= 10.5 ? B : A)), { len: 2, skip: [9, 9.5, 10, 10.5] });
  assert.equal(skip, null, 'вырезанное (рука) окном мордочки не становится');
  assert.equal(momentWindow(film(() => A), { len: 2 }), null, 'ровный ролик — окна нет');
  assert.equal(momentWindow([], { len: 2 }), null);
});

test('createPrivacy: scan отдаёт окно мордочки без вырезанных моментов', async () => {
  const fr = film((t) => (t >= 9 && t <= 10.5 ? nrm([0.3, 1, 0]) : t >= 5 && t <= 6 ? grab : calm));
  const embedder = { available: true, embedAt: async () => fr };
  const pr = createPrivacy({ embedder, labels: { ...P, passes: [{ kind: 'рука', grid: 1, step: 0.5, threshold: 0.5, rise: 0.25, minRun: 2 }], moment: { grid: 1, step: 0.5, len: 2 } } });
  const hits = await pr.scan('a.mov');
  assert.ok(hits.some((h) => h.kind === 'рука' && h.t === 5));
  assert.ok(hits.moment && hits.moment.t >= 9 && hits.moment.t <= 10.5, JSON.stringify(hits.moment));
});

const shot = (from, len) => ({ from, len, best: { t: from + len / 2, kind: 'move', score: 1 }, peaks: [{ t: from + 1, kind: 'move', score: 0.5 }], labels: ['движение'], defects: [], score: 0.8, why: 'движение' });

test('рука посреди плана: оба чистых куска остаются (0–3,5 и 8,5–13), второй — новым планом в конце', () => {
  const shots = [shot(0, 13)];
  const hits = [5, 6, 7].map((t) => ({ t, kind: 'рука' }));
  const r = markPrivate(shots, hits, { step: 1, pad: 1, minLen: 1.5 });
  const parts = shots.map((s) => [s.from, +(s.from + s.len).toFixed(3)]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(parts, [[0, 3.5], [8.5, 13]]);
  assert.ok(shots.every((s) => !s.defects.length && s.best.t >= s.from && s.best.t <= s.from + s.len));
  assert.equal(r.cut, 1);
});

test('подтверждённое видео: лучший момент плана — окно мордочки', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r16-'));
  try {
    const lib = createLibrary({ path: join(dir, 'lib.json'), baseDir: dir });
    lib.ingest(join(dir, 'a.mov'), { info: { duration: 14, width: 1080, height: 1920 }, shots: [] }, { id: 'a' });
    lib.get('a').shots = [shot(0, 14)];
    const hits = [0, 1, 2].map((t) => ({ t, kind: null }));
    hits.moment = { from: 9, to: 11, t: 9.75, nov: 0.05 };
    lib.setPrivacy('a', hits, { pad: 1 });
    assert.equal(lib.get('a').shots[0].best.t, 7, 'пока не подтверждено — лучший момент прежний');
    lib.setPet('a', true);
    const s = lib.get('a').shots[0];
    assert.equal(s.best.t, 9.75);
    assert.equal(s.best.kind, 'мордочка');
    assert.ok(s.peaks.some((p) => p.t === 9.75));
    lib.setPet('a', true);
    assert.equal(lib.get('a').shots[0].peaks.filter((p) => p.kind === 'мордочка').length, 1, 'повторная отметка не плодит пики');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('отказ без годных кусков — с подсказкой, как переснять; тёмное — без совета про свет', () => {
  const c = { id: 'c', name: 'IMG_0128.MOV', night: false, used: [], shots: [{ defects: ['рука'], luma: 120, labels: [] }] };
  const f = petFate(c, []);
  assert.match(f.text, /^IMG_0128: .*зверька не видно.*переснимите 2–3 с у мордочки/);
  assert.doesNotMatch(f.text, /повтор|включите свет|вспышк/i);
  const dark = { ...c, shots: [{ defects: ['чёрный'], luma: 6, labels: [] }] };
  assert.match(petFate(dark, []).text, /тёмные/);
  assert.doesNotMatch(petFate(dark, []).text, /повтор|включите свет|вспышк/i);
});
