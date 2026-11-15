// План монтажа под площадку: лучший момент в первые 1,5 с (или тизер), 1–3 звука, наезд, подписи RU+EN.
export const PROFILES = {
  youtube: { label: 'YouTube Shorts', maxLen: 30, music: true },
  tiktok: { label: 'TikTok', maxLen: 20, music: false }, // тренд-звук ставится в самом TikTok
  reels: { label: 'Instagram Reels', maxLen: 15, minLen: 12, music: true },
};
export const HOOK_MAX = 1.5;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r2 = (x) => Math.round(x * 100) / 100;

export function makePlan(analysis, profileName, { music = null, captions = {} } = {}) {
  const prof = PROFILES[profileName];
  if (!prof) throw new Error(`Нет площадки ${profileName}`);
  const dur = analysis.duration;
  if (!(dur >= 1)) throw new Error('Видео слишком короткое: нужно хотя бы 1 секунда.');
  const best = clamp(analysis.best?.t ?? dur / 2, 0, dur);

  const L = Math.min(prof.maxLen, dur);
  const start = clamp(best - 1, 0, dur - L);
  let segments, hookAt;
  if (best - start <= HOOK_MAX) {
    segments = [{ from: r2(start), len: r2(L) }];
    hookAt = best - start;
  } else {
    // лучший момент далеко — короткий тизер в начало, потом сам ролик
    const tlen = Math.min(1.2, dur);
    const tFrom = clamp(best - 0.5, 0, dur - tlen);
    const mainLen = Math.min(prof.maxLen - tlen, dur);
    const mainFrom = clamp(best - mainLen * 0.6, 0, dur - mainLen);
    segments = [{ from: r2(tFrom), len: r2(tlen), teaser: true }, { from: r2(mainFrom), len: r2(mainLen) }];
    hookAt = best - tFrom;
  }
  const total = r2(segments.reduce((s, x) => s + x.len, 0));

  // звуки: «поп» на хук, потом прыжки (свист) и писк (пружинка), не чаще раза в 2 с, не больше 3
  const sfx = [{ at: r2(Math.max(0, hookAt - 0.1)), name: 'pop' }];
  const kindSfx = { move: 'whoosh', squeak: 'boing' };
  let offset = 0;
  for (const seg of segments) {
    for (const p of analysis.peaks ?? []) {
      if (sfx.length >= 3) break;
      if (p.t < seg.from || p.t >= seg.from + seg.len) continue;
      const at = r2(offset + (p.t - seg.from));
      if (at >= total - 0.3 || sfx.some((s) => Math.abs(s.at - at) < 2)) continue;
      sfx.push({ at, name: kindSfx[p.kind] ?? 'whoosh' });
    }
    offset += seg.len;
  }
  sfx.sort((a, b) => a.at - b.at);

  return {
    profile: profileName,
    segments,
    total,
    hookAt: r2(hookAt),
    sfx,
    zooms: [{ at: r2(Math.max(0, hookAt - 0.3)), len: 1, scale: 1.25 }],
    music: prof.music && music ? { file: music, gainDb: -20 } : null,
    captions: { ru: captions.ru ?? '', en: captions.en ?? '', from: 0.1, to: r2(Math.min(3.4, total)) },
  };
}
