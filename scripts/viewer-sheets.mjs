// Листы кадров для зрителей-проверяльщиков (агенты-«зрители» оценивают готовые ролики по картинкам).
// 12 кадров по всей длине ролика, два из них — в последних 2 секундах: концовку (в топ-5 там №1) зритель должен видеть.
// Раньше было 8 кадров с шагом 1,5 с — только первые 10,5 с, оценка выходила без концовки.
// node scripts/viewer-sheets.mjs <папка листов> <папка ролика>...   (в папке ролика: video.mp4, cover.jpg, пост.txt, заметки.txt)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SHEET_FRAMES = 12;
export const SHEET_COLS = 4;
const CELL_W = 270;
const FONT = "C\\:/Windows/Fonts/arial.ttf"; // в -filter_complex двоеточие диска экранируется дважды
const r2 = (x) => Math.round(x * 100) / 100;

/** Времена кадров (с): n−2 ровно по [0, sec−2], ещё два в последних 2 с, последний — за 0,15 с до конца. */
export function viewerSheetTimes(sec, n = SHEET_FRAMES) {
  const last = sec - 0.15;
  if (sec <= 3) return Array.from({ length: n }, (_, i) => r2((last * i) / (n - 1)));
  const body = sec - 2;
  const t = Array.from({ length: n - 2 }, (_, i) => r2((body * i) / (n - 3)));
  return [...t, r2((body + last) / 2), r2(last)];
}

/** Длина ролика (с) по видеодорожке: если звук длиннее, кадр «за 0,15 с до конца файла» оказался бы пустым. */
export function videoSeconds(probe) {
  const fmt = +probe.format.duration;
  const vid = +(probe.streams.find((s) => s.codec_type === 'video')?.duration ?? NaN);
  return r2(Number.isFinite(vid) && vid > 0 ? Math.min(fmt, vid) : fmt);
}

/** Подпись кадра: секунды с десятыми («19.4 с»). */
const label = (t) => `${(Math.round(t * 10) / 10).toFixed(1)} с`;

/** Аргументы ffmpeg: каждый кадр — свой -ss, подпись времени, сетка 4×3 (xstack). */
export function viewerSheetArgs({ src, sec, out }) {
  const times = viewerSheetTimes(sec);
  const inputs = times.flatMap((t) => ['-ss', String(t), '-i', src]);
  const cells = times.map((t, i) =>
    `[${i}:v]scale=${CELL_W}:-2,drawtext=fontfile='${FONT}':text='${label(t)}':x=6:y=6:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.6[v${i}]`);
  const pos = (k, d) => (k === 0 ? '0' : Array(k).fill(`${d}0`).join('+'));
  const layout = times.map((_, i) => `${pos(i % SHEET_COLS, 'w')}_${pos(Math.floor(i / SHEET_COLS), 'h')}`).join('|');
  const fc = `${cells.join(';')};${times.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${times.length}:layout=${layout}[out]`;
  return ['-y', '-v', 'error', ...inputs, '-filter_complex', fc, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out];
}

function build(sheets, reels) {
  mkdirSync(sheets, { recursive: true });
  const facts = reels.map((dir, k) => {
    const v = join(dir, 'video.mp4');
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', v]).toString());
    const sec = videoSeconds(probe);
    const vs = probe.streams.find((s) => s.codec_type === 'video');
    const sheet = `reel${k + 1}.jpg`;
    const cover = `reel${k + 1}-cover.jpg`;
    execFileSync('ffmpeg', viewerSheetArgs({ src: v, sec, out: join(sheets, sheet) }));
    copyFileSync(join(dir, 'cover.jpg'), join(sheets, cover));
    const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
    const post = read('пост.txt');
    const title = (post.split('\n')[1] ?? '').replace(/\s*#Shorts\s*$/i, '').trim();
    console.log(`${sheet}: ${sec} с, кадры ${viewerSheetTimes(sec).join(' ')}`);
    return { sheet, cover, kind: basename(dir).split('_')[1] ?? '', title, sec, w: vs.width, h: vs.height,
      audio: probe.streams.some((s) => s.codec_type === 'audio'), times: viewerSheetTimes(sec), post, notes: read('заметки.txt') };
  });
  writeFileSync(join(sheets, 'facts.json'), JSON.stringify(facts, null, 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sheets, ...reels] = process.argv.slice(2);
  if (!sheets || !reels.length) { console.error('node scripts/viewer-sheets.mjs <папка листов> <папка ролика>...'); process.exit(1); }
  build(sheets, reels);
}
