// Календарь выкладки: один ролик в день в 18:00, очередь на 14 дней вперёд.
// Календарь ничего не выкладывает: слот — это готовый пакет (mp4 + обложка + тексты), выкладывает человек кнопкой этапа 1.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY = 24 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
/** Дата по местному времени: «2026-11-15». */
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export function createCalendar({ path = null, now = Date.now, hour = 18, days = 14 } = {}) {
  let db = { slots: [] };
  if (path && existsSync(path)) {
    try { db = { slots: [], ...JSON.parse(readFileSync(path, 'utf8')) }; }
    catch { try { copyFileSync(path, `${path}.bak`); } catch { /* нечего сохранить */ } }
  }
  const save = () => {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(db, null, 2), 'utf8');
    renameSync(`${path}.tmp`, path);
  };
  /** Время выкладки через `offset` дней от сегодня (местные 18:00). */
  const slotAt = (offset) => { const d = new Date(now()); d.setHours(hour, 0, 0, 0); d.setDate(d.getDate() + offset); return d.getTime(); };
  const firstOffset = () => (now() >= slotAt(0) ? 1 : 0); // сегодняшние 18:00 прошли — ближайший слот завтра
  const live = () => db.slots.filter((s) => s.status !== 'skipped');
  const taken = (day) => live().some((s) => s.day === day);
  const today = () => dayKey(now());

  return {
    path, hour, days,
    all: () => db.slots.map((s) => ({ ...s })),
    get: (id) => db.slots.find((s) => s.id === id) ?? null,

    /** Свободных дней в окне на 14 дней вперёд. */
    free() {
      const f = firstOffset();
      let n = 0;
      for (let k = f; k < f + days; k++) if (!taken(dayKey(slotAt(k)))) n++;
      return n;
    },

    /** День первого свободного слота (ГГГГ-ММ-ДД) или null — по нему называется папка ролика. */
    nextFree() {
      const f = firstOffset();
      for (let k = f; k < f + days; k++) { const day = dayKey(slotAt(k)); if (!taken(day)) return day; }
      return null;
    },

    /** Готовый ролик → первый свободный день. null — окно на 14 дней занято. */
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

    /** Что впереди (с сегодняшнего дня), без отменённых. */
    upcoming: () => live().filter((s) => s.day >= today()).map((s) => ({ ...s })),
    /** Пора выкладывать: готово и день наступил (или прошёл). */
    due: () => live().filter((s) => s.status === 'ready' && s.day <= today()).map((s) => ({ ...s })),
    ready: () => live().filter((s) => s.status === 'ready').map((s) => ({ ...s })),

    /** История для ворот разнообразия: [{kind, at}] старые → новые. */
    history: () => live().map((s) => ({ kind: s.kind, at: s.at, id: s.id })),

    pickTitle(id, pick) {
      const s = db.slots.find((x) => x.id === id);
      if (!s || !['A', 'B'].includes(pick)) return null;
      s.pick = pick; save(); return { ...s };
    },
    markPublished(id) { const s = db.slots.find((x) => x.id === id); if (!s) return null; s.status = 'published'; s.publishedAt = now(); save(); return { ...s }; },
    /** Ролик перемонтирован (убран момент) — обновить пояснение и длину. */
    update(id, patch) {
      const s = db.slots.find((x) => x.id === id); if (!s) return null;
      for (const k of ['why', 'total']) if (k in patch) s[k] = patch[k];
      save(); return { ...s };
    },
    /** «Не выкладывать»: день освобождается. */
    skip(id) { const s = db.slots.find((x) => x.id === id); if (!s) return null; s.status = 'skipped'; save(); return { ...s }; },
    DAY,
  };
}
