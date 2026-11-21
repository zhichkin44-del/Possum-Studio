// Editing by plan: pieces → vertical 1080×1920 → push-in → RU/EN captions → sounds and music → −14 LUFS.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const f3 = (x) => Number(x).toFixed(3);

/** Compression of the finished video: medium + CRF 18. Platforms re-compress again, so there must be a quality margin (veryfast/20 gave blocks on fur). Measured 16.11, 20 s of 1080×1920: slow 34 s / 113 MB, medium 18 s / 112 MB — the same size, twice as fast. */
export const ENCODE = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p'];

/** Brightness of a piece (0–255) below which the frame has phone noise: hqdn3d removes it. */
export const NOISY_LUMA = 90;

/**
 * Image processing of a piece: denoiser for a dark frame, color vividness without acidity (vibrance protects what is already saturated),
 * light contrast and CAS sharpness. soft — for calm and quiet videos: everything softer.
 */
export function gradeChain(p = {}, soft = false) {
  const denoise = typeof p.luma === 'number' && p.luma < NOISY_LUMA ? 'hqdn3d=1.5:1.5:6:6,' : '';
  return denoise + (soft
    ? 'vibrance=intensity=0.08,eq=contrast=1.02:saturation=1.04,cas=strength=0.25'
    : 'vibrance=intensity=0.15,eq=contrast=1.05:saturation=1.08,cas=strength=0.4');
}

/** Wraps a line by words so that a caption does not go out of the frame. */
export function wrapLines(text, max = 20) {
  const lines = []; let cur = '';
  for (const w of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** luma — average brightness of the source: plan pieces have no brightness of their own, and without it the denoiser does not switch on. */
export function buildRenderArgs({ src, plan, hasAudio, sfxFiles = {}, out, captionFiles = { ru: [], en: [] }, luma }) {
  const inputs = ['-i', src];
  let idx = 1;
  const parts = [];
  const n = plan.segments.length;
  plan.segments.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${f3(s.from)}:duration=${f3(s.len)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${gradeChain({ luma: s.luma ?? luma })},fps=30,setsar=1[v${i}]`);
    parts.push(hasAudio
      ? `[0:a]atrim=start=${f3(s.from)}:duration=${f3(s.len)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`
      : `aevalsrc=0:c=stereo:s=48000:d=${f3(s.len)}[a${i}]`);
  });
  parts.push(`${plan.segments.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[vc][ac]`);

  // push-in: smoothly up to scale and back
  let v = 'vc';
  if (plan.zooms?.length) {
    const z = plan.zooms.map((zz) => `between(it,${f3(zz.at)},${f3(zz.at + zz.len)})*${f3(zz.scale - 1)}*sin(PI*(it-${f3(zz.at)})/${f3(zz.len)})`).join('+');
    parts.push(`[vc]zoompan=z='1+${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30[vz]`);
    v = 'vz';
  }
  // captions: drawtext per line; the files and the font are in the working folder
  const cap = plan.captions ?? {};
  const en = `between(t,${f3(cap.from ?? 0)},${f3(cap.to ?? 3)})`;
  const draws = [];
  const style = 'fontcolor=white:borderw=9:bordercolor=black@0.9:shadowx=3:shadowy=4:shadowcolor=black@0.6:x=(w-text_w)/2';
  captionFiles.ru.forEach((file, i) => draws.push(`drawtext=fontfile=font.ttf:textfile=${file}:fontsize=76:${style}:y=h*0.11+${i * 92}:enable='${en}'`));
  const enTop = 0.11 * 1920 + captionFiles.ru.length * 92 + 14;
  captionFiles.en.forEach((file, i) => draws.push(`drawtext=fontfile=font.ttf:textfile=${file}:fontsize=54:${style.replace('fontcolor=white', 'fontcolor=0xFFD84D')}:y=${Math.round(enTop + i * 66)}:enable='${en}'`));
  if (draws.length) { parts.push(`[${v}]${draws.join(',')}[vt]`); v = 'vt'; }
  parts.push(`[${v}]format=yuv420p[vout]`);

  // sound: the video's own sound + 1–3 effects + quiet music
  const mix = ['[ac]'];
  plan.sfx.forEach((s, k) => {
    const file = sfxFiles[s.name];
    if (!file) return;
    inputs.push('-i', file);
    const ms = Math.round(s.at * 1000);
    parts.push(`[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},volume=0.6[s${k}]`);
    mix.push(`[s${k}]`); idx++;
  });
  if (plan.music?.file) {
    inputs.push('-stream_loop', '-1', '-i', plan.music.file);
    const t = plan.total;
    parts.push(`[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${f3(t)},asetpts=PTS-STARTPTS,volume=${plan.music.gainDb}dB,afade=t=in:d=0.5,afade=t=out:st=${f3(Math.max(0, t - 1))}:d=1[mu]`);
    mix.push('[mu]'); idx++;
  }
  parts.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);

  return [
    '-y', ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    ...ENCODE,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', f3(plan.total), '-movflags', '+faststart', out,
  ];
}

/** Render one variant. workDir — the working folder for the font and the caption texts. */
export async function renderPlan({ src, plan, info, sfxFiles, out, workDir, font, media }) {
  mkdirSync(workDir, { recursive: true });
  const captionFiles = { ru: [], en: [] };
  if (font && (plan.captions?.ru || plan.captions?.en)) {
    copyFileSync(font, join(workDir, 'font.ttf'));
    for (const lang of ['ru', 'en']) {
      wrapLines(plan.captions[lang], lang === 'ru' ? 20 : 26).forEach((line, i) => {
        const name = `cap_${plan.profile}_${lang}${i}.txt`;
        writeFileSync(join(workDir, name), line, 'utf8');
        captionFiles[lang].push(name);
      });
    }
  }
  const args = buildRenderArgs({ src, plan, hasAudio: info.hasAudio, sfxFiles, out, captionFiles, luma: info.luma });
  await media.ffmpeg(args, { cwd: workDir, timeoutMs: 15 * 60_000 });
  return out;
}

export async function makeCover({ video, at, out, media }) {
  await media.ffmpeg(['-y', '-ss', f3(at), '-i', video, '-frames:v', '1', '-q:v', '2', out]);
  return out;
}

/**
 * Frame time for the cover: sharp, normally lit, without blur; the very edges of the video are not used.
 * A frame where something moves (moderately) is better than a still one: in an empty scene (an empty bath) there is no motion,
 * and a sharp change of picture at a cut is not the pet's motion.
 */
export function bestCoverAt(sig) {
  const step = sig?.step, sharp = sig?.sharp ?? [], n = sharp.length;
  if (!step || !n) return null;
  const dur = sig.info?.duration ?? n * step;
  const maxSharp = Math.max(...sharp, 1e-9);
  // first only normally lit frames (not dark and not overexposed); if there are none — any
  const lit = (i) => { const y = sig.luma?.[i] ?? 120; return y >= 60 && y <= 200; };
  const anyLit = sharp.some((_, i) => i * step >= 0.5 && i * step <= dur - 0.5 && lit(i));
  let best = null, bestScore = -1;
  for (let i = 0; i < n; i++) {
    const t = i * step;
    if (t < 0.5 || t > dur - 0.5) continue;
    if (anyLit && !lit(i)) continue;
    const l = ((sig.luma?.[i] ?? 120) - 120) / 60;
    const m = sig.motion?.[i] ?? 0;
    const live = m < 1 ? 0.5 : m <= 15 ? 1 : 1 / (1 + (m - 15) / 5);
    const score = (sharp[i] / maxSharp) * Math.exp(-l * l) * live;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best == null ? null : Math.round(best * 100) / 100;
}
