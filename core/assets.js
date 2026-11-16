// Свои звуки и своя фоновая мелодия — синтезируем ffmpeg'ом, поэтому никаких лицензий и страйков.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Выражения в одинарных кавычках: так запятые внутри не режут граф фильтров.
const SFX = {
  pop: ['-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*(500+2200*t)*t)*exp(-28*t)':s=48000:d=0.2"],
  whoosh: ['-f', 'lavfi', '-i', 'anoisesrc=c=pink:a=0.7:d=0.6:r=48000', '-af', 'bandpass=f=1400:w=1200,afade=t=in:d=0.25,afade=t=out:st=0.3:d=0.3'],
  boing: ['-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*(260+70*sin(2*PI*11*t))*t)*exp(-5*t)':s=48000:d=0.55"],
};

export async function ensureSfx(dir, media) {
  mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [name, args] of Object.entries(SFX)) {
    const file = join(dir, `${name}.wav`);
    if (!existsSync(file)) await media.ffmpeg(['-y', ...args, '-ac', '2', file]);
    out[name] = file;
  }
  return out;
}

// Колыбельная I–vi–IV–V, арпеджио четвертями; тихо ляжет под звуки самого поссума.
const LULLABY = "aevalsrc='0.25*sin(2*PI*261.63*pow(2,(if(eq(mod(floor(t/2),4),1),-3,if(eq(mod(floor(t/2),4),2),-7,if(eq(mod(floor(t/2),4),3),-5,0)))+mod(floor(t*4),4)*4-eq(mod(floor(t*4),4),2))/12)*t)*exp(-5*mod(t,0.25))':s=48000:d=16";

export async function ensureMusic(dir, media) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'possum-lullaby.wav');
  if (!existsSync(file)) await media.ffmpeg(['-y', '-f', 'lavfi', '-i', LULLABY, '-af', 'lowpass=f=3000,aecho=0.8:0.7:120:0.25', '-ac', '2', file]);
  return file;
}

const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac']);
/** Своя музыка владельца или напарницы (папка «Музыка»): только то, что они туда положили сами. */
export function listMusic(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => AUDIO.has(extname(f).toLowerCase())).sort().map((f) => join(dir, f));
}

/** Один и тот же ролик — та же мелодия; разные ролики — разные. */
export function pickMusic(list, seed = '') {
  if (!list.length) return null;
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return list[h % list.length];
}

/**
 * Папка вшитых шрифтов и звуков. В установленном приложении она лежит рядом с app.asar (extraResources):
 * ffmpeg не умеет читать изнутри asar. При разработке — assets/ в корне репо.
 */
export function bundledAssetsDir(exists = existsSync) {
  const res = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'assets') : null;
  if (res && exists(res)) return res;
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
}

/** Жирный шрифт с кириллицей для подписей: свой (POSSUM_FONT) → вшитый Montserrat Black → Segoe UI Bold → Arial Bold → DejaVu (Linux). */
export function findFont(env = process.env, exists = existsSync) {
  const win = join(env.WINDIR ?? env.windir ?? 'C:/Windows', 'Fonts');
  const cands = [env.POSSUM_FONT, join(bundledAssetsDir(exists), 'fonts', 'Montserrat-Black.ttf'), join(win, 'segoeuib.ttf'), join(win, 'arialbd.ttf'), join(win, 'arial.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'].filter(Boolean);
  return cands.find((f) => exists(f)) ?? null;
}
