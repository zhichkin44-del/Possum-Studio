// The owner sends a video to the bot → three edits + a tip → publishing buttons. Publishing only by the owner's button and only with confirm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, OWNER } from './helpers.js';
import * as T from '../src/texts.js';

function fakeStudio(over = {}) {
  const s = {
    processed: [], published: [], processFails: 0,
    async process(src) {
      s.processed.push(src);
      if (s.processFails > 0) { s.processFails--; throw new Error('ffmpeg не найден'); }
      return {
        dir: 'C:/Готово/001', src,
        advice: { verdict: 'выкладывать', why: 'есть смешной момент на 2-й секунде' },
        welfare: ['Ночью без вспышки.'],
        texts: { source: 'шаблон' },
        packages: { youtube: { title: 'Поссум и банан' }, tiktok: { caption: 'тикток подпись' }, instagram: { caption: 'рилс подпись' } },
        outputs: { youtube: 'C:/Готово/001/youtube.mp4', tiktok: 'C:/Готово/001/tiktok.mp4', reels: 'C:/Готово/001/reels.mp4' },
      };
    },
    async publish(platform, dir, opts) {
      s.published.push({ platform, dir, confirm: opts?.confirm });
      if (platform === 'instagram') return { manual: true, steps: ['Открой Instagram', 'Нажми +'], caption: 'рилс подпись' };
      if (platform === 'tiktok') return { id: 'p1', note: 'в черновиках TikTok — открой приложение и опубликуй' };
      return { id: 'yt1', url: 'https://youtube.com/shorts/yt1' };
    },
    ...over,
  };
  return s;
}

async function ready(studio = fakeStudio()) {
  const w = makeWorld({ studio });
  await w.register();
  await w.owner.video({ uid: 'own1' });
  await w.idle();
  return { w, studio };
}

test('video from owner → three edits, advice and publish buttons', async () => {
  const { w, studio } = await ready();
  assert.equal(studio.processed.length, 1);
  assert.match(studio.processed[0], /owner-in/);
  assert.deepEqual(w.owner.videos().map((v) => v.text), ['YouTube Shorts', 'TikTok', 'Instagram Reels']);
  const all = w.owner.all();
  assert.match(all, /Принял, монтирую/);
  assert.match(all, /Совет: выкладывать/);
  assert.match(all, /Ночью без вспышки/);
  assert.deepEqual(w.owner.labels(), ['Выложить YouTube', 'В черновики TikTok', 'Instagram', 'Везде', 'Переделать']);
  assert.equal(studio.published.length, 0, 'nothing is published without the button');
});

test('the "Publish YouTube" button → publish with confirm:true and a link', async () => {
  const { w, studio } = await ready();
  await w.owner.press('Выложить YouTube');
  await w.idle();
  assert.equal(studio.published.length, 0, 'the first press only asks');
  assert.match(w.owner.last(), /Точно выложить: YouTube/);
  await w.owner.press('Да, выложить');
  await w.idle();
  assert.deepEqual(studio.published, [{ platform: 'youtube', dir: 'C:/Готово/001', confirm: true }]);
  assert.match(w.owner.last(), /YouTube: выложено — https:\/\/youtube\.com\/shorts\/yt1/);
});

test('"Everywhere" → three platforms; Instagram gives steps for manual publishing', async () => {
  const { w, studio } = await ready();
  await w.owner.press('Везде');
  await w.idle();
  await w.owner.press('Да, выложить');
  await w.idle();
  assert.deepEqual(studio.published.map((p) => p.platform), ['youtube', 'tiktok', 'instagram']);
  assert.ok(studio.published.every((p) => p.confirm === true));
  const last = w.owner.last();
  assert.match(last, /TikTok: в черновиках/);
  assert.match(last, /Instagram: выкладка вручную/);
  assert.match(last, /1\. Открой Instagram/);
});

test('a platform error does not break the others', async () => {
  const studio = fakeStudio();
  const orig = studio.publish;
  studio.publish = async (p, d, o) => { if (p === 'youtube') throw new Error('нет входа в YouTube'); return orig(p, d, o); };
  const { w } = await ready(studio);
  await w.owner.press('Везде');
  await w.idle();
  await w.owner.press('Да, выложить');
  await w.idle();
  const last = w.owner.last();
  assert.match(last, /YouTube: не вышло — нет входа в YouTube/);
  assert.match(last, /TikTok: в черновиках/);
});

test('"Cancel" after the question — nothing is published', async () => {
  const { w, studio } = await ready();
  await w.owner.press('Везде');
  await w.idle();
  await w.owner.press('Отмена');
  await w.idle();
  assert.equal(studio.published.length, 0);
  assert.match(w.owner.last(), /Отменено — ничего не выложено/);
});

test('a double "Yes" does not publish twice', async () => {
  const studio = fakeStudio();
  const orig = studio.publish;
  let release;
  const gate = new Promise((r) => { release = r; });
  studio.publish = async (p, d, o) => { await gate; return orig(p, d, o); };
  const { w } = await ready(studio);
  await w.owner.press('Выложить YouTube');
  await w.idle();
  const p1 = w.owner.press('Да, выложить');
  const p2 = w.owner.press('Да, выложить');
  release();
  await Promise.all([p1, p2]);
  await w.idle();
  assert.equal(studio.published.length, 1);
});

test("partner cannot press the owner's publish buttons", async () => {
  const { w, studio } = await ready();
  const data = w.tg.to(OWNER).filter((r) => r.buttons).at(-1).buttons.flat().find((b) => b.text === 'Везде').data;
  await w.bot.handleUpdate({ update_id: 9999, callback_query: { id: 'cbx', from: { id: 222 }, message: { message_id: 1, chat: { id: 222 } }, data } });
  await w.idle();
  assert.equal(studio.published.length, 0);
});

test('without the core (no ffmpeg) the bot honestly says editing is unavailable', async () => {
  const w = makeWorld();
  await w.register();
  await w.owner.video({ uid: 'own2' });
  await w.idle();
  assert.equal(w.owner.last(), T.ownerNoStudio.replace(/<[^>]+>/g, ''));
});

test('editing failed → "Redo" starts over', async () => {
  const studio = fakeStudio({ processFails: 1 });
  studio.processFails = 1;
  const { w } = await ready(studio);
  assert.match(w.owner.all(), /ffmpeg не найден/);
  assert.equal(w.owner.videos().length, 0);
  await w.owner.press('Переделать');
  await w.idle();
  assert.equal(studio.processed.length, 2);
  assert.equal(w.owner.videos().length, 3);
});

test('video too large — asks to send a smaller file, without downloading', async () => {
  const studio = fakeStudio();
  const w = makeWorld({ studio });
  await w.register();
  await w.owner.video({ uid: 'big', size: 60_000_000 });
  await w.idle();
  assert.equal(studio.processed.length, 0);
  assert.equal(w.owner.last(), T.ownerTooBig.replace(/<[^>]+>/g, ''));
});
