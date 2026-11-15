// Видео, брошенные в окно или выбранные кнопкой, → папка «Входящие». Без Electron: тестируется обычным node --test.
// Папки раскрываются целиком (служебные _папки, .скрытые и out с готовыми роликами пропускаются).
// Файл с тем же именем не затирается; то же самое видео второй раз не копируется.
import { createReadStream, createWriteStream, existsSync, openSync, readSync, closeSync, readdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { basename, extname, join, resolve } from 'node:path';
import { VIDEO_EXT } from './inbox.js';

const SKIP_DIR = /^[_.]|^out$/i;

/** Пути (файлы и папки) → список видеофайлов. */
export function collectVideos(paths, depth = 0) {
  const out = [];
  for (const p of paths ?? []) {
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (depth > 0 && SKIP_DIR.test(basename(p))) continue;
      if (depth > 6) continue;
      let names = []; try { names = readdirSync(p); } catch { continue; }
      out.push(...collectVideos(names.sort().map((n) => join(p, n)), depth + 1));
    } else if (st.isFile() && VIDEO_EXT.has(extname(p).toLowerCase())) out.push(p);
  }
  return [...new Set(out.map((f) => resolve(f)))];
}

function head(file) {
  const fd = openSync(file, 'r');
  try { const b = Buffer.alloc(1 << 20); const n = readSync(fd, b, 0, b.length, 0); return createHash('sha1').update(b.subarray(0, n)).digest('hex'); }
  finally { closeSync(fd); }
}
const same = (a, b) => statSync(a).size === statSync(b).size && head(a) === head(b);

/** Куда положить: то же видео уже лежит → null; имя занято другим → «имя (2).ext». */
function target(src, inDir) {
  const ext = extname(src); const stem = basename(src, ext);
  for (let i = 1; i < 1000; i++) {
    const dst = join(inDir, i === 1 ? `${stem}${ext}` : `${stem} (${i})${ext}`);
    if (!existsSync(dst)) return dst;
    if (resolve(dst) === resolve(src) || same(src, dst)) return null;
  }
  return null;
}

/** Копирует с прогрессом { done, total, name, bytesDone, bytesTotal }. Пишет во временный файл: разбор не возьмёт недокопированное. */
export async function copyVideos(files, inDir, onProgress = () => {}) {
  const list = files.map((f) => ({ f, size: statSync(f).size }));
  const bytesTotal = list.reduce((s, x) => s + x.size, 0);
  let bytesDone = 0; let done = 0; let copied = 0; let same = 0; let last = 0;
  const tell = (name, force) => { const t = Date.now(); if (force || t - last > 150) { last = t; onProgress({ done, total: list.length, name, bytesDone, bytesTotal }); } };
  tell('', true);
  for (const { f, size } of list) {
    const name = basename(f);
    const dst = target(f, inDir);
    if (!dst) { same++; bytesDone += size; done++; tell(name, true); continue; }
    const tmp = `${dst}.копируется`;
    try {
      const rs = createReadStream(f);
      rs.on('data', (c) => { bytesDone += c.length; tell(name); });
      await pipeline(rs, createWriteStream(tmp));
      renameSync(tmp, dst);
      copied++;
    } catch (e) { try { rmSync(tmp, { force: true }); } catch { /* нечего убрать */ } throw e; }
    done++; tell(name, true);
  }
  return { copied, same, total: list.length };
}
