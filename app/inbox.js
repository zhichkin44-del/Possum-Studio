// Папка «Входящие» → очередь → монтаж по одному ролику или пачкой (batch: продюсер разбирает всё сразу). Без Electron: тестируется обычным node --test.
// Файл берётся в работу, когда размер и время изменения не менялись stableMs (по умолчанию 15 с) — докопирован.
// Состояние пишется атомарно (tmp → rename); испорченный файл состояния сохраняется как .bak, а не теряется молча.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp', '.ogv', '.mpg', '.mpeg', '.wmv']);

export function createInbox({ inDir, statePath, studio, onChange = () => {}, stableMs = 15_000, now = Date.now, batch = null, onBatch = () => {} }) {
  mkdirSync(inDir, { recursive: true });
  let jobs = [];
  let last = null; // итог последней пачки: решения для экрана «Календарь»
  if (existsSync(statePath)) {
    try { const st = JSON.parse(readFileSync(statePath, 'utf8')); jobs = st.jobs ?? []; last = st.last ?? null; }
    catch { try { copyFileSync(statePath, `${statePath}.bak`); } catch { /* нечего сохранить */ } jobs = []; }
  }
  const seen = new Map(); // имя → { size, mtime, since } с прошлой проверки
  const queue = [];
  let busy = null;
  let waiters = [];

  const list = () => jobs.map((j) => ({ ...j })).reverse();
  // файлы, что ещё докопируются, видны сразу — иначе первые 15 с «Входящие» пишут «Пока пусто»
  const copying = () => [...seen.keys()].map((name) => ({ id: `copy:${name}`, name, status: 'copying', step: 'Ждём, пока файл докопируется' }));
  const changed = () => { try { onChange([...copying(), ...list()]); } catch { /* окно закрыто */ } };
  function persist() {
    mkdirSync(dirname(statePath), { recursive: true });
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ jobs, last }, null, 2), 'utf8');
    renameSync(tmp, statePath);
  }

  function enqueue(job) {
    job.status = 'waiting'; job.step = 'В очереди'; job.error = null;
    if (!queue.includes(job.id)) queue.push(job.id);
  }

  function scan() {
    let files = [];
    try { files = readdirSync(inDir); } catch { return; }
    for (const name of seen.keys()) if (!files.includes(name)) seen.delete(name); // убрали из папки
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

  const toLast = (res, n, prevMade = []) => {
    const made = [...prevMade, ...(res?.made ?? [])].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i);
    return {
      at: new Date(now()).toISOString(), made, decisions: res?.decisions ?? [], errors: (res?.errors ?? []).filter((e) => e.story),
      disk: res?.disk ?? null, n, notPet: res?.notPet ?? res?.rejected?.length ?? (res?.files ?? []).filter((f) => f.notPet).length, review: made.filter((m) => m.needsReview).length,
      rejected: res?.rejected ?? (res?.files ?? []).filter((f) => f.notPet).map((f) => ({ name: basename(f.file), why: f.why ?? null })),
      confirmed: res?.confirmed ?? [], queued: res?.queued ?? null,
    };
  };
  /**
   * Итог шага той же пачки (эталон, отметка «где мой зверёк»): ролики прошлых шагов не теряются,
   * пока пачка ждала решения человека. Отброшенные видео получают во «Входящих» статус «не взято» с причиной.
   */
  function setLast(res) {
    const pending = (last?.decisions ?? []).some((d) => d.type === 'reference' || d.type === 'confirm');
    last = toLast(res, last?.n ?? 0, pending ? last.made : []);
    for (const r of res?.rejected ?? []) {
      const j = jobs.find((x) => x.name === r.name && x.status !== 'error');
      if (j) Object.assign(j, { status: 'notpet', step: `${r.why ?? 'не ваш зверёк'} — в ролики не берём`, error: null });
    }
    persist(); if (res?.rejected?.length) changed();
    return last;
  }

  /** Пачка: всё, что в очереди, уходит в batch(files, onProgress) одним заходом. */
  async function pumpBatch() {
    const group = queue.splice(0).map((id) => jobs.find((j) => j.id === id)).filter(Boolean);
    if (!group.length) return pump();
    busy = group;
    for (const j of group) {
      try { const st = statSync(j.src); j.key = `${j.name}|${st.size}|${Math.round(st.mtimeMs)}`; } catch { /* нет файла — скажет разбор */ }
      j.status = 'working'; j.step = 'Жду разбора';
    }
    persist(); changed();
    const byName = (n) => group.find((j) => j.name === n);
    try {
      const res = await batch(group.map((j) => j.src), (p) => {
        const j = p.name && byName(p.name);
        if (p.stage === 'разбор' && j) j.step = 'Разбираю';
        for (const g of group) if (g.status === 'working') g.eta = p.eta ?? null;
        if (p.stage === 'монтаж') for (const g of group) if (g.step !== 'Ошибка') g.step = `Монтаж ${p.i + 1}/${p.n}`;
        changed();
      });
      for (const j of group) {
        const err = (res?.errors ?? []).find((e) => e.file === j.name);
        const f = (res?.files ?? []).find((x) => basename(x.file) === j.name);
        if (err) Object.assign(j, { status: 'error', step: 'Ошибка', error: String(err.error ?? 'не разобрался').slice(0, 500) });
        else if (f?.skipped) Object.assign(j, { status: 'done', step: f.skipped, error: null });
        else if (f?.notPet) Object.assign(j, { status: 'notpet', step: `${f.why ?? 'не ваш зверёк'} — в ролики не берём`, error: null });
        else Object.assign(j, { status: 'done', step: res?.sent ? 'Отправлено монтажёру' : 'Разобран', error: null });
        delete j.eta;
      }
      last = toLast(res, group.length);
      try { onBatch(res); } catch { /* окно закрыто */ }
    } catch (e) {
      for (const j of group) { Object.assign(j, { status: 'error', step: 'Ошибка', error: String(e?.message ?? e).slice(0, 500) }); delete j.eta; }
    } finally {
      busy = null;
      persist(); changed();
      pump();
    }
  }

  async function pump() {
    if (busy || !queue.length) { if (!busy && !queue.length) { waiters.forEach((w) => w()); waiters = []; } return; }
    if (batch) return pumpBatch();
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

  return { scan, resume, redo, list, copying, idle, last: () => last, setLast, get: (id) => jobs.find((j) => j.id === id) ?? null };
}
