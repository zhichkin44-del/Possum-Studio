// Regressions from the findings of the "engineer-skeptic" and the "producer" (re-checked against the code before the fix).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld } from './helpers.js';
import { createTelegram } from '../src/telegram.js';
import { createStore } from '../src/store.js';
import { qualityIssues, buildCaptions } from '../src/post.js';
import { TASKS } from '../src/tasks.js';

const at = (d, hm) => `${d}T${hm}:00+07:00`;
async function ready() {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:30')); await w.partner.press('Снимаю');
  return w;
}

test('a download that "froze" mid-file is aborted by timeout and does not hang the bot', async () => {
  const s = http.createServer((req, res) => {
    if (req.url.includes('/getFile')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true, result: { file_path: 'v.mp4' } })); }
    res.setHeader('content-type', 'video/mp4'); res.write(Buffer.alloc(1000)); // and nothing more: the body is never closed
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const TOKEN = '123456:HANG-TOKEN-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';
  const tg = createTelegram({ token: TOKEN, apiBase: `http://127.0.0.1:${s.address().port}` });
  const dest = join(mkdtempSync(join(tmpdir(), 'possum-hang-')), 'v.mp4');
  const t0 = Date.now();
  await assert.rejects(() => tg.download('F', dest, { timeoutMs: 400 }), (e) => /timeout/.test(e.message) && !e.message.includes(TOKEN));
  assert.ok(Date.now() - t0 < 3000);
  s.closeAllConnections?.(); s.close();
});

test('"broken" HTML markup does not lose the message: it is sent as plain text', async () => {
  const calls = [];
  const s = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    calls.push(body); res.setHeader('content-type', 'application/json');
    if (body.parse_mode === 'HTML') { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" })); }
    res.end(JSON.stringify({ ok: true, result: { message_id: 3 } }));
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const tg = createTelegram({ token: '123456:HTML-TOKEN-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', apiBase: `http://127.0.0.1:${s.address().port}` });
  const r = await tg.sendMessage(1, 'ошибка <stdin> &amp; всё');
  assert.equal(r.message_id, 3);
  assert.equal(calls.at(-1).parse_mode, undefined);
  s.close();
});

test('a tick during a long clip send does not create a second delivery (partner gets the video once)', async () => {
  const w = await ready();
  let release; const gate = new Promise((r) => { release = r; });
  const orig = w.tg.sendVideo.bind(w.tg);
  w.tg.sendVideo = async (...a) => { await gate; return orig(...a); };
  await w.partner.video(); w.clock.advance(100_000);
  const building = w.bot.tick(); // starts the build and the delivery (the delivery is stuck on sendVideo)
  await building;
  await new Promise((r) => setTimeout(r, 30)); // the build has started, the video is still "being sent"
  const quick = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('тик завис: идёт вторая выдача')), 1500))]);
  await quick(w.bot.tick()); await quick(w.bot.tick()); // ticks during a long send must not wait for it or duplicate it
  release(); await w.idle();
  assert.equal(w.partner.videos().length, 1);
  assert.equal(w.partner.texts().filter((t) => /^Готово!/.test(t)).length, 1);
});

test('partner blocked the bot (403): retries stop, owner is told once', async () => {
  const w = await ready();
  w.tg.sendMessage = async (chat, text, opts) => {
    if (chat === 222 && /Готово!/.test(text)) throw new Error('Telegram sendMessage: Forbidden: bot was blocked by the user 403');
    return w.tg.constructor.prototype.sendMessage.call(w.tg, chat, text, opts);
  };
  await w.partner.video(); await w.afterQuiet();
  assert.equal(w.store.data.posts[0].status, 'stuck');
  const n = w.owner.texts().filter((t) => /Не могу отправить напарнице готовый ролик/.test(t)).length;
  await w.bot.tick(); await w.bot.tick(); await w.idle();
  assert.equal(w.owner.texts().filter((t) => /Не могу отправить напарнице готовый ролик/.test(t)).length, n);
  assert.equal(n, 1);
});

test('"not published yet" does not mark the clip as published', async () => {
  const w = await ready();
  await w.partner.video(); await w.afterQuiet();
  await w.partner.say('пока не выложила, вечером');
  assert.match(w.partner.last(), /жду/i);
  assert.deepEqual(w.store.data.posts[0].posted, {});
  await w.partner.say('выложила');
  assert.equal(w.store.data.posts[0].status, 'posted');
});

test('week results catch up if the laptop was off on Sunday', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-23', '10:00')); // Monday after Sunday 22.11
  assert.match(w.partner.last(), /Итоги недели/);
  const n = w.partner.texts().length;
  await w.at(at('2026-11-23', '12:00'));
  assert.equal(w.partner.texts().length, n, 'does not repeat');
  await w.at(at('2026-11-27', '10:00')); // Friday — too late to catch up
  assert.equal(w.partner.texts().length, n);
});

test('time zone is picked up without restart (config is read every time)', async () => {
  const w = makeWorld({ config: { tzOffsetHours: 7 } });
  await w.register(); await w.partner.press('Поняла');
  await w.at('2026-11-15T12:00:00Z'); // 19:00 at UTC+7 — still early
  assert.doesNotMatch(w.partner.last(), /Задание на сегодня/);
  w.config.tzOffsetHours = 8; // the laptop changed its time zone: now 20:00
  await w.at('2026-11-15T12:00:30Z');
  assert.match(w.partner.last(), /Задание на сегодня/);
});

test('broken state.json is restored from the last good copy: partner stays connected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-rec-'));
  const p = join(dir, 'state.json');
  const s1 = createStore(p);
  s1.data.partnerId = 222; s1.data.ownerId = 111; s1.save(); s1.data.x = 2; s1.save();
  writeFileSync(p, '{"v":1,"partnerId"'); // truncated write
  const s2 = createStore(p);
  assert.equal(s2.data.partnerId, 222);
  assert.equal(s2.data.ownerId, 111);
  assert.ok(existsSync(`${p}.corrupt`));
  assert.ok(JSON.parse(readFileSync(p, 'utf8')).partnerId === 222, 'after restoring the file is whole again');
});

test('repeat of a postponed task — a short reminder, not the whole card', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:30')); await w.partner.press('Потом');
  await w.at(at('2026-11-16', '19:30'));
  const t = w.partner.last();
  assert.match(t, /Вчерашнее задание остаётся: как Пип просыпается/);
  assert.ok(t.length < 200);
  assert.deepEqual(w.partner.labels(), ['Снимаю', 'Потом', 'Он спит', 'Не поняла задание']);
});

test('post: explanations for the partner — one file for all platforms, copy the caption; in the task "phone upright"', async () => {
  const w = await ready();
  assert.match(w.partner.all(), /Телефон держи стоймя/);
  await w.partner.video(); await w.afterQuiet();
  assert.match(w.partner.all(), /один файл на все четыре площадки/);
  assert.match(w.partner.all(), /скопируй нужную/);
});

test('pause names the date and weekday, not just the day', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:30'));
  await w.partner.say('пауза'); await w.partner.press('На неделю');
  assert.match(w.partner.last(), /до 22 ноября \(воскресенье\)/);
});

test('captions differ across platforms; Instagram has no more than 5 hashtags; every task has a RU+EN intro', () => {
  const pet = { im: 'Пип', ro: 'Пипа', da: 'Пипу', vi: 'Пипа', tv: 'Пипом', en: 'Pip' };
  for (const t of TASKS) {
    const c = buildCaptions({ task: t, pet, n: 0 });
    assert.notEqual(c.yt_ru.caption, c.tiktok.caption, `${t.id}: YouTube and TikTok are not duplicated`);
    assert.notEqual(c.tiktok.caption, c.reels.caption, `${t.id}: TikTok and Reels are not duplicated`);
    assert.notEqual(c.yt_ru.comment, c.tiktok.comment);
    assert.ok(c.reels.hashtags.length <= 5, `${t.id}: ${c.reels.hashtags.length}`);
    assert.ok(t.hook?.ru && t.hook?.en, `${t.id}: intro`);
    assert.ok(t.hook.ru.length <= 18, `${t.id}: intro is short`);
    assert.ok(t.pitch, `${t.id}: description in the card`);
  }
});

test('quality check catches loudness off −14 LUFS and a "dead" hook', () => {
  const ok = { duration: 14, width: 1080, height: 1920, hasAudio: true, firstFrameLuma: 80, blackRatio: 0, loudness: -14.3, hookMotion: 3 };
  assert.deepEqual(qualityIssues(ok), []);
  assert.ok(qualityIssues({ ...ok, loudness: -23 }).some((i) => /громкость/.test(i)));
  assert.ok(qualityIssues({ ...ok, hookMotion: 0.02 }).some((i) => /первые 1,5 с/.test(i)));
});

test('stats screenshot goes to the owner (the promise "passed to the owner" is kept)', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  const before = w.tg.to(111).filter((r) => r.kind === 'photo').length;
  await w.partner.photo('shot1');
  assert.equal(w.tg.to(111).filter((r) => r.kind === 'photo').length, before + 1);
  assert.match(w.partner.last(), /передала Саше/);
});

test('numbers from text: "YouTube EN 12 3410" is not joined into 123410; "3 410" is read as 3410', async () => {
  const { parseStatsText } = await import('../src/stats.js');
  assert.equal(parseStatsText('YouTube EN 3 410 +21')[0].views, 3410);
  assert.equal(parseStatsText('YouTube EN 12 3410')[0].views, 12);
  assert.equal(parseStatsText('TikTok 5200')[0].views, 5200);
});

test('"not lethargic" does not stop tasks', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.partner.say('Пип сегодня не вялый, бодрый');
  assert.doesNotMatch(w.partner.last(), /Тогда не снимаем/);
  assert.equal(w.store.data.partner.pausedUntil, null);
});

test('results from manual numbers do not promise "best clip" and do not show the "by clips" button', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at('2026-11-21T10:00:00+07:00'); // Saturday: the figures were sent in advance
  await w.partner.say('YouTube EN 3410 +21\nTikTok 5200 +34');
  await w.at('2026-11-22T19:00:00+07:00');
  assert.match(w.partner.last(), /YouTube EN/);
  assert.doesNotMatch(w.partner.last(), /Лучший ролик/);
  assert.ok(!w.partner.labels().includes('Покажи по роликам'));
});

test('/code for the owner gives a t.me link if the bot name is known; the introduction says why the partner needs the video and numbers', async () => {
  const w = makeWorld({ config: { botUsername: 'possum_test_bot' } });
  await w.register();
  await w.owner.say('/код');
  assert.match(w.owner.last(), /https:\/\/t\.me\/possum_test_bot\?start=s-/);
  assert.match(w.partner.texts()[0], /только для этого проекта/);
});

test('numbers sent on Monday after the results belong to the past week, not the new one', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at('2026-11-22T19:00:00+07:00'); // week 47 totals
  await w.at('2026-11-23T09:00:00+07:00');
  await w.partner.say('TikTok 5200 +34');
  assert.equal(w.store.data.stats.at(-1).week, '2026-W47');
});
