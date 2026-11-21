// Round 20 (viewers r4, average 5.50): pieces of one video are placed back to back ("one source, twice over");
// the hook — a blurred piece with a finger; the face of 0120 starts before it (a hand in the frame); blurred jumps with a squeak
// look like a fall; "Episode N" fades out after a second.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStories, pieceAround } from '../core/stories.js';
import { buildStoryArgs } from '../core/story-render.js';

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();
function shot(from, len, labels, score = 0.6, extra = {}) {
  return { from, len, score, best: { t: from + len / 2, kind: 'move', score }, peaks: [], labels, defects: [], why: 'план', hash: null, sharp: 0.5, motion: 5, ...extra };
}
function clip(id, shots, extra = {}) {
  return { id, name: `${id}.mp4`, rel: `${id}.mp4`, orient: 'vertical', hasAudio: true, created: null, night: false, shots, labels: [], stars: 0, used: [], vision: null, ...extra };
}
function fakeLib(clips) {
  const db = Object.fromEntries(clips.map((c) => [c.id, c]));
  return {
    all: () => Object.values(db),
    get: (id) => db[id] ?? null,
    realPath: (c) => `/v/${c.rel}`,
    isFree(id, i) { const s = db[id]?.shots[i]; return Boolean(s && !s.defects.length && !db[id].used.some((u) => u.shot === i && NOW - u.at < 7 * DAY)); },
    markUsed(id, s, story, at) { db[id].used.push({ shot: s, story, at }); },
  };
}
const top5Of = (clips) => makeStories(fakeLib(clips), { history: [], now: NOW, count: 1 }).find((s) => s.kind === 'top5');
const adjacent = (ps) => ps.some((p, k) => k > 0 && ps[k - 1].clip === p.clip);

test('top-5: pieces of one video do not stand together; with enough videos — one piece per video', () => {
  // two videos with two best shots each: before, they were taken in pairs and ran back to back
  const clips = [
    clip('a', [shot(0, 4, ['движение'], 0.9), shot(4, 4, ['движение'], 0.88)]),
    clip('b', [shot(0, 4, ['движение'], 0.86), shot(4, 4, ['движение'], 0.85)]),
    clip('c', [shot(0, 4, ['движение'], 0.7)]),
    clip('d', [shot(0, 4, ['движение'], 0.65)]),
    clip('e', [shot(0, 4, ['движение'], 0.6)]),
  ];
  const t = top5Of(clips);
  assert.ok(t);
  assert.equal(new Set(t.pieces.map((p) => p.clip)).size, 5, 'five videos — five different sources');
  // few videos: two pieces from one video are allowed, but not back to back
  const t2 = top5Of(clips.slice(0, 3).concat(clip('f', [shot(0, 4, ['движение'], 0.5)])));
  assert.ok(t2);
  assert.ok(!adjacent(t2.pieces), t2.pieces.map((p) => p.clip).join(','));
});

test('top-5: the hook is a sharp, lively piece, not a blurred one', () => {
  const clips = [
    clip('blur', [shot(0, 4, ['движение'], 0.7, { sharp: 0.3, motion: 9 })]),
    clip('sharp', [shot(0, 4, ['движение'], 0.7, { sharp: 0.75, motion: 6 })]),
    clip('c', [shot(0, 4, ['движение'], 0.69, { motion: 2 })]),
    clip('d', [shot(0, 4, ['движение'], 0.68, { motion: 2 })]),
    clip('e', [shot(0, 4, ['движение'], 0.95, { motion: 2 })]),
  ];
  const t = top5Of(clips);
  assert.equal(t.pieces[0].clip, 'sharp');
  assert.equal(t.pieces.at(-1).clip, 'e', 'best stays №1');
});

test('top-5: a blurred jump with a squeak — not the hook and not at the start', () => {
  const clips = [
    clip('fall', [shot(0, 4, ['движение', 'прыжок', 'писк'], 0.8, { sharp: 0.34, motion: 12 })]),
    clip('b', [shot(0, 4, ['движение'], 0.7)]),
    clip('c', [shot(0, 4, ['движение'], 0.69)]),
    clip('d', [shot(0, 4, ['движение'], 0.68)]),
    clip('e', [shot(0, 4, ['движение'], 0.67)]),
    clip('f', [shot(0, 4, ['движение'], 0.66)]),
  ];
  const t = top5Of(clips);
  assert.ok(!t.pieces.some((p) => p.clip === 'fall'), 'five clean pieces exist — the blurred jump is not needed');
});

test('a piece with a face starts at the face itself: the hand before it does not get into the clip', () => {
  const c = clip('h', [shot(4, 9, ['движение'])]);
  c.shots[0].best = { t: 8, kind: 'мордочка', score: 1 };
  const p = pieceAround(c, 0, 3.5);
  assert.equal(p.from, 8);
  assert.equal(p.len, 3.5);
  assert.equal(p.peak, 0);
  // the face near the end of the shot — the piece does not go past the shot
  c.shots[0].best.t = 12;
  const q = pieceAround(c, 0, 3.5);
  assert.ok(q.from + q.len <= 13 + 1e-9 && q.from >= 4);
});

test('series: blurred jumps with a squeak are not an "episode"; a video with clean pieces is taken', () => {
  const blur = clip('blur', [0, 1, 2, 3].map((k) => shot(k * 5, 5, ['движение', ...(k % 2 ? ['прыжок', 'писк'] : [])], 0.7, { sharp: 0.35 })));
  const clean = clip('clean', [0, 1, 2, 3].map((k) => shot(k * 5, 5, ['движение'], 0.6)));
  const lib = fakeLib([blur, clean]);
  const s = makeStories(lib, { history: [{ kind: 'top5', at: NOW - DAY }], now: NOW, count: 3 }).find((x) => x.kind === 'series');
  assert.ok(s, 'series assembled');
  assert.ok(s.pieces.every((p) => p.clip === 'clean'), s.pieces.map((p) => `${p.clip}:${p.shot}`).join(','));
});

test('"Episode N" holds for the whole clip, not for one second', () => {
  const clean = clip('clean', [0, 1, 2, 3].map((k) => shot(k * 5, 5, ['движение'], 0.6)));
  const s = makeStories(fakeLib([clean]), { history: [{ kind: 'top5', at: NOW - DAY }], now: NOW, count: 1 }).find((x) => x.kind === 'series');
  assert.ok(s);
  assert.match(s.pieces[0].caption, /^Эпизод \d+$/);
  assert.equal(s.pieces[0].hold, true);
  const args = buildStoryArgs({ pieces: [{ src: 'a', from: 0, len: 5, hasAudio: true, orient: 'vertical', hold: true }, { src: 'a', from: 5, len: 5, hasAudio: true, orient: 'vertical' }], out: 'o.mp4', captionFiles: [['c0.txt'], []] });
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /c0\.txt[^,]*between\(t,0\.000,9\.980\)/);
});
