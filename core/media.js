// ffmpeg/ffprobe: поиск (переменная → ffmpeg-static в приложении → PATH), запуск, сигналы ролика по 0,25 с.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const STEP = 0.25;
const W = 64, H = 96;

const works = (b) => { try { return b && spawnSync(b, ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0 ? b : null; } catch { return null; } };
const unasar = (p) => (p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p);
function fromPackage(name) {
  try { const m = require(name); return unasar(typeof m === 'string' ? m : m?.path); } catch { return null; }
}

export function findTools(env = process.env) {
  const ffmpeg = works(env.FFMPEG) || works(fromPackage('ffmpeg-static')) || works('ffmpeg');
  const ffprobe = works(env.FFPROBE) || works(fromPackage('ffprobe-static')) || works('ffprobe');
  return { ffmpeg, ffprobe };
}

export function run(bin, args, { cwd, binary = false, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${bin} завис дольше ${Math.round(timeoutMs / 1000)} с`)); }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      resolve({ code, stdout: binary ? buf : buf.toString('utf8'), stderr: err });
    });
  });
}

export function createMedia(env = process.env) {
  const tools = findTools(env);
  const need = () => { if (!tools.ffmpeg || !tools.ffprobe) throw new Error('Не найден ffmpeg. Переустановите приложение или поставьте FFmpeg.'); };

  async function ffmpeg(args, opts) {
    need();
    const r = await run(tools.ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', ...args], opts);
    if (r.code !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-600)}`);
    return r;
  }

  async function probe(path) {
    need();
    const r = await run(tools.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { timeoutMs: 90_000 });
    if (r.code !== 0) throw new Error(`Не удалось прочитать видео: ${r.stderr.slice(-200)}`);
    const j = JSON.parse(r.stdout);
    const v = (j.streams ?? []).find((s) => s.codec_type === 'video');
    if (!v) throw new Error('В файле нет видео');
    let w = Number(v.width), h = Number(v.height);
    const rotSide = (v.side_data_list ?? []).find((x) => x.rotation !== undefined)?.rotation;
    const rot = Math.abs(Number(v.tags?.rotate ?? rotSide ?? 0));
    if (rot === 90 || rot === 270) [w, h] = [h, w];
    return {
      duration: Number(j.format?.duration ?? v.duration ?? 0),
      width: w, height: h,
      hasAudio: (j.streams ?? []).some((s) => s.codec_type === 'audio'),
      size: Number(j.format?.size ?? 0),
    };
  }

  /** Движение (средняя разница соседних кадров), яркость (0–255) и громкость (дБ) — по окнам 0,25 с. */
  async function signals(path) {
    const info = await probe(path);
    const v = await ffmpeg(['-i', path, '-an', '-vf', `fps=${1 / STEP},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { binary: true });
    const frame = W * H, n = Math.floor(v.stdout.length / frame);
    const motion = [], luma = [];
    for (let i = 0; i < n; i++) {
      let sum = 0, diff = 0;
      for (let k = 0; k < frame; k++) {
        const p = v.stdout[i * frame + k];
        sum += p;
        if (i > 0) diff += Math.abs(p - v.stdout[(i - 1) * frame + k]);
      }
      luma.push(sum / frame);
      motion.push(i > 0 ? diff / frame : 0);
    }
    const loud = Array(n).fill(-90);
    if (info.hasAudio) {
      const rate = 8000, win = rate * STEP;
      const a = await ffmpeg(['-i', path, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { binary: true });
      const samples = Math.floor(a.stdout.length / 2);
      for (let i = 0; i < n; i++) {
        let sq = 0, c = 0;
        for (let s = i * win; s < Math.min(samples, (i + 1) * win); s++, c++) { const x = a.stdout.readInt16LE(s * 2) / 32768; sq += x * x; }
        if (c) loud[i] = Math.max(-90, 10 * Math.log10(sq / c + 1e-12));
      }
    }
    return { step: STEP, motion, loud, luma, info };
  }

  return { tools, ffmpeg, probe, signals };
}
