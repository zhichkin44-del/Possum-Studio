// Монтаж по плану: куски → вертикаль 1080×1920 → наезд → подписи RU/EN → звуки и музыка → −14 LUFS.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const f3 = (x) => Number(x).toFixed(3);

/** Переносит строку по словам, чтобы подпись не вылезала за кадр. */
export function wrapLines(text, max = 20) {
  const lines = []; let cur = '';
  for (const w of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

export function buildRenderArgs({ src, plan, hasAudio, sfxFiles = {}, out, captionFiles = { ru: [], en: [] } }) {
  const inputs = ['-i', src];
  let idx = 1;
  const parts = [];
  const n = plan.segments.length;
  plan.segments.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${f3(s.from)}:duration=${f3(s.len)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v${i}]`);
    parts.push(hasAudio
      ? `[0:a]atrim=start=${f3(s.from)}:duration=${f3(s.len)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`
      : `aevalsrc=0:c=stereo:s=48000:d=${f3(s.len)}[a${i}]`);
  });
  parts.push(`${plan.segments.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[vc][ac]`);

  // наезд: плавно до scale и обратно
  let v = 'vc';
  if (plan.zooms?.length) {
    const z = plan.zooms.map((zz) => `between(it,${f3(zz.at)},${f3(zz.at + zz.len)})*${f3(zz.scale - 1)}*sin(PI*(it-${f3(zz.at)})/${f3(zz.len)})`).join('+');
    parts.push(`[vc]zoompan=z='1+${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30[vz]`);
    v = 'vz';
  }
  // подписи: по drawtext на строку, файлы и шрифт лежат в рабочей папке
  const cap = plan.captions ?? {};
  const en = `between(t,${f3(cap.from ?? 0)},${f3(cap.to ?? 3)})`;
  const draws = [];
  const style = 'fontcolor=white:borderw=9:bordercolor=black@0.9:shadowx=3:shadowy=4:shadowcolor=black@0.6:x=(w-text_w)/2';
  captionFiles.ru.forEach((file, i) => draws.push(`drawtext=fontfile=font.ttf:textfile=${file}:fontsize=76:${style}:y=h*0.11+${i * 92}:enable='${en}'`));
  const enTop = 0.11 * 1920 + captionFiles.ru.length * 92 + 14;
  captionFiles.en.forEach((file, i) => draws.push(`drawtext=fontfile=font.ttf:textfile=${file}:fontsize=54:${style.replace('fontcolor=white', 'fontcolor=0xFFD84D')}:y=${Math.round(enTop + i * 66)}:enable='${en}'`));
  if (draws.length) { parts.push(`[${v}]${draws.join(',')}[vt]`); v = 'vt'; }
  parts.push(`[${v}]format=yuv420p[vout]`);

  // звук: родной звук ролика + 1–3 эффекта + тихая музыка
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
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', f3(plan.total), '-movflags', '+faststart', out,
  ];
}

/** Рендер одного варианта. workDir — рабочая папка для шрифта и текстов подписей. */
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
  const args = buildRenderArgs({ src, plan, hasAudio: info.hasAudio, sfxFiles, out, captionFiles });
  await media.ffmpeg(args, { cwd: workDir, timeoutMs: 15 * 60_000 });
  return out;
}

export async function makeCover({ video, at, out, media }) {
  await media.ffmpeg(['-y', '-ss', f3(at), '-i', video, '-frames:v', '1', '-q:v', '2', out]);
  return out;
}

/**
 * Время кадра для обложки: резкий, нормально освещённый, без смазки; самые края ролика не берём.
 * Кадр, где что-то движется (умеренно), лучше неподвижного: в пустой сцене (пустая ванна) движения нет,
 * а резкая смена картинки на склейке — не движение зверька.
 */
export function bestCoverAt(sig) {
  const step = sig?.step, sharp = sig?.sharp ?? [], n = sharp.length;
  if (!step || !n) return null;
  const dur = sig.info?.duration ?? n * step;
  const maxSharp = Math.max(...sharp, 1e-9);
  // сначала только нормально освещённые кадры (не тёмные и не пересвеченные); нет таких — любые
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
