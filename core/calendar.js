// Posting calendar: one video a day at 18:00, a queue 14 days ahead.
// The calendar publishes nothing: a slot is a ready package (mp4 + cover + texts), and a person publishes it with the stage 1 button.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY = 24 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
/** Date in local time: "2026-11-15". */
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export function createCalendar({ path = null, now = Date.now, hour = 18, days = 14 } = {}) {
  let db = { slots: [] };
  if (path && existsSync(path)) {
    try { db = { slots: [], ...JSON.parse(readFileSync(path, 'utf8')) }; }
    catch { try { copyFileSync(path, `${path}.bak`); } catch { /* nothing to save */ } }
  }
  const save = () => {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(db, null, 2), 'utf8');
    renameSync(`${path}.tmp`, path);
  };
  /** Posting time `offset` days from today (18:00 local). */
  const slotAt = (offset) => { const d = new Date(now()); d.setHours(hour, 0, 0, 0); d.setDate(d.getDate() + offset); return d.getTime(); };
  const firstOffset = () => (now() >= slotAt(0) ? 1 : 0); // today's 18:00 has passed — the nearest slot is tomorrow
  const live = () => db.slots.filter((s) => s.status !== 'skipped');
  const taken = (day) => live().some((s) => s.day === day);
  const today = () => dayKey(now());

  return {
    path, hour, days,
    all: () => db.slots.map((s) => ({ ...s })),
    get: (id) => db.slots.find((s) => s.id === id) ?? null,

    /** Free days in the 14-day window ahead. */
    free() {
      const f = firstOffset();
      let n = 0;
      for (let k = f; k < f + days; k++) if (!taken(dayKey(slotAt(k)))) n++;
      return n;
    },

    /** Day of the first free slot (YYYY-MM-DD) or null — the video's folder is named after it. */
    nextFree() {
      const f = firstOffset();
      for (let k = f; k < f + days; k++) { const day = dayKey(slotAt(k)); if (!taken(day)) return day; }
      return null;
    },

    /** Finished video → first free day. null — the 14-day window is full. */
    add(entry) {
      if (db.slots.some((s) => s.id === entry.id && s.status !== 'skipped')) return db.slots.find((s) => s.id === entry.id);
      const f = firstOffset();
      for (let k = f; k < f + days; k++) {
        const at = slotAt(k);
        const day = dayKey(at);
        if (taken(day)) continue;
        const slot = { pick: null, needsReview: null, why: '', ...entry, day, at, status: 'ready', addedAt: now() };
        db.slots = db.slots.filter((s) => s.id !== entry.id);
        db.slots.push(slot);
        db.slots.sort((a, b) => a.at - b.at);
        save();
        return { ...slot };
      }
      return null;
    },

    /** What is ahead (from today on), without cancelled items. */
    upcoming: () => live().filter((s) => s.day >= today()).map((s) => ({ ...s })),
    /** Time to publish: ready and the day has come (or passed). */
    due: () => live().filter((s) => s.status === 'ready' && s.day <= today()).map((s) => ({ ...s })),
    ready: () => live().filter((s) => s.status === 'ready').map((s) => ({ ...s })),

    /** History for the variety gate: [{kind, at}] oldest → newest. */
    history: () => live().map((s) => ({ kind: s.kind, at: s.at, id: s.id })),

    pickTitle(id, pick) {
      const s = db.slots.find((x) => x.id === id);
      if (!s || !['A', 'B'].includes(pick)) return null;
      s.pick = pick; save(); return { ...s };
    },
    markPublished(id) { const s = db.slots.find((x) => x.id === id); if (!s) return null; s.status = 'published'; s.publishedAt = now(); save(); return { ...s }; },
    /** Video re-edited (a moment removed) — update the note and the length. */
    update(id, patch) {
      const s = db.slots.find((x) => x.id === id); if (!s) return null;
      for (const k of ['why', 'total']) if (k in patch) s[k] = patch[k];
      save(); return { ...s };
    },
    /** "Do not publish": the day is freed. */
    skip(id) { const s = db.slots.find((x) => x.id === id); if (!s) return null; s.status = 'skipped'; save(); return { ...s }; },
    DAY,
  };
}
