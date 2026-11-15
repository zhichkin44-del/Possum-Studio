// Папка «Входящие» → очередь → монтаж по одному ролику. Без Electron: тестируется обычным node --test.
// Файл берётся в работу, когда размер и время изменения не менялись stableMs (по умолчанию 15 с) — докопирован.
// Состояние пишется атомарно (tmp → rename); испорченный файл состояния сохраняется как .bak, а не теряется молча.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join } from 'node:path';

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp']);

export function createInbox({ inDir, statePath, studio, onChange = () => {}, stableMs = 15_000, now = Date.now }) {
  mkdirSync(inDir, { recursive: true });
  let jobs = [];
  if (existsSync(statePath)) {
    try { jobs = JSON.parse(readFileSync(statePath, 'utf8')).jobs ?? []; }
    catch { try { copyFileSync(statePath, `${statePath}.bak`); } catch { /* нечего сохранить */ } jobs = []; }
  }
  const seen = new Map(); // имя → { size, mtime, since } с прошлой проверки
  const queue = [];
  let busy = null;
  let waiters = [];

  const list = () => jobs.map((j) => ({ ...j })).reverse();
  const changed = () => { try { onChange(list()); } catch { /* окно закрыто */ } };
  function persist() {
    mkdirSync(dirname(statePath), { recursive: true });
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ jobs }, null, 2), 'utf8');
    renameSync(tmp, statePath);
  }

  function enqueue(job) {
    job.status = 'waiting'; job.step = 'В очереди'; job.error = null;
    if (!queue.includes(job.id)) queue.push(job.id);
  }

  function scan() {
    let files = [];
    try { files = readdirSync(inDir); } catch { return; }
    for (const name of files) {
      if (!VIDEO_EXT.has(extname(name).toLowerCase())) continue;
      const src = join(inDir, name);
      let st;
      try { st = statSync(src); } catch { continue; }
      if (!st.isFile()) continue;
      const key = `${name}|${st.size}|${Math.round(st.mtimeMs)}`;
      if (jobs.some((j) => j.key === key || (j.src === src && (j.status === 'waiting' || j.status === 'working')))) continue;
      const mtime = Math.round(st.mtimeMs);
      const prev = seen.get(name);
      if (!prev || prev.size !== st.size || prev.mtime !== mtime) { seen.set(name, { size: st.size, mtime, since: now() }); continue; }
      if (now() - prev.since < stableMs) continue;
      seen.delete(name);
      const job = { id: createHash('sha1').update(key).digest('hex').slice(0, 12), key, name, src, addedAt: new Date().toISOString(), dir: null, verdict: null };
      jobs.push(job);
      enqueue(job);
    }
    persist();
    changed();
    pump();
  }

  /** После перезапуска: недоделанное — снова в очередь. */
  function resume() {
    for (const j of jobs) if (j.status === 'waiting' || j.status === 'working') enqueue(j);
    persist(); changed(); pump();
  }

  async function pump() {
    if (busy || !queue.length) { if (!busy && !queue.length) { waiters.forEach((w) => w()); waiters = []; } return; }
    const id = queue.shift();
    const job = jobs.find((j) => j.id === id);
    if (!job) return pump();
    busy = job;
    // ключ — по тому файлу, что реально монтируем (после перезапуска запись могла устареть)
    try { const st = statSync(job.src); job.key = `${job.name}|${st.size}|${Math.round(st.mtimeMs)}`; } catch { /* файла нет — studio скажет */ }
    job.status = 'working'; job.step = 'Начинаю';
    persist(); changed();
    try {
      const m = await studio.process(job.src, (step) => { job.step = step; changed(); });
      Object.assign(job, { status: 'done', step: 'Готово', dir: m.dir, verdict: m.advice?.verdict ?? null, error: null });
    } catch (e) {
      Object.assign(job, { status: 'error', step: 'Ошибка', error: String(e?.message ?? e).slice(0, 500) });
    } finally {
      busy = null;
      persist(); changed();
      pump();
    }
  }

  function redo(id) {
    const job = jobs.find((j) => j.id === id);
    if (!job || job.status === 'working') return false;
    enqueue(job); persist(); changed(); pump();
    return true;
  }

  const idle = () => (busy || queue.length ? new Promise((r) => waiters.push(r)) : Promise.resolve());

  return { scan, resume, redo, list, idle, get: (id) => jobs.find((j) => j.id === id) ?? null };
}
