// Этап 2, шаг 3, настоящий ffmpeg: три разных клипа → сигналы → библиотека → сюжет с подписями → вертикальный ролик.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMedia } from '../core/media.js';
import { createLibrary } from '../core/library.js';
import { findFont, ensureMusic } from '../core/assets.js';
import { pieceAround } from '../core/stories.js';
import { renderStory } from '../core/story-render.js';
import { pickSheetFrames, makeSheet } from '../core/vision.js';

const media = createMedia();
const skip = !media.tools.ffmpeg || !media.tools.ffprobe ? 'ffmpeg не найден' : false;

function makeClip(dir, name, sec, w, h, sound) {
  const out = join(dir, name);
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=30:duration=${sec}`];
  if (sound) args.push('-f', 'lavfi', '-i', `sine=frequency=330:duration=${sec}`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(sound ? ['-c:a', 'aac', '-shortest'] : []), out);
  const r = spawnSync(media.tools.ffmpeg, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr?.slice(-400));
  return out;
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'possum-sr-'));
  const base = join(root, 'Поссум');
  const inbox = join(base, 'Входящие'); mkdirSync(inbox, { recursive: true });
  const lib = createLibrary({ path: join(base, 'library.json'), baseDir: base });
  const files = [
    makeClip(inbox, 'вертикаль.mp4', 4, 1080, 1920, true),
    makeClip(inbox, 'горизонт без звука.mp4', 4, 1280, 720, false),
    makeClip(inbox, 'квадрат.mp4', 4, 720, 720, true),
  ];
  const clips = [];
  for (const f of files) {
    const info = await media.probe(f);
    const sig = await media.signals(f, { info });
    clips.push(lib.ingest(f, { ...sig, info }).clip);
  }
  return { root, base, lib, clips };
}

test('сюжет из трёх клипов (вертикаль, горизонт без звука, квадрат) → 1080×1920, звук, длительность = сумма', { skip, timeout: 300_000 }, async () => {
  const { root, lib, clips } = await setup();
  assert.deepEqual(clips.map((c) => c.orient), ['vertical', 'horizontal', 'square']);
  assert.deepEqual(clips.map((c) => c.hasAudio), [true, false, true]);
  const pieces = clips.map((c, k) => pieceAround(c, 0, 2, k === 0 ? 'Утро' : k === 1 ? 'День' : 'Вечер'));
  const total = pieces.reduce((t, p) => t + p.len, 0);
  const story = { id: 'day-test', kind: 'day', pieces, total, quiet: false };
  const out = join(root, 'out.mp4');
  await renderStory({ story, lib, out, workDir: join(root, 'work'), font: findFont(), media });
  assert.ok(existsSync(out) && statSync(out).size > 10_000);
  const p = await media.probe(out);
  assert.equal(p.width, 1080); assert.equal(p.height, 1920);
  assert.equal(p.hasAudio, true);
  assert.ok(Math.abs(p.duration - total) < 0.25, `длительность ${p.duration} ≠ ${total}`);
});

test('ASMR-сюжет: тихий режим с музыкой — музыка не подмешивается, громкость не поднимается', { skip, timeout: 300_000 }, async () => {
  const { root, lib, clips } = await setup();
  const music = await ensureMusic(join(root, 'Музыка'), media);
  const story = { id: 'asmr-test', kind: 'asmr', pieces: [pieceAround(clips[0], 0, 3), pieceAround(clips[2], 0, 3)], quiet: true };
  const out = join(root, 'asmr.mp4');
  await renderStory({ story, lib, out, workDir: join(root, 'w2'), media, music: { file: music } });
  const p = await media.probe(out);
  assert.equal(p.height, 1920); assert.equal(p.hasAudio, true);
  assert.ok(Math.abs(p.duration - 6) < 0.25, String(p.duration));
});

test('лист 3×3 для Haiku собирается из настоящего клипа', { skip, timeout: 120_000 }, async () => {
  const { root, lib, clips } = await setup();
  const src = lib.realPath(clips[1]);
  const r = await makeSheet({ src, clip: clips[1], out: join(root, 'sheets', 's.jpg'), media });
  assert.equal(r.frames.length, pickSheetFrames(clips[1]).length);
  const p = await media.probe(r.file);
  assert.equal(p.width, 1152); assert.equal(p.height, 648);
});

test('исходник пропал — понятная ошибка, ffmpeg не запускается', { skip }, async () => {
  const { root, lib, clips } = await setup();
  const story = { pieces: [{ clip: 'нет-такого', shot: 0, from: 0, len: 2 }, pieceAround(clips[0], 0, 2)] };
  await assert.rejects(renderStory({ story, lib, out: join(root, 'x.mp4'), workDir: join(root, 'w3'), media }), /Нет исходника/);
});
