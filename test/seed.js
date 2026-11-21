// Ready-made "long life": the user with a history of N days — for the day-100 test.
import { TASK_IDS } from '../src/tasks.js';
import { isoWeek } from '../src/stats.js';

export function seedLongHistory(world, days) {
  const d = world.store.data;
  const now = world.clock.now();
  const DAY = 86_400_000;
  const start = new Date(now.getTime() - days * DAY);
  d.partner = {
    ...(d.partner ?? {}), id: 222, startedAt: start.toISOString(), lastSeenAt: new Date(now.getTime() - DAY / 2).toISOString(), introDone: true,
    pausedUntil: null, cadence: 'normal', awaiting: null, task: null, nudgesUnanswered: 0, ideas: [], taskHistory: [],
  };
  d.clips = []; d.posts = []; d.stats = [];
  const pool = TASK_IDS;
  for (let i = 0; i < days; i++) {
    const date = new Date(start.getTime() + i * DAY);
    const id = pool[i % pool.length];
    d.partner.taskHistory.push({ id, date: date.toISOString().slice(0, 10), status: 'done', clarified: false });
    const post = { id: `p${i}`, taskId: id, createdAt: date.toISOString(), status: 'posted', posted: { yt_en: date.toISOString(), yt_ru: date.toISOString(), tiktok: date.toISOString(), reels: date.toISOString() }, captions: {} };
    d.posts.push(post);
    const wk = isoWeek(date);
    const base = 200 + ((i * 37) % 900) + (id === 'flight' ? 1500 : 0);
    for (const [platform, k] of [['yt_en', 1], ['yt_ru', 0.5], ['tiktok', 1.6], ['reels', 0.3]]) {
      d.stats.push({ week: wk, platform, postId: post.id, views: Math.round(base * k), subs: Math.round(base * k / 80), source: 'manual' });
    }
  }
  // the last week before Sunday — a table by channel
  const wk = isoWeek(now);
  for (const [platform, views, subs] of [['yt_en', 3410, 21], ['yt_ru', 1870, 9], ['tiktok', 5200, 34], ['reels', 960, 4]]) {
    d.stats.push({ week: wk, platform, postId: null, views, subs, source: 'manual', weekly: true });
  }
  world.store.save();
}
