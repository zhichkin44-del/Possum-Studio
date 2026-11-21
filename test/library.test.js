// Stage 2, step 1: frame features, shots, defects, duplicates, library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frameStats, dhash, hamming, FW, FH } from '../core/frames.js';
import { stepFor } from '../core/media.js';
import { detectShots, findCuts, markDuplicates, summarizeClip, splitLong, shotPrint } from '../core/shots.js';
import { createLibrary, fileId } from '../core/library.js';

// ── frames ────────────────────────────────────────────────────────────────
function frame(fn) {
  const b = Buffer.alloc(FW * FH * 3);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const [r, g, bl] = fn(x, y); const o = (y * FW + x) * 3;
    b[o] = r; b[o + 1] = g; b[o + 2] = bl;
  }
  return b;
}

test('frame: grey — no saturation (IR), colour — saturated, flat — no sharpness', () => {
  const gray = frameStats(frame(() => [90, 90, 90]));
  assert.equal(gray.sat, 0); assert.equal(gray.sharp, 0); assert.equal(Math.round(gray.luma), 90);
  const red = frameStats(frame(() => [200, 20, 20]));
  assert.ok(red.sat > 150);
  const irGrad = frameStats(frame((x) => { const v = 40 + x * 2; return [v, v, v + 2]; }));
  assert.ok(irGrad.sat < 6, 'IR frame is almost grey');
});

test('frame: checkerboard is sharper than a smooth gradient; dark checkerboard is not "blurred"', () => {
  const checker = (hi, lo) => frame((x, y) => ((((x >> 2) + (y >> 2)) & 1) ? [hi, hi, hi] : [lo, lo, lo]));
  const smooth = frameStats(frame((x, y) => { const v = (x + y) * 1.5; return [v, v, v]; }));
  const sharp = frameStats(checker(220, 30));
  const darkSharp = frameStats(checker(30, 5));
  assert.ok(sharp.sharp > smooth.sharp * 3, `${sharp.sharp} vs ${smooth.sharp}`);
  assert.ok(Math.abs(darkSharp.sharp - sharp.sharp) < 0.05, 'sharpness does not depend on brightness');
});

test('dHash: same scene brighter — same hash; another scene — far', () => {
  const scene = (k) => frame((x, y) => { const v = Math.min(255, (x * 3 + (y % 17) * 5) * k); return [v, v, v]; });
  const a = frameStats(scene(1)).hash, b = frameStats(scene(1.3)).hash;
  const c = frameStats(frame((x) => { const v = 255 - x * 3; return [v, v, v]; })).hash;
  assert.equal(a.length, 16);
  assert.ok(hamming(a, b) <= 4, `brighter: ${hamming(a, b)}`);
  assert.ok(hamming(a, c) > 20, `another scene: ${hamming(a, c)}`);
  assert.equal(hamming(a, null), 64);
  assert.equal(dhash(new Float32Array(FW * FH)), '0000000000000000');
});

test('signal step grows on long clips (≤ 2,400 samples)', () => {
  assert.equal(stepFor(30), 0.25);
  assert.equal(stepFor(900), 0.5);
  assert.equal(stepFor(3600), 1.5);
  assert.ok(3 * 3600 / stepFor(3 * 3600) <= 2400);
});

// ── shots ────────────────────────────────────────────────────────────────
const H0 = '0000000000000000', H1 = 'ffffffffffffffff', H2 = '00ff00ff00ff00ff', H3 = 'f0f0f0f0f0f0f0f0';
/** Segments → signals; at a segment joint — a splice (a frame jump and a different hash). */
function sig(segments, info = { hasAudio: true }) {
  const s = { step: 0.25, motion: [], loud: [], luma: [], sat: [], sharp: [], hash: [], info };
  for (const [k, g] of segments.entries()) {
    for (let i = 0; i < g.n; i++) {
      let m = typeof g.motion === 'function' ? g.motion(i) : g.motion ?? 1;
      if (i === 0 && k > 0) m = 80; // splice
      s.motion.push(m);
      s.loud.push(typeof g.loud === 'function' ? g.loud(i) : g.loud ?? -45);
      s.luma.push(g.luma ?? 120); s.sat.push(g.sat ?? 40); s.sharp.push(g.sharp ?? 0.5);
      s.hash.push(g.hash ?? H0);
    }
  }
  return s;
}

test('cuts split the clip into shots; a flash inside a shot is not a cut', () => {
  const s = sig([{ n: 20, hash: H0 }, { n: 24, hash: H1 }, { n: 16, hash: H2 }]);
  assert.deepEqual(findCuts(s), [0, 20, 44]);
  // a motion jump without a frame change (same hash) is a jump, not a splice
  const jump = sig([{ n: 40, hash: H0, motion: (i) => (i === 20 ? 90 : 1) }]);
  assert.deepEqual(findCuts(jump), [0]);
  const shots = detectShots(s);
  assert.equal(shots.length, 3);
  assert.deepEqual(shots.map((x) => x.from), [0, 5, 11]);
  assert.deepEqual(shots.map((x) => x.len), [5, 6, 4]);
  assert.equal(shots[1].motion < 2, true, 'a cut is not counted as shot motion');
});

test('night and IR are labels, not defects; black, blurred, short — spare', () => {
  const shots = detectShots(sig([
    { n: 20, luma: 25, sat: 30, hash: H0 },          // dark but alive
    { n: 20, luma: 60, sat: 2, hash: H1 },           // IR camera
    { n: 20, luma: 3, motion: 0, hash: H2 },         // black frame
    { n: 20, sharp: 0.03, hash: H3 },                // blurry
    { n: 3, hash: H0 },                              // 0.75 s
  ]));
  assert.deepEqual(shots[0].defects, []); assert.ok(shots[0].labels.includes('тёмное'));
  assert.deepEqual(shots[1].defects, []); assert.ok(shots[1].labels.includes('ИК'));
  assert.ok(shots[2].defects.includes('чёрный'));
  assert.ok(shots[3].defects.includes('размыто'));
  assert.ok(shots[4].defects.includes('коротко'));
  assert.ok(shots[0].score > 0 && shots[1].score > 0);
  assert.equal(shots[2].score, 0);
  assert.match(shots[2].why, /^в запас: чёрный/);
  assert.match(shots[1].why, /ночная съёмка/);
});

test('jump with a squeak: label "jump", score below calm, explained', () => {
  const shots = detectShots(sig([
    { n: 30, hash: H0, motion: 1, loud: -48 },
    { n: 30, hash: H1, motion: (i) => (i >= 14 && i <= 16 ? 14 : 1.5), loud: (i) => (i === 15 ? -20 : -48) },
  ]));
  const [calm, jump] = shots;
  assert.ok(calm.labels.includes('спокойно'));
  assert.ok(jump.labels.includes('движение') && jump.labels.includes('писк'), jump.labels.join());
  assert.ok(jump.score < calm.score, 'a sharp jump is not in favour');
  assert.ok(jump.labels.includes('прыжок'));
  assert.equal(jump.best.t, 7.5 + 3.75);
  assert.match(jump.why, /прыжок на 11.25 с.*писк/);
});

test('smooth fiddling without a spike — "movement", but not "jump"', () => {
  const [s] = detectShots(sig([{ n: 30, hash: H0, motion: (i) => 4 + (i % 3), loud: -48 }]));
  assert.ok(s.labels.includes('движение'), s.labels.join());
  assert.ok(!s.labels.includes('прыжок'), s.labels.join());
});

test('no audio track — label "no sound", not a defect', () => {
  const [s] = detectShots(sig([{ n: 20, loud: -90 }], { hasAudio: false }));
  assert.ok(s.labels.includes('без звука'));
  assert.deepEqual(s.defects, []);
});

test('dHash duplicates: the best shot stays, a similar one goes to spare; accounts for already taken ones', () => {
  const near = 'ffffffffffffff0f'; // 4 bits from H1
  const shots = detectShots(sig([
    { n: 20, hash: H1, motion: (i) => (i === 10 ? 11 : 1) }, // a spike below "jump": the best shot
    { n: 20, hash: H0 },
    { n: 20, hash: near, motion: (i) => (i === 10 ? 10 : 1) }, // the same action — a real duplicate
  ]));
  shots[2].hash = near; shots[0].hash = H1;
  const added = markDuplicates(shots);
  assert.ok(shots[2].defects.includes('дубль'), 'similar to the first — duplicate');
  assert.deepEqual(shots[0].defects, []);
  assert.equal(added.length, 2);
  const again = detectShots(sig([{ n: 20, hash: H0 }]));
  markDuplicates(again, [H0]);
  assert.ok(again[0].defects.includes('дубль'), 'already in the library');
});

test('clip summary: labels, best score, how many in spare', () => {
  const sum = summarizeClip(sig([{ n: 20, luma: 25, hash: H0 }, { n: 20, luma: 3, motion: 0, hash: H1 }]));
  assert.equal(sum.shots.length, 2);
  assert.equal(sum.spare, 1);
  assert.equal(sum.duration, 10);
  assert.ok(sum.labels.includes('тёмное'));
});

// ── library ───────────────────────────────────────────────────────────
function lib(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'possum-lib-'));
  const base = join(root, 'Поссум'); mkdirSync(join(base, 'Входящие'), { recursive: true });
  const path = join(base, 'library.json');
  let t = 1_700_000_000_000;
  const clock = { now: () => t, add: (d) => { t += d * 24 * 3600 * 1000; } };
  const make = () => createLibrary({ path, baseDir: base, now: clock.now, ...opts });
  const file = (name, body, dir = join(base, 'Входящие')) => { const p = join(dir, name); writeFileSync(p, body); return p; };
  return { root, base, path, make, file, clock };
}
const nightJump = () => sig([
  { n: 24, luma: 30, sat: 3, hash: H0, motion: (i) => (i === 12 ? 15 : 1) },
  { n: 24, luma: 140, hash: H1, motion: 0.5, loud: -44 },
], { hasAudio: true, width: 1080, height: 1920, duration: 12 });

test('library: a clip is added once, a copy under another name is also not a duplicate', () => {
  const L = lib(); const db = L.make();
  const a = L.file('a.mp4', Buffer.alloc(3000, 7));
  const r1 = db.ingest(a, nightJump());
  assert.equal(r1.added, true);
  assert.equal(r1.clip.orient, 'vertical');
  assert.equal(r1.clip.rel, 'Входящие/a.mp4');
  const copy = join(L.base, 'Входящие', 'копия.mp4'); copyFileSync(a, copy);
  assert.equal(fileId(copy), r1.clip.id);
  assert.equal(db.ingest(copy, nightJump()).added, false);
  assert.equal(db.all().length, 1);
  assert.equal(db.stats().spare, 0);
});

test('library: full user paths are not in library.json, but the file is found', () => {
  const L = lib(); const db = L.make();
  const outside = mkdtempSync(join(tmpdir(), 'possum-ext-'));
  const f = L.file('из телефона.mov', 'phone-bytes', outside);
  const { clip } = db.ingest(f, nightJump());
  const json = readFileSync(L.path, 'utf8');
  assert.ok(!json.includes(outside.replace(/\\/g, '\\\\')) && !json.includes(outside), 'path is not in library.json');
  assert.equal(clip.rel, null);
  assert.equal(L.make().realPath(L.make().get(clip.id)), f, 'after restart it is found via the local map');
});

test('library: search "jump night", "calm", defects — only on request', () => {
  const L = lib(); const db = L.make();
  db.ingest(L.file('n.mp4', 'n'), nightJump());
  db.ingest(L.file('bad.mp4', 'b'), sig([{ n: 20, luma: 2, motion: 0, hash: H2 }]));
  const hits = db.search('прыжок ночь');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].shot, 0);
  assert.match(hits[0].why, /прыжок/);
  assert.equal(db.search('спокойно')[0].shot, 1);
  assert.equal(db.search('').length, 2, 'defects are not shown');
  assert.equal(db.search('', { spare: true }).length, 3);
});

test('library: "fall/stress" from analysis blocks the shot; stars raise the clip', () => {
  const L = lib(); const db = L.make();
  const { clip } = db.ingest(L.file('n.mp4', 'n'), nightJump());
  db.setVision(clip.id, { by: 'claude', frames: [{ shot: 0, labels: ['прыжок', 'падение'] }, { shot: 1, labels: ['ест'] }], asmr: true });
  assert.ok(db.get(clip.id).shots[0].defects.includes('стресс'));
  assert.equal(db.search('прыжок').length, 0);
  assert.equal(db.search('ест').length, 1);
  assert.equal(db.search('асмр').length, 1);
  db.setStars(clip.id, 9);
  assert.equal(db.get(clip.id).stars, 5);
});

test('library: shot is free again 7 days after use', () => {
  const L = lib(); const db = L.make();
  const { clip } = db.ingest(L.file('n.mp4', 'n'), nightJump());
  assert.equal(db.isFree(clip.id, 0), true);
  db.markUsed(clip.id, 0, 'top5');
  assert.equal(db.isFree(clip.id, 0), false);
  assert.equal(db.search('прыжок', { free: true }).length, 0);
  L.clock.add(6); assert.equal(db.isFree(clip.id, 0), false);
  L.clock.add(1); assert.equal(db.isFree(clip.id, 0), true);
});

test('library: corrupted library.json — restored from .bak, broken one kept', () => {
  const L = lib(); const db = L.make();
  db.ingest(L.file('a.mp4', 'a'), nightJump());
  db.ingest(L.file('b.mp4', 'b'), nightJump()); // now .bak holds one clip
  writeFileSync(L.path, '{битый');
  const again = L.make();
  assert.equal(again.all().length, 1, 'took .bak');
  assert.ok(existsSync(`${L.path}.broken-1700000000000`));
});

test('a long shot without cuts is split into ~7 s pieces at a calm spot', () => {
  // 20 s of one shot; a motion spike at 7 s — the cut must not land in it
  const shots = detectShots(sig([{ n: 80, hash: H0, motion: (i) => (i >= 27 && i <= 29 ? 14 : 1) }]));
  assert.equal(shots.length, 3);
  for (const s of shots) { assert.ok(s.len <= 8, `piece ${s.len} s`); assert.equal(s.hashes.length, 3); }
  assert.equal(shots.reduce((x, s) => x + s.len, 0), 20);
  const cut = shots[1].from;
  assert.ok(cut < 6.75 || cut > 7.25, `cut ${cut} is not at a jump`);
  // a short shot is left alone
  assert.deepEqual(splitLong([], 0, 30, 0.25), [0]);
});

test('duplicate: the same clip rotated — different picture, but the same sound, length and motion', () => {
  const [orig] = detectShots(sig([{ n: 24, hash: H0, motion: 2, loud: -40 }]));
  const taken = [shotPrint(orig, 6)];
  const [rot] = detectShots(sig([{ n: 24, hash: H1, motion: 2.1, loud: -40 }]));
  markDuplicates([rot], taken, undefined, 6);
  assert.ok(rot.defects.includes('дубль'));
  assert.equal(rot.dupOf, H0);
  // a different clip length — not a duplicate
  const [other] = detectShots(sig([{ n: 24, hash: H1, motion: 2.1, loud: -40 }]));
  markDuplicates([other], taken, undefined, 9);
  assert.deepEqual(other.defects, []);
});

test('IR shots look alike, but different sound — not a duplicate; rows in taken still work', () => {
  const [a] = detectShots(sig([{ n: 24, hash: H0, sat: 2, luma: 60, loud: -90 }], { hasAudio: false }));
  const [b] = detectShots(sig([{ n: 24, hash: H0, sat: 2, luma: 60, loud: -50 }]));
  markDuplicates([b], [shotPrint(a, 6)], undefined, 6);
  assert.deepEqual(b.defects, [], 'one without sound, the other with sound — different shoots');
  const [c] = detectShots(sig([{ n: 24, hash: H0, loud: -50 }]));
  markDuplicates([c], [H0]);
  assert.ok(c.defects.includes('дубль'));
});

test('static camera: calm and active shot look alike, but are not duplicates of each other', () => {
  const shots = detectShots(sig([{ n: 24, hash: H0, motion: (i) => (i % 4 === 0 ? 14 : 4), loud: -50 }, { n: 24, hash: H0, motion: 0.3, loud: -50 }]));
  markDuplicates(shots, [], undefined, 12);
  assert.ok(shots.length >= 2);
  assert.ok(shots.some((s) => s.labels.includes('спокойно') && !s.defects.length), JSON.stringify(shots.map((s) => [s.labels, s.defects])));
  assert.ok(shots.some((s) => s.labels.includes('движение') && !s.defects.length));
});

test('duplicate: a recropped clip of the same length — cuts shifted, motion different, sound the same', () => {
  const orig = { from: 0, len: 5.5, loudMean: -41, motion: 31, hash: H0, hashes: [H0], defects: [], score: 0.5, labels: [] };
  const taken = [shotPrint(orig, 16.816)];
  const crop = { from: 0, len: 6.5, loudMean: -39.5, motion: 37, hash: H1, hashes: [H1], defects: [], score: 0.5, labels: [] };
  markDuplicates([crop], taken, undefined, 16.817);
  assert.ok(crop.defects.includes('дубль'));
  const other = { from: 0, len: 6.5, loudMean: -39.5, motion: 37, hash: H1, hashes: [H1], defects: [], score: 0.5, labels: [] };
  markDuplicates([other], taken, undefined, 16.4);
  assert.deepEqual(other.defects, [], 'different clip length — not a duplicate');
});

test('video copy: if most shots are duplicates of another video, the rest also go to spare', () => {
  const shot = (hash, loud, from) => ({ from, len: 3, loudMean: loud, motion: 5, hash, hashes: [hash], defects: [], score: 0.5 - from / 100, labels: [] });
  const shots = [shot(H0, -40, 0), shot(H2, -40, 3), shot(H1, -37, 6)];
  markDuplicates(shots, [H0, H2]);
  assert.deepEqual(shots.map((s) => s.defects.includes('дубль')), [true, true, true]);
  assert.equal(shots[2].dupOf, 'копия другого видео');
  // one duplicate of three — not a copy, the others are fine
  const mixed = [shot(H0, -40, 0), shot(H1, -40, 3), shot(H2, -37, 6)];
  markDuplicates(mixed, [H0]);
  assert.deepEqual(mixed.map((s) => s.defects.length), [1, 0, 0]);
});

test('library: without Claude the species is not checked — shot is not free until marked; "not him" removes all shots', () => {
  const L = lib(); const db = L.make();
  const { clip: a } = db.ingest(L.file('a.mp4', 'a'), nightJump());
  const { clip: b } = db.ingest(L.file('b.mp4', 'b'), sig([{ n: 20, luma: 120, motion: 3, hash: H2 }]));
  assert.equal(db.pending().length, 0, 'without analysis we do not wait for marks');
  assert.equal(db.isFree(a.id, 0), true);
  db.setVision(a.id, { by: 'сигналы' });
  db.setVision(b.id, { by: 'сигналы' });
  assert.deepEqual(db.pending().map((c) => c.id).sort(), [a.id, b.id].sort());
  assert.equal(db.isFree(a.id, 0), false, 'an unmarked clip does not go into stories');
  db.setPet(a.id, true);
  db.setPet(b.id, false);
  assert.equal(db.pending().length, 0);
  assert.equal(db.isFree(a.id, 0), true);
  assert.ok(db.get(b.id).shots.every((s) => s.defects.includes('не ваш зверёк') && !db.isFree(b.id, db.get(b.id).shots.indexOf(s))));
  db.setVision(a.id, { by: 'claude' });
  assert.equal(db.pending().length, 0, 'Claude checked — mark is not needed');
  assert.equal(db.setPet('нет-такого', true), null);
});

test('moment supply: usable, busy for a week and why postponed — without foreign and unmarked ones', () => {
  const L = lib(); const db = L.make();
  const { clip: a } = db.ingest(L.file('a.mp4', 'a'), sig([{ n: 20, luma: 120, motion: 3, hash: H2 }]));
  const { clip: d } = db.ingest(L.file('d.mp4', 'd'), sig([{ n: 20, luma: 2, motion: 3, hash: H1 }]));
  const { clip: x } = db.ingest(L.file('x.mp4', 'x'), sig([{ n: 20, luma: 120, motion: 3, hash: H0 }]));
  for (const c of [a, d, x]) db.setVision(c.id, { by: 'сигналы' });
  assert.deepEqual(db.supply(), { good: 0, busy: 0, spare: {} }, 'we count nothing before the mark');
  db.setPet(a.id, true); db.setPet(d.id, true); db.setPet(x.id, false);
  const s = db.supply();
  assert.equal(s.good, db.get(a.id).shots.filter((q) => !q.defects.length).length);
  assert.ok(s.good >= 1);
  assert.equal(s.busy, 0);
  assert.ok(s.spare['темно'] >= 1, JSON.stringify(s));
  db.markUsed(a.id, 0, 'day-1');
  assert.equal(db.supply().busy, 1);
});
