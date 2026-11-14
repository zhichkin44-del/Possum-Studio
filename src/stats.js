// Статистика каналов. Источники подключаются по очереди: manual (цифры от напарницы) сейчас, api (YouTube/TikTok/Instagram) — позже,
// когда Саша сделает входы. Бот зависит только от интерфейса StatsSource: { name, async fetch({ week }) → rows[] }.

export const PLATFORM_LABEL = { yt_en: 'YouTube EN', yt_ru: 'YouTube RU', tiktok: 'TikTok', reels: 'Instagram' };

const ALIASES = [
  ['yt_en', /(youtube|ютуб|yt)\s*[- ]?\s*(en|англ\w*)/i],
  ['yt_ru', /(youtube|ютуб|yt)\s*[- ]?\s*(ru|рус\w*)/i],
  ['tiktok', /(tik\s*tok|тик\s*ток)/i],
  ['reels', /(instagram|инстаграм|инста|reels|рилс)/i],
];

/** ISO-неделя вида 2026-W46 (по UTC-дате переданного Date). */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** «YouTube EN 3410 +21» по строкам → [{platform, views, subs}] */
export function parseStatsText(text) {
  const rows = [];
  for (const line of String(text).split(/\n|;/)) {
    const hit = ALIASES.find(([, re]) => re.test(line));
    if (!hit) continue;
    const rest = line.replace(hit[1], ' ');
    const subsM = rest.match(/\+\s*(\d[\d\s]*)/);
    const subs = subsM ? Number(subsM[1].replace(/\s/g, '')) : 0;
    const restNoSubs = subsM ? rest.replace(subsM[0], ' ') : rest;
    // число с пробелами-разрядами («3 410») или обычное; «12 3410» не склеиваем в 123410
    const viewsM = restNoSubs.match(/(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?!\d)/);
    if (!viewsM) continue;
    rows.push({ platform: hit[0], views: Number(viewsM[1].replace(/[\s\u00a0]/g, '')), subs });
  }
  return rows;
}

export const nf = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Таблица недели по площадкам (без двойного счёта: одна строка на площадку). */
export function weekRows(stats, week) {
  const byPlat = new Map();
  for (const r of stats) if (r.week === week && r.weekly) byPlat.set(r.platform, r);
  return Object.keys(PLATFORM_LABEL).filter((p) => byPlat.has(p)).map((p) => byPlat.get(p));
}

/** Лучший сценарий по среднему числу просмотров на ролик (нужно минимум minPosts роликов со статистикой). */
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

/** Заглушка автодоступа: подключится, когда Саша сделает входы. Бот не падает, а работает по manual. */
export function apiSource(env = process.env) {
  const ready = Boolean(env.POSSUM_STATS_API === '1');
  return {
    name: 'api',
    connected: ready,
    async fetch() {
      if (!ready) throw new Error('Автодоступ к статистике ещё не подключён (входы делает Саша)');
      return [];
    },
  };
}
