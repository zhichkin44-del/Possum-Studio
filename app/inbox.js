// "Inbox" folder → queue → editing one video at a time or in a batch (batch: the producer analyses everything at once). No Electron: tested with plain node --test.
// A file is taken into work when its size and modification time have not changed for stableMs (15 s by default) — it has finished copying.
// The state is written atomically (tmp → rename); a corrupted state file is kept as .bak, not silently lost.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp', '.ogv', '.mpg', '.mpeg', '.wmv']);

export function createInbox({ inDir, statePath, studio, onChange = () => {}, stableMs = 15_000, now = Date.now, batch = null, onBatch = () => {} }) {
  mkdirSync(inDir, { recursive: true });
  let jobs = [];
  let last = null; // result of the last batch: decisions for the "Calendar" screen
  if (existsSync(statePath)) {
    try { const st = JSON.parse(readFileSync(statePath, 'utf8')); jobs = st.jobs ?? []; last = st.last ?? null; }
    catch { try { copyFileSync(statePath, `${statePath}.bak`); } catch { /* nothing to keep */ } jobs = []; }
  }
  const seen = new Map(); // name → { size, mtime, since } from the previous check
  const queue = [];
  let busy = null;
  let waiters = [];

  const list = () => jobs.map((j) => ({ ...j })).reverse();
  // files that are still copying are visible at once — otherwise for the first 15 s "Inbox" would say "Empty for now"
  const copying = () => [...seen.keys()].map((name) => ({ id: `copy:${name}`, name, status: 'copying', step: 'Ждём, пока файл докопируется' }));
  const changed = () => { try { onChange([...copying(), ...list()]); } catch { /* window closed */ } };
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
    for (const name of seen.keys()) if (!files.includes(name)) seen.delete(name); // removed from the folder
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

  /** After a restart: unfinished work goes back into the queue. */
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
   * The result of a step of the same batch (reference, "where my pet is" mark): videos from past steps are not lost,
   * while the batch was waiting for the person's decision. Discarded videos get the status "not taken" with a reason in "Inbox".
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

  /** Batch: everything in the queue goes into batch(files, onProgress) in one pass. */
  async function pumpBatch() {
    const group = queue.splice(0).map((id) => jobs.find((j) => j.id === id)).filter(Boolean);
    if (!group.length) return pump();
    busy = group;
    for (const j of group) {
      try { const st = statSync(j.src); j.key = `${j.name}|${st.size}|${Math.round(st.mtimeMs)}`; } catch { /* no file — the analysis will report it */ }
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
      try { onBatch(res); } catch { /* window closed */ }
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
    // the key is by the file we actually edit (after a restart the record may be stale)
    try { const st = statSync(job.src); job.key = `${job.name}|${st.size}|${Math.round(st.mtimeMs)}`; } catch { /* no file — studio will report it */ }
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
