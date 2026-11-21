// Channel statistics. Sources are plugged in one by one: manual (figures from the partner) now, api (YouTube/TikTok/Instagram) later,
// once the owner sets up the logins. The bot depends only on the StatsSource interface: { name, async fetch({ week }) → rows[] }.

export const PLATFORM_LABEL = { yt_en: 'YouTube EN', yt_ru: 'YouTube RU', tiktok: 'TikTok', reels: 'Instagram' };

const ALIASES = [
  ['yt_en', /(youtube|ютуб|yt)\s*[- ]?\s*(en|англ\w*)/i],
  ['yt_ru', /(youtube|ютуб|yt)\s*[- ]?\s*(ru|рус\w*)/i],
  ['tiktok', /(tik\s*tok|тик\s*ток)/i],
  ['reels', /(instagram|инстаграм|инста|reels|рилс)/i],
];

/** ISO week such as 2026-W46 (from the UTC date of the given Date). */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** "YouTube EN 3410 +21" per line → [{platform, views, subs}] */
export function parseStatsText(text) {
  const rows = [];
  for (const line of String(text).split(/\n|;/)) {
    const hit = ALIASES.find(([, re]) => re.test(line));
    if (!hit) continue;
    const rest = line.replace(hit[1], ' ');
    const subsM = rest.match(/\+\s*(\d[\d\s]*)/);
    const subs = subsM ? Number(subsM[1].replace(/\s/g, '')) : 0;
    const restNoSubs = subsM ? rest.replace(subsM[0], ' ') : rest;
    // a number with space separators ("3 410") or a plain one; "12 3410" is not glued into 123410
    const viewsM = restNoSubs.match(/(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?!\d)/);
    if (!viewsM) continue;
    rows.push({ platform: hit[0], views: Number(viewsM[1].replace(/[\s\u00a0]/g, '')), subs });
  }
  return rows;
}

export const nf = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Weekly table by platform (no double counting: one row per platform). */
export function weekRows(stats, week) {
  const byPlat = new Map();
  for (const r of stats) if (r.week === week && r.weekly) byPlat.set(r.platform, r);
  return Object.keys(PLATFORM_LABEL).filter((p) => byPlat.has(p)).map((p) => byPlat.get(p));
}

/** Best scenario by average views per video (needs at least minPosts videos with statistics). */
export function scenarioAverages(data) {
  const byPost = new Map();
  for (const r of data.stats) if (r.postId) byPost.set(r.postId, (byPost.get(r.postId) ?? 0) + r.views);
  const sums = new Map();
  for (const p of data.posts) {
    if (!byPost.has(p.id)) continue;
    const s = sums.get(p.taskId) ?? { total: 0, n: 0 };
    s.total += byPost.get(p.id); s.n += 1; sums.set(p.taskId, s);
  }
  return new Map([...sums].map(([id, s]) => [id, { avg: s.total / s.n, n: s.n }]));
}

export function bestPost(data) {
  const byPost = new Map();
  for (const r of data.stats) if (r.postId) byPost.set(r.postId, (byPost.get(r.postId) ?? 0) + r.views);
  let best = null;
  for (const p of data.posts) { const v = byPost.get(p.id); if (v !== undefined && (!best || v > best.views)) best = { post: p, views: v }; }
  return best;
}

/** Auto-access stub: connects once the owner sets up the logins. The bot does not crash; it works in manual mode. */
export function apiSource(env = process.env) {
  const ready = Boolean(env.POSSUM_STATS_API === '1');
  return {
    name: 'api',
    connected: ready,
    async fetch() {
      if (!ready) throw new Error('Automatic statistics access is not connected yet (The owner sets up the logins)');
      return [];
    },
  };
}
