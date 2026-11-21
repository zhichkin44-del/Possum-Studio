// Frame sheets for the viewer-reviewers (agent "viewers" rate finished videos by pictures).
// 12 frames across the whole length of the video, two of them in the last 2 seconds: the viewer must see the ending (No. 1 in the top 5 is there).
// Before it was 8 frames at a 1.5 s step — only the first 10.5 s, the rating came out without the ending.
// node scripts/viewer-sheets.mjs <sheets folder> <video folder>...   (in the video folder: video.mp4, cover.jpg, пост.txt, заметки.txt)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SHEET_FRAMES = 12;
export const SHEET_COLS = 4;
const CELL_W = 270;
const FONT = "C\\:/Windows/Fonts/arial.ttf"; // in -filter_complex the drive colon is escaped twice
const r2 = (x) => Math.round(x * 100) / 100;

/** Frame times (s): n−2 evenly over [0, sec−2], two more in the last 2 s, the last — 0.15 s before the end. */
export function viewerSheetTimes(sec, n = SHEET_FRAMES) {
  const last = sec - 0.15;
  if (sec <= 3) return Array.from({ length: n }, (_, i) => r2((last * i) / (n - 1)));
  const body = sec - 2;
  const t = Array.from({ length: n - 2 }, (_, i) => r2((body * i) / (n - 3)));
  return [...t, r2((body + last) / 2), r2(last)];
}

/** Video length (s) from the video track: if the sound is longer, the frame "0.15 s before the end of the file" would be empty. */
export function videoSeconds(probe) {
  const fmt = +probe.format.duration;
  const vid = +(probe.streams.find((s) => s.codec_type === 'video')?.duration ?? NaN);
  return r2(Number.isFinite(vid) && vid > 0 ? Math.min(fmt, vid) : fmt);
}

/** Frame label: seconds with one decimal place. */
const label = (t) => `${(Math.round(t * 10) / 10).toFixed(1)} с`;

/** ffmpeg arguments: each frame — its own -ss, a time label, a 4×3 grid (xstack). */
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
