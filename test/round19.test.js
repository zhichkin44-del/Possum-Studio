// Round 19 (sheets r3): in IMG_0129 the animal is held in hands the whole video, and a piece got into the video where it is clutched
// in a fist and only the tail is visible. The director's rule: from such a video — only the face window (about 9–11 s).
// Sign: the share of moments "a person holds the animal" is almost 1 (0129 — 1.00, the other videos ≤ 0.50).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivacy } from '../core/privacy.js';
import { createLibrary } from '../core/library.js';

const nrm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
// labels: 0 — bare hand, 1 — animal in hands, 2 — cigarette, 3 — animal on the table
const P = { labels: ['a human hand', 'a person holding a small animal', 'cigarette', 'a small furry animal'], kind: ['рука', 'рука', 'сигарета', null], vectors: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], scale: 10 };
const HELD = { labels: ['a person holding a small animal'], threshold: 0.5, share: 0.8 };
const film = (f, n = 20) => Array.from({ length: n }, (_, k) => k * 0.5).map((t) => ({ t, v: f(t) }));
const inHands = nrm([0.1, 1, 0, 0.2]);
const onTable = nrm([0, 0.2, 0, 1]);

test('in settings — the "whole clip in hands" rule', () => {
  const p = JSON.parse(readFileSync(new URL('../core/clip-labels.json', import.meta.url), 'utf8')).privacy;
  assert.ok(p.held?.labels?.length >= 1 && p.held.labels.every((l) => p.labels.includes(l)));
  assert.ok(p.held.share >= 0.7 && p.held.share < 1);
});

test('createPrivacy: held only when the pet is held for almost the whole clip', async () => {
  const mk = (f) => createPrivacy({ embedder: { available: true, embedAt: async () => film(f) }, labels: { ...P, passes: [{ kind: 'сигарета', grid: 1, threshold: 0.9, minRun: 2 }], moment: { grid: 1, step: 0.5, len: 2 }, held: HELD } });
  assert.equal((await mk(() => inHands).scan('a.mov')).held?.held, true);
  assert.equal((await mk(() => onTable).scan('b.mov')).held?.held, false);
  assert.equal((await mk((t) => (t < 6 ? onTable : inHands)).scan('c.mov')).held?.held, false);
});

const shot = (from, len) => ({ from, len, best: { t: from + 1, kind: 'move', score: 1 }, peaks: [], labels: ['движение'], defects: [], score: 0.8, why: 'движение' });

test('video "in hands": only a piece with the face window is usable, the rest go to the "pet not visible" spare', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r19-'));
  try {
    const lib = createLibrary({ path: join(dir, 'lib.json'), baseDir: dir });
    lib.ingest(join(dir, 'h.mov'), { info: { duration: 17, width: 1080, height: 1920 }, shots: [] }, { id: 'h' });
    lib.get('h').shots = [shot(0, 3), shot(3, 3), shot(6, 3), shot(9, 3), shot(12, 5)];
    lib.setPet('h', true);
    const hits = [0, 1, 2].map((t) => ({ t, kind: null }));
    hits.moment = { t: 10, from: 9, to: 11 };
    hits.held = { share: 1, held: true };
    lib.setPrivacy('h', hits); lib.setPrivacy('h', hits);
    const s = lib.get('h').shots;
    assert.deepEqual(s.map((x) => x.defects.length === 0), [false, false, false, true, false]);
    assert.ok(s.every((x) => x.defects.filter((d) => d === 'нет зверька').length <= 1), 'a repeat does not multiply defects');
    assert.equal(s[3].best.kind, 'мордочка');
    assert.match(s[0].why, /в руках/);

    // without a face window we cut nothing: there is nothing to decide with
    lib.ingest(join(dir, 'n.mov'), { info: { duration: 6, width: 1080, height: 1920 }, shots: [] }, { id: 'n' });
    lib.get('n').shots = [shot(0, 3), shot(3, 3)];
    lib.setPet('n', true);
    const h2 = [0].map((t) => ({ t, kind: null })); h2.moment = null; h2.held = { share: 1, held: true };
    lib.setPrivacy('n', h2);
    assert.ok(lib.get('n').shots.every((x) => !x.defects.length));

    // animal on the table — pieces are left alone
    lib.ingest(join(dir, 't.mov'), { info: { duration: 6, width: 1080, height: 1920 }, shots: [] }, { id: 't' });
    lib.get('t').shots = [shot(0, 3), shot(3, 3)];
    const h3 = [0].map((t) => ({ t, kind: null })); h3.moment = { t: 4, from: 3, to: 5 }; h3.held = { share: 0.1, held: false };
    lib.setPrivacy('t', h3);
    assert.ok(lib.get('t').shots.every((x) => !x.defects.length));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
