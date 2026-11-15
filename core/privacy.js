// Приватность: лица людей, сигареты и руки в ролики не попадают (руку в кадре зрители ругают первой).
// Кадры (квадраты, покрывающие весь кадр) сравниваются с подписями той же локальной
// модели CLIP; подписи, проходы и пороги — в clip-labels.json (privacy). Сеть не нужна.
// Лица крупные — хватает сетки 1 (три квадрата по высоте); сигарета мелкая и мелькает меньше секунды — нужна сетка 2 и шаг 0,5 с.

/** Причина в запасе — простыми словами, как у других браков. */
export const PRIVATE_WHY = {
  'люди': 'в кадре человек — в сюжеты не берём',
  'сигарета': 'в кадре сигарета — в сюжеты не берём',
  'рука': 'в кадре рука — в сюжеты не берём; снимите зверька без руки в кадре',
};

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Доли групп одного кадра: softmax(scale·cos) по всем подписям, сумма по каждой группе. */
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
 * По каждому моменту — 'люди', 'сигарета' или null. Кропы одного момента (одинаковое t) сводятся
 * по максимуму. Срабатывание короче P.minRun соседних моментов считается шумом. Нет подписей — пусто.
 * P.only — считать только эту группу (доля других групп не мешает и не засчитывается).
 * P.minRunSeen — если в ролике осталась хоть одна серия, повторная проверка с этой (меньшей) длиной:
 * курильщик в кадре уже подтверждён, и одиночный кадр с сигаретой рядом — уже не шум.
 * P.rise — засчитывать только всплеск: доля группы выше своей медианы по ролику хотя бы на rise
 * (зверёк весь ролик в ладони — это не «рука у морды»; рука, влезшая в кадр, — да).
 * P.over — группа засчитывается, только если её доля выше доли каждой из этих групп (минус P.overMargin):
 * сжатый кулак модель путает с сигаретой, но «рукой» он для неё всё равно больше.
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

/** Несколько проходов — в один ряд по моменту: попадание любого прохода остаётся. */
export function mergeHits(...lists) {
  const by = new Map();
  for (const list of lists) for (const h of list ?? []) {
    const cur = by.get(h.t);
    if (!cur || (!cur.kind && h.kind)) by.set(h.t, { t: h.t, kind: h.kind });
  }
  return [...by.values()].sort((a, b) => a.t - b.t);
}

/**
 * Фильтр приватности поверх кадрового эмбеддера: scan(file) → [{t, kind}]. Каждый проход из
 * labels.passes берёт кадры своей сетки и смотрит только свою группу. Нет модели или подписей —
 * available=false, ролики собираются как раньше, а программа честно говорит, что проверки не было.
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
      // «зверька держат в руках весь ролик»: из такого видео годится только окно мордочки
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
 * «Зверька не видно»: доля моментов ролика, где подписи «голой руки» (H.labels: рука, кулак, пальцы)
 * вместе набирают не меньше H.threshold. Зверёк зажат в кулаке весь ролик — доля большая; держат
 * в ладони и мордочку видно — около нуля. Кропы одного момента усредняются.
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
 * Окно «мордочки»: самое непохожее на остальной ролик место длиной len секунд (новизна кадра —
 * 1 − cos к среднему виду ролика). Зверька показали крупно — кадр не похож на общий план.
 * Окна с моментами из skip (вырезанная рука, сигарета) не берутся. Пик незаметный (меньше
 * полутора медиан новизны) или ролик ровный — null.
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
 * Планы с попаданием режутся по чистым участкам (не короче minLen): самый длинный остаётся на месте плана,
 * остальные добавляются новыми планами в конец (номера старых планов не сдвигаются). Лучший момент
 * и пики остаются внутри своих кусков. Чистого участка нет — план в запас с причиной. Каждое попадание закрывает
 * ±(step/2 + pad) секунды вокруг своего момента.
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
