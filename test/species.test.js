// "Is this my critter?" without a key or network: local frame model + a reference of 3–5 shots, data once.
// The vectors here are toy 4-dimensional ones: that shows the threshold borders. Thresholds are computed from the reference itself;
// a check on the real scores of the owner's 10 videos — the "owner's figures" test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { THRESHOLDS, scoreAgainst, animalShare, verdictOf, thresholdsFor, createSpecies } from '../core/species.js';

const norm = (a) => { const n = Math.hypot(...a); return a.map((x) => x / n); };
const at = (cos) => [cos, Math.sqrt(1 - cos * cos), 0, 0]; // vector with the given cosine to [1,0,0,0]
const REF = [1, 0, 0, 0];
const ANIMAL = norm([0.7, 0.7, 0, 0]);
const EMPTY = [0, 0, 0, 1];
const LABELS = { vectors: [ANIMAL, EMPTY], animal: 1 };
const emptyFrame = norm([0, 0, 0.3, 0.95]);

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('fallback thresholds (one frame in the reference): "mine" ≥0.92, "not him" <0.85, frames with the animal under 40% — empty', () => {
  assert.deepEqual(THRESHOLDS, { mine: 0.92, other: 0.85, animal: 0.4 });
  assert.deepEqual(thresholdsFor([REF]), THRESHOLDS);
  assert.deepEqual(thresholdsFor([]), THRESHOLDS);
});

test('thresholds from the reference: worst similarity of its frame to the others, "mine" −0.03, "not him" −0.12, within 0.90–0.96', () => {
  // pairwise: REF·at(.95)=.95, REF·c=.93, at(.95)·c=.8835 → worst "nearest neighbour" 0.93
  const c = norm([0.93, 0, Math.sqrt(1 - 0.93 ** 2), 0]);
  const t = thresholdsFor([REF, at(0.95), c]);
  assert.ok(near(t.mine, 0.90) && near(t.other, 0.81) && t.animal === 0.4, JSON.stringify(t));
  const same = thresholdsFor([REF, REF, REF]);
  assert.ok(near(same.mine, 0.93) && near(same.other, 0.84), 'identical frames: not stricter than 0.93 / 0.84');
  const loose = thresholdsFor([REF, at(0.6), [0, 0, 1, 0]]);
  assert.ok(near(loose.mine, 0.87) && near(loose.other, 0.78), 'different frames: not softer than 0.87 / 0.78');
});

test('owner\'s numbers: own — "mine", other animals — "not him", empty — "empty"', () => {
  // Real frame-model scores on the owner's test batch (15 files: 10 videos, 2 from a phone, 3 without the animal).
  // Reference A — 4 frames of an opossum from Opossum_in_Missouri, the reference frames' similarity to each other (worst) 0.921.
  const A = { mine: 0.921 - 0.03, other: 0.921 - 0.12, animal: 0.4 };
  const V = (score, animal = 1) => verdictOf({ score, animal }, A);
  assert.equal(V(0.972), 'mine', 'Opossum_in_Missouri');
  assert.equal(V(0.900), 'mine', 'VID_vertical_opossum');
  for (const [n, x] of [['Ringtail', 0.764], ['Martes', 0.759], ['Ferrets', 0.698], ['Rat', 0.688], ['Sugarglider', 0.672], ['Weasel', 0.630], ['Hamsters', 0.628], ['Kitten', 0.583]]) {
    assert.equal(V(x), 'other', n);
  }
  assert.equal(V(0.625, 0), 'empty', 'EMPTY');
  assert.equal(V(0.595, 0.33), 'empty', 'IMG_rotated_weasel: the animal is visible in a third of the frames');
  // Reference B — frames of VID_vertical_opossum, worst similarity 0.941: own 0.967 and 0.933, others up to 0.769, empty up to 0.671.
  const B = { mine: 0.941 - 0.03, other: 0.941 - 0.12, animal: 0.4 };
  assert.equal(verdictOf({ score: 0.967, animal: 1 }, B), 'mine');
  assert.equal(verdictOf({ score: 0.933, animal: 1 }, B), 'mine');
  assert.equal(verdictOf({ score: 0.769, animal: 1 }, B), 'other');
  assert.equal(verdictOf({ score: 0.671, animal: 0 }, B), 'empty');
});

test('score — average of the three best matches with the reference; without a reference — null', () => {
  const frames = [at(0.95), at(0.5), at(0.93), at(0.91), at(0.2)];
  assert.ok(Math.abs(scoreAgainst(frames, [REF]) - (0.95 + 0.93 + 0.91) / 3) < 1e-9);
  // to the nearest of the references
  assert.ok(Math.abs(scoreAgainst([[0, 1, 0, 0]], [REF, [0, 1, 0, 0]]) - 1) < 1e-9);
  // fewer than three frames — use all of them
  assert.ok(Math.abs(scoreAgainst([at(0.9), at(0.8)], [REF]) - 0.85) < 1e-9);
  assert.equal(scoreAgainst(frames, []), null);
  assert.equal(scoreAgainst([], [REF]), null);
});

test('share of frames with the animal — by the nearest label', () => {
  assert.equal(animalShare([ANIMAL, ANIMAL, emptyFrame, emptyFrame], LABELS), 0.5);
  assert.equal(animalShare([emptyFrame], LABELS), 0);
  assert.equal(animalShare([], LABELS), 0);
});

test('verdict at threshold boundaries', () => {
  const T = THRESHOLDS;
  assert.equal(verdictOf({ score: 0.92, animal: 1 }, T), 'mine');
  assert.equal(verdictOf({ score: 0.9199, animal: 1 }, T), 'unsure');
  assert.equal(verdictOf({ score: 0.85, animal: 1 }, T), 'unsure');
  assert.equal(verdictOf({ score: 0.8499, animal: 1 }, T), 'other');
  // few frames with the animal: a high score — unsure (we do not decide silently), a low one — empty
  assert.equal(verdictOf({ score: 0.95, animal: 0.3 }, T), 'unsure');
  assert.equal(verdictOf({ score: 0.88, animal: 0.3 }, T), 'empty');
  assert.equal(verdictOf({ score: 0.5, animal: 0.3 }, T), 'empty');
  assert.equal(verdictOf({ score: null, animal: 1 }, T), 'unsure');
});

/** Fake model: the frame vector is set by the file name. */
function fakeEmbedder(table) {
  const calls = [];
  return {
    calls, available: true,
    async embed(file, { k = 12 } = {}) { calls.push([basename(file), k]); const f = table[basename(file)]; if (!f) throw new Error('битый файл'); return f.slice(0, k); },
  };
}
const TABLE = {
  'ref1.mp4': [REF, REF, REF, REF], 'ref2.jpg': [REF], 'ref3.mp4': [at(0.99), at(0.98), at(0.97)],
  // the animal only at the end of the video: the reference takes frames with the animal, not just the first ones
  'late.mp4': [emptyFrame, emptyFrame, emptyFrame, at(0.9), REF, at(0.95), at(0.97)],
  'room.jpg': [emptyFrame], 'room.mp4': [emptyFrame, emptyFrame, emptyFrame],
  'mine.mp4': [at(0.97), at(0.95), at(0.94), at(0.3)],
  'other.mp4': [at(0.8), at(0.8), at(0.8)],
  'unsure.mp4': [at(0.88), at(0.88), at(0.88)],
  'empty.mp4': [emptyFrame, emptyFrame, emptyFrame, emptyFrame],
};
// "mine" frames must also be "animal" by label: the reference [1,0,0,0] is closer to ANIMAL than to EMPTY
const mk = (dataRoot, embedder = fakeEmbedder(TABLE)) => ({ embedder, sp: createSpecies({ dataRoot, embedder, labels: LABELS }) });

test('reference: from a video we look at 12 frames and take 3 with the animal, a photo — 1; written to disk and survives restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp, embedder } = mk(root);
  assert.equal(sp.available, true);
  assert.equal(sp.hasReference(), false);
  const r = await sp.addReference([join(root, 'ref1.mp4'), join(root, 'ref2.jpg'), join(root, 'битый.mp4')]);
  assert.deepEqual(embedder.calls.map(([, k]) => k), [12, 1, 12]);
  assert.equal(r.added, 4);
  assert.deepEqual(r.failed, ['битый.mp4']);
  assert.equal(sp.refCount(), 4);
  const again = createSpecies({ dataRoot: root, embedder: fakeEmbedder(TABLE), labels: LABELS });
  assert.equal(again.hasReference(), true);
  assert.equal(again.refCount(), 4);
});

test('reference: frames without the animal are not taken — from the video the best with the animal, a photo of an empty room is rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp } = mk(root);
  const r = await sp.addReference([join(root, 'late.mp4'), join(root, 'room.jpg')]);
  assert.equal(r.added, 3);
  assert.deepEqual(r.noAnimal, ['room.jpg']);
  for (const x of sp.refs()) assert.ok(x.v[3] < 0.5, 'the reference has no empty room');
});

test('reference: the animal is visible in fewer than 3 shots — we save nothing and say how many were found', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp } = mk(root);
  const r = await sp.addReference([join(root, 'room.jpg'), join(root, 'room.mp4')]);
  assert.equal(r.added, 0);
  assert.equal(r.found, 0);
  assert.equal(r.needMore, true);
  assert.deepEqual(r.noAnimal, ['room.jpg', 'room.mp4']);
  assert.equal(sp.hasReference(), false);
  assert.equal(existsSync(join(root, '.species', 'species.json')), false);
  const two = await sp.addReference([join(root, 'ref2.jpg'), join(root, 'ref2.jpg')]);
  assert.deepEqual([two.added, two.found, two.needMore], [0, 2, true]);
  assert.equal(sp.hasReference(), false);
});

test('reference already exists — one photo can be added too', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp } = mk(root);
  await sp.addReference([join(root, 'ref1.mp4')]);
  const r = await sp.addReference([join(root, 'ref2.jpg')]);
  assert.equal(r.added, 1);
  assert.equal(sp.refCount(), 4);
});

test('no "animal/empty" labels — the reference takes frames without selection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const sp = createSpecies({ dataRoot: root, embedder: fakeEmbedder(TABLE), labels: { vectors: [], animal: 0 } });
  const r = await sp.addReference([join(root, 'late.mp4')]);
  assert.equal(r.added, 3);
});

test('verdict by thresholds from the reference: reference of identical frames → "mine" ≥0.93, "not him" <0.84', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp } = mk(root);
  await sp.addReference([join(root, 'ref1.mp4')]);
  const v = async (n, frames) => {
    const s2 = createSpecies({ dataRoot: root, embedder: fakeEmbedder({ ...TABLE, [n]: frames }), labels: LABELS });
    return (await s2.judge(join(root, n), n)).verdict;
  };
  assert.equal(await v('x931.mp4', [at(0.931)]), 'mine');
  assert.equal(await v('x925.mp4', [at(0.925)]), 'unsure', 'with the fallback threshold 0.92 it would be "mine"');
  assert.equal(await v('x845.mp4', [at(0.845)]), 'unsure');
  assert.equal(await v('x835.mp4', [at(0.835)]), 'other', 'with the fallback threshold 0.85 it would also be "not him"');
  // explicitly set thresholds are not recomputed
  const fixed = createSpecies({ dataRoot: root, embedder: fakeEmbedder({ ...TABLE, 'y.mp4': [at(0.925)] }), labels: LABELS, thresholds: THRESHOLDS });
  assert.equal((await fixed.judge(join(root, 'y.mp4'), 'y.mp4')).verdict, 'mine');
});

test('without a reference there is nothing to judge with — "unsure", score null', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp } = mk(root);
  const j = await sp.judge(join(root, 'mine.mp4'), 'mine.mp4');
  assert.equal(j.verdict, 'unsure');
  assert.equal(j.score, null);
});

test('verdict: mine / other / unsure / empty; frames are cached and after restart the model is not called', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp, embedder } = mk(root);
  await sp.addReference([join(root, 'ref1.mp4')]);
  const v = {};
  for (const n of ['mine.mp4', 'other.mp4', 'unsure.mp4', 'empty.mp4']) v[n] = (await sp.judge(join(root, n), n)).verdict;
  assert.deepEqual(v, { 'mine.mp4': 'mine', 'other.mp4': 'other', 'unsure.mp4': 'unsure', 'empty.mp4': 'empty' });
  assert.ok(embedder.calls.filter(([n]) => n === 'mine.mp4').every(([, k]) => k === 12), 'for the verdict — 12 frames');
  assert.ok(existsSync(join(root, '.species', 'frames')));
  const e2 = fakeEmbedder(TABLE);
  const sp2 = createSpecies({ dataRoot: root, embedder: e2, labels: LABELS });
  assert.equal((await sp2.judge(join(root, 'mine.mp4'), 'mine.mp4')).verdict, 'mine');
  assert.equal(e2.calls.length, 0, 'frames were taken from cache');
});

test('verdict is recalculated against the current reference: a reference given later — "unsure" became "mine"', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp } = mk(root);
  assert.equal((await sp.judge(join(root, 'ref3.mp4'), 'ref3.mp4')).verdict, 'unsure');
  await sp.addReference([join(root, 'ref1.mp4')]);
  assert.equal((await sp.judge(join(root, 'ref3.mp4'), 'ref3.mp4')).verdict, 'mine');
});

test('learns from confirmed: one frame from the video, no duplicates, no more than 20, own photos are not displaced', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const table = { ...TABLE };
  for (let i = 0; i < 30; i++) table[`u${i}.mp4`] = [at(0.88), at(0.87), at(0.86)];
  const { sp } = mk(root, fakeEmbedder(table));
  await sp.addReference([join(root, 'ref1.mp4')]);
  const before = sp.refCount();
  await sp.judge(join(root, 'u0.mp4'), 'u0.mp4');
  assert.equal(sp.learn('u0.mp4'), true);
  assert.equal(sp.learn('u0.mp4'), false, 'the same video is not added a second time');
  assert.equal(sp.refCount(), before + 1);
  assert.equal(sp.learn('нет-кадров'), false);
  for (let i = 1; i < 30; i++) { await sp.judge(join(root, `u${i}.mp4`), `u${i}.mp4`); sp.learn(`u${i}.mp4`); }
  assert.equal(sp.refCount(), 20);
  assert.equal(sp.refs().filter((r) => r.from === 'user').length, before, 'owner photos are in place');
});

test('frame file name is safe for disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const { sp } = mk(root, fakeEmbedder({ ...TABLE, 'a:b?.mp4': [REF] }));
  await sp.judge(join(root, 'a:b?.mp4'), 'папка/a:b?.mp4');
  for (const f of readdirSync(join(root, '.species', 'frames'))) assert.doesNotMatch(f, /[\\/:*?"<>|]/);
});

test('no model — available false, verdict does not break', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const sp = createSpecies({ dataRoot: root, embedder: { available: false, embed: async () => { throw new Error('нет модели'); } }, labels: LABELS });
  assert.equal(sp.available, false);
  assert.equal((await sp.judge(join(root, 'mine.mp4'), 'mine.mp4')).verdict, 'unsure');
});

// ── Real model on the owner's video: only if POSSUM_CLIP_MODEL and VOVA_DIR are set (the model weighs 150 MB, it is not in the repo). ──
const MODEL = process.env.POSSUM_CLIP_MODEL; const VOVA = process.env.VOVA_DIR;
test('owner\'s video: reference — one possum video; among "mine" there are no foreign or empty ones, own ones are not "not him"', { skip: !(MODEL && VOVA) && 'no POSSUM_CLIP_MODEL/VOVA_DIR' }, async () => {
  const { createClipEmbedder, loadLabels } = await import('../core/species.js');
  const { readdirSync: ls } = await import('node:fs');
  const { createMedia } = await import('../core/media.js');
  const m = createMedia();
  const embedder = createClipEmbedder({ modelDir: MODEL, ffmpeg: m.tools.ffmpeg, ffprobe: m.tools.ffprobe });
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-vova-'));
  const sp = createSpecies({ dataRoot: root, embedder, labels: loadLabels() });
  const MINE = [/^Opossum_in_Missouri/, /^VID_vertical_opossum/];
  const files = ['src', 'phone', 'empty'].flatMap((d) => ls(join(VOVA, d)).map((f) => join(VOVA, d, f)));
  const r = await sp.addReference(files.filter((f) => /^Opossum_in_Missouri/.test(basename(f))));
  assert.equal(r.added, 3, 'from the video — three frames with the animal');
  const got = {};
  for (const f of files) {
    const n = basename(f); const j = await sp.judge(f, n); got[n] = j;
    if (j.verdict === 'mine') assert.ok(MINE.some((x) => x.test(n)), `foreign accepted as own: ${n}`);
    if (MINE.some((x) => x.test(n))) assert.notEqual(j.verdict, 'other', `own discarded: ${n}`);
    if (n.startsWith('EMPTY')) assert.notEqual(j.verdict, 'mine', n);
  }
  if (process.env.VOVA_PRINT) console.log(JSON.stringify(Object.fromEntries(Object.entries(got).map(([n, j]) => [n, [j.verdict, j.score, j.animal]]))));
});
