// Где в ролике самое интересное: прыжки (всплески движения), писк (всплески звука), темнота, вспышки.
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/** Группы подряд идущих индексов, где pred(i); от каждой — середина самого высокого плато. */
function groupPeaks(values, pred, step) {
  const out = [];
  for (let i = 0; i < values.length;) {
    if (!pred(i)) { i++; continue; }
    let j = i; while (j + 1 < values.length && pred(j + 1)) j++;
    let max = -Infinity; for (let k = i; k <= j; k++) max = Math.max(max, values[k]);
    const top = []; for (let k = i; k <= j; k++) if (values[k] === max) top.push(k);
    out.push({ t: ((top[0] + top[top.length - 1]) / 2) * step, value: max });
    i = j + 1;
  }
  return out;
}
function spaced(peaks, minGap, limit) {
  const keep = [];
  for (const p of [...peaks].sort((a, b) => b.score - a.score)) {
    if (keep.length >= limit) break;
    if (keep.every((k) => Math.abs(k.t - p.t) >= minGap)) keep.push(p);
  }
  return keep;
}

export const DARK_LUMA = 40;
export const FLASH_JUMP = 60;

export function deriveMoments({ step = 0.25, motion = [], loud = [], luma = [] }) {
  const n = Math.max(motion.length, luma.length);
  const duration = n * step;
  const mThr = mean(motion) + std(motion);
  const mMax = Math.max(1e-9, ...motion);
  const moves = std(motion) < 1e-6 ? [] : spaced(
    groupPeaks(motion, (i) => motion[i] > mThr, step).map((p) => ({ t: p.t, kind: 'move', score: p.value / mMax })), 1, 6);
  const lMed = median(loud);
  const squeaks = spaced(
    groupPeaks(loud, (i) => loud[i] > lMed + 12 && loud[i] > -35, step)
      .map((p) => ({ t: p.t, kind: 'squeak', score: Math.min(1, (p.value - lMed) / 30) })), 1, 6);
  const peaks = [...moves, ...squeaks].sort((a, b) => a.t - b.t);

  // лучший момент: сильный прыжок, особенно если рядом писк
  let best = null;
  for (const m of moves) {
    const s = m.score + (squeaks.some((q) => Math.abs(q.t - m.t) <= 1) ? 0.5 : 0);
    if (!best || s > best.score) best = { t: m.t, score: s, kind: 'move' };
  }
  if (!best && squeaks.length) best = { ...squeaks.reduce((a, b) => (b.score > a.score ? b : a)) };
  if (!best) best = { t: duration / 2, score: 0, kind: 'none' };

  const flash = [];
  for (let i = 1; i < luma.length; i++) if (luma[i] - luma[i - 1] > FLASH_JUMP) flash.push(i * step);
  return { duration, peaks, best, dark: luma.length > 0 && median(luma) < DARK_LUMA, avgLuma: mean(luma), flash };
}

export async function analyzeVideo(path, media) {
  const s = await media.signals(path);
  return { ...deriveMoments(s), info: s.info };
}
