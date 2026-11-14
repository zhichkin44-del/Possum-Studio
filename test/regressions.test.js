// Регрессии по находкам «скептика-инженера» и «продюсера» (перепроверены по коду до правки).
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

test('скачивание, которое «зависло» посреди файла, обрывается по таймауту и не вешает бота', async () => {
  const s = http.createServer((req, res) => {
    if (req.url.includes('/getFile')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true, result: { file_path: 'v.mp4' } })); }
    res.setHeader('content-type', 'video/mp4'); res.write(Buffer.alloc(1000)); // и больше ничего: тело не закрывается
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const TOKEN = '123456:HANG-TOKEN-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';
  const tg = createTelegram({ token: TOKEN, apiBase: `http://127.0.0.1:${s.address().port}` });
  const dest = join(mkdtempSync(join(tmpdir(), 'possum-hang-')), 'v.mp4');
  const t0 = Date.now();
  await assert.rejects(() => tg.download('F', dest, { timeoutMs: 400 }), (e) => /таймаут/.test(e.message) && !e.message.includes(TOKEN));
  assert.ok(Date.now() - t0 < 3000);
  s.closeAllConnections?.(); s.close();
});

test('«сломанная» HTML-разметка не теряет сообщение: уходит простым текстом', async () => {
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

test('тик во время долгой отправки ролика не создаёт вторую выдачу (напарница получает видео один раз)', async () => {
  const w = await ready();
  let release; const gate = new Promise((r) => { release = r; });
  const orig = w.tg.sendVideo.bind(w.tg);
  w.tg.sendVideo = async (...a) => { await gate; return orig(...a); };
  await w.partner.video(); w.clock.advance(100_000);
  const building = w.bot.tick(); // запускает сборку и выдачу (выдача застряла на sendVideo)
  await building;
  await new Promise((r) => setTimeout(r, 30)); // сборка пошла, видео ещё «отправляется»
  const quick = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('тик завис: идёт вторая выдача')), 1500))]);
  await quick(w.bot.tick()); await quick(w.bot.tick()); // тики во время долгой отправки не должны ждать её и дублировать
  release(); await w.idle();
  assert.equal(w.partner.videos().length, 1);
  assert.equal(w.partner.texts().filter((t) => /^Готово!/.test(t)).length, 1);
});

test('напарница заблокировала бота (403): повторы останавливаются, Саша узнаёт один раз', async () => {
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

test('«пока не выложила» не помечает ролик опубликованным', async () => {
  const w = await ready();
  await w.partner.video(); await w.afterQuiet();
  await w.partner.say('пока не выложила, вечером');
  assert.match(w.partner.last(), /жду/i);
  assert.deepEqual(w.store.data.posts[0].posted, {});
  await w.partner.say('выложила');
  assert.equal(w.store.data.posts[0].status, 'posted');
});

test('итоги недели догоняются, если ноутбук был выключен в воскресенье', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-23', '10:00')); // понедельник после воскресенья 22.11
  assert.match(w.partner.last(), /Итоги недели/);
  const n = w.partner.texts().length;
  await w.at(at('2026-11-23', '12:00'));
  assert.equal(w.partner.texts().length, n, 'не повторяется');
  await w.at(at('2026-11-27', '10:00')); // пятница — уже поздно догонять
  assert.equal(w.partner.texts().length, n);
});

test('часовой пояс подхватывается без перезапуска (config читается каждый раз)', async () => {
  const w = makeWorld({ config: { tzOffsetHours: 7 } });
  await w.register(); await w.partner.press('Поняла');
  await w.at('2026-11-15T12:00:00Z'); // 19:00 по UTC+7 — ещё рано
  assert.doesNotMatch(w.partner.last(), /Задание на сегодня/);
  w.config.tzOffsetHours = 8; // ноутбук сменил пояс: теперь 20:00
  await w.at('2026-11-15T12:00:30Z');
  assert.match(w.partner.last(), /Задание на сегодня/);
});

test('битый state.json восстанавливается из последней хорошей копии: напарница остаётся подключённой', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-rec-'));
  const p = join(dir, 'state.json');
  const s1 = createStore(p);
  s1.data.partnerId = 222; s1.data.ownerId = 111; s1.save(); s1.data.x = 2; s1.save();
  writeFileSync(p, '{"v":1,"partnerId"'); // оборванная запись
  const s2 = createStore(p);
  assert.equal(s2.data.partnerId, 222);
  assert.equal(s2.data.ownerId, 111);
  assert.ok(existsSync(`${p}.corrupt`));
  assert.ok(JSON.parse(readFileSync(p, 'utf8')).partnerId === 222, 'после восстановления файл снова целый');
});

test('повтор перенесённого задания — короткое напоминание, а не вся карточка', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:30')); await w.partner.press('Потом');
  await w.at(at('2026-11-16', '19:30'));
  const t = w.partner.last();
  assert.match(t, /Вчерашнее задание остаётся: как Пип просыпается/);
  assert.ok(t.length < 200);
  assert.deepEqual(w.partner.labels(), ['Снимаю', 'Потом', 'Он спит', 'Не поняла задание']);
});

test('пост: пояснения для напарницы — один файл на все площадки, подпись копировать; в задании «телефон стоймя»', async () => {
  const w = await ready();
  assert.match(w.partner.all(), /Телефон держи стоймя/);
  await w.partner.video(); await w.afterQuiet();
  assert.match(w.partner.all(), /один файл на все четыре площадки/);
  assert.match(w.partner.all(), /скопируй нужную/);
});

test('пауза называет дату и день недели, а не только день', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:30'));
  await w.partner.say('пауза'); await w.partner.press('На неделю');
  assert.match(w.partner.last(), /до 22 ноября \(воскресенье\)/);
});

test('подписи на площадках разные; в Instagram не больше 5 хештегов; у каждого задания есть заставка RU+EN', () => {
  const pet = { im: 'Пип', ro: 'Пипа', da: 'Пипу', vi: 'Пипа', tv: 'Пипом', en: 'Pip' };
  for (const t of TASKS) {
    const c = buildCaptions({ task: t, pet, n: 0 });
    assert.notEqual(c.yt_ru.caption, c.tiktok.caption, `${t.id}: YouTube и TikTok не дублируются`);
    assert.notEqual(c.tiktok.caption, c.reels.caption, `${t.id}: TikTok и Reels не дублируются`);
    assert.notEqual(c.yt_ru.comment, c.tiktok.comment);
    assert.ok(c.reels.hashtags.length <= 5, `${t.id}: ${c.reels.hashtags.length}`);
    assert.ok(t.hook?.ru && t.hook?.en, `${t.id}: заставка`);
    assert.ok(t.hook.ru.length <= 18, `${t.id}: заставка короткая`);
    assert.ok(t.pitch, `${t.id}: описание в карточке`);
  }
});

test('проверка качества ловит громкость мимо −14 LUFS и «мёртвый» хук', () => {
  const ok = { duration: 14, width: 1080, height: 1920, hasAudio: true, firstFrameLuma: 80, blackRatio: 0, loudness: -14.3, hookMotion: 3 };
  assert.deepEqual(qualityIssues(ok), []);
  assert.ok(qualityIssues({ ...ok, loudness: -23 }).some((i) => /громкость/.test(i)));
  assert.ok(qualityIssues({ ...ok, hookMotion: 0.02 }).some((i) => /первые 1,5 с/.test(i)));
});

test('скриншот статистики уходит Саше (обещание «передала Саше» выполняется)', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  const before = w.tg.to(111).filter((r) => r.kind === 'photo').length;
  await w.partner.photo('shot1');
  assert.equal(w.tg.to(111).filter((r) => r.kind === 'photo').length, before + 1);
  assert.match(w.partner.last(), /передала Саше/);
});

test('цифры из текста: «YouTube EN 12 3410» не склеивается в 123410; «3 410» читается как 3410', async () => {
  const { parseStatsText } = await import('../src/stats.js');
  assert.equal(parseStatsText('YouTube EN 3 410 +21')[0].views, 3410);
  assert.equal(parseStatsText('YouTube EN 12 3410')[0].views, 12);
  assert.equal(parseStatsText('TikTok 5200')[0].views, 5200);
});

test('«не вялый» не останавливает задания', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.partner.say('Пип сегодня не вялый, бодрый');
  assert.doesNotMatch(w.partner.last(), /Тогда не снимаем/);
  assert.equal(w.store.data.partner.pausedUntil, null);
});

test('итоги по ручным цифрам не обещают «лучший ролик» и не показывают кнопку «по роликам»', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at('2026-11-21T10:00:00+07:00'); // суббота: цифры присланы заранее
  await w.partner.say('YouTube EN 3410 +21\nTikTok 5200 +34');
  await w.at('2026-11-22T19:00:00+07:00');
  assert.match(w.partner.last(), /YouTube EN/);
  assert.doesNotMatch(w.partner.last(), /Лучший ролик/);
  assert.ok(!w.partner.labels().includes('Покажи по роликам'));
});

test('/код у Саши даёт ссылку t.me, если известно имя бота; знакомство говорит, зачем ей видео и цифры', async () => {
  const w = makeWorld({ config: { botUsername: 'possum_test_bot' } });
  await w.register();
  await w.owner.say('/код');
  assert.match(w.owner.last(), /https:\/\/t\.me\/possum_test_bot\?start=s-/);
  assert.match(w.partner.texts()[0], /только для этого проекта/);
});

test('цифры, присланные в понедельник после итогов, относятся к прошедшей неделе, а не к новой', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at('2026-11-22T19:00:00+07:00'); // итоги недели 47
  await w.at('2026-11-23T09:00:00+07:00');
  await w.partner.say('TikTok 5200 +34');
  assert.equal(w.store.data.stats.at(-1).week, '2026-W47');
});
