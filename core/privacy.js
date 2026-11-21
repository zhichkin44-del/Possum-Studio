// Privacy: people's faces, cigarettes and hands do not get into videos (viewers criticize a hand in frame first).
// Frames (squares covering the whole frame) are compared with the captions of the same local
// CLIP model; captions, passes and thresholds are in clip-labels.json (privacy). No network needed.
// Faces are large — grid 1 is enough (three squares in height); a cigarette is small and flashes for less than a second — it needs grid 2 and a 0.5 s step.

/** The reason in the reserve — in plain words, like the other defects. */
export const PRIVATE_WHY = {
  'люди': 'в кадре человек — в сюжеты не берём',
  'сигарета': 'в кадре сигарета — в сюжеты не берём',
  'рука': 'в кадре рука — в сюжеты не берём; снимите зверька без руки в кадре',
};

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Shares of the groups of one frame: softmax(scale·cos) over all captions, summed per group. */
function shares(v, P) {
  const z = P.vectors.map((t) => (P.scale ?? 100) * dot(v, t));
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const sum = e.reduce((a, b) => a + b, 0) || 1;
  const out = {};
  P.kind.forEach((k, i) => { if (k) out[k] = (out[k] ?? 0) + e[i] / sum; });
  return out;
}

/**
 * For each moment — 'people', 'cigarette' or null. Crops of one moment (same t) are merged
 * by maximum. A hit shorter than P.minRun neighbouring moments counts as noise. No captions — empty.
 * P.only — count only this group (the share of other groups does not interfere and is not counted).
 * P.minRunSeen — if at least one run is left in the video, a repeat check with this (smaller) length:
 * a smoker in the frame is already confirmed, and a single frame with a cigarette nearby is no longer noise.
 * P.rise — count only a spike: the group's share is above its own median for the video by at least rise
 * (the pet held in the palm the whole video is not "a hand at the muzzle"; a hand that gets into the frame is).
 * P.over — a group counts only if its share is above the share of each of these groups (minus P.overMargin):
 * the model confuses a clenched fist with a cigarette, but for it the "hand" is still bigger.
 */
export function privacyHits(frames, P) {
  if (!P?.vectors?.length || !frames?.length) return [];
  const by = new Map();
  for (const f of frames) {
    const s = shares(f.v, P);
    const cur = by.get(f.t) ?? {};
    for (const [k, x] of Object.entries(s)) cur[k] = Math.max(cur[k] ?? 0, x);
    by.set(f.t, cur);
  }
  const thr = P.threshold ?? 0.5;
  const rows = [...by.entries()].sort((a, b) => a[0] - b[0]);
  const med = (g) => { const v = rows.map(([, s]) => s[g] ?? 0).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; };
  const base = {};
  const hits = rows.map(([t, s]) => {
    const [k, x] = Object.entries(s).filter(([g]) => !P.only || g === P.only).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    let ok = x >= thr;
    if (ok && P.rise != null) ok = x - (base[k] ??= med(k)) >= P.rise;
    if (ok && P.over?.length) ok = P.over.every((g) => x > (s[g] ?? 0) - (P.overMargin ?? 0));
    return { t, kind: ok ? k : null };
  });
  const keep = (run) => {
    const h = hits.map((x) => ({ ...x }));
    for (let i = 0; i < h.length;) {
      if (!h[i].kind) { i++; continue; }
      let j = i; while (j < h.length && h[j].kind) j++;
      if (j - i < run) for (let n = i; n < j; n++) h[n] = { t: h[n].t, kind: null };
      i = j;
    }
    return h;
  };
  const out = keep(P.minRun ?? 1);
  return P.minRunSeen != null && out.some((h) => h.kind) ? keep(P.minRunSeen) : out;
}

/** Several passes — in one row per moment: a hit from any pass is kept. */
export function mergeHits(...lists) {
  const by = new Map();
  for (const list of lists) for (const h of list ?? []) {
    const cur = by.get(h.t);
    if (!cur || (!cur.kind && h.kind)) by.set(h.t, { t: h.t, kind: h.kind });
  }
  return [...by.values()].sort((a, b) => a.t - b.t);
}

/**
 * Privacy filter on top of the frame embedder: scan(file) → [{t, kind}]. Each pass from
 * labels.passes takes the frames of its own grid and looks only at its own group. No model or captions —
 * available=false, videos are assembled as before, and the program honestly says that no check was done.
 */
export function createPrivacy({ embedder, labels } = {}) {
  const ok = !!(embedder?.available && embedder.embedAt && labels?.vectors?.length);
  const passes = labels?.passes?.length ? labels.passes : [{ grid: 1, threshold: labels?.threshold, minRun: labels?.minRun }];
  return {
    available: ok,
    pad: labels?.pad ?? 1,
    async scan(file) {
      if (!ok) return [];
      const frames = new Map();
      const out = [];
      for (const p of passes) {
        const g = p.grid ?? 1, st = p.step ?? 1, key = g + '/' + st;
        if (!frames.has(key)) frames.set(key, await embedder.embedAt(file, { grid: g, step: st }));
        out.push(privacyHits(frames.get(key), { ...labels, only: p.kind, threshold: p.threshold, minRun: p.minRun, minRunSeen: p.minRunSeen, rise: p.rise, over: p.over, overMargin: p.overMargin }));
      }
      const hits = mergeHits(...out);
      const m = labels.moment;
      if (m) {
        const g = m.grid ?? 1, st = m.step ?? 0.5, key = g + '/' + st;
        if (!frames.has(key)) frames.set(key, await embedder.embedAt(file, { grid: g, step: st }));
        hits.moment = momentWindow(frames.get(key), { len: m.len ?? 2, skip: hits.filter((h) => h.kind).map((h) => h.t) });
      }
      const H = labels.hidden;
      if (H) {
        const g = H.grid ?? m?.grid ?? 1, st = H.step ?? m?.step ?? 0.5, key = g + '/' + st;
        if (!frames.has(key)) frames.set(key, await embedder.embedAt(file, { grid: g, step: st }));
        const share = hiddenShare(frames.get(key), labels, H);
        hits.hidden = { share: +share.toFixed(3), hidden: share >= (H.share ?? 0.5) };
      }
      // "the pet is held in hands the whole video": from such a video only the face window is usable
      const Hd = labels.held;
      if (Hd) {
        const g = Hd.grid ?? m?.grid ?? 1, st = Hd.step ?? m?.step ?? 0.5, key = g + '/' + st;
        if (!frames.has(key)) frames.set(key, await embedder.embedAt(file, { grid: g, step: st }));
        const share = hiddenShare(frames.get(key), labels, Hd);
        hits.held = { share: +share.toFixed(3), held: share >= (Hd.share ?? 0.8) };
      }
      return hits;
    },
  };
}

/**
 * "Pet not visible": the share of video moments where the "bare hand" captions (H.labels: hand, fist, fingers)
 * together reach at least H.threshold. A pet held in a fist the whole video — a large share; held
 * in the palm with the muzzle visible — close to zero. Crops of one moment are averaged.
 */
export function hiddenShare(frames, P, H) {
  const idx = (H?.labels ?? []).map((l) => P?.labels?.indexOf(l)).filter((i) => i >= 0);
  if (!idx.length || !frames?.length || !P?.vectors?.length) return 0;
  const by = new Map();
  for (const f of frames) {
    const z = P.vectors.map((t) => (P.scale ?? 100) * dot(f.v, t));
    const mx = Math.max(...z);
    const e = z.map((x) => Math.exp(x - mx));
    const sum = e.reduce((a, b) => a + b, 0) || 1;
    by.set(f.t, [...(by.get(f.t) ?? []), idx.reduce((a, i) => a + e[i] / sum, 0)]);
  }
  const ms = [...by.values()].map((a) => a.reduce((x, y) => x + y, 0) / a.length);
  return ms.filter((x) => x >= (H.threshold ?? 0.2)).length / ms.length;
}

const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };

/**
 * "Muzzle" window: the place most unlike the rest of the video, len seconds long (frame novelty —
 * 1 − cos to the average look of the video). The pet is shown close up — the frame does not look like a wide shot.
 * Windows with moments from skip (a cut-out hand, a cigarette) are not taken. A peak that is unnoticeable (less than
 * one and a half novelty medians) or a flat video — null.
 */
export function momentWindow(frames, { len = 2, skip = [] } = {}) {
  if (!frames?.length) return null;
  const by = new Map();
  for (const f of frames) by.set(f.t, [...(by.get(f.t) ?? []), f.v]);
  const ts = [...by.keys()].sort((a, b) => a - b);
  const vt = ts.map((t) => { const vs = by.get(t); return unit(vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0))); });
  const mean = unit(vt[0].map((_, i) => vt.reduce((s, v) => s + v[i], 0)));
  const nov = vt.map((v) => Math.max(0, 1 - dot(v, mean)));
  const bad = new Set(skip);
  const free = nov.filter((_, k) => !bad.has(ts[k])).sort((a, b) => a - b);
  if (!free.length) return null;
  const median = free[Math.floor(free.length / 2)];
  let best = null;
  for (let i = 0; i < ts.length; i++) {
    const idx = [];
    for (let j = i; j < ts.length && ts[j] < ts[i] + len - 1e-9; j++) idx.push(j);
    if (idx.some((j) => bad.has(ts[j]))) continue;
    const avg = idx.reduce((s, j) => s + nov[j], 0) / idx.length;
    if (!best || avg > best.avg) best = { i, idx, avg };
  }
  if (!best || !(best.avg > 0) || best.avg < 1.5 * median) return null;
  const top = best.idx.reduce((a, j) => (nov[j] > nov[a] ? j : a), best.idx[0]);
  return { from: ts[best.i], to: +(ts[best.i] + len).toFixed(3), t: ts[top], nov: +best.avg.toFixed(4) };
}

/**
 * Plans with a hit are cut at clean spots (no shorter than minLen): the longest stays in the plan's place,
 * the others are added as new plans at the end (the numbers of old plans do not shift). The best moment
 * and the peaks stay inside their pieces. If there is no clean spot — the plan goes to the reserve with a reason. Each hit covers
 * ±(step/2 + pad) seconds around its moment.
 */
export function markPrivate(shots, hits, { minLen = 1.5, step = 1, pad = 0 } = {}) {
  const r = { cut: 0, dropped: 0, kinds: [] };
  const bad = hits.filter((h) => h.kind).map((h) => ({ a: h.t - step / 2 - pad, b: h.t + step / 2 + pad, kind: h.kind }));
  if (!bad.length) return r;
  for (const s of [...shots]) {
    const end = s.from + s.len;
    const mine = bad.filter((x) => x.b > s.from && x.a < end).sort((x, y) => x.a - y.a);
    if (!mine.length) continue;
    for (const x of mine) if (!r.kinds.includes(x.kind)) r.kinds.push(x.kind);
    const parts = [];
    let at = s.from;
    for (const x of [...mine, { a: end, b: end }]) {
      const a = at, b = Math.min(x.a, end);
      if (b - a >= minLen) parts.push({ a, b });
      at = Math.max(at, x.b);
    }
    if (!parts.length) {
      const kind = mine[0].kind;
      if (!s.defects.includes(kind)) s.defects.push(kind);
      s.score = 0; s.why = PRIVATE_WHY[kind] ?? 'в кадре посторонний — в сюжеты не берём';
      r.dropped++;
      continue;
    }
    parts.sort((x, y) => (y.b - y.a) - (x.b - x.a));
    const orig = JSON.parse(JSON.stringify(s));
    parts.forEach((p, k) => {
      const x = k ? JSON.parse(JSON.stringify(orig)) : s;
      const inside = (t) => t >= p.a && t <= p.b;
      x.from = +p.a.toFixed(3); x.len = +(p.b - p.a).toFixed(3);
      x.peaks = (orig.peaks ?? []).filter((q) => inside(q.t)).map((q) => ({ ...q }));
      if (!orig.best || !inside(orig.best.t)) {
        const top = [...x.peaks].sort((u, v) => (v.score ?? 0) - (u.score ?? 0))[0];
        x.best = top ? { ...top } : { ...(orig.best ?? {}), t: +(x.from + x.len / 2).toFixed(3) };
      }
      if (k) shots.push(x);
    });
    r.cut++;
  }
  return r;
}
