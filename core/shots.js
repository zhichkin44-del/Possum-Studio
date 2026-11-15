// Шаг А разбора, локально и бесплатно: клип → планы (склейки по скачку кадра), у плана — метки, брак, лучший момент.
// Тёмное и ИК — метки, не брак: зверёк ночной. Брак не удаляется — уходит «в запас».
import { deriveMoments } from './analyze.js';
import { hamming } from './frames.js';

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (x) => Math.round(x * 100) / 100;

export const SHOT = {
  minLen: 1.2,        // короче — брак «коротко»
  cutMotion: 25,      // склейка: разница кадров выше этого…
  cutFactor: 5,       // …и в 5 раз выше обычной для клипа
  cutHash: 18,        // …и dHash соседних кадров отличается ≥ 18 бит
  dupBits: 6,         // дубль: dHash ≤ 6 бит к уже взятому плану (у большинства из трёх кадров)
  maxShot: 8,         // длиннее — режем на куски ~7 с в спокойных местах
  pieceLen: 7,
  dark: 40,           // метка «тёмное»
  black: 13,          // брак «чёрный»; такие кадры в начале и конце плана обрезаются
  tooDark: 22,        // не-ИК темнее — брак «слишком темно» (зверька не разглядеть)
  irSat: 6,           // насыщенность ниже — кадр серый, похоже на ИК
  blur: 0.12,         // резкость ниже — брак «размыто» (уточняется на настоящих роликах)
  calm: 1.5, active: 3,
  jump: 8,           // всплеск движения выше — «движение» даже в спокойном в среднем плане
};

/** Индексы начала планов. */
export function findCuts(sig, opt = SHOT) {
  const { motion = [], hash = [] } = sig;
  const thr = Math.max(opt.cutMotion, median(motion) * opt.cutFactor);
  const cuts = [0];
  for (let i = 1; i < motion.length; i++) {
    if (motion[i] < thr) continue;
    if (hash[i] && hash[i - 1] && hamming(hash[i], hash[i - 1]) < opt.cutHash) continue;
    if (i - cuts.at(-1) >= 2) cuts.push(i); // две склейки подряд (вспышка/смаз) считаем одной
  }
  return cuts;
}

/**
 * Длинный план без склеек (сток, телефон на штативе) → начала кусков по ~7 с.
 * Разрез — в самом спокойном кадре ±1 с от намеченной границы, чтобы не резать прыжок.
 */
export function splitLong(motion, a, b, step, opt = SHOT) {
  if ((b - a) * step <= opt.maxShot) return [a];
  const k = Math.ceil(((b - a) * step) / opt.pieceLen);
  const size = (b - a) / k;
  const win = Math.max(1, Math.round(1 / step));
  const out = [a];
  for (let j = 1; j < k; j++) {
    const aim = Math.round(a + j * size);
    let best = aim;
    for (let i = Math.max(out.at(-1) + win, aim - win); i <= Math.min(b - win, aim + win); i++) {
      if ((motion[i] ?? 0) < (motion[best] ?? 0)) best = i;
    }
    if (best - out.at(-1) >= win && b - best >= win) out.push(best);
  }
  return out;
}

/** Сигналы клипа → список планов с метками и браком. */
export function detectShots(sig, opt = SHOT) {
  const step = sig.step ?? 0.25;
  const n = Math.max(sig.motion?.length ?? 0, sig.luma?.length ?? 0);
  if (!n) return [];
  const pick = (arr, a, b) => (arr ? arr.slice(a, b) : []);
  const hasAudio = sig.info?.hasAudio !== false;
  const clipLuma = Math.max(1, median(sig.luma ?? []));
  const real = [...findCuts(sig, opt), n];
  const hard = new Set(real);
  const cuts = [];
  for (let c = 0; c + 1 < real.length; c++) cuts.push(...splitLong(sig.motion ?? [], real[c], real[c + 1], step, opt));
  cuts.push(n);
  const shots = [];
  for (let c = 0; c + 1 < cuts.length; c++) {
    let a = cuts[c], b = cuts[c + 1];
    // чёрные кадры по краям плана (затемнение, телефон в кармане) — отрезаем, если внутри есть картинка
    if (sig.luma?.length) {
      let a2 = a, b2 = b;
      while (a2 < b2 && sig.luma[a2] < opt.black) a2++;
      while (b2 > a2 && sig.luma[b2 - 1] < opt.black) b2--;
      if (b2 - a2 >= 2 && (a2 > a || b2 < b)) { a = a2; b = b2; }
    }
    const motion = pick(sig.motion, a, b).map((x, i) => (i === 0 && a > 0 && hard.has(a) ? 0 : x)); // склейка — не движение
    const luma = pick(sig.luma, a, b), loud = pick(sig.loud, a, b);
    const sat = pick(sig.sat, a, b), sharp = pick(sig.sharp, a, b);
    const m = deriveMoments({ step, motion, loud, luma });
    const len = (b - a) * step;
    const shot = {
      from: r2(a * step), len: r2(len),
      luma: r2(mean(luma)), sat: sat.length ? r2(mean(sat)) : null,
      sharp: sharp.length ? r2(median(sharp)) : null,
      motion: r2(mean(motion)), loudMax: r2(Math.max(-90, ...loud)), loudMean: r2(loud.length ? mean(loud) : -90),
      hash: sig.hash?.[a + ((b - a) >> 1)] ?? null,
      hashes: [a + ((b - a) >> 2), a + ((b - a) >> 1), a + (((b - a) * 3) >> 2)].map((i) => sig.hash?.[i]).filter(Boolean),
      best: { t: r2(a * step + m.best.t), kind: m.best.kind, score: r2(m.best.score) },
      peaks: m.peaks.map((p) => ({ t: r2(a * step + p.t), kind: p.kind, score: r2(p.score) })),
      labels: [], defects: [],
    };
    const L = shot.labels, D = shot.defects;
    if (shot.luma < opt.black) D.push('чёрный');
    else {
      if (shot.luma < opt.dark) L.push('тёмное');
      if (shot.sat !== null && shot.sat < opt.irSat) L.push('ИК');
      else if (shot.luma < opt.tooDark) D.push('слишком темно');
    }
    if (shot.luma > 235) D.push('пересвет');
    if (len < opt.minLen) D.push('коротко');
    if (shot.sharp !== null && shot.sharp < opt.blur && !D.includes('чёрный')) D.push('размыто');
    const mx = Math.max(0, ...motion);
    const moving = m.peaks.some((p) => p.kind === 'move') && (shot.motion >= opt.active || mx >= opt.jump);
    if (moving) {
      L.push('движение');
      // «прыжок» — только резкий всплеск: высокий по абсолютной мере и в 3 раза выше среднего движения плана.
      // Ровная возня (ест, бегает, колесо) прыжком не считается. Нормированный best.score тут не годится — он почти всегда 1.
      if (mx >= opt.jump * 1.5 && mx >= 3 * shot.motion) L.push('прыжок');
    } else if (shot.motion < opt.calm) L.push('спокойно');
    if (m.peaks.some((p) => p.kind === 'squeak')) L.push('писк');
    if (!hasAudio || shot.loudMax < -60) L.push('без звука');
    else if (L.includes('спокойно') && shot.loudMean > -50 && shot.loudMax > -35) L.push('asmr?');
    // оценка 0…1: резко, хорошо видно, зверёк занят своим делом. Резкий прыжок и писк — не награда:
    // такие моменты могут значить испуг, их смотрит человек (см. needsReview в сюжетах).
    const moveScore = Math.min(1, Math.max(0, ...m.peaks.filter((p) => p.kind === 'move').map((p) => p.score), 0));
    const life = L.includes('движение') ? 0.6 * moveScore : 0;
    const sharpScore = shot.sharp === null ? 0.5 : Math.min(1, shot.sharp / (opt.blur * 3));
    const expo = Math.min(1, 0.5 * shot.luma / clipLuma + 0.5 * shot.luma / 80);
    const calmBonus = L.includes('спокойно') ? 0.2 : 0;
    const jumpPenalty = L.includes('прыжок') ? 0.25 : 0;
    shot.score = D.length ? 0 : r2(Math.max(0.01, Math.min(1, 0.35 * sharpScore + 0.25 * expo + 0.4 * life + calmBonus - jumpPenalty)));
    shot.why = whyLine(shot);
    shots.push(shot);
  }
  return shots;
}

/** «Почему этот момент» — одна строка для окна. */
export function whyLine(s) {
  if (s.defects.length) return `в запас: ${s.defects.join(', ')}`;
  const parts = [];
  if (s.labels.includes('движение')) parts.push(moveLine(s));
  if (s.labels.includes('писк')) parts.push('слышен писк');
  if (s.labels.includes('asmr?')) parts.push('тихо, хорошо слышно — для ASMR');
  if (s.labels.includes('тёмное') || s.labels.includes('ИК')) parts.push('ночная съёмка');
  if (!parts.length) parts.push(s.labels.includes('спокойно') ? 'спокойный план' : 'обычный план');
  return parts.join(', ');
}

/** Движение разными словами: сильный всплеск — «прыжок», остальное — по месту в клипе. */
function moveLine(s) {
  if (s.labels.includes('прыжок')) return `прыжок на ${s.best.t} с`;
  return 'зверёк занят своими делами';
}

const hashesOf = (x) => (typeof x === 'string' ? [x] : x.hashes?.length ? x.hashes : x.hash ? [x.hash] : []);
const actOf = (s) => (s.labels?.includes('движение') ? 'движение' : s.labels?.includes('спокойно') ? 'спокойно' : '');
const silent = (x) => typeof x.loudMean !== 'number' || x.loudMean <= -85;

/** Похожи ли кадры: большинство хэшей близки; если у взятого есть звук — он тоже должен быть похож. */
function sameLook(s, t, opt) {
  const a = hashesOf(s), b = hashesOf(t);
  if (!a.length || !b.length) return false;
  let close = 0;
  for (const h of a) if (b.some((g) => hamming(h, g) <= opt.dupBits)) close++;
  if (close * 2 <= a.length && !(a.length === 1 && close === 1)) return false;
  if (typeof t === 'string') return true;
  // статичная камера: спит и потом прыгает — кадры похожи, но это разные моменты (нужны для «до/после»)
  if (t.act !== undefined && actOf(s) !== t.act) return false;
  if (silent(s) !== silent(t)) return false; // один со звуком, другой без — разные съёмки
  if (!silent(s) && Math.abs(s.loudMean - t.loudMean) > 3) return false;
  return true;
}

/** Тот же кусок того же ролика, но повёрнутый или пережатый: картинка другая, а длина, звук и движение совпадают. */
function sameTrack(s, t, dur) {
  if (typeof t === 'string' || silent(s) || silent(t)) return false;
  if (dur == null || t.dur == null || Math.abs(dur - t.dur) > 0.5) return false;
  // длина клипа до сотых — тот же ролик, перекадрированный: склейки и движение сдвигаются, звук остаётся
  if (Math.abs(dur - t.dur) <= 0.05) {
    const over = Math.min(s.from + s.len, t.from + t.len) - Math.max(s.from, t.from);
    if (over >= 0.5 * Math.min(s.len, t.len) && Math.abs(s.loudMean - t.loudMean) <= 2) return true;
  }
  if (Math.abs(s.from - t.from) > 0.5 || Math.abs(s.len - t.len) > 0.5) return false;
  if (Math.abs(s.loudMean - t.loudMean) > 1) return false;
  return Math.abs(s.motion - t.motion) <= Math.max(0.5, 0.15 * Math.max(s.motion, t.motion));
}

/** Что запомнить о взятом плане, чтобы ловить дубли в следующих клипах. */
export const shotPrint = (s, dur = null) => ({
  hash: s.hash ?? null, hashes: hashesOf(s), from: s.from, len: s.len, loudMean: s.loudMean, motion: s.motion, dur, act: actOf(s),
});

/**
 * Дубли: идём от лучших к худшим; план, похожий на уже взятый, — «дубль».
 * Похож — если близки кадры (большинство из трёх dHash) и звук, или совпадает «отпечаток»
 * (длина клипа, место, громкость, движение) — так ловится тот же ролик после поворота.
 * taken — отпечатки взятых планов из библиотеки (или просто хэши). dur — длина этого клипа.
 * Возвращает отпечатки новых взятых.
 */
export function markDuplicates(shots, taken = [], opt = SHOT, dur = null) {
  const kept = [...taken];
  const order = shots.map((s, i) => i).sort((x, y) => shots[y].score - shots[x].score);
  let checked = 0, fromOther = 0;
  const fresh = [];
  for (const i of order) {
    const s = shots[i];
    if (s.defects.length || (!hashesOf(s).length && silent(s))) continue;
    checked++;
    const k = kept.findIndex((t) => sameLook(s, t, opt) || sameTrack(s, t, dur));
    if (k >= 0) {
      const near = kept[k];
      if (k < taken.length) fromOther++;
      s.defects.push('дубль'); s.dupOf = typeof near === 'string' ? near : near.hash ?? 'тот же звук и движение';
      s.score = 0; s.why = whyLine(s); continue;
    }
    kept.push(shotPrint(s, dur)); fresh.push(s);
  }
  // большинство планов повторяет уже взятые из другого видео — это копия (пересжатая, повёрнутая):
  // остальные её планы — тоже дубли, иначе тот же момент попадёт в ролик дважды
  if (checked >= 2 && fromOther * 2 > checked) {
    for (const s of fresh) { s.defects.push('дубль'); s.dupOf = 'копия другого видео'; s.score = 0; s.why = whyLine(s); }
    return [];
  }
  return kept.slice(taken.length);
}

/** Сводка по клипу для библиотеки. */
export function summarizeClip(sig, opt = SHOT) {
  const shots = detectShots(sig, opt);
  const labels = [...new Set(shots.flatMap((s) => s.labels))];
  const good = shots.filter((s) => !s.defects.length);
  return {
    duration: r2((sig.motion?.length ?? 0) * (sig.step ?? 0.25)),
    step: sig.step ?? 0.25,
    shots, labels,
    best: good.length ? Math.max(...good.map((s) => s.score)) : 0,
    spare: shots.length - good.length,
  };
}
