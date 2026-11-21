// Real editing: synthetic "phone" clip → ffmpeg → 1080×1920, ≤20 s, sound, cover, check sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMontage, findFfmpeg } from '../src/montage.js';
import { qualityIssues } from '../src/post.js';

const ffmpeg = findFfmpeg();
const skip = !ffmpeg ? 'ffmpeg не найден' : false;

function makeClip(dir, name, seconds, w = 1280, h = 720, sound = true) {
  const out = join(dir, name);
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=30:duration=${seconds}`];
  if (sound) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(sound ? ['-c:a', 'aac', '-shortest'] : []), out);
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr?.slice(-400));
  return out;
}

test('probe: duration, size, brightness, sound', { skip, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-m-'));
  const m = createMontage({});
  const clip = makeClip(dir, 'a.mp4', 3);
  const p = await m.probe(clip);
  assert.ok(Math.abs(p.duration - 3) < 0.3);
  assert.equal(p.width, 1280); assert.equal(p.height, 720);
  assert.equal(p.hasAudio, true);
  assert.ok(p.luma > 20 && p.luma < 240, `luma=${p.luma}`);
});

test('build: 40 s horizontal clip → vertical clip ≤ 20 s with intro, cover and check sheet', { skip, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-m-'));
  const m = createMontage({});
  const clip = makeClip(dir, 'long.mp4', 40);
  const out = join(dir, 'post1');
  const r = await m.build({ clips: [{ path: clip }], title: 'Решился', outDir: out });
  assert.ok(existsSync(r.video) && statSync(r.video).size > 10_000);
  assert.equal(r.width, 1080); assert.equal(r.height, 1920);
  assert.ok(r.duration <= 20.5 && r.duration >= 8, `duration=${r.duration}`);
  assert.equal(r.hasAudio, true);
  assert.ok(existsSync(r.cover) && existsSync(r.proof));
  assert.deepEqual(qualityIssues(r), []);
});

test('build: three short clips are joined, a video without sound gets silence and does not crash', { skip, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-m-'));
  const m = createMontage({});
  const clips = [makeClip(dir, 'a.mp4', 5, 1080, 1920), makeClip(dir, 'b.mp4', 4, 1920, 1080, false), makeClip(dir, 'c.mp4', 6, 720, 1280)].map((path) => ({ path }));
  const r = await m.build({ clips, title: 'Полёт', outDir: join(dir, 'post2') });
  assert.equal(r.hasAudio, true);
  assert.ok(r.duration >= 8 && r.duration <= 20.5, `duration=${r.duration}`);
  assert.equal(r.height, 1920);
});

test('build: a path with spaces and Cyrillic does not break ffmpeg', { skip, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum m-ё-'));
  const m = createMontage({});
  const clip = makeClip(dir, 'клип 1.mp4', 9);
  const r = await m.build({ clips: [{ path: clip }], title: 'На руку', outDir: join(dir, 'пост 1') });
  assert.ok(existsSync(r.video));
});

test('build: RU+EN intro, loudness around −14 LUFS, hook in motion', { skip, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-m-'));
  const m = createMontage({});
  const clip = makeClip(dir, 'a.mp4', 20);
  const r = await m.build({ clips: [{ path: clip }], title: { ru: 'Он полетел?!', en: 'Will he fly?!' }, outDir: join(dir, 'post3') });
  assert.ok(typeof r.loudness === 'number' && Math.abs(r.loudness + 14) < 3, `loudness=${r.loudness}`);
  assert.ok(r.hookMotion > 0.25, `hookMotion=${r.hookMotion}`);
  assert.ok(r.truePeak === null || r.truePeak <= 0.5, `peak=${r.truePeak}`);
  assert.deepEqual(qualityIssues(r), []);
  assert.ok(existsSync(r.cover));
});
