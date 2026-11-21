// Round 16 (the director's remarks on r2): a hand is a spike, not a hold; the "face" window on a confirmed video;
// the second clean piece of the plan is not lost; a refusal — with a hint on how to reshoot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privacyHits, markPrivate, momentWindow, createPrivacy } from '../core/privacy.js';
import { petFate } from '../core/producer.js';
import { createLibrary } from '../core/library.js';

const nrm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
// labels: 0 — hand, 1 — animal, 2 — cigarette
const P = { labels: ['hand', 'animal', 'cigarette'], kind: ['рука', null, 'сигарета'], vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], scale: 10 };
const calm = nrm([0.9, 1, 0]);   // hand share about 0.3: the animal is in the palm, the face is visible
const grab = [1, 0, 0];          // hand filling the whole frame

test('hand: a spike relative to the normal level of the clip is a defect, holding in a palm for the whole clip is not', () => {
  const spike = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => ({ t, v: t === 5 || t === 6 ? grab : calm }));
  const r = privacyHits(spike, { ...P, only: 'рука', threshold: 0.5, rise: 0.25, minRun: 2 });
  assert.deepEqual(r.filter((h) => h.kind).map((h) => h.t), [5, 6]);
  const hold = [0, 1, 2, 3, 4, 5].map((t) => ({ t, v: grab }));
  assert.deepEqual(privacyHits(hold, { ...P, only: 'рука', threshold: 0.5, rise: 0.25, minRun: 2 }).filter((h) => h.kind), [], 'holding the whole clip — not "hand at the face"');
  assert.equal(privacyHits(hold, { ...P, only: 'рука', threshold: 0.5, minRun: 2 }).filter((h) => h.kind).length, 6, 'without rise — the old threshold rule');
});

test('hand: the "hand" pass settings have a spike rule', () => {
  const p = JSON.parse(readFileSync(new URL('../core/clip-labels.json', import.meta.url), 'utf8')).privacy;
  const pass = p.passes.find((x) => x.kind === 'рука');
  assert.ok(pass.rise > 0 && pass.rise < 0.5, 'rise is set');
  assert.ok(p.moment && p.moment.len >= 2 && p.moment.len <= 3, 'face window 2–3 s');
});

test('cigarette: a fist (hand share above cigarette share) — not a cigarette', () => {
  const fist = nrm([1, 0.2, 0.95]);   // hand share higher
  const cig = nrm([0.3, 0.2, 1]);     // cigarette clearly
  const fr = [0, 0.5, 1, 1.5].map((t) => ({ t, v: t < 1 ? fist : cig }));
  const r = privacyHits(fr, { ...P, only: 'сигарета', threshold: 0.3, minRun: 2, over: ['рука'] });
  assert.deepEqual(r.map((h) => h.kind), [null, null, 'сигарета', 'сигарета']);
  const p = JSON.parse(readFileSync(new URL('../core/clip-labels.json', import.meta.url), 'utf8')).privacy;
  assert.deepEqual(p.passes.find((x) => x.kind === 'сигарета').over, ['рука']);
});

// frames: the background is the same, at 9–10.5 s — the face close up (a new view of the frame)
const A = nrm([1, 0.1, 0, 0]), B = nrm([0.7, 0.7, 0.1, 0]);
const film = (f) => Array.from({ length: 29 }, (_, k) => k * 0.5).map((t) => ({ t, v: f(t) }));

test('face window: the newest-looking place of the clip, 2 s, outside cut moments', () => {
  const m = momentWindow(film((t) => (t >= 9 && t <= 10.5 ? B : A)), { len: 2 });
  assert.ok(m, 'window found');
  assert.ok(m.from >= 8.5 && m.to <= 11.5, `window ${m.from}–${m.to}`);
  assert.ok(m.t >= 9 && m.t <= 10.5);
  const skip = momentWindow(film((t) => (t >= 9 && t <= 10.5 ? B : A)), { len: 2, skip: [9, 9.5, 10, 10.5] });
  assert.equal(skip, null, 'a cut-out (hand) does not become a face window');
  assert.equal(momentWindow(film(() => A), { len: 2 }), null, 'flat clip — no window');
  assert.equal(momentWindow([], { len: 2 }), null);
});

test('createPrivacy: scan returns the face window without cut moments', async () => {
  const fr = film((t) => (t >= 9 && t <= 10.5 ? nrm([0.3, 1, 0]) : t >= 5 && t <= 6 ? grab : calm));
  const embedder = { available: true, embedAt: async () => fr };
  const pr = createPrivacy({ embedder, labels: { ...P, passes: [{ kind: 'рука', grid: 1, step: 0.5, threshold: 0.5, rise: 0.25, minRun: 2 }], moment: { grid: 1, step: 0.5, len: 2 } } });
  const hits = await pr.scan('a.mov');
  assert.ok(hits.some((h) => h.kind === 'рука' && h.t === 5));
  assert.ok(hits.moment && hits.moment.t >= 9 && hits.moment.t <= 10.5, JSON.stringify(hits.moment));
});

const shot = (from, len) => ({ from, len, best: { t: from + len / 2, kind: 'move', score: 1 }, peaks: [{ t: from + 1, kind: 'move', score: 0.5 }], labels: ['движение'], defects: [], score: 0.8, why: 'движение' });

test('hand in the middle of a plan: both clean pieces remain (0–3.5 and 8.5–13), the second becomes a new plan at the end', () => {
  const shots = [shot(0, 13)];
  const hits = [5, 6, 7].map((t) => ({ t, kind: 'рука' }));
  const r = markPrivate(shots, hits, { step: 1, pad: 1, minLen: 1.5 });
  const parts = shots.map((s) => [s.from, +(s.from + s.len).toFixed(3)]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(parts, [[0, 3.5], [8.5, 13]]);
  assert.ok(shots.every((s) => !s.defects.length && s.best.t >= s.from && s.best.t <= s.from + s.len));
  assert.equal(r.cut, 1);
});

test('confirmed video: best moment of the plan — face window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r16-'));
  try {
    const lib = createLibrary({ path: join(dir, 'lib.json'), baseDir: dir });
    lib.ingest(join(dir, 'a.mov'), { info: { duration: 14, width: 1080, height: 1920 }, shots: [] }, { id: 'a' });
    lib.get('a').shots = [shot(0, 14)];
    const hits = [0, 1, 2].map((t) => ({ t, kind: null }));
    hits.moment = { from: 9, to: 11, t: 9.75, nov: 0.05 };
    lib.setPrivacy('a', hits, { pad: 1 });
    assert.equal(lib.get('a').shots[0].best.t, 7, 'until confirmed — best moment unchanged');
    lib.setPet('a', true);
    const s = lib.get('a').shots[0];
    assert.equal(s.best.t, 9.75);
    assert.equal(s.best.kind, 'мордочка');
    assert.ok(s.peaks.some((p) => p.t === 9.75));
    lib.setPet('a', true);
    assert.equal(lib.get('a').shots[0].peaks.filter((p) => p.kind === 'мордочка').length, 1, 'repeated mark does not create peaks');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refusal without usable pieces — with a hint on how to reshoot; dark — without advice about light', () => {
  const c = { id: 'c', name: 'IMG_0128.MOV', night: false, used: [], shots: [{ defects: ['рука'], luma: 120, labels: [] }] };
  const f = petFate(c, []);
  assert.match(f.text, /^IMG_0128: .*зверька не видно.*переснимите 2–3 с у мордочки/);
  assert.doesNotMatch(f.text, /повтор|включите свет|вспышк/i);
  const dark = { ...c, shots: [{ defects: ['чёрный'], luma: 6, labels: [] }] };
  assert.match(petFate(dark, []).text, /тёмные/);
  assert.doesNotMatch(petFate(dark, []).text, /повтор|включите свет|вспышк/i);
});
