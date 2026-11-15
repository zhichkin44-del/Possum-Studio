// ffmpeg/ffprobe: поиск (переменная → ffmpeg-static в приложении → PATH), запуск, сигналы ролика (шаг 0,25 с, у длинных — больше), прокси 720p.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { frameStats, FW as W, FH as H } from './frames.js';

const require = createRequire(import.meta.url);
export const STEP = 0.25;
export const MAX_SAMPLES = 2400;
/** Шаг сигналов: 0,25 с, но не больше 2 400 замеров на клип. */
export const stepFor = (duration) => Math.max(STEP, Math.ceil(((duration || 0) / MAX_SAMPLES) * 4) / 4);
const ratio = (s) => { const [a, b] = String(s ?? '0/1').split('/').map(Number); return b ? a / b : a || 0; };
const HDR_TRC = new Set(['smpte2084', 'arib-std-b67']);

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
    const fps = ratio(v.avg_frame_rate) || ratio(v.r_frame_rate);
    const rfps = ratio(v.r_frame_rate);
    return {
      duration: Number(j.format?.duration ?? v.duration ?? 0),
      width: w, height: h,
      hasAudio: (j.streams ?? []).some((s) => s.codec_type === 'audio'),
      size: Number(j.format?.size ?? 0),
      fps: Math.round(fps * 100) / 100,
      vfr: fps > 0 && rfps > 0 && Math.abs(rfps - fps) / fps > 0.02,
      hdr: HDR_TRC.has(v.color_transfer),
      codec: v.codec_name ?? '',
      created: j.format?.tags?.creation_time ?? null,
    };
  }

  /** Прокси для разбора: 720p по короткой стороне, 30 к/с постоянная, H.264 BT.709 (HDR → тонмаппинг). */
  async function proxy(src, out, info) {
    const i = info ?? await probe(src);
    const size = "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'";
    const tone = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,';
    const vf = `${i.hdr ? tone : ''}${size},fps=30,format=yuv420p`;
    const audio = i.hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an'];
    await ffmpeg(['-y', '-i', src, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', ...audio, '-movflags', '+faststart', out], { timeoutMs: 1_800_000 });
    return out;
  }

  /** По шагу: движение (разница соседних кадров), яркость, насыщенность, резкость, dHash, громкость (дБ). */
  async function signals(path, { info: given } = {}) {
    const info = given ?? await probe(path);
    const step = stepFor(info.duration);
    const v = await ffmpeg(['-i', path, '-an', '-vf', `fps=${1 / step},scale=${W}:${H},format=rgb24`, '-f', 'rawvideo', '-'], { binary: true, timeoutMs: 1_800_000 });
    const frame = W * H * 3, n = Math.floor(v.stdout.length / frame);
    const motion = [], luma = [], sat = [], sharp = [], hash = [];
    for (let i = 0; i < n; i++) {
      const f = frameStats(v.stdout, i * frame);
      luma.push(f.luma); sat.push(f.sat); sharp.push(f.sharp); hash.push(f.hash);
      if (i === 0) { motion.push(0); continue; }
      let diff = 0;
      for (let k = 0; k < W * H; k++) {
        const o = i * frame + k * 3, p = o - frame;
        diff += Math.abs((0.299 * v.stdout[o] + 0.587 * v.stdout[o + 1] + 0.114 * v.stdout[o + 2])
          - (0.299 * v.stdout[p] + 0.587 * v.stdout[p + 1] + 0.114 * v.stdout[p + 2]));
      }
      motion.push(diff / (W * H));
    }
    const loud = Array(n).fill(-90);
    if (info.hasAudio) {
      const rate = 8000, win = Math.round(rate * step);
      const a = await ffmpeg(['-i', path, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { binary: true, timeoutMs: 1_800_000 });
      const samples = Math.floor(a.stdout.length / 2);
      for (let i = 0; i < n; i++) {
        let sq = 0, c = 0;
        for (let s = i * win; s < Math.min(samples, (i + 1) * win); s++, c++) { const x = a.stdout.readInt16LE(s * 2) / 32768; sq += x * x; }
        if (c) loud[i] = Math.max(-90, 10 * Math.log10(sq / c + 1e-12));
      }
    }
    return { step, motion, loud, luma, sat, sharp, hash, info };
  }

  return { tools, ffmpeg, probe, signals, proxy };
}
