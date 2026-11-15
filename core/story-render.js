// Монтаж сюжета из нескольких клипов: каждый кусок → 1080×1920, 30 к/с, BT.709; горизонтальное — размытый фон + кадр по центру.
// Подписи по кускам («№5», «Утро»), кусок без звука — тишина. Тихие/ASMR — без подъёма громкости, только ограничение пиков.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { wrapLines } from './render.js';

const f3 = (x) => Number(x).toFixed(3);
const STYLE = 'fontcolor=white:borderw=9:bordercolor=black@0.9:shadowx=3:shadowy=4:shadowcolor=black@0.6:x=(w-text_w)/2';
const FIT = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';

/** Передний план горизонтального кадра: окно 9:8 (1080×960) — зверёк крупнее, у 16:9 режет меньше пятой части с каждого бока (не глубокий 4:5). */
export const FG = 'scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960';
/** Размытый фон: без затемнения, чтобы ролик и обложка не выглядели тёмными. */
export const BG = 'scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=12,scale=1080:1920,eq=brightness=0.02:saturation=1.1';

/** Видео куска k: приведение к 9:16 + добивка последним кадром, если исходник кончился раньше. */
function videoChain(k, p) {
  const tail = `tpad=stop_mode=clone:stop_duration=${f3(p.len)},trim=duration=${f3(p.len)},setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p`;
  if (p.orient === 'vertical') return [`[${k}:v]${FIT},${tail}[v${k}]`];
  return [
    `[${k}:v]split=2[bg${k}][fg${k}]`,
    `[bg${k}]${BG}[bb${k}]`,
    // кадр 9:8: крупнее полоски 16:9, но без глубокой обрезки 4:5, что срезала зверька у края
    `[fg${k}]${FG}[ff${k}]`,
    `[bb${k}][ff${k}]overlay=(W-w)/2:(H-h)/2,${tail}[v${k}]`,
  ];
}

/**
 * Аргументы ffmpeg для сюжета.
 * pieces: [{src, from, len, hasAudio, orient, hold}] (hold — подпись держится до конца ролика), captionFiles: [[файлы строк куска k], …] (лежат в рабочей папке с font.ttf).
 */
export function buildStoryArgs({ pieces, out, quiet = false, captionFiles = [], music = null }) {
  if (!pieces?.length) throw new Error('Пустой сюжет');
  const inputs = pieces.flatMap((p) => ['-ss', f3(p.from), '-t', f3(p.len), '-i', p.src]);
  const parts = [];
  pieces.forEach((p, k) => {
    parts.push(...videoChain(k, p));
    parts.push(p.hasAudio
      ? `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${f3(p.len)},asetpts=PTS-STARTPTS[a${k}]`
      : `aevalsrc=0:c=stereo:s=48000:d=${f3(p.len)}[a${k}]`);
  });
  parts.push(`${pieces.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${pieces.length}:v=1:a=1[vc][ac]`);

  // подписи: каждая — на время своего куска; hold (например «Эпизод N») — до конца ролика
  const draws = [];
  const span = pieces.reduce((t, p) => t + p.len, 0);
  let at = 0;
  pieces.forEach((p, k) => {
    const files = captionFiles[k] ?? [];
    const en = `between(t,${f3(at)},${f3((p.hold ? span : at + p.len) - 0.02)})`;
    files.forEach((file, i) => draws.push(`drawtext=fontfile=font.ttf:textfile=${file}:fontsize=96:${STYLE}:y=h*0.11+${i * 112}:enable='${en}'`));
    at += p.len;
  });
  const total = at;
  let v = 'vc';
  if (draws.length) { parts.push(`[vc]${draws.join(',')}[vt]`); v = 'vt'; }
  parts.push(`[${v}]format=yuv420p[vout]`);

  let a = '[ac]';
  if (music?.file && !quiet) {
    inputs.push('-stream_loop', '-1', '-i', music.file);
    parts.push(`[${pieces.length}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${f3(total)},asetpts=PTS-STARTPTS,volume=${music.gainDb ?? -18}dB,afade=t=in:d=0.5,afade=t=out:st=${f3(Math.max(0, total - 1))}:d=1[mu]`);
    parts.push('[ac][mu]amix=inputs=2:duration=first:normalize=0[am]');
    a = '[am]';
  }
  parts.push(`${a}${quiet ? 'alimiter=limit=0.89' : 'loudnorm=I=-14:TP=-1.5:LRA=11'},aresample=48000[aout]`);

  return [
    '-y', ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', f3(total), '-movflags', '+faststart', out,
  ];
}

/** Обложка 1080×1920 из исходника куска (без подписей «№»): тот же фон и передний план, что в ролике; тёмный кадр чуть высветлен. */
export function coverArgs({ src, at, orient, out, luma = 120 }) {
  const lift = luma < 90 ? ',eq=brightness=0.06:contrast=1.08:gamma=1.15' : '';
  const vf = orient === 'vertical'
    ? `${FIT}${lift}`
    : `split=2[bg][fg];[bg]${BG}[bb];[fg]${FG}[ff];[bb][ff]overlay=(W-w)/2:(H-h)/2${lift}`;
  return ['-y', '-ss', f3(at), '-i', src, '-frames:v', '1', '-filter_complex', vf, '-q:v', '2', out];
}

/** Время t в готовом ролике → кусок и время в его исходнике. */
export function pieceAt(pieces, t) {
  let at = 0;
  for (const p of pieces) {
    if (t < at + p.len) return { piece: p, srcAt: p.from + Math.max(0, t - at) };
    at += p.len;
  }
  const p = pieces[pieces.length - 1];
  return p ? { piece: p, srcAt: p.from + Math.max(0, p.len - 0.1) } : null;
}

/** Куски сюжета → входы ffmpeg (пути и ориентация из библиотеки). Пропавший файл — понятная ошибка. */
export function storyInputs(story, lib) {
  return story.pieces.map((p) => {
    const clip = lib.get(p.clip);
    const src = clip ? lib.realPath(clip) : null;
    if (!src) throw new Error(`Нет исходника для куска (${clip?.name ?? p.clip}) — файл перемещён или удалён`);
    return { src, from: p.from, len: p.len, hasAudio: clip.hasAudio, orient: clip.orient, caption: p.caption, ...(p.hold ? { hold: true } : {}) };
  });
}

/** Рендер сюжета в out. workDir — рабочая папка для шрифта и текстов подписей. */
export async function renderStory({ story, lib, out, workDir, font = null, media, music = null }) {
  const pieces = storyInputs(story, lib);
  mkdirSync(workDir, { recursive: true });
  const captionFiles = pieces.map(() => []);
  if (font && pieces.some((p) => p.caption)) {
    copyFileSync(font, join(workDir, 'font.ttf'));
    pieces.forEach((p, k) => wrapLines(p.caption, 18).forEach((line, i) => {
      const name = `cap_s${k}_${i}.txt`;
      writeFileSync(join(workDir, name), line, 'utf8');
      captionFiles[k].push(name);
    }));
  }
  const args = buildStoryArgs({ pieces, out, quiet: story.quiet, captionFiles, music });
  await media.ffmpeg(args, { cwd: workDir, timeoutMs: 15 * 60_000 });
  return out;
}
