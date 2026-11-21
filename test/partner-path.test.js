// Acceptance test: the user path through the bot screen layouts (screens hello, task, receive, post, warn, week, scenario, stats, pause).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, fakeMontage, PARTNER, OWNER } from './helpers.js';
import { seedLongHistory } from './seed.js';

const FORBIDDEN = [/нельзя/i, /ветеринар/i, /обогрев/i, /шоколад/i, /скрипт/i, /exception/i, /undefined/, /\[object/];
function assertClean(world) {
  for (const r of world.tg.to(PARTNER)) {
    const t = String(r.text ?? '').replace(/<[^>]+>/g, '');
    for (const re of FORBIDDEN) assert.ok(!re.test(t), `partner must not be shown ${re}: "${t.slice(0, 80)}"`);
  }
}
const DAY1 = '2026-11-15';
const at = (date, hm) => `${date}T${hm}:00+07:00`;

test('day 1: introduction only by code, rules in one line, "Got it" button', async () => {
  const w = makeWorld();
  await w.stranger.say('/start');
  assert.match(w.stranger.last(), /закрыт/i);
  await w.stranger.say('/start чужой-код');
  assert.match(w.stranger.last(), /закрыт/i);
  assert.equal(w.tg.to(PARTNER).length, 0);

  await w.register();
  const t = w.partner.texts();
  assert.match(t[0], /Привет! Я помощник Саши/);
  assert.match(t[0], /скрепк/i, 'it is said how to send a video');
  assert.match(t[0], /выкладываешь ты/);
  assert.match(t[1], /не жарко/);
  assert.ok(t[1].length < 160, 'rules are one short line');
  assert.deepEqual(w.partner.labels(), ['Поняла']);
  assert.match(w.owner.last(), /напарница|Напарница/, 'owner gets confirmation that the partner connected');

  await w.partner.press('Поняла');
  assert.match(w.partner.last(), /Первое задание пришлю вечером/);
  assertClean(w);
});

test('day 1: no task before 19:30, at 19:30 — "Woke up" with four buttons; a repeated tick does not duplicate', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  const before = w.partner.texts().length;
  await w.at(at(DAY1, '12:00'));
  assert.equal(w.partner.texts().length, before);
  await w.at(at(DAY1, '19:30'));
  assert.match(w.partner.last(), /Задание на сегодня: как Пип просыпается/);
  assert.match(w.partner.last(), /Сколько:/);
  assert.match(w.partner.last(), /Пришли как есть\. Не обрезай и не улучшай\./);
  assert.deepEqual(w.partner.labels(), ['Снимаю', 'Потом', 'Он спит', 'Не поняла задание']);
  const n = w.partner.texts().length;
  await w.at(at(DAY1, '19:31'));
  assert.equal(w.partner.texts().length, n, 'a second tick on the same day sends nothing');
  assertClean(w);
});

test('shoot intake → finished post for all platforms → "published" mark → final thank-you', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.press('Снимаю');
  assert.match(w.partner.last(), /Жду ролик/);

  await w.partner.video({ uid: 'a1' });
  assert.match(w.partner.last(), /Получила! Смотрю, что можно собрать\. Обычно это занимает час или меньше/);
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 0, 'editing waits for a quiet window (in case more pieces arrive)');
  await w.afterQuiet();
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 1);

  const vids = w.partner.videos();
  assert.equal(vids.length, 1, 'clip sent');
  const post = w.partner.all();
  assert.match(post, /Готово!/);
  assert.match(post, /Для YouTube RU/); assert.match(post, /Для YouTube EN/);
  assert.match(post, /Для TikTok/); assert.match(post, /Для Instagram Reels/);
  assert.match(post, /#сахарныйпоссум/); assert.match(post, /#sugarglider/);
  assert.match(post, /Первый комментарий/);
  assert.match(post, /Сам я ничего не публикую/);
  assert.deepEqual(w.partner.labels(), ['Всё хорошо', 'Поменять текст']);
  assert.match(w.owner.all(), /Ролик готов/, 'owner knows the clip is ready');

  await w.partner.press('Всё хорошо');
  assert.match(w.partner.last(), /Где выложила/);
  assert.deepEqual(w.partner.labels().sort(), ['Instagram Reels', 'TikTok', 'YouTube EN', 'YouTube RU', 'Выложила везде'].sort());
  await w.partner.press('YouTube RU'); await w.partner.press('YouTube EN');
  assert.doesNotMatch(w.partner.last(), /Когда пришлёшь скриншот/, 'not all done yet — too early to thank');
  await w.partner.press('TikTok'); await w.partner.press('Instagram Reels');
  assert.match(w.partner.last(), /Спасибо! Когда пришлёшь скриншот статистики, расскажу, как пошло\./);
  assert.equal(w.store.data.posts[0].status, 'posted');
  assertClean(w);
});

test('"Change text": partner sends their own caption — the bot keeps it as is', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю');
  await w.partner.video(); await w.afterQuiet();
  await w.partner.press('Поменять текст');
  assert.match(w.partner.last(), /Пришли подпись/);
  await w.partner.say('Пип проснулся и недоволен');
  assert.match(w.partner.last(), /Пип проснулся и недоволен/);
  assert.match(w.partner.last(), /Оставляю как есть/);
  assert.deepEqual(w.partner.labels(), ['Всё хорошо', 'Поменять текст']);
});

test('week 1: five tasks go per plan, "Later" moves to tomorrow', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  const titles = ['просыпается', 'вкусный кусочек', 'идёт к тебе', 'ночная жизнь', 'большая вещь рядом'];
  let day = 15; // 15 November 2026
  const date = () => `2026-11-${String(day).padStart(2, '0')}`;
  for (let i = 0; i < 5; i++) {
    await w.at(at(date(), '19:30'));
    assert.match(w.partner.last(), new RegExp(titles[i]), `task ${i + 1}`);
    if (i === 1) {
      await w.partner.press('Потом');
      assert.match(w.partner.last(), /Перенесла на завтра/);
      day++;
      await w.at(at(date(), '19:30'));
      assert.match(w.partner.last(), /вкусный кусочек/, 'the postponed task comes again');
    }
    await w.partner.press('Снимаю'); await w.partner.video({ uid: `d${i}` }); await w.afterQuiet();
    await w.partner.press('Всё хорошо'); await w.partner.press('Выложила везде');
    assertClean(w);
    day++;
  }
});

test('silence: one soft reminder a day, after two unanswered the bot goes quiet', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:30'));
  await w.at(at('2026-11-15', '21:30'));
  assert.match(w.partner.last(), /Как дела с Пипом\? Если сегодня не получилось — ничего страшного/);
  await w.at(at('2026-11-16', '21:30'));
  assert.match(w.partner.last(), /Если сегодня не хочется снимать — это нормально/);
  assert.doesNotMatch(w.partner.all(), /Давно тебя не слышала/);
  const n = w.partner.texts().length;
  await w.at(at('2026-11-17', '19:30')); await w.at(at('2026-11-17', '21:30'));
  await w.at(at('2026-11-18', '19:30')); await w.at(at('2026-11-18', '21:30'));
  assert.equal(w.partner.texts().length, n, 'we do not write until the partner replies');
  await w.partner.say('привет');
  await w.at(at('2026-11-19', '19:30'));
  assert.match(w.partner.last(), /Задание на сегодня/, 'after the partner writes, the tasks return');
});

test('"Did not understand the task": the bot explains more simply and notes it to the owner, does not push', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.press('Не поняла задание');
  assert.match(w.partner.last(), /Попробую проще/);
  assert.match(w.owner.last(), /не поняла задание/i);
  assert.equal(w.store.data.partner.taskHistory.at(-1)?.clarified ?? w.store.data.partner.task.clarified, true);
});

test('"He is asleep": the bot does not rush', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.press('Он спит');
  assert.match(w.partner.last(), /Не будим/);
});

test('pause without guilt: "pause" → deadline → silence → "back"', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.say('пауза');
  assert.match(w.partner.last(), /На сколько\?/);
  assert.deepEqual(w.partner.labels(), ['До завтра', 'На неделю', 'Пока не напишу']);
  await w.partner.press('На неделю');
  assert.match(w.partner.last(), /Отдыхай\. Задания не шлю до/);
  const n = w.partner.texts().length;
  for (const d of ['2026-11-16', '2026-11-17', '2026-11-20']) { await w.at(at(d, '19:30')); await w.at(at(d, '21:30')); }
  assert.equal(w.partner.texts().length, n, 'on pause — no tasks, no reminders');
  await w.partner.say('вернулась');
  assert.match(w.partner.last(), /С возвращением/);
  await w.at(at('2026-11-21', '19:30'));
  assert.match(w.partner.last(), /Задание на сегодня/);
});

test('if "lethargic or not eating": partner writes — the bot removes the task and goes quiet until the partner writes back', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.say('Пип вялый и не ест');
  assert.match(w.partner.last(), /Тогда не снимаем/);
  assert.match(w.owner.last(), /вялый|не ест/i, 'owner finds out');
  const n = w.partner.texts().length;
  await w.at(at('2026-11-16', '19:30'));
  assert.equal(w.partner.texts().length, n);
});

test('week results: Sunday 19:00, "Published: N of 5", screenshot request, parsing numbers from text', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю'); await w.partner.video(); await w.afterQuiet();
  await w.partner.press('Всё хорошо'); await w.partner.press('Выложила везде');
  await w.at(at('2026-11-22', '19:00'));
  const t = w.partner.last();
  assert.match(t, /Итоги недели с Пипом/);
  assert.match(t, /Выложено: 1 из 5/);
  assert.match(t, /скриншот статистики из YouTube Studio/);
  assert.match(t, /Что зашло: пока не знаем/, 'honestly: little data');
  assert.deepEqual(w.partner.labels(), ['Пришлю скриншот', 'Позже', 'Хочу реже']);
  assert.doesNotMatch(t, /молодец/, 'praise without data is removed');

  await w.partner.press('Пришлю скриншот');
  await w.partner.photo();
  assert.match(w.partner.last(), /Скриншот сохранила/);
  await w.partner.say('YouTube EN 3410 +21\nYouTube RU 1870 +9\nTikTok 5200 +34\nInstagram 960 +4');
  assert.match(w.partner.last(), /Записала/);
  assert.equal(w.store.data.stats.length, 4);
  assert.equal(w.store.data.stats.find((s) => s.platform === 'tiktok').views, 5200);
  await w.partner.press('Хочу реже').catch(() => {});
});

test('"Less often please": the bot switches to light mode', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at('2026-11-22T19:00:00+07:00');
  await w.partner.press('Хочу реже');
  assert.match(w.partner.last(), /буду присылать реже/);
  assert.equal(w.store.data.partner.cadence, 'light');
});

test('several pieces in a row are assembled into one clip', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю');
  await w.partner.video({ uid: 'k1' }); await w.partner.video({ uid: 'k2' }); await w.partner.video({ uid: 'k3' });
  assert.match(w.partner.all(), /Получила несколько кусочков\. Из них соберу один ролик\./);
  await w.afterQuiet();
  const b = w.montage.calls.filter((c) => c[0] === 'build');
  assert.equal(b.length, 1);
  assert.equal(b[0][1], 3);
  assert.equal(w.partner.videos().length, 1);
});

test('too dark footage: one soft warning and a choice, partner decides', async () => {
  const w = makeWorld({ montage: fakeMontage({ probeResult: { duration: 12, width: 1080, height: 1920, luma: 18, hasAudio: true } }) });
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю');
  await w.partner.video(); await w.afterQuiet();
  assert.match(w.partner.last(), /Зверька почти не видно: слишком темно/);
  assert.match(w.partner.last(), /лампу сбоку, не в глаза/);
  assert.deepEqual(w.partner.labels(), ['Собери этот ролик', 'Сниму заново']);
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 0, 'we do not assemble without the partner saying so');
  await w.partner.press('Собери этот ролик');
  await w.idle();
  assert.equal(w.partner.videos().length, 1);
  assertClean(w);
});

test('too bright frame: warning about light, the clip is still assembled', async () => {
  const w = makeWorld({ montage: fakeMontage({ probeResult: { duration: 12, width: 1080, height: 1920, luma: 232, hasAudio: true } }) });
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю');
  await w.partner.video(); await w.afterQuiet();
  assert.match(w.partner.last(), /Свет в кадре яркий/);
  assert.match(w.partner.last(), /решение за тобой/);
  await w.partner.press('Собери этот ролик'); await w.idle();
  assert.equal(w.partner.videos().length, 1);
});

test('day 100: instead of a fixed plan — three cards; choice, "Others", "Own idea", "Skipping today"', async () => {
  const w = makeWorld({ start: '2027-02-22T09:00:00+07:00' });
  await w.register();
  seedLongHistory(w, 99);
  await w.at('2027-02-22T19:30:00+07:00');
  const t = w.partner.last();
  assert.match(t, /Что снимем сегодня\? Выбирай\./);
  assert.equal((t.match(/^\d\. /gm) ?? []).length, 3, 'three cards');
  assert.deepEqual(w.partner.labels(), ['Беру 1', 'Беру 2', 'Беру 3', 'Другие', 'Своя идея', 'Сегодня пропускаю']);
  const lastUsed = w.store.data.partner.taskHistory.at(-1).id;
  assert.doesNotMatch(t, new RegExp(w.bot.taskTitle(lastUsed)), 'what was shot yesterday is not offered (cooling off)');

  await w.partner.press('Другие');
  assert.match(w.partner.last(), /Что снимем сегодня\?/);
  await w.partner.press('Беру 2');
  assert.match(w.partner.texts().at(-2), /Принято: «/);
  assert.match(w.partner.last(), /Задание на сегодня/);
  await w.partner.press('Беру 2').catch(() => {});
  assertClean(w);
});

test('day 100: "Own idea" and "Skipping today" without explanations', async () => {
  const w = makeWorld({ start: '2027-02-22T09:00:00+07:00' });
  await w.register(); seedLongHistory(w, 99);
  await w.at('2027-02-22T19:30:00+07:00');
  await w.partner.press('Своя идея');
  assert.match(w.partner.last(), /Напиши, что хочешь снять/);
  await w.partner.say('Пип на новогодней гирлянде');
  assert.match(w.partner.last(), /Записала/);
  assert.deepEqual(w.store.data.partner.ideas.map((i) => i.text), ['Пип на новогодней гирлянде']);

  await w.at('2027-02-23T19:30:00+07:00');
  await w.partner.press('Сегодня пропускаю');
  assert.match(w.partner.last(), /Хорошо/);
  assert.doesNotMatch(w.partner.last(), /почему|объясн/i);
  assert.equal(w.store.data.partner.taskHistory.at(-1).status, 'skipped');
});

test('day 100 (when clip numbers are available, auto-access): table by channel and conclusion from data', async () => {
  const w = makeWorld({ start: '2027-02-22T09:00:00+07:00' });
  await w.register(); seedLongHistory(w, 99);
  await w.at('2027-02-28T19:00:00+07:00');
  const t = w.partner.last();
  assert.match(t, /Итоги недели/);
  for (const p of ['YouTube EN', 'YouTube RU', 'TikTok', 'Instagram']) assert.match(t, new RegExp(p));
  assert.match(t, /Лучший ролик/);
  assert.doesNotMatch(t, /пока не знаем/, 'on the hundredth clip "we do not know yet" is a brush-off');
  assert.match(t, /Что общего|лучше всего/);
  assert.doesNotMatch(t, /скриншот/i, 'while there is no auto-access we ask for numbers; but the table already exists: we do not ask again for what is there');
});

test('owner: /status shows the link with the partner, the week and what is pending; partner messages are not forwarded in full', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю');
  await w.partner.say('секретное сообщение напарницы');
  await w.owner.say('/status');
  const s = w.owner.last();
  assert.match(s, /Напарница на связи/);
  assert.match(s, /Задание дня/);
  assert.match(s, /Неделя: 0 из 5/);
  assert.doesNotMatch(w.owner.all(), /секретное сообщение напарницы/);
});

test('while the partner is not connected, tasks go to nobody; a stranger gets nothing', async () => {
  const w = makeWorld();
  await w.at(at(DAY1, '19:30'));
  assert.equal(w.tg.log.length, 0);
  await w.stranger.say('привет');
  assert.equal(w.tg.to(OWNER).length, 0);
});

test('week results do not reach a newcomer on the first Sunday', async () => {
  const w = makeWorld(); // 15 November 2026 — Sunday, day 1
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:00'));
  assert.doesNotMatch(w.partner.all(), /Итоги недели/);
  await w.at(at('2026-11-15', '19:30'));
  assert.match(w.partner.last(), /Задание на сегодня/);
});
