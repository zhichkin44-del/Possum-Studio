// Editing of real phone footage: 9:16, up to 18 s, the most dynamic spot by motion, title card (RU + EN), audio −14 LUFS, cover, proof sheet.
// Shared with the Video Studio (<project-dir>): the same ffmpeg, 1080×1920 format and −14 LUFS loudness. The Video Studio code is not here.
// produce.py and proof_sheet.py are tied to an "episode" (voice-over, AI frames, Hyperframes overlays) and do not fit phone footage.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findFont as findBundledFont } from '../core/assets.js';
import { ENCODE, gradeChain } from '../core/render.js';

/**
 * Picture of one bot clip: vertical goes full-frame; horizontal becomes a large centered square on a blurred background
 * (the pet is not small). Processing as in the app: denoise on dark areas, vividness, contrast, sharpness.
 */
export function segVideoFilter(s, i) {
  const grade = gradeChain({ luma: s.luma });
  return s.width / s.height < 0.7
    ? `[${i}:v]fps=30,setsar=1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${grade},setsar=1,format=yuv420p[v${i}]`
    : `[${i}:v]fps=30,setsar=1,split=2[bg${i}][fgv${i}];[bg${i}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[bgb${i}];[fgv${i}]crop='min(iw,ih)':'min(iw,ih)',scale=1080:1080[fgs${i}];[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,${grade},setsar=1,format=yuv420p[v${i}]`;
}

const TARGET_SECONDS = 18; // within the 8–20 s from the passport
const FPS_SCAN = 4;
const SCAN_W = 64, SCAN_H = 96;

export function findFfmpeg(env = process.env) {
  const tryBin = (b) => { try { return spawnSync(b, ['-version'], { stdio: 'ignore' }).status === 0 ? b : null; } catch { return null; } };
  return (env.FFMPEG && tryBin(env.FFMPEG)) || tryBin('ffmpeg');
}
function findFfprobe(ffmpeg, env = process.env) {
  const tryBin = (b) => { try { return spawnSync(b, ['-version'], { stdio: 'ignore' }).status === 0 ? b : null; } catch { return null; } };
  const sibling = ffmpeg && /ffmpeg(\.exe)?$/i.test(ffmpeg) ? ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')) : null;
  return (env.FFPROBE && tryBin(env.FFPROBE)) || (sibling && tryBin(sibling)) || tryBin('ffprobe');
}
/** Caption font of the bot — the same as in the app: the embedded Montserrat Black (core/assets.js). */
export function findFont(env = process.env) { return findBundledFont(env); }

function run(bin, args, { cwd, binary = false, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${bin} завис дольше ${Math.round(timeoutMs / 1000)} с`)); }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out);
      resolve({ code, stdout: binary ? stdout : stdout.toString('utf8'), stderr: err });
    });
  });
}

/** Title card: an RU line (large) and an EN line (smaller) — one video for two channels. */
export function normalizeHook(title) {
  if (title && typeof title === 'object') return { ru: String(title.ru ?? '').trim(), en: String(title.en ?? '').trim() };
  return { ru: String(title ?? '').trim(), en: '' };
}

export function createMontage({ env = process.env } = {}) {
  const ffmpeg = findFfmpeg(env);
  const ffprobe = findFfprobe(ffmpeg, env);
  const font = findFont(env);
  const need = () => { if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe не найден: поставь FFmpeg или задай FFMPEG'); };
  const quick = { timeoutMs: 90_000 };

  async function lumaAt(path, ss, seconds = 1) {
    const r = await run(ffmpeg, ['-nostdin', '-v', 'error', '-ss', String(ss), '-t', String(seconds), '-i', path, '-an', '-vf', 'fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], quick);
    const v = [...r.stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  async function probe(path) {
    need();
    const r = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], quick);
    if (r.code !== 0) throw new Error(`Не удалось прочитать видео: ${r.stderr.slice(-200)}`);
    const j = JSON.parse(r.stdout);
    const v = (j.streams ?? []).find((s) => s.codec_type === 'video');
    if (!v) throw new Error('В файле нет видео');
    let [w, h] = [Number(v.width), Number(v.height)];
    const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? 0));
    if (rot === 90 || rot === 270) [w, h] = [h, w];
    const duration = Number(j.format?.duration ?? v.duration ?? 0);
    const hasAudio = (j.streams ?? []).some((s) => s.codec_type === 'audio');
    const luma = await lumaAt(path, Math.min(1, Math.max(0, duration / 4)), Math.min(8, Math.max(1, duration)));
    return { duration, width: w, height: h, hasAudio, luma };
  }

  /** Average changes between adjacent 64×96 frames over the window ss..ss+t. */
  async function frameDiffs(path, ss, t) {
    const r = await run(ffmpeg, ['-nostdin', '-v', 'error', '-ss', String(ss), '-t', String(t), '-i', path, '-an', '-vf', `fps=${FPS_SCAN},scale=${SCAN_W}:${SCAN_H}:flags=area,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { binary: true, timeoutMs: 180_000 });
    const fsz = SCAN_W * SCAN_H;
    const n = Math.floor(r.stdout.length / fsz);
    const diffs = [0];
    for (let i = 1; i < n; i++) {
      let s = 0, c = 0; const a = i * fsz, b = (i - 1) * fsz;
      for (let k = 0; k < fsz; k += 3) { s += Math.abs(r.stdout[a + k] - r.stdout[b + k]); c++; }
      diffs.push(s / c);
    }
    return diffs;
  }

  /** Where in the clip the most dynamic spot is: a win-second window with the largest motion between frames. */
  async function motionStart(path, duration, win) {
    if (duration <= win + 0.5) return 0;
    const diffs = await frameDiffs(path, 0, 240);
    const n = diffs.length;
    if (n < 3) return 0;
    const w = Math.min(n, Math.round(win * FPS_SCAN));
    let sum = 0; for (let i = 0; i < w; i++) sum += diffs[i];
    let best = sum, bestI = 0;
    for (let i = 1; i + w <= n; i++) { sum += diffs[i + w - 1] - diffs[i - 1]; if (sum > best) { best = sum; bestI = i; } }
    return Math.max(0, Math.min(duration - win, bestI / FPS_SCAN - 0.3));
  }

  /** Average frame change over the window (0 = freeze frame): the check "the first 1.5 s are not empty". */
  async function motionLevel(path, ss, t) {
    const d = (await frameDiffs(path, ss, t)).slice(1);
    return d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
  }

  /** Integrated loudness (LUFS) and peak, from ebur128. null if there is no audio. */
  async function loudness(path) {
    const r = await run(ffmpeg, ['-nostdin', '-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], quick);
    const tail = r.stderr.slice(Math.max(0, r.stderr.lastIndexOf('Summary:')));
    const I = tail.match(/I:\s+(-?[\d.]+)\s+LUFS/);
    const P = tail.match(/Peak:\s+(-?[\d.]+)\s+dBFS/);
    return { lufs: I ? Number(I[1]) : null, peak: P ? Number(P[1]) : null };
  }

  async function build({ clips, title, outDir }) {
    need();
    mkdirSync(outDir, { recursive: true });
    const work = join(outDir, '_work');
    mkdirSync(work, { recursive: true });
    try {
      return await buildIn({ clips, title, outDir, work });
    } finally {
      try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  async function buildIn({ clips, title, outDir, work }) {
    const infos = [];
    for (const c of clips) infos.push({ path: c.path, ...(c.info ?? await probe(c.path)) });
    const total = infos.reduce((a, c) => a + c.duration, 0);
    if (total < 1) throw new Error('Съёмка слишком короткая для монтажа');

    // how much we take from each clip
    const segs = [];
    for (const c of infos) {
      const len = total <= TARGET_SECONDS ? c.duration : Math.max(2, Math.min(c.duration, (TARGET_SECONDS * c.duration) / total));
      const start = len < c.duration - 0.3 ? await motionStart(c.path, c.duration, len) : 0;
      segs.push({ ...c, start, len });
    }
    const outLen = segs.reduce((a, s) => a + s.len, 0);

    const hook = normalizeHook(title);
    const useTitle = Boolean(font && hook.ru);
    if (font) copyFileSync(font, join(work, 'font.ttf'));
    const ruText = hook.ru.toUpperCase();
    if (useTitle) { writeFileSync(join(work, 'title_ru.txt'), ruText, 'utf8'); if (hook.en) writeFileSync(join(work, 'title_en.txt'), hook.en.toUpperCase(), 'utf8'); }
    const sizeRu = Math.max(72, Math.min(108, Math.floor(940 / Math.max(5, ruText.length * 0.74))));
    const sizeEn = Math.round(sizeRu * 0.56);
    const titleY = 0.19; // above the pet, but below the top interface bar (≈13%); the cover uses the same spot
    const drawTitle = (extra = '') => {
      const parts = [`drawtext=fontfile=font.ttf:textfile=title_ru.txt:fontsize=${sizeRu}:fontcolor=white:borderw=9:bordercolor=black@0.9:shadowx=3:shadowy=4:shadowcolor=black@0.6:x=(w-text_w)/2:y=h*${titleY}${extra}`];
      if (hook.en) parts.push(`drawtext=fontfile=font.ttf:textfile=title_en.txt:fontsize=${sizeEn}:fontcolor=0xFFD84D:borderw=7:bordercolor=black@0.9:shadowx=2:shadowy=3:shadowcolor=black@0.6:x=(w-text_w)/2:y=h*${titleY}+${Math.round(sizeRu * 1.25)}${extra}`);
      return parts.join(',');
    };

    const args = ['-nostdin', '-y', '-v', 'error'];
    segs.forEach((s) => args.push('-ss', s.start.toFixed(2), '-t', s.len.toFixed(2), '-i', s.path));
    const silent = [];
    segs.forEach((s, i) => { if (!s.hasAudio) { silent.push(i); args.push('-f', 'lavfi', '-t', s.len.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo'); } });
    const fg = [];
    segs.forEach((s, i) => {
      fg.push(segVideoFilter(s, i));
      const asrc = s.hasAudio ? `${i}:a` : `${segs.length + silent.indexOf(i)}:a`;
      fg.push(`[${asrc}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=N/SR/TB[a${i}]`);
    });
    fg.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segs.length}:v=1:a=1[vc][ac]`);
    // fades in over 0.3 s, holds until 3 s, fades out over 0.4 s
    const fade = ":enable='between(t,0.1,3.4)':alpha='if(lt(t,0.4),(t-0.1)/0.3,if(gt(t,3.0),(3.4-t)/0.4,1))'";
    if (useTitle) {
      // soft darkening under the title card: one "curtain" frame repeated for the display time (cheap), fading in and out smoothly
      const cy = (titleY + (hook.en ? 0.07 : 0.04)).toFixed(3);
      fg.push(`color=c=black:s=1080x1920:r=30:d=0.04,format=gbrap,geq=r=0:g=0:b=0:a='255*min(0.78,0.62*exp(-pow((Y-H*${cy})/(H*0.2),2))+0.5*pow(hypot((X-W/2)/(W/2),(Y-H/2)/(H/2))/1.42,2.2))',loop=loop=115:size=1:start=0,fade=t=in:st=0.1:d=0.3:alpha=1,fade=t=out:st=3.0:d=0.4:alpha=1[scrim]`);
      fg.push('[vc][scrim]overlay=eof_action=pass:format=auto[vs]');
      fg.push(`[vs]${drawTitle(fade)}[vout]`);
    } else fg.push('[vc]null[vout]');
    fg.push(`[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,afade=t=out:st=${Math.max(0, outLen - 0.3).toFixed(2)}:d=0.3[aout]`);
    args.push('-filter_complex', fg.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', outLen.toFixed(2),
      ...ENCODE, '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'final_1080p_vertical.mp4');
    const r = await run(ffmpeg, args, { cwd: work });
    if (r.code !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-1800)}`);

    const video = join(outDir, 'final_1080p_vertical.mp4');
    copyFileSync(join(work, 'final_1080p_vertical.mp4'), video);

    // cover: a frame from a strong spot + the caption in the same place as in the video
    const cover = join(outDir, 'cover.jpg');
    // soft darkening under the caption (vertical Gaussian), without a hard banner
    const g = `exp(-pow((Y-H*${titleY + (hook.en ? 0.07 : 0.04)})/(H*0.18),2))`;
    const shade = `geq=lum='lum(X,Y)*(1-0.55*${g})':cb='128+(cb(X,Y)-128)*(1-0.5*${g})':cr='128+(cr(X,Y)-128)*(1-0.5*${g})'`;
    const cargs = ['-nostdin', '-y', '-v', 'error', '-ss', (outLen * 0.35).toFixed(2), '-i', video, '-frames:v', '1', '-vf'];
    cargs.push(useTitle ? `vignette=PI/5,eq=brightness=-0.04:contrast=1.06:saturation=1.08,${shade},${drawTitle()}` : 'null', 'cover.jpg');
    const cr = await run(ffmpeg, cargs, { cwd: work, ...quick });
    if (cr.code === 0) copyFileSync(join(work, 'cover.jpg'), cover);

    // proof sheet: 8 frames across the video length (for the owner and QA; not shown to the partner)
    const proof = join(outDir, 'proof.jpg');
    const pr = await run(ffmpeg, ['-nostdin', '-y', '-v', 'error', '-i', video, '-vf', `fps=8/${outLen.toFixed(2)},scale=270:-2,tile=4x2`, '-frames:v', '1', 'proof.jpg'], { cwd: work, ...quick });
    if (pr.code === 0) copyFileSync(join(work, 'proof.jpg'), proof);

    const fin = await probe(video);
    const first = await lumaAt(video, 0.3, 0.6);
    const bd = await run(ffmpeg, ['-nostdin', '-v', 'info', '-i', video, '-an', '-vf', 'blackdetect=d=0.2:pix_th=0.1', '-f', 'null', '-'], quick);
    const blackSecs = [...bd.stderr.matchAll(/black_duration:([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
    const loud = await loudness(video);
    const hookMotion = await motionLevel(video, 0, 1.6);
    return {
      video, cover, proof, duration: fin.duration, width: fin.width, height: fin.height, hasAudio: fin.hasAudio,
      firstFrameLuma: first ?? 0, blackRatio: fin.duration ? blackSecs / fin.duration : 0,
      loudness: loud.lufs, truePeak: loud.peak, hookMotion, segments: segs.map((s) => ({ path: s.path, start: s.start, len: s.len })),
    };
  }

  return { probe, build, ffmpeg, font };
}
