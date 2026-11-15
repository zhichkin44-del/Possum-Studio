// Библиотека всех клипов: library.json (атомарно, с .bak), планы, метки, звёзды, где использован.
// Полные пути пользователя в library.json не пишем: внутри baseDir — относительный путь, снаружи — только имя,
// а настоящий путь лежит в соседнем library.paths.local.json (он никогда не уходит в общую папку).
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, fstatSync, existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve, basename, isAbsolute, join } from 'node:path';
import { summarizeClip, markDuplicates, shotPrint } from './shots.js';
import { markPrivate } from './privacy.js';

/** id клипа: размер + первый 1 МБ + последние 64 КБ. Копия того же файла под другим именем — тот же id. */
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

// слово запроса → какие метки подходят (метки из сигналов и из разбора Haiku)
const SYN = {
  'прыжок': ['движение', 'прыжок'], 'прыгает': ['движение', 'прыжок'], 'бегает': ['движение'], 'движение': ['движение', 'прыжок', 'играет', 'лазает'],
  'играет': ['играет', 'движение'], 'лазает': ['лазает', 'движение'],
  'ночь': ['тёмное', 'ИК'], 'ночное': ['тёмное', 'ИК'], 'темно': ['тёмное', 'ИК'], 'тёмное': ['тёмное', 'ИК'], 'ик': ['ИК'],
  'писк': ['писк'], 'пищит': ['писк'], 'звук': ['писк', 'asmr?'],
  'ест': ['ест', 'asmr?'], 'кушает': ['ест', 'asmr?'], 'хрустит': ['ест', 'asmr?'], 'asmr': ['asmr?', 'ест'], 'асмр': ['asmr?', 'ест'],
  'спит': ['спит', 'спокойно'], 'спокойно': ['спокойно', 'спит'], 'умывается': ['умывается'], 'прячется': ['прячется'],
  'камера': ['смотрит в камеру'], 'смотрит': ['смотрит в камеру'],
};
export const BLOCK = ['падение', 'стресс']; // такие планы в сюжеты не идут никогда
// почему кусок не подошёл — простыми словами (первое совпадение)
const SPARE_WHY = [['чёрный', 'темно'], ['слишком темно', 'темно'], ['дубль', 'одинаковые видео'], ['размыто', 'размыто'], ['пересвет', 'пересвет'], ['коротко', 'слишком короткий кусок'], ['нет зверька', 'зверька не видно'], ['стресс', 'зверёк мог испугаться'], ['падение', 'зверёк мог испугаться'], ['люди', 'в кадре человек'], ['сигарета', 'в кадре сигарета'], ['рука', 'в кадре рука']];

/**
 * Запас моментов вашего зверька: сколько годных, сколько из них уже в роликах за неделю
 * и почему остальные отложены (темно, копия…). Чужие и неотмеченные видео не считаются.
 */
/** Метка плана, где не ваш зверёк (чужой зверь). */
export const NOT_PET = 'не ваш зверёк';

/**
 * Видео подтверждено как «ваш зверёк»: лучший момент плана, где лежит окно мордочки (самое непохожее
 * на остальной ролик место), ставится на это окно — сборка режет кусок вокруг него, а не держание в ладони.
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
 * Зверька держат в руках весь ролик (круг 19, IMG_0129): вне окна мордочки он зажат в кулаке и виден
 * только хвост. Годен лишь кусок, где лежит окно мордочки; остальные — в запас «зверька не видно».
 * Окна нет — решать нечем, куски не трогаем.
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
/** Вид зверька не подтверждён: модель не уверена, или без Claude и без модели никто не смотрел, а человек ещё не отметил. */
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
        if (f === p) writeFileSync(`${p}.broken-${now()}`, raw); // испорченный файл не теряем
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
    side[id] = abs; // наружный файл: путь только локально
    return null;
  }
  const realPath = (clip) => (clip.rel ? join(baseDir, clip.rel) : side[clip.id] ?? null);

  /** Отпечатки хороших планов — чтобы новый клип не набрал дублей уже взятого. */
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

    /** Новый файл + его сигналы → клип в библиотеке. Тот же файл второй раз не добавляется. */
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

    /** Разбор Haiku (или эмуляция) по планам: метки дописываются к планам, «падение/стресс» — блок. */
    /** Фильтр приватности: моменты с лицом или сигаретой вырезаются из планов, план без чистого куска — в запас. */
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
     * Решено, его ли это зверёк: by — кто решил ('owner' — человек, 'clip' — локальная модель по эталону).
     * «Не он» — все планы клипа в сторону навсегда.
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
    /** Модель не уверена, ваш ли это зверёк: клип ждёт отметки человека и в сюжеты не идёт. */
    markUnsure(id) {
      const c = db.clips[id]; if (!c) return null;
      c.pet = null; c.petBy = 'clip'; c.petUnsure = true;
      flush();
      return c;
    },
    /** Клипы, где вид зверька не подтверждён и человек ещё не отметил. Такие в сюжеты не идут. */
    pending() { return Object.values(db.clips).filter(unmarked); },

    /** Человек на экране ролика нажал «Убрать момент»: на плане зверька не видно — в сюжеты больше не идёт. */
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
    /** Когда план брали последний раз (мс) или null. */
    lastUsed(id, shot) {
      const u = db.clips[id]?.used.filter((x) => x.shot === shot) ?? [];
      return u.length ? Math.max(...u.map((x) => x.at)) : null;
    },
    /** План свободен для сюжета: не брак, не блок, не брали последние `days` дней. */
    isFree(id, shot, days = 7) {
      const s = db.clips[id]?.shots[shot];
      if (!s || s.defects.length || unmarked(db.clips[id])) return false;
      const last = this.lastUsed(id, shot);
      return last === null || now() - last >= days * DAY;
    },

    /**
     * Поиск планов: «прыжок ночь» — план должен подходить под каждое слово.
     * opts: spare — показывать и брак «в запасе»; minStars; free — только свободные (7 дней).
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

    /** Запас моментов вашего зверька — см. countSupply. */
    supply() { return countSupply(Object.values(db.clips), (id, i) => this.isFree(id, i)); },

    stats() {
      const clips = Object.values(db.clips);
      const shots = clips.flatMap((c) => c.shots);
      return { clips: clips.length, shots: shots.length, good: shots.filter((s) => !s.defects.length).length, spare: shots.filter((s) => s.defects.length).length, night: clips.filter((c) => c.night).length };
    },
  };
}
