// Editing a story from several clips: each piece → 1080×1920, 30 fps, BT.709; horizontal — a blurred background + the frame in the center.
// Captions per piece ("No. 5", "Morning"); a piece without sound — silence. Quiet/ASMR — without raising the volume, only peak limiting.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENCODE, gradeChain, wrapLines } from './render.js';

const f3 = (x) => Number(x).toFixed(3);
const STYLE = 'fontcolor=white:borderw=9:bordercolor=black@0.9:shadowx=3:shadowy=4:shadowcolor=black@0.6:x=(w-text_w)/2';
const FIT = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';

/** Foreground of a horizontal frame: a 9:8 window (1080×960) — the pet is larger; for 16:9 it cuts less than a fifth from each side (not a deep 4:5). */
export const FG = 'scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960';
/** Blurred background: no darkening, so that the video and the cover do not look dark. */
export const BG = 'scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=12,scale=1080:1920,eq=brightness=0.02:saturation=1.1';

/**
 * Editing styles by story kind: videos of different kinds do not look alike.
 * trans — xfade transitions (in rotation, the start is shifted by the seed), dur — transition length, zoom — camera motion,
 * shake — shake at the start of the hook and the best moment, slowLast — slowing the last piece (a repeat of the best moment).
 * A kind not in the table — a simple join, as before.
 */
export const STYLES = {
  top5: { name: 'Динамичный', trans: ['slideleft', 'smoothup', 'zoomin', 'wipeleft', 'slideup'], dur: 0.25, zoom: 'punch', shake: true, slowLast: 0.6 },
  fails: { name: 'Ой!', trans: ['zoomin', 'slideleft'], dur: 0.2, zoom: 'punch', shake: true },
  day: { name: 'День', trans: ['fade', 'smoothleft', 'dissolve', 'fadeblack'], dur: 0.5, zoom: 'kenburns' },
  beforeAfter: { name: 'Было-стало', trans: ['wiperight'], dur: 0.5, zoom: 'slow' },
  calm: { name: 'Спокойный', trans: ['fade'], dur: 0.8, zoom: 'slow', soft: true },
  asmr: { name: 'Тихий', trans: ['fade'], dur: 0.6, zoom: 'slow', soft: true },
  series: { name: 'Серия', trans: ['smoothleft', 'smoothright'], dur: 0.35, zoom: 'kenburns' },
};

/** A number from a string (story id) — so that two videos of one kind start with different transitions and push-ins. */
export function seedOf(s = '') {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

/** Camera motion over a piece (zoompan, frame by frame): N — frames in the piece, dir — push-in or pull-out. */
function zoomExpr(kind, N, dir) {
  const r = `min(1,on/${N})`;
  if (kind === 'punch') return "if(lt(on,6),1+0.12*on/6,1.12-0.08*min(1,(on-6)/24))"; // a sharp push-in of 0.2 s and a soft pull-back
  if (kind === 'kenburns') return dir ? `1+0.07*${r}` : `1.07-0.07*${r}`;
  if (kind === 'slow') return `1+0.035*${r}`;
  return null;
}

/** Video of piece k: conversion to 9:16 + image processing + padding with the last frame if the source ended earlier; fx — camera motion, shake, speed. */
function videoChain(k, p, fx = {}, soft = false) {
  const grade = gradeChain(p, soft);
  const len = p.len + (fx.extra ?? 0);
  const speed = fx.speed ? `setpts=PTS/${fx.speed},` : '';
  const tail = `${speed}tpad=stop_mode=clone:stop_duration=${f3(len)},trim=duration=${f3(len)},setpts=PTS-STARTPTS,fps=30,setsar=1`;
  const z = fx.zoom ? zoomExpr(fx.zoom, Math.max(1, Math.round(len * 30)), fx.dir) : null;
  const move = [
    z ? `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30` : null,
    // shake of 10 frames from frame shakeAt (after the transition comes in): the 1040×1848 window moves around the frame and stretches back
    fx.shake ? shakeCrop(fx.shakeAt ?? 0) : null,
    'setsar=1,format=yuv420p',
  ].filter(Boolean).join(',');
  if (p.orient === 'vertical') return [`[${k}:v]${FIT},${grade},${tail},${move}[v${k}]`];
  return [
    `[${k}:v]split=2[bg${k}][fg${k}]`,
    `[bg${k}]${BG}[bb${k}]`,
    // 9:8 frame: larger than the 16:9 strip, but without a deep 4:5 crop that cut the pet at the edge
    `[fg${k}]${FG}[ff${k}]`,
    `[bb${k}][ff${k}]overlay=(W-w)/2:(H-h)/2,${grade},${tail},${move}[v${k}]`,
  ];
}

function shakeCrop(at) {
  const on = `between(n,${at},${at + 9})`;
  return `crop=1040:1848:x='20+16*sin(n*2.3)*${on}':y='36+16*cos(n*1.7)*${on}',scale=1080:1920`;
}

/** Piece effects by style: transition length (no more than a third of the shortest piece), what happens with each piece. */
export function planStyle(pieces, style, seed = 0) {
  if (!style || pieces.length < 1) return null;
  const d = pieces.length > 1 ? Math.min(style.dur, Math.min(...pieces.map((p) => p.len)) / 3) : 0;
  const last = pieces.length - 1;
  const fx = pieces.map((p, k) => ({
    // every piece except the last takes d more from the source: the tail goes under the transition, and the video length does not change
    extra: k < last ? d : 0,
    zoom: style.zoom ?? null,
    dir: (k + seed) % 2 === 0,
    shake: Boolean(style.shake) && (k === 0 || k === last) && pieces.length > 1,
    // the first d seconds of a piece (except the first) are covered by the transition — the shake starts after it
    shakeAt: k > 0 ? Math.ceil(d * 30) : 0,
    speed: style.slowLast && k === last && pieces.length > 1 ? style.slowLast : null,
  }));
  const trans = pieces.slice(1).map((_, k) => style.trans[(k + seed) % style.trans.length]);
  return { d, fx, trans };
}

/**
 * ffmpeg arguments for a story.
 * pieces: [{src, from, len, hasAudio, orient, hold}] (hold — the caption stays until the end of the video), captionFiles: [[files of the lines of piece k], …] (they lie in the working folder with font.ttf).
 */
export function buildStoryArgs({ pieces, out, quiet = false, captionFiles = [], music = null, style = null, seed = 0 }) {
  if (!pieces?.length) throw new Error('Пустой сюжет');
  const plan = planStyle(pieces, style, seed);
  const fxOf = (k) => plan?.fx[k] ?? {};
  // a slowed-down piece takes from the middle of its window as much source as will stretch over the whole piece length
  const window = (p, fx) => (fx.speed
    ? { from: p.from + (p.len * (1 - fx.speed)) / 2, len: p.len * fx.speed }
    : { from: p.from, len: p.len + (fx.extra ?? 0) });
  const inputs = pieces.flatMap((p, k) => {
    const w = window(p, fxOf(k));
    return ['-ss', f3(w.from), '-t', f3(w.len), '-i', p.src];
  });
  const parts = [];
  pieces.forEach((p, k) => {
    const fx = fxOf(k);
    const alen = p.len + (fx.extra ?? 0);
    parts.push(...videoChain(k, p, fx, Boolean(style?.soft)));
    parts.push(p.hasAudio
      ? `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,${fx.speed ? `atempo=${fx.speed},` : ''}apad,atrim=duration=${f3(alen)},asetpts=PTS-STARTPTS[a${k}]`
      : `aevalsrc=0:c=stereo:s=48000:d=${f3(alen)}[a${k}]`);
  });
  if (plan && pieces.length > 1) {
    // transitions: piece k+1 slides over the tail of piece k; offset — where piece k ends in the finished video
    let v = 'v0', a = 'a0', end = 0;
    for (let k = 1; k < pieces.length; k++) {
      end += pieces[k - 1].len;
      const vo = k === pieces.length - 1 ? 'vc' : `vx${k}`;
      const ao = k === pieces.length - 1 ? 'ac' : `ax${k}`;
      parts.push(`[${v}][v${k}]xfade=transition=${plan.trans[k - 1]}:duration=${f3(plan.d)}:offset=${f3(end)}[${vo}]`);
      parts.push(`[${a}][a${k}]acrossfade=d=${f3(plan.d)}:c1=tri:c2=tri[${ao}]`);
      v = vo; a = ao;
    }
  } else {
    parts.push(`${pieces.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${pieces.length}:v=1:a=1[vc][ac]`);
  }

  // captions: each one for the time of its piece; hold (e.g. "Episode N") — until the end of the video
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
    ...ENCODE,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', f3(total), '-movflags', '+faststart', out,
  ];
}

/** Cover 1080×1920 from the source of a piece (without "No." captions): the same background and foreground as in the video; a dark frame is brightened slightly. */
export function coverArgs({ src, at, orient, out, luma = 120 }) {
  const lift = luma < 90 ? ',eq=brightness=0.06:contrast=1.08:gamma=1.15' : '';
  const vf = orient === 'vertical'
    ? `${FIT}${lift}`
    : `split=2[bg][fg];[bg]${BG}[bb];[fg]${FG}[ff];[bb][ff]overlay=(W-w)/2:(H-h)/2${lift}`;
  return ['-y', '-ss', f3(at), '-i', src, '-frames:v', '1', '-filter_complex', vf, '-q:v', '2', out];
}

/** Time t in the finished video → piece and time in its source. */
export function pieceAt(pieces, t) {
  let at = 0;
  for (const p of pieces) {
    if (t < at + p.len) return { piece: p, srcAt: p.from + Math.max(0, t - at) };
    at += p.len;
  }
  const p = pieces[pieces.length - 1];
  return p ? { piece: p, srcAt: p.from + Math.max(0, p.len - 0.1) } : null;
}

/** Story pieces → ffmpeg inputs (paths and orientation from the library). A missing file — a clear error. */
export function storyInputs(story, lib) {
  return story.pieces.map((p) => {
    const clip = lib.get(p.clip);
    const src = clip ? lib.realPath(clip) : null;
    if (!src) throw new Error(`Нет исходника для куска (${clip?.name ?? p.clip}) — файл перемещён или удалён`);
    const luma = clip.shots?.[p.shot]?.luma;
    return { src, from: p.from, len: p.len, hasAudio: clip.hasAudio, orient: clip.orient, caption: p.caption, ...(p.hold ? { hold: true } : {}), ...(typeof luma === 'number' ? { luma } : {}) };
  });
}

/** Render a story into out. workDir — the working folder for the font and the caption texts. */
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
  const args = buildStoryArgs({ pieces, out, quiet: story.quiet, captionFiles, music, style: STYLES[story.kind] ?? null, seed: seedOf(story.id) });
  await media.ffmpeg(args, { cwd: workDir, timeoutMs: 15 * 60_000 });
  return out;
}
