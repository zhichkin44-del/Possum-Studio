// Library of all clips: library.json (atomic, with .bak), plans, labels, stars, where each one was used.
// We do not write the user's full paths into library.json: inside baseDir it is a relative path, outside only the name,
// and the real path lives in the neighbouring library.paths.local.json (it never leaves the local machine).
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, fstatSync, existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve, basename, isAbsolute, join } from 'node:path';
import { summarizeClip, markDuplicates, shotPrint } from './shots.js';
import { markPrivate } from './privacy.js';

/** Clip id: size + first 1 MB + last 64 KB. A copy of the same file under another name has the same id. */
export function fileId(file) {
  const fd = openSync(file, 'r');
  try {
    const { size } = fstatSync(fd);
    const h = createHash('sha1').update(String(size));
    const head = Buffer.alloc(Math.min(size, 1 << 20));
    readSync(fd, head, 0, head.length, 0); h.update(head);
    if (size > head.length) {
      const tail = Buffer.alloc(Math.min(size - head.length, 1 << 16));
      readSync(fd, tail, 0, tail.length, size - tail.length); h.update(tail);
    }
    return h.digest('hex').slice(0, 16);
  } finally { closeSync(fd); }
}

// request word → which labels fit (labels from the signals and from the Haiku analysis)
const SYN = {
  'прыжок': ['движение', 'прыжок'], 'прыгает': ['движение', 'прыжок'], 'бегает': ['движение'], 'движение': ['движение', 'прыжок', 'играет', 'лазает'],
  'играет': ['играет', 'движение'], 'лазает': ['лазает', 'движение'],
  'ночь': ['тёмное', 'ИК'], 'ночное': ['тёмное', 'ИК'], 'темно': ['тёмное', 'ИК'], 'тёмное': ['тёмное', 'ИК'], 'ик': ['ИК'],
  'писк': ['писк'], 'пищит': ['писк'], 'звук': ['писк', 'asmr?'],
  'ест': ['ест', 'asmr?'], 'кушает': ['ест', 'asmr?'], 'хрустит': ['ест', 'asmr?'], 'asmr': ['asmr?', 'ест'], 'асмр': ['asmr?', 'ест'],
  'спит': ['спит', 'спокойно'], 'спокойно': ['спокойно', 'спит'], 'умывается': ['умывается'], 'прячется': ['прячется'],
  'камера': ['смотрит в камеру'], 'смотрит': ['смотрит в камеру'],
};
export const BLOCK = ['падение', 'стресс']; // such plans never go into stories
// why a piece did not fit — in plain words (first match)
const SPARE_WHY = [['чёрный', 'темно'], ['слишком темно', 'темно'], ['дубль', 'одинаковые видео'], ['размыто', 'размыто'], ['пересвет', 'пересвет'], ['коротко', 'слишком короткий кусок'], ['нет зверька', 'зверька не видно'], ['стресс', 'зверёк мог испугаться'], ['падение', 'зверёк мог испугаться'], ['люди', 'в кадре человек'], ['сигарета', 'в кадре сигарета'], ['рука', 'в кадре рука']];

/**
 * Stock of moments of your pet: how many are usable, how many of them are already in videos this week
 * and why the others are set aside (dark, copy…). Other people's and unmarked videos do not count.
 */
/** Label of a plan where the pet is not yours (another animal). */
export const NOT_PET = 'не ваш зверёк';

/**
 * The video is confirmed as "your pet": the best moment of the plan where the face window lies (the most unlike
 * the rest of the video place), is set to this window — assembly cuts the piece around it, not holding it in the palm.
 */
function faceMoment(c) {
  const m = c.privacy?.moment;
  if (!m || typeof m.t !== 'number') return;
  const s = (c.shots ?? []).find((x) => !(x.defects ?? []).length && m.t >= x.from && m.t <= x.from + x.len);
  if (!s) return;
  s.best = { ...(s.best ?? {}), t: m.t, kind: 'мордочка' };
  s.peaks = s.peaks ?? [];
  if (!s.peaks.some((p) => p.kind === 'мордочка' && p.t === m.t)) s.peaks.push({ t: m.t, kind: 'мордочка', score: s.best.score ?? 1 });
}
/**
 * The pet is held in hands the whole video (round 19, IMG_0129): outside the face window it is held in a fist and visible
 * only by its tail. Only a piece where the face window lies is usable; the others go to the reserve "pet not visible".
 * No window — nothing to decide by, the pieces are left alone.
 */
function heldOnlyFace(c) {
  const m = c.privacy?.moment;
  if (!c.privacy?.held?.held || !m || typeof m.t !== 'number') return;
  for (const s of c.shots ?? []) {
    if (m.t >= s.from && m.t <= s.from + s.len) continue;
    if (!s.defects.includes('нет зверька')) s.defects.push('нет зверька');
    s.score = 0; s.why = 'зверёк в руках — берём только кусок с мордочкой';
  }
}
/** The pet's species is not confirmed: the model is not sure, or without Claude and without a model nobody looked, and the person has not marked it yet. */
export const unmarkedClip = (c) => c?.pet == null && (Boolean(c?.petUnsure) || (Boolean(c?.vision?.by) && c.vision.by !== 'claude'));

export function countSupply(clips, isFree) {
  const out = { good: 0, busy: 0, spare: {} };
  for (const c of clips) {
    if (c.pet === false || c.vision?.notPet || unmarkedClip(c)) continue;
    c.shots.forEach((s, i) => {
      if (!s.defects.length) { out.good++; if (!isFree(c.id, i)) out.busy++; return; }
      if (s.defects.includes(NOT_PET)) return;
      const why = SPARE_WHY.find(([d]) => s.defects.includes(d))?.[1] ?? 'брак';
      out.spare[why] = (out.spare[why] ?? 0) + 1;
    });
  }
  return out;
}

const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').trim();
const DAY = 24 * 3600 * 1000;

export function createLibrary({ path, baseDir, now = () => Date.now() }) {
  const sidePath = path.replace(/\.json$/i, '') + '.paths.local.json';
  let db = load(path, { version: 1, clips: {} });
  let side = load(sidePath, {});
  db.clips ??= {};

  function load(p, empty) {
    for (const f of [p, `${p}.bak`]) {
      if (!existsSync(f)) continue;
      const raw = readFileSync(f, 'utf8');
      try { return JSON.parse(raw); } catch {
        if (f === p) writeFileSync(`${p}.broken-${now()}`, raw); // do not lose a corrupted file
      }
    }
    return structuredClone(empty);
  }
  function save(p, data) {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    if (existsSync(p)) copyFileSync(p, `${p}.bak`);
    renameSync(tmp, p);
  }
  const flush = () => { save(path, db); save(sidePath, side); };

  function storePath(id, file) {
    const abs = resolve(file);
    if (baseDir) {
      const rel = relative(resolve(baseDir), abs);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) { delete side[id]; return rel.split('\\').join('/'); }
    }
    side[id] = abs; // external file: the path stays local only
    return null;
  }
  const realPath = (clip) => (clip.rel ? join(baseDir, clip.rel) : side[clip.id] ?? null);

  /** Fingerprints of good plans — so that a new clip does not duplicate what has already been taken. */
  function takenPrints(exceptId) {
    const out = [];
    for (const c of Object.values(db.clips)) {
      if (c.id === exceptId) continue;
      for (const s of c.shots) if (!s.defects.length) out.push(shotPrint(s, c.duration));
    }
    return out;
  }

  const unmarked = unmarkedClip;

  return {
    path, sidePath, fileId,
    has: (id) => Boolean(db.clips[id]),
    get: (id) => db.clips[id] ?? null,
    all: () => Object.values(db.clips),
    realPath,

    /** New file + its signals → a clip in the library. The same file is not added a second time. */
    ingest(file, sig, extra = {}) {
      const id = extra.id ?? fileId(file);
      const old = db.clips[id];
      if (old && !extra.force) { storePath(id, file); flush(); return { clip: old, added: false }; }
      const sum = summarizeClip(sig);
      markDuplicates(sum.shots, takenPrints(id), undefined, sig.info?.duration ?? sum.duration);
      const info = sig.info ?? {};
      const w = info.width ?? 0, h = info.height ?? 0;
      const clip = {
        id, name: basename(file), rel: storePath(id, file),
        duration: info.duration ?? sum.duration, step: sum.step,
        orient: h > w ? 'vertical' : w > h ? 'horizontal' : 'square',
        hasAudio: info.hasAudio !== false, created: info.created ?? null,
        night: sum.shots.length > 0 && sum.shots.filter((s) => s.labels.includes('тёмное') || s.labels.includes('ИК')).length * 2 >= sum.shots.length,
        shots: sum.shots, labels: sum.labels, best: sum.best, spare: sum.spare,
        stars: old?.stars ?? 0, used: old?.used ?? [], vision: old?.vision ?? null,
        addedAt: old?.addedAt ?? now(),
      };
      db.clips[id] = clip;
      flush();
      return { clip, added: !old };
    },

    /** Haiku analysis (or its emulation) per plan: labels are appended to the plans; the "fall" and "stress" labels — blocked. */
    /** Privacy filter: moments with a face or a cigarette are cut out of the plans; a plan without a clean piece goes to the reserve. */
    setPrivacy(id, hits, opts = {}) {
      const c = db.clips[id]; if (!c) return null;
      const r = markPrivate(c.shots, hits, { step: 1, ...opts });
      c.privacy = { checked: true, ...r, moment: hits?.moment ?? null, hidden: hits?.hidden ?? null, held: hits?.held ?? null };
      heldOnlyFace(c);
      if (hits?.hidden?.hidden) for (const s of c.shots) if (!s.defects.includes('нет зверька')) { s.defects.push('нет зверька'); s.score = 0; s.why = 'зверька на кадре не видно — в сюжеты не берём'; }
      if (c.pet === true) faceMoment(c);
      flush();
      return r;
    },

    setVision(id, vision) {
      const c = db.clips[id]; if (!c) return null;
      c.vision = { by: vision.by ?? 'claude', notPet: Boolean(vision.notPet), mood: vision.mood ?? null, asmr: Boolean(vision.asmr), cost: vision.cost ?? 0 };
      for (const f of vision.frames ?? []) {
        const s = c.shots[f.shot]; if (!s) continue;
        s.labels = [...new Set([...s.labels, ...(f.labels ?? [])])];
        if (f.labels?.some((l) => BLOCK.includes(l)) && !s.defects.includes('стресс')) { s.defects.push('стресс'); s.score = 0; s.why = 'в запас: зверёк мог испугаться — в сюжеты не берём'; }
        if (f.labels?.includes('нет зверька') && !s.defects.includes('нет зверька')) { s.defects.push('нет зверька'); s.score = 0; s.why = 'зверька на кадре не видно — в сюжеты не берём'; }
      }
      if (vision.notPet) for (const s of c.shots) if (!s.defects.includes(NOT_PET)) { s.defects.push(NOT_PET); s.score = 0; s.why = 'на кадрах не ваш зверёк — в сюжеты не берём'; }
      if (vision.asmr) for (const s of c.shots) if (s.labels.includes('спокойно') && !s.labels.includes('asmr?')) s.labels.push('asmr?');
      c.labels = [...new Set(c.shots.flatMap((s) => s.labels))];
      flush();
      return c;
    },

    /**
     * Decided whether it is his pet: by — who decided ('owner' — a person, 'clip' — the local model by the reference).
     * "Not him" — all plans of the clip are set aside forever.
     */
    setPet(id, yes, { by = 'owner', why = null } = {}) {
      const c = db.clips[id]; if (!c) return null;
      c.pet = Boolean(yes); c.petBy = by; c.petWhy = why; c.petUnsure = false;
      if (c.pet) faceMoment(c);
      const text = why ?? (by === 'owner' ? 'отмечено: на видео не ваш зверёк' : 'на видео не ваш зверёк');
      if (!c.pet) for (const s of c.shots) if (!s.defects.includes(NOT_PET)) { s.defects.push(NOT_PET); s.score = 0; s.why = `${text} — в сюжеты не берём`; }
      flush();
      return c;
    },
    /** The model is not sure whether this is your pet: the clip waits for the person's mark and does not go into stories. */
    markUnsure(id) {
      const c = db.clips[id]; if (!c) return null;
      c.pet = null; c.petBy = 'clip'; c.petUnsure = true;
      flush();
      return c;
    },
    /** Clips where the species is not confirmed and the person has not marked it yet. Such clips do not go into stories. */
    pending() { return Object.values(db.clips).filter(unmarked); },

    /** The person pressed "Remove moment" on the video screen: the pet is not visible in the plan — it no longer goes into stories. */
    markNoPet(id, shot) {
      const s = db.clips[id]?.shots[shot]; if (!s) return null;
      if (!s.defects.includes('нет зверька')) s.defects.push('нет зверька');
      s.score = 0; s.why = 'убран вручную: зверька на кадре не видно — в сюжеты не берём';
      flush();
      return s;
    },

    setStars(id, n) { const c = db.clips[id]; if (!c) return null; c.stars = Math.max(0, Math.min(5, Math.round(n))); flush(); return c; },

    markUsed(id, shot, story, at = now()) {
      const c = db.clips[id]; if (!c) return;
      c.used.push({ shot, story, at }); flush();
    },
    /** When the plan was last taken (ms) or null. */
    lastUsed(id, shot) {
      const u = db.clips[id]?.used.filter((x) => x.shot === shot) ?? [];
      return u.length ? Math.max(...u.map((x) => x.at)) : null;
    },
    /** A plan is free for a story: not defective, not blocked, not taken in the last `days` days. */
    isFree(id, shot, days = 7) {
      const s = db.clips[id]?.shots[shot];
      if (!s || s.defects.length || unmarked(db.clips[id])) return false;
      const last = this.lastUsed(id, shot);
      return last === null || now() - last >= days * DAY;
    },

    /**
     * Plan search: "jump night" — a plan must match every word.
     * opts: spare — show defects "in reserve" too; minStars; free — only free ones (7 days).
     */
    search(query = '', { spare = false, minStars = 0, free = false } = {}) {
      const words = norm(query).split(/\s+/).filter(Boolean);
      const out = [];
      for (const c of Object.values(db.clips)) {
        if (c.stars < minStars) continue;
        c.shots.forEach((s, i) => {
          if (!spare && s.defects.length) return;
          if (free && !this.isFree(c.id, i)) return;
          const labels = s.labels.map(norm);
          const ok = words.every((w) => (SYN[w] ?? [w]).some((l) => labels.includes(norm(l))));
          if (ok) out.push({ clip: c.id, shot: i, score: s.score + c.stars * 0.05, why: s.why, labels: s.labels, from: s.from, len: s.len });
        });
      }
      return out.sort((a, b) => b.score - a.score);
    },

    /** Stock of moments of your pet — see countSupply. */
    supply() { return countSupply(Object.values(db.clips), (id, i) => this.isFree(id, i)); },

    stats() {
      const clips = Object.values(db.clips);
      const shots = clips.flatMap((c) => c.shots);
      return { clips: clips.length, shots: shots.length, good: shots.filter((s) => !s.defects.length).length, spare: shots.filter((s) => s.defects.length).length, night: clips.filter((c) => c.night).length };
    },
  };
}
