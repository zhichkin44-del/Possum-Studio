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

/**
 * Стили монтажа по виду сюжета: ролики разных видов не похожи друг на друга.
 * trans — переходы xfade (по кругу, начало сдвигает seed), dur — длина перехода, zoom — движение камеры,
 * shake — встряска в начале крючка и лучшего момента, slowLast — замедление последнего куска (повтор лучшего момента).
 * Вида нет в таблице — простая склейка, как раньше.
 */
export const STYLES = {
  top5: { name: 'Динамичный', trans: ['slideleft', 'smoothup', 'zoomin', 'wipeleft', 'slideup'], dur: 0.25, zoom: 'punch', shake: true, slowLast: 0.6 },
  fails: { name: 'Ой!', trans: ['zoomin', 'slideleft'], dur: 0.2, zoom: 'punch', shake: true },
  day: { name: 'День', trans: ['fade', 'smoothleft', 'dissolve', 'fadeblack'], dur: 0.5, zoom: 'kenburns' },
  beforeAfter: { name: 'Было-стало', trans: ['wiperight'], dur: 0.5, zoom: 'slow' },
  calm: { name: 'Спокойный', trans: ['fade'], dur: 0.8, zoom: 'slow' },
  asmr: { name: 'Тихий', trans: ['fade'], dur: 0.6, zoom: 'slow' },
  series: { name: 'Серия', trans: ['smoothleft', 'smoothright'], dur: 0.35, zoom: 'kenburns' },
};

/** Число из строки (id сюжета) — чтобы два ролика одного вида начинались с разных переходов и наездов. */
export function seedOf(s = '') {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

/** Движение камеры по куску (zoompan, кадр за кадром): N — кадров в куске, dir — наезд или отъезд. */
function zoomExpr(kind, N, dir) {
  const r = `min(1,on/${N})`;
  if (kind === 'punch') return "if(lt(on,6),1+0.12*on/6,1.12-0.08*min(1,(on-6)/24))"; // резкий наезд 0,2 с и мягкий откат
  if (kind === 'kenburns') return dir ? `1+0.07*${r}` : `1.07-0.07*${r}`;
  if (kind === 'slow') return `1+0.035*${r}`;
  return null;
}

/** Видео куска k: приведение к 9:16 + добивка последним кадром, если исходник кончился раньше; fx — движение камеры, встряска, скорость. */
function videoChain(k, p, fx = {}) {
  const len = p.len + (fx.extra ?? 0);
  const speed = fx.speed ? `setpts=PTS/${fx.speed},` : '';
  const tail = `${speed}tpad=stop_mode=clone:stop_duration=${f3(len)},trim=duration=${f3(len)},setpts=PTS-STARTPTS,fps=30,setsar=1`;
  const z = fx.zoom ? zoomExpr(fx.zoom, Math.max(1, Math.round(len * 30)), fx.dir) : null;
  const move = [
    z ? `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30` : null,
    // встряска 10 кадров с кадра shakeAt (после въезда перехода): окно 1040×1848 гуляет по кадру и растягивается обратно
    fx.shake ? shakeCrop(fx.shakeAt ?? 0) : null,
    'setsar=1,format=yuv420p',
  ].filter(Boolean).join(',');
  if (p.orient === 'vertical') return [`[${k}:v]${FIT},${tail},${move}[v${k}]`];
  return [
    `[${k}:v]split=2[bg${k}][fg${k}]`,
    `[bg${k}]${BG}[bb${k}]`,
    // кадр 9:8: крупнее полоски 16:9, но без глубокой обрезки 4:5, что срезала зверька у края
    `[fg${k}]${FG}[ff${k}]`,
    `[bb${k}][ff${k}]overlay=(W-w)/2:(H-h)/2,${tail},${move}[v${k}]`,
  ];
}

function shakeCrop(at) {
  const on = `between(n,${at},${at + 9})`;
  return `crop=1040:1848:x='20+16*sin(n*2.3)*${on}':y='36+16*cos(n*1.7)*${on}',scale=1080:1920`;
}

/** Эффекты кусков по стилю: длина перехода (не больше трети самого короткого куска), что с каждым куском. */
export function planStyle(pieces, style, seed = 0) {
  if (!style || pieces.length < 1) return null;
  const d = pieces.length > 1 ? Math.min(style.dur, Math.min(...pieces.map((p) => p.len)) / 3) : 0;
  const last = pieces.length - 1;
  const fx = pieces.map((p, k) => ({
    // каждый кусок, кроме последнего, берёт из исходника на d больше: хвост уходит под переход, и длина ролика не меняется
    extra: k < last ? d : 0,
    zoom: style.zoom ?? null,
    dir: (k + seed) % 2 === 0,
    shake: Boolean(style.shake) && (k === 0 || k === last) && pieces.length > 1,
    // первые d секунд куска (кроме первого) закрыты переходом — встряску начинаем после него
    shakeAt: k > 0 ? Math.ceil(d * 30) : 0,
    speed: style.slowLast && k === last && pieces.length > 1 ? style.slowLast : null,
  }));
  const trans = pieces.slice(1).map((_, k) => style.trans[(k + seed) % style.trans.length]);
  return { d, fx, trans };
}

/**
 * Аргументы ffmpeg для сюжета.
 * pieces: [{src, from, len, hasAudio, orient, hold}] (hold — подпись держится до конца ролика), captionFiles: [[файлы строк куска k], …] (лежат в рабочей папке с font.ttf).
 */
export function buildStoryArgs({ pieces, out, quiet = false, captionFiles = [], music = null, style = null, seed = 0 }) {
  if (!pieces?.length) throw new Error('Пустой сюжет');
  const plan = planStyle(pieces, style, seed);
  const fxOf = (k) => plan?.fx[k] ?? {};
  // замедленный кусок берёт из середины своего окна столько исходника, сколько растянется на всю длину куска
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
    parts.push(...videoChain(k, p, fx));
    parts.push(p.hasAudio
      ? `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,${fx.speed ? `atempo=${fx.speed},` : ''}apad,atrim=duration=${f3(alen)},asetpts=PTS-STARTPTS[a${k}]`
      : `aevalsrc=0:c=stereo:s=48000:d=${f3(alen)}[a${k}]`);
  });
  if (plan && pieces.length > 1) {
    // переходы: кусок k+1 въезжает поверх хвоста куска k; offset — где кончается кусок k в готовом ролике
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
  const args = buildStoryArgs({ pieces, out, quiet: story.quiet, captionFiles, music, style: STYLES[story.kind] ?? null, seed: seedOf(story.id) });
  await media.ffmpeg(args, { cwd: workDir, timeoutMs: 15 * 60_000 });
  return out;
}
