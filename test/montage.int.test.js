// Настоящий монтаж: синтетический «телефонный» клип → ffmpeg → 1080×1920, ≤20 с, звук, обложка, лист проверки.
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

test('probe: длительность, размер, яркость, звук', { skip, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-m-'));
  const m = createMontage({});
  const clip = makeClip(dir, 'a.mp4', 3);
  const p = await m.probe(clip);
  assert.ok(Math.abs(p.duration - 3) < 0.3);
  assert.equal(p.width, 1280); assert.equal(p.height, 720);
  assert.equal(p.hasAudio, true);
  assert.ok(p.luma > 20 && p.luma < 240, `luma=${p.luma}`);
});

test('build: горизонтальный клип 40 с → вертикальный ролик ≤ 20 с с заставкой, обложкой и листом проверки', { skip, timeout: 240_000 }, async () => {
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

test('build: три коротких клипа склеиваются, видео без звука получает тишину и не падает', { skip, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-m-'));
  const m = createMontage({});
  const clips = [makeClip(dir, 'a.mp4', 5, 1080, 1920), makeClip(dir, 'b.mp4', 4, 1920, 1080, false), makeClip(dir, 'c.mp4', 6, 720, 1280)].map((path) => ({ path }));
  const r = await m.build({ clips, title: 'Полёт', outDir: join(dir, 'post2') });
  assert.equal(r.hasAudio, true);
  assert.ok(r.duration >= 8 && r.duration <= 20.5, `duration=${r.duration}`);
  assert.equal(r.height, 1920);
});

test('build: путь с пробелами и кириллицей не ломает ffmpeg', { skip, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum m-ё-'));
  const m = createMontage({});
  const clip = makeClip(dir, 'клип 1.mp4', 9);
  const r = await m.build({ clips: [{ path: clip }], title: 'На руку', outDir: join(dir, 'пост 1') });
  assert.ok(existsSync(r.video));
});

test('build: заставка RU+EN, громкость около −14 LUFS, хук в движении', { skip, timeout: 240_000 }, async () => {
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
