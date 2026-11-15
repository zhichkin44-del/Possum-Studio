// Генератор сюжетов из планов всей библиотеки: топ-5, день из жизни, до/после, спокойные моменты, ASMR, серии.
// «Фейлы» не собираются: резкий прыжок может значить испуг, такие куски только с пометкой «посмотрите».
// Ворота разнообразия: вид сюжета подряд не повторяется, за 7 дней ≥ 3 разных вида, план — не чаще раза в 7 дней,
// в одной пачке план не повторяется; исходное видео — не в соседних роликах и не больше 2 роликов за 7 дней, если есть другие. Только свободные хорошие планы (брак и «стресс» — никогда).
import { createHash } from 'node:crypto';
import { SHOT } from './shots.js';

const DAY = 24 * 3600 * 1000;
const r2 = (x) => Math.round(x * 100) / 100;
export const KINDS = ['top5', 'day', 'beforeAfter', 'calm', 'asmr', 'series'];
const PRIORITY = { top5: 0, day: 1, series: 2, asmr: 3, beforeAfter: 4, calm: 5, fails: 6 };

/** Заголовки по видам: повтор вида берёт следующий вариант, чтобы ролики не назывались одинаково. */
export const TITLE_VARIANTS = {
  top5: [
    { ru: 'Топ-5 моментов нашего зверька', en: 'Top 5 moments of our little animal' },
    { ru: 'Лучшие моменты: топ-5', en: 'Best moments: top 5' },
    { ru: 'Пять моментов из жизни зверька', en: '5 moments from a little animal life' },
  ],
  day: [
    { ru: 'День из жизни нашего зверька', en: 'A day in the life of our little animal' },
    { ru: 'Как живёт ночной зверёк', en: 'How a night animal lives' },
    { ru: 'Сутки маленького зверька', en: "A little animal's 24 hours" },
  ],
  beforeAfter: [
    { ru: 'Сначала тихо, потом за дело', en: 'Quiet first, then busy' },
    { ru: 'Спокойно… а потом движение', en: 'Calm… and then action' },
    { ru: 'Тишина… и вдруг зверёк', en: 'Silence… and then a little animal' },
  ],
  calm: [
    { ru: 'Спокойные моменты зверька', en: 'Calm little animal moments' },
    { ru: 'Тихие моменты: зверёк по своим делам', en: 'Quiet moments: a little animal doing its thing' },
    { ru: 'Минутка спокойствия', en: 'A minute of calm' },
  ],
  fails: [
    { ru: 'Зверёк и его фейлы', en: 'Little animal fails' },
    { ru: 'Не всё получается с первого раза', en: 'Not everything works the first time' },
    { ru: 'Неуклюжие моменты зверька', en: 'Clumsy little animal moments' },
  ],
  asmr: [
    { ru: 'ASMR: зверёк ест', en: 'Little animal eating ASMR' },
    { ru: 'ASMR: тихий ужин зверька', en: "ASMR: a little animal's quiet dinner" },
    { ru: 'ASMR: только звук', en: 'ASMR: just the sound' },
  ],
};
export const TITLES = Object.fromEntries(Object.entries(TITLE_VARIANTS).map(([k, v]) => [k, v[0]]));
const THEME = { 'ест': ['ест', 'eats'], 'играет': ['играет', 'plays'], 'лазает': ['лазает', 'climbs'], 'умывается': ['умывается', 'grooming'], 'движение': ['в движении', 'on the move'], 'спит': ['спит', 'sleeps'] };
// писк не тема серии: по звуку не понять, кто пищит, а писк может значить испуг — его не делают «рубрикой»
const PARTS = ['Утро', 'День', 'Вечер', 'Ночь'];
const PARTS_EN = { 'Утро': 'Morning', 'День': 'Day', 'Вечер': 'Evening', 'Ночь': 'Night' };

/** Нижняя граница длины серии, секунды: короче 15 с ролик в ленте не досматривают. */
export const SERIES_MIN = 15;

const key = (p) => `${p.clip}:${p.shot}`;

/** Кусок плана длиной до `len` вокруг лучшего момента. */
export function pieceAround(clip, shotIdx, len, caption = null) {
  const s = clip.shots[shotIdx];
  const L = Math.min(len, s.len);
  const t = s.best?.t ?? s.from + s.len / 2;
  // мордочка — с неё и начинаем: до неё в кадре обычно рука, которая подносит зверька
  const lead = s.best?.kind === 'мордочка' ? 0 : L * 0.3;
  const from = Math.min(s.from + s.len - L, Math.max(s.from, t - lead));
  return { clip: clip.id, shot: shotIdx, from: r2(from), len: r2(L), peak: r2(Math.min(L, Math.max(0, t - from))), caption, why: s.why };
}

/**
 * Все свободные хорошие планы библиотеки, без уже взятых в этой пачке.
 * tired — исходные видео, которые сейчас лучше не брать (были в прошлом ролике или уже в 2 роликах за неделю).
 */
function freeShots(lib, taken, tired = null, focus = null) {
  const out = [];
  for (const c of lib.all()) {
    if (tired?.has(c.id) && !focus?.has(c.id)) continue;
    // focus — видео, которые человек только что отметил «Это мой зверёк»: их планы идут первыми
    const lift = focus?.has(c.id) ? 10 : 0;
    c.shots.forEach((s, i) => {
      if (taken.has(`${c.id}:${i}`) || !lib.isFree(c.id, i)) return;
      out.push({ c, s, i, score: s.score + (c.stars ?? 0) * 0.05 + lift });
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Исходные видео, которые «устали»: были в предыдущем ролике (соседний день) или уже в 2 роликах за 7 дней.
 * Считает и библиотеку (used), и ролики этой пачки (batch — [[clipId…]…], старые → новые).
 */
export function tiredClips(lib, { history = [], batch = [], now = Date.now(), perWeek = 2 } = {}) {
  const lastId = history.at(-1)?.id ?? null;
  const tired = new Set(batch.at(-1) ?? []);
  for (const c of lib.all()) {
    const stories = new Set((c.used ?? []).filter((u) => now - u.at < 7 * DAY).map((u) => u.story));
    const uses = stories.size + batch.filter((b) => b.includes(c.id)).length;
    if (uses >= perWeek) tired.add(c.id);
    if (!batch.length && lastId && stories.has(lastId)) tired.add(c.id);
  }
  return tired;
}
const has = (x, ...labels) => labels.some((l) => x.s.labels.includes(l));
/** Живость плана для первой секунды: движение плюс самый сильный пик движения. */
const live = (x) => (x.s.motion ?? 0) + Math.max(0, ...(x.s.peaks ?? []).filter((p) => p.kind === 'move').map((p) => p.score ?? 0));
/** Смазанный прыжок с писком: зрители видят в нём падение или испуг — такие куски в конец очереди. */
const blurry = (x) => (x.s.sharp ?? 1) < 0.4 && has(x, 'прыжок', 'писк');
const blurLast = (xs) => [...xs.filter((x) => !blurry(x)), ...xs.filter(blurry)];
/** Крючок первой секунды: живое и резкое движение (смазанное с пальцем у объектива — не крючок). */
const hook = (x) => live(x) * (x.s.sharp ?? 0.5);
function* perms(xs) {
  if (xs.length <= 1) { yield xs; return; }
  for (let i = 0; i < xs.length; i++) for (const p of perms([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...p];
}
const glued = (xs) => xs.some((x, k) => k > 0 && xs[k - 1].c.id === x.c.id);
/**
 * Переставить так, чтобы куски одного видео не шли подряд («один исходник два раза подряд» зрители замечают сразу).
 * Первый (крючок) и последний (лучший) остаются на местах, если можно; середина — ближе к исходному порядку.
 */
function unglue(xs) {
  if (!glued(xs) || xs.length < 3) return xs;
  for (const mid of perms(xs.slice(1, -1))) { const v = [xs[0], ...mid, xs.at(-1)]; if (!glued(v)) return v; }
  for (const tail of perms(xs.slice(1))) { const v = [xs[0], ...tail]; if (!glued(v)) return v; }
  return xs;
}

/** Видео каждого прошлого ролика вида kind: ролики этой пачки и недельной истории (по c.used). [Set(clipId)…] */
function sameKindClips(lib, kind, { history = [], out = [], now = Date.now() } = {}) {
  const sets = out.filter((s) => s.kind === kind).map((s) => new Set(s.pieces.map((p) => p.clip)));
  const ids = new Set(history.filter((h) => h.kind === kind && h.id && now - h.at < 7 * DAY).map((h) => h.id));
  if (ids.size) {
    const by = {};
    for (const c of lib.all()) for (const u of c.used ?? []) if (ids.has(u.story)) (by[u.story] ??= new Set()).add(c.id);
    sets.push(...Object.values(by));
  }
  return sets;
}
const backOf = (pool, sets) => {
  const old = new Set(sets.flatMap((s) => [...s]));
  return old.size ? [...pool.filter((x) => !old.has(x.c.id)), ...pool.filter((x) => old.has(x.c.id)).map((x) => ({ ...x, old: true }))] : pool;
};
const repeats = (b, sets) => {
  const mine = new Set(b.pieces.map((p) => p.clip));
  return sets.some((s) => [...mine].filter((id) => s.has(id)).length >= 2);
};

/** Часть суток плана — только по настоящему времени съёмки. Без даты (сток, пересланное) — null: не угадываем. */
export function partOfDay(c) {
  if (c.created) {
    const h = new Date(c.created).getHours();
    if (h >= 5 && h < 11) return 'Утро';
    if (h >= 11 && h < 17) return 'День';
    if (h >= 17 && h < 22) return 'Вечер';
    return 'Ночь';
  }
  return null;
}

const BUILD = {
  top5(pool) {
    // не больше двух моментов с одного клипа, если хватает других
    // топ-5 — про живые моменты: сначала подвижные планы, спокойные — только если не хватает (они нужны «спокойным моментам»)
    const all = pool.filter((x) => x.s.len >= 1.5);
    const calmOnly = (x) => has(x, 'спокойно', 'спит', 'умывается') && !has(x, 'движение');
    // смазанные прыжки с писком — в самый конец: зрители видят в них падение
    const ok = blurLast([...all.filter((x) => !calmOnly(x)), ...all.filter(calmOnly)]);
    // сначала по одному куску с видео, потом по два, потом любые; видео прошлого топ-5 (old) — только когда новых не хватает
    const per = {}; const pick = [];
    for (const [cap, fresh] of [[1, true], [2, true], [2, false], [Infinity, false]]) {
      for (const x of ok) if (pick.length < 5 && !pick.includes(x) && !(fresh && x.old) && (per[x.c.id] ?? 0) < cap) { pick.push(x); per[x.c.id] = (per[x.c.id] ?? 0) + 1; }
    }
    pick.sort((a, b) => ok.indexOf(a) - ok.indexOf(b));
    if (pick.length < 5) return null;
    let show = pick.reverse();
    // первый показ (№5) — дневной кусок, если он есть среди №4…№2: ролик не открывается серым ИК-куском; №1 (лучший) не трогаем
    const ir = (x) => has(x, 'ИК') || Boolean(x.c.night);
    // крючок: первая секунда — самое живое движение среди №5…№2 (дневной кусок важнее ИК)
    const head = show.slice(0, 4);
    // крючок — живое и резкое (смазанное с пальцем у объектива не цепляет), не смазанный прыжок
    const day = head.some((x) => !ir(x)) ? head.filter((x) => !ir(x)) : head;
    const cand = day.some((x) => !blurry(x)) ? day.filter((x) => !blurry(x)) : day;
    const best = cand.reduce((a, x) => (hook(x) > hook(a) ? x : a), cand[0]);
    show.unshift(...show.splice(show.indexOf(best), 1));
    show = unglue(show);
    // крючок — 2 с, остальные по 3 с; короткие планы добираются длинными (до 5 с), чтобы ролик был не короче SERIES_MIN;
    // крючок растягивается последним
    const lens = show.map((x, k) => (k === 0 ? 2 : 3));
    const room = (k) => Math.min(5, show[k].s.len) - lens[k];
    const total = () => show.reduce((t, x, k) => t + Math.min(lens[k], x.s.len), 0);
    for (const order of [[1, 2, 3, 4], [0, 1, 2, 3, 4]]) {
      for (let k = 0; total() < SERIES_MIN && k < order.length * 6; k++) { const i = order[k % order.length]; if (room(i) > 0) lens[i] += Math.min(room(i), 0.5); }
    }
    return { pieces: show.map((x, k) => pieceAround(x.c, x.i, lens[k], `№${5 - k}`)) };
  },
  day(pool) {
    const byPart = {};
    for (const x of pool) { const p = partOfDay(x.c); if (p) byPart[p] ??= x; }
    const parts = PARTS.filter((p) => byPart[p]);
    if (parts.length < 3) return null;
    return { pieces: parts.map((p) => pieceAround(byPart[p].c, byPart[p].i, 3.5, p)), parts: parts.map((p) => PARTS_EN[p]) };
  },
  beforeAfter(pool) {
    // только один клип (тот же зверёк, то же место), «потом» — позже и заметно подвижнее (в 3 раза и не меньше «активно»)
    const before = pool.filter((x) => has(x, 'спит', 'спокойно', 'прячется') && !has(x, 'движение'));
    for (const b of before) {
      const a = pool.find((x) => x.c.id === b.c.id && x.i > b.i && (x.s.motion ?? 0) >= Math.max(SHOT.active, 3 * (b.s.motion ?? 0)));
      if (!a) continue;
      const slept = has(b, 'спит');
      return {
        pieces: [pieceAround(b.c, b.i, 4, 'Сначала'), pieceAround(a.c, a.i, 4, 'Потом')],
        ...(slept ? { title: { ru: 'Спал — и вот проснулся', en: 'Asleep… and then awake' } } : {}),
      };
    }
    return null;
  },
  calm(pool) {
    // спокойные планы: зверёк отдыхает, умывается, ест; разные клипы, если есть
    const ok = pool.filter((x) => has(x, 'спокойно', 'спит', 'умывается') && !has(x, 'прыжок', 'писк') && x.s.len >= 2);
    const pick = [];
    for (const x of ok) if (pick.length < 3 && !pick.some((y) => y.c.id === x.c.id)) pick.push(x);
    for (const x of ok) if (pick.length < 3 && !pick.includes(x)) pick.push(x);
    // два спокойных плана — уже ролик (по 6 с), три — по 4 с
    if (pick.length < 2) return null;
    const L = pick.length === 2 ? 6 : 4;
    return { pieces: pick.map((x) => pieceAround(x.c, x.i, L, null)) };
  },
  fails(pool) {
    // грубо: резкий прыжок (сильный пик движения) — «возможно фейл», решает человек
    const jumps = pool.filter((x) => has(x, 'движение', 'прыжок') && x.s.peaks.some((p) => p.kind === 'move' && p.score >= 0.6)).slice(0, 3);
    if (jumps.length < 2) return null;
    return { pieces: jumps.map((x, k) => pieceAround(x.c, x.i, 3, k === 0 ? 'Ой!' : null)), needsReview: 'резкие прыжки — убедитесь, что зверёк не ударился и не испугался' };
  },
  asmr(pool) {
    // ASMR — только когда слышно, что зверёк ест (метка «ест» или так сказал разбор Claude), а не просто тихо
    const quiet = pool.filter((x) => x.c.hasAudio && has(x, 'asmr?') && !has(x, 'без звука') && (x.c.vision?.asmr || has(x, 'ест'))).slice(0, 3);
    if (!quiet.length) return null;
    const pieces = quiet.map((x) => pieceAround(x.c, x.i, 6, null));
    if (pieces.reduce((t, p) => t + p.len, 0) < 4) return null;
    return { pieces, quiet: true };
  },
  series(pool, { episode = 1 } = {}) {
    const counts = {};
    for (const x of pool) for (const l of x.s.labels) if (THEME[l]) counts[l] = (counts[l] ?? 0) + 1;
    const theme = Object.keys(counts).filter((l) => counts[l] >= 3).sort((a, b) => counts[b] - counts[a])[0];
    if (!theme) return null;
    const ok = blurLast(pool.filter((x) => x.s.labels.includes(theme)));
    // ролик не короче SERIES_MIN секунд: по 5 с на момент, а не хватает — четвёртый момент той же темы
    const fill = (from) => {
      const pick = [];
      for (const x of from) if (pick.length < 3 || (pick.length < 4 && pick.reduce((t, y) => t + Math.min(5, y.s.len), 0) < SERIES_MIN)) pick.push(x);
      return pick;
    };
    // «Эпизод N» — только когда это правда один эпизод: все куски из одного видео и по порядку съёмки
    const per = {};
    // смазанные прыжки с писком эпизодом не считаются: зрители видят в них падение
    for (const x of ok) if (!blurry(x)) (per[x.c.id] ??= []).push(x);
    const one = Object.values(per).filter((xs) => xs.length >= 3).sort((p, q) => q.length - p.length)[0];
    if (one) {
      const pick = fill(one).sort((p, q) => p.i - q.i);
      return {
        // «Эпизод N» держится весь ролик: за секунду его не успевают прочесть
        pieces: pick.map((x, k) => (k === 0 ? { ...pieceAround(x.c, x.i, 5, `Эпизод ${episode}`), hold: true } : pieceAround(x.c, x.i, 5, null))),
        theme,
        title: { ru: `Зверёк ${THEME[theme][0]} · эпизод ${episode}`, en: `Little animal ${THEME[theme][1]} · episode ${episode}` },
      };
    }
    // иначе — подборка одной темы из разных видео, без «эпизода»; первым — самый живой кусок
    const spread = [];
    for (const x of ok) if (spread.length < 3 && !spread.some((y) => y.c.id === x.c.id)) spread.push(x);
    for (const x of ok) if (!spread.includes(x)) spread.push(x);
    const pick = fill(spread);
    const clean = pick.filter((x) => !blurry(x));
    const top = (clean.length ? clean : pick).reduce((p, x) => (hook(x) > hook(p) ? x : p), (clean.length ? clean : pick)[0]);
    pick.unshift(...pick.splice(pick.indexOf(top), 1));
    return {
      pieces: pick.map((x) => pieceAround(x.c, x.i, 5, null)),
      theme,
      title: { ru: `Зверёк ${THEME[theme][0]}`, en: `Little animal ${THEME[theme][1]}` },
    };
  },
};

/** Проверка ворот для вида сюжета. null — можно, иначе причина. */
export function gateReason(kind, history, now = Date.now()) {
  const last = history.at(-1);
  if (last && last.kind === kind) return 'такой же вид был последним';
  const week = history.filter((h) => now - h.at < 7 * DAY);
  const kinds = new Set(week.map((h) => h.kind));
  // если за неделю уже 4 ролика и меньше 3 видов — новый ролик обязан быть нового вида
  if (week.length >= 4 && kinds.size < 3 && kinds.has(kind)) return 'за неделю мало разных видов';
  return null;
}

/** Порядок видов на сегодня: давно не было — раньше. */
export function kindOrder(history, now = Date.now()) {
  const week = history.filter((h) => now - h.at < 7 * DAY);
  const cnt = (k) => week.filter((h) => h.kind === k).length;
  const lastAt = (k) => Math.max(-Infinity, ...history.filter((h) => h.kind === k).map((h) => h.at));
  return [...KINDS].sort((a, b) => cnt(a) - cnt(b) || lastAt(a) - lastAt(b) || PRIORITY[a] - PRIORITY[b]);
}

/**
 * Новые сюжеты на сегодня. history — [{kind, at}] уже собранных/выложенных роликов (старые → новые).
 * Возвращает до `count` сюжетов с разными планами; в библиотеке ничего не меняет (см. commit).
 */
export function makeStories(lib, { history = [], now = Date.now(), count = 3, focus = null } = {}) {
  const taken = new Set();
  const out = [];
  const hist = [...history];
  for (let round = 0; round < count; round++) {
    let made = null;
    // сначала — без «уставших» исходных видео (были вчера или уже дважды за неделю);
    // не вышло — только без видео соседнего ролика; и лишь в крайнем случае — из всех
    const batch = out.map((s) => [...new Set(s.pieces.map((p) => p.clip))]);
    const tired = tiredClips(lib, { history, batch, now });
    const near = tiredClips(lib, { history, batch, now, perWeek: Infinity });
    // запасные ступени — только для маленькой библиотеки (1–2 видео): иначе лучше меньше роликов, чем одно видео три раза за неделю
    const small = lib.all().length < 3;
    const tiers = (small ? [tired, near, null] : [tired]).filter((t, k, a) => k === 0 || (t?.size ?? 0) < (a[k - 1]?.size ?? 0));
    for (const skip of tiers) {
      if (made) break;
      for (const kind of kindOrder(hist, now)) {
        if (gateReason(kind, hist, now)) continue;
        // повтор: видео прошлых роликов этого вида (в пачке и за неделю) — в конец очереди;
        // если ролик всё равно делит с одним из них ≥ 2 видео, этот вид сегодня не собираем
        const before = sameKindClips(lib, kind, { history, out, now });
        const pool = backOf(freeShots(lib, taken, skip, focus), before);
        const episode = history.filter((h) => h.kind === 'series').length + out.filter((s) => s.kind === 'series').length + 1;
        const b = BUILD[kind](pool, { episode });
        if (!b) continue;
        if (!small && repeats(b, before)) continue;
        // резкий прыжок или писк могут значить испуг — такой ролик человек смотрит перед выкладкой
        const risky = b.pieces.some((p) => { const x = pool.find((y) => y.c.id === p.clip && y.i === p.shot); return x && has(x, 'прыжок', 'писк'); });
        if (risky && !b.needsReview) b.needsReview = 'есть резкий прыжок или писк — убедитесь, что зверёк не испугался';
        const n = history.filter((h) => h.kind === kind).length + out.filter((s) => s.kind === kind).length;
        made = finish(kind, b, now, n);
        break;
      }
    }
    if (!made) break;
    made.pieces.forEach((p) => taken.add(key(p)));
    out.push(made);
    hist.push({ kind: made.kind, at: now });
  }
  // человек только что отметил видео «Это мой зверёк», а ворота разнообразия закрыли все виды, что из него
  // собираются: один ролик с ним всё равно собираем — отметка важнее правила «не повторять вид»
  const hit = (s) => s.pieces.some((p) => focus.has(p.clip));
  if (focus?.size && out.length < count && !out.some(hit)) {
    const tiers = [tiredClips(lib, { history, batch: out.map((s) => s.pieces.map((p) => p.clip)), now }), null];
    for (const skip of tiers) {
      const pool = freeShots(lib, taken, skip, focus);
      const episode = history.filter((h) => h.kind === 'series').length + out.filter((s) => s.kind === 'series').length + 1;
      const kind = kindOrder(hist, now).find((k) => { const b = BUILD[k](pool, { episode }); return b && b.pieces.some((p) => focus.has(p.clip)); });
      if (!kind) continue;
      const b = BUILD[kind](pool, { episode });
      const risky = b.pieces.some((p) => { const x = pool.find((y) => y.c.id === p.clip && y.i === p.shot); return x && has(x, 'прыжок', 'писк'); });
      if (risky && !b.needsReview) b.needsReview = 'есть резкий прыжок или писк — убедитесь, что зверёк не испугался';
      const n = history.filter((h) => h.kind === kind).length + out.filter((s) => s.kind === kind).length;
      out.push(finish(kind, b, now, n));
      break;
    }
  }
  return out;
}

export const KIND_RU = { top5: 'Топ-5 моментов', day: 'День из жизни', beforeAfter: 'Сначала и потом', calm: 'Спокойные моменты', asmr: 'АСМР', series: 'Серия' };
const NEED = {
  top5: 'нужно 5 хороших моментов длиннее 1,5 с',
  day: 'нужны видео с настоящей датой съёмки из 3 разных частей суток (у пересланных и скачанных даты нет)',
  beforeAfter: 'нужно одно видео, где зверёк сначала спит или сидит тихо, а потом сам начинает двигаться',
  calm: 'нужно 2 спокойных момента без прыжков и писка',
  asmr: 'нужно видео со звуком, где слышно, как зверёк ест',
  series: 'нужно 3 свободных момента с одним занятием',
};

/** Почему не собраны остальные виды: [{kind, name, why}] — честно, по свободным планам и воротам. */
export function whyNotKinds(lib, stories, { history = [], now = Date.now() } = {}) {
  const taken = new Set(stories.flatMap((s) => s.pieces.map(key)));
  const hist = [...history, ...stories.map((s) => ({ kind: s.kind, at: now }))];
  const pool = freeShots(lib, taken);
  const out = [];
  for (const kind of KINDS) {
    if (stories.some((s) => s.kind === kind)) continue;
    let why, gated = false;
    if (!BUILD[kind](pool, { episode: 1 })) why = NEED[kind];
    else { why = gateReason(kind, hist, now) ?? 'материал есть — соберу в следующей пачке, чтобы не повторять виды подряд'; gated = true; }
    out.push({ kind, name: KIND_RU[kind], why, gated });
  }
  return out;
}

function finish(kind, b, now, n = 0) {
  const pieces = b.pieces;
  const total = r2(pieces.reduce((t, p) => t + p.len, 0));
  const id = `${kind}-${new Date(now).toISOString().slice(0, 10)}-${createHash('sha1').update(pieces.map(key).join('|')).digest('hex').slice(0, 6)}`;
  return {
    id, kind, variant: n, title: b.title ?? (TITLE_VARIANTS[kind] ? TITLE_VARIANTS[kind][n % TITLE_VARIANTS[kind].length] : TITLES[kind]), pieces, total,
    quiet: Boolean(b.quiet), needsReview: b.needsReview ?? null, theme: b.theme ?? null,
    why: storyWhy(pieces),
  };
}

/** Совет к ролику: моменты со временем в готовом ролике, а не в исходнике («резкий прыжок около 0:03»). */
export function storyWhy(pieces) {
  const n = pieces.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? 'момент' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'момента' : 'моментов';
  const clips = new Set(pieces.map((p) => p.clip).filter(Boolean)).size;
  const out = [clips ? `${n} ${word} из ${clips} видео` : `${n} ${word}`];
  let o = 0, jump = null, squeak = false, nights = 0, sound = false;
  for (const p of pieces) {
    if (/ночн/.test(String(p.why ?? ''))) nights++;
    for (const part of String(p.why ?? '').split(/[,;] /).filter(Boolean)) {
      const m = part.match(/^прыжок на (\d+(?:\.\d+)?) с$/);
      if (m && jump == null) jump = Math.floor(Math.min(o + p.len, Math.max(o, o + Number(m[1]) - p.from))) + 1;
      if (/писк/.test(part)) squeak = true;
      if (/asmr/i.test(part)) sound = true;
    }
    o += p.len;
  }
  if (jump != null) { const t = jump - 1; out.push(`резкий прыжок около ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`); }
  if (squeak) out.push('слышен писк');
  if (nights && nights === n) out.push('снято ночью в ИК');
  else if (nights) out.push('часть снята ночью в ИК');
  if (sound) out.push('хорошо слышно звук');
  return out.join(', ');
}

/** Сюжет собран — планы заняты на 7 дней. Возвращает запись для history. */
export function commit(lib, story, at = Date.now()) {
  for (const p of story.pieces) lib.markUsed(p.clip, p.shot, story.id, at);
  return { kind: story.kind, at, id: story.id };
}
