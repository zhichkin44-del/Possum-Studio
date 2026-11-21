// Story generator from the plans of the whole library: top 5, a day in the life, before/after, calm moments, ASMR, series.
// "Fails" are not assembled: a sharp jump may mean fright, such pieces only with a "check it" mark.
// Variety gates: a story kind does not repeat in a row, at least 3 different kinds in 7 days, a plan — no more than once every 7 days,
// a plan is not repeated within one batch; the source video is not in adjacent videos and not in more than 2 videos in 7 days, if others exist. Only free good plans (defects and "stress" — never).
import { createHash } from 'node:crypto';
import { SHOT } from './shots.js';

const DAY = 24 * 3600 * 1000;
const r2 = (x) => Math.round(x * 100) / 100;
export const KINDS = ['top5', 'day', 'beforeAfter', 'calm', 'asmr', 'series'];
const PRIORITY = { top5: 0, day: 1, series: 2, asmr: 3, beforeAfter: 4, calm: 5, fails: 6 };

/** Titles by kind: a repeated kind takes the next variant, so that videos are not named the same. */
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
// a squeak is not a series theme: from the sound you cannot tell who squeaks, and a squeak may mean fright — it is not made into a "column"
const PARTS = ['Утро', 'День', 'Вечер', 'Ночь'];
const PARTS_EN = { 'Утро': 'Morning', 'День': 'Day', 'Вечер': 'Evening', 'Ночь': 'Night' };

/** Lower bound of the series length in seconds: shorter than 15 s, the video is not watched to the end in the feed. */
export const SERIES_MIN = 15;

const key = (p) => `${p.clip}:${p.shot}`;

/** A piece of the plan up to `len` long around the best moment. */
export function pieceAround(clip, shotIdx, len, caption = null) {
  const s = clip.shots[shotIdx];
  const L = Math.min(len, s.len);
  const t = s.best?.t ?? s.from + s.len / 2;
  // the face — we start with it: before it there is usually a hand in the frame that brings the pet
  const lead = s.best?.kind === 'мордочка' ? 0 : L * 0.3;
  const from = Math.min(s.from + s.len - L, Math.max(s.from, t - lead));
  return { clip: clip.id, shot: shotIdx, from: r2(from), len: r2(L), peak: r2(Math.min(L, Math.max(0, t - from))), caption, why: s.why };
}

/**
 * All free good plans of the library, without those already taken in this batch.
 * tired — source videos that are better not taken now (they were in the previous video or already in 2 videos this week).
 */
function freeShots(lib, taken, tired = null, focus = null) {
  const out = [];
  for (const c of lib.all()) {
    if (tired?.has(c.id) && !focus?.has(c.id)) continue;
    // focus — videos the person has just marked "This is my pet": their plans go first
    const lift = focus?.has(c.id) ? 10 : 0;
    c.shots.forEach((s, i) => {
      if (taken.has(`${c.id}:${i}`) || !lib.isFree(c.id, i)) return;
      out.push({ c, s, i, score: s.score + (c.stars ?? 0) * 0.05 + lift });
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Source videos that are "tired": they were in the previous video (the neighbouring day) or already in 2 videos in 7 days.
 * Counts both the library (used) and the videos of this batch (batch — [[clipId…]…], oldest → newest).
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
/** Liveliness of a plan for the first second: motion plus the strongest motion peak. */
const live = (x) => (x.s.motion ?? 0) + Math.max(0, ...(x.s.peaks ?? []).filter((p) => p.kind === 'move').map((p) => p.score ?? 0));
/** A blurred jump with a squeak: viewers see a fall or fright in it — such pieces go to the end of the queue. */
const blurry = (x) => (x.s.sharp ?? 1) < 0.4 && has(x, 'прыжок', 'писк');
const blurLast = (xs) => [...xs.filter((x) => !blurry(x)), ...xs.filter(blurry)];
/** Hook of the first second: lively, sharp motion (blurred with a finger on the lens is not a hook). */
const hook = (x) => live(x) * (x.s.sharp ?? 0.5);
function* perms(xs) {
  if (xs.length <= 1) { yield xs; return; }
  for (let i = 0; i < xs.length; i++) for (const p of perms([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...p];
}
const glued = (xs) => xs.some((x, k) => k > 0 && xs[k - 1].c.id === x.c.id);
/**
 * Rearrange so that pieces of one video do not run one after another ("one source twice in a row" viewers notice at once).
 * The first (hook) and the last (best) stay in place if possible; the middle — closer to the original order.
 */
function unglue(xs) {
  if (!glued(xs) || xs.length < 3) return xs;
  for (const mid of perms(xs.slice(1, -1))) { const v = [xs[0], ...mid, xs.at(-1)]; if (!glued(v)) return v; }
  for (const tail of perms(xs.slice(1))) { const v = [xs[0], ...tail]; if (!glued(v)) return v; }
  return xs;
}

/** Videos of each past video of kind `kind`: the videos of this batch and of the weekly history (by c.used). [Set(clipId)…] */
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

/** Time of day of a plan — only from the real shooting time. Without a date (stock, forwarded) — null: we do not guess. */
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
    // no more than two moments from one clip, if there are enough others
    // the top 5 is about lively moments: moving plans first, calm ones only if there are not enough (they are needed for "calm moments")
    const all = pool.filter((x) => x.s.len >= 1.5);
    const calmOnly = (x) => has(x, 'спокойно', 'спит', 'умывается') && !has(x, 'движение');
    // blurred jumps with a squeak — at the very end: viewers see a fall in them
    const ok = blurLast([...all.filter((x) => !calmOnly(x)), ...all.filter(calmOnly)]);
    // first one piece per video, then two, then any; videos of the past top 5 (old) — only when there are not enough new ones
    const per = {}; const pick = [];
    for (const [cap, fresh] of [[1, true], [2, true], [2, false], [Infinity, false]]) {
      for (const x of ok) if (pick.length < 5 && !pick.includes(x) && !(fresh && x.old) && (per[x.c.id] ?? 0) < cap) { pick.push(x); per[x.c.id] = (per[x.c.id] ?? 0) + 1; }
    }
    pick.sort((a, b) => ok.indexOf(a) - ok.indexOf(b));
    if (pick.length < 5) return null;
    let show = pick.reverse();
    // the first showing (No. 5) — a daytime piece, if one is among No. 4…No. 2: the video does not open with a gray IR piece; No. 1 (the best) is left alone
    const ir = (x) => has(x, 'ИК') || Boolean(x.c.night);
    // hook: the first second — the most lively motion among No. 5…No. 2 (a daytime piece matters more than IR)
    const head = show.slice(0, 4);
    // hook — lively and sharp (blurred with a finger on the lens does not hook), not a blurred jump
    const day = head.some((x) => !ir(x)) ? head.filter((x) => !ir(x)) : head;
    const cand = day.some((x) => !blurry(x)) ? day.filter((x) => !blurry(x)) : day;
    const best = cand.reduce((a, x) => (hook(x) > hook(a) ? x : a), cand[0]);
    show.unshift(...show.splice(show.indexOf(best), 1));
    show = unglue(show);
    // the hook is 2 s, the others 3 s each; short plans are filled with longer ones (up to 5 s) so that the video is not shorter than SERIES_MIN;
    // the hook is stretched last
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
    // only one clip (the same pet, the same place), "then" — later and noticeably more active (3 times and not less than "active")
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
    // calm plans: the pet rests, washes, eats; different clips, if there are any
    const ok = pool.filter((x) => has(x, 'спокойно', 'спит', 'умывается') && !has(x, 'прыжок', 'писк') && x.s.len >= 2);
    const pick = [];
    for (const x of ok) if (pick.length < 3 && !pick.some((y) => y.c.id === x.c.id)) pick.push(x);
    for (const x of ok) if (pick.length < 3 && !pick.includes(x)) pick.push(x);
    // two calm plans already make a video (6 s each), three — 4 s each
    if (pick.length < 2) return null;
    const L = pick.length === 2 ? 6 : 4;
    return { pieces: pick.map((x) => pieceAround(x.c, x.i, L, null)) };
  },
  fails(pool) {
    // roughly: a sharp jump (a strong motion peak) — "possibly a fail", the person decides
    const jumps = pool.filter((x) => has(x, 'движение', 'прыжок') && x.s.peaks.some((p) => p.kind === 'move' && p.score >= 0.6)).slice(0, 3);
    if (jumps.length < 2) return null;
    return { pieces: jumps.map((x, k) => pieceAround(x.c, x.i, 3, k === 0 ? 'Ой!' : null)), needsReview: 'резкие прыжки — убедитесь, что зверёк не ударился и не испугался' };
  },
  asmr(pool) {
    // ASMR — only when you can hear the pet eating (the "eats" label or Claude's analysis says so), not just quiet
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
    // the video is no shorter than SERIES_MIN seconds: 5 s per moment, and if it is not enough — a fourth moment of the same theme
    const fill = (from) => {
      const pick = [];
      for (const x of from) if (pick.length < 3 || (pick.length < 4 && pick.reduce((t, y) => t + Math.min(5, y.s.len), 0) < SERIES_MIN)) pick.push(x);
      return pick;
    };
    // "Episode N" — only when it really is one episode: all pieces from one video and in shooting order
    const per = {};
    // blurred jumps with a squeak do not count as an episode: viewers see a fall in them
    for (const x of ok) if (!blurry(x)) (per[x.c.id] ??= []).push(x);
    const one = Object.values(per).filter((xs) => xs.length >= 3).sort((p, q) => q.length - p.length)[0];
    if (one) {
      const pick = fill(one).sort((p, q) => p.i - q.i);
      return {
        // "Episode N" stays for the whole video: it cannot be read in a second
        pieces: pick.map((x, k) => (k === 0 ? { ...pieceAround(x.c, x.i, 5, `Эпизод ${episode}`), hold: true } : pieceAround(x.c, x.i, 5, null))),
        theme,
        title: { ru: `Зверёк ${THEME[theme][0]} · эпизод ${episode}`, en: `Little animal ${THEME[theme][1]} · episode ${episode}` },
      };
    }
    // otherwise — a selection of one theme from different videos, without an "episode"; the most lively piece goes first
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

/** Gate check for a story kind. null — allowed, otherwise the reason. */
export function gateReason(kind, history, now = Date.now()) {
  const last = history.at(-1);
  if (last && last.kind === kind) return 'такой же вид был последним';
  const week = history.filter((h) => now - h.at < 7 * DAY);
  const kinds = new Set(week.map((h) => h.kind));
  // if there are already 4 videos in a week and fewer than 3 kinds — a new video must be of a new kind
  if (week.length >= 4 && kinds.size < 3 && kinds.has(kind)) return 'за неделю мало разных видов';
  return null;
}

/** Order of kinds for today: the ones not seen for a long time go first. */
export function kindOrder(history, now = Date.now()) {
  const week = history.filter((h) => now - h.at < 7 * DAY);
  const cnt = (k) => week.filter((h) => h.kind === k).length;
  const lastAt = (k) => Math.max(-Infinity, ...history.filter((h) => h.kind === k).map((h) => h.at));
  return [...KINDS].sort((a, b) => cnt(a) - cnt(b) || lastAt(a) - lastAt(b) || PRIORITY[a] - PRIORITY[b]);
}

/**
 * New stories for today. history — [{kind, at}] of already assembled/published videos (oldest → newest).
 * Returns up to `count` stories with different plans; changes nothing in the library (see commit).
 */
export function makeStories(lib, { history = [], now = Date.now(), count = 3, focus = null } = {}) {
  const taken = new Set();
  const out = [];
  const hist = [...history];
  for (let round = 0; round < count; round++) {
    let made = null;
    // first — without "tired" source videos (used yesterday or already twice in a week);
    // if that fails — only without the videos of a neighbouring video; and only as a last resort — from all of them
    const batch = out.map((s) => [...new Set(s.pieces.map((p) => p.clip))]);
    const tired = tiredClips(lib, { history, batch, now });
    const near = tiredClips(lib, { history, batch, now, perWeek: Infinity });
    // fallback steps — only for a small library (1–2 videos): otherwise it is better to have fewer videos than one video three times in a week
    const small = lib.all().length < 3;
    const tiers = (small ? [tired, near, null] : [tired]).filter((t, k, a) => k === 0 || (t?.size ?? 0) < (a[k - 1]?.size ?? 0));
    for (const skip of tiers) {
      if (made) break;
      for (const kind of kindOrder(hist, now)) {
        if (gateReason(kind, hist, now)) continue;
        // repeat: videos of past videos of this kind (in the batch and in the week) — to the end of the queue;
        // if the video still shares 2 or more videos with one of them, this kind is not assembled today
        const before = sameKindClips(lib, kind, { history, out, now });
        const pool = backOf(freeShots(lib, taken, skip, focus), before);
        const episode = history.filter((h) => h.kind === 'series').length + out.filter((s) => s.kind === 'series').length + 1;
        const b = BUILD[kind](pool, { episode });
        if (!b) continue;
        if (!small && repeats(b, before)) continue;
        // a sharp jump or a squeak may mean fright — the person watches such a video before publishing
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
  // the person has just marked a video "This is my pet", and the variety gates closed all the kinds it could make
  // one video with it is still assembled: the mark matters more than the "do not repeat a kind" rule
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

/** Why the other kinds were not assembled: [{kind, name, why}] — honestly, by the free plans and the gates. */
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

/** Advice for the video: moments with times in the finished video, not in the source ("sharp jump around 0:03"). */
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

/** Story assembled — the plans are occupied for 7 days. Returns a record for history. */
export function commit(lib, story, at = Date.now()) {
  for (const p of story.pieces) lib.markUsed(p.clip, p.shot, story.id, at);
  return { kind: story.kind, at, id: story.id };
}
