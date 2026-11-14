// Приёмочный тест: путь «напарница» по раскладкам docs/layouts (экраны hello, task, receive, post, warn, week, scenario, stats, pause).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, fakeMontage, PARTNER, OWNER } from './helpers.js';
import { seedLongHistory } from './seed.js';

const FORBIDDEN = [/нельзя/i, /ветеринар/i, /обогрев/i, /шоколад/i, /скрипт/i, /exception/i, /undefined/, /\[object/];
function assertClean(world) {
  for (const r of world.tg.to(PARTNER)) {
    const t = String(r.text ?? '').replace(/<[^>]+>/g, '');
    for (const re of FORBIDDEN) assert.ok(!re.test(t), `напарнице нельзя показывать ${re}: «${t.slice(0, 80)}»`);
  }
}
const DAY1 = '2026-11-15';
const at = (date, hm) => `${date}T${hm}:00+07:00`;

test('день 1: знакомство только по коду, правила одной строкой, кнопка «Поняла»', async () => {
  const w = makeWorld();
  await w.stranger.say('/start');
  assert.match(w.stranger.last(), /закрыт/i);
  await w.stranger.say('/start чужой-код');
  assert.match(w.stranger.last(), /закрыт/i);
  assert.equal(w.tg.to(PARTNER).length, 0);

  await w.register();
  const t = w.partner.texts();
  assert.match(t[0], /Привет! Я помощник Саши/);
  assert.match(t[0], /скрепк/i, 'сказано, как прислать видео');
  assert.match(t[0], /выкладываешь ты/);
  assert.match(t[1], /не жарко/);
  assert.ok(t[1].length < 160, 'правила — одна короткая строка');
  assert.deepEqual(w.partner.labels(), ['Поняла']);
  assert.match(w.owner.last(), /напарница|Напарница/, 'Саша получает подтверждение, что напарница подключилась');

  await w.partner.press('Поняла');
  assert.match(w.partner.last(), /Первое задание пришлю вечером/);
  assertClean(w);
});

test('день 1: до 19:30 задания нет, в 19:30 — «Проснулся» с четырьмя кнопками; повторный тик не дублирует', async () => {
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
  assert.equal(w.partner.texts().length, n, 'второй тик в тот же день ничего не шлёт');
  assertClean(w);
});

test('приём съёмки → готовый пост по всем площадкам → отметка «выложила» → итоговая благодарность', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.press('Снимаю');
  assert.match(w.partner.last(), /Жду ролик/);

  await w.partner.video({ uid: 'a1' });
  assert.match(w.partner.last(), /Получила! Смотрю, что можно собрать\. Обычно это занимает час или меньше/);
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 0, 'монтаж ждёт окно тишины (вдруг пришлют ещё кусочки)');
  await w.afterQuiet();
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 1);

  const vids = w.partner.videos();
  assert.equal(vids.length, 1, 'ролик отправлен');
  const post = w.partner.all();
  assert.match(post, /Готово!/);
  assert.match(post, /Для YouTube RU/); assert.match(post, /Для YouTube EN/);
  assert.match(post, /Для TikTok/); assert.match(post, /Для Instagram Reels/);
  assert.match(post, /#сахарныйпоссум/); assert.match(post, /#sugarglider/);
  assert.match(post, /Первый комментарий/);
  assert.match(post, /Сам я ничего не публикую/);
  assert.deepEqual(w.partner.labels(), ['Всё хорошо', 'Поменять текст']);
  assert.match(w.owner.all(), /Ролик готов/, 'Саша знает, что ролик готов');

  await w.partner.press('Всё хорошо');
  assert.match(w.partner.last(), /Где выложила/);
  assert.deepEqual(w.partner.labels().sort(), ['Instagram Reels', 'TikTok', 'YouTube EN', 'YouTube RU', 'Выложила везде'].sort());
  await w.partner.press('YouTube RU'); await w.partner.press('YouTube EN');
  assert.doesNotMatch(w.partner.last(), /Когда пришлёшь скриншот/, 'пока не все — рано благодарить');
  await w.partner.press('TikTok'); await w.partner.press('Instagram Reels');
  assert.match(w.partner.last(), /Спасибо! Когда пришлёшь скриншот статистики, расскажу, как пошло\./);
  assert.equal(w.store.data.posts[0].status, 'posted');
  assertClean(w);
});

test('«Поменять текст»: напарница присылает свою подпись — бот оставляет её как есть', async () => {
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

test('неделя 1: пять заданий идут по плану, «Потом» переносит на завтра', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  const titles = ['просыпается', 'вкусный кусочек', 'идёт к тебе', 'ночная жизнь', 'большая вещь рядом'];
  let day = 15; // 15 ноября 2026
  const date = () => `2026-11-${String(day).padStart(2, '0')}`;
  for (let i = 0; i < 5; i++) {
    await w.at(at(date(), '19:30'));
    assert.match(w.partner.last(), new RegExp(titles[i]), `задание ${i + 1}`);
    if (i === 1) {
      await w.partner.press('Потом');
      assert.match(w.partner.last(), /Перенесла на завтра/);
      day++;
      await w.at(at(date(), '19:30'));
      assert.match(w.partner.last(), /вкусный кусочек/, 'перенесённое задание приходит снова');
    }
    await w.partner.press('Снимаю'); await w.partner.video({ uid: `d${i}` }); await w.afterQuiet();
    await w.partner.press('Всё хорошо'); await w.partner.press('Выложила везде');
    assertClean(w);
    day++;
  }
});

test('молчание: одно мягкое напоминание в день, после двух без ответа бот замолкает', async () => {
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
  assert.equal(w.partner.texts().length, n, 'не пишем, пока она не ответит');
  await w.partner.say('привет');
  await w.at(at('2026-11-19', '19:30'));
  assert.match(w.partner.last(), /Задание на сегодня/, 'после её сообщения задания возвращаются');
});

test('«Не поняла задание»: бот объясняет проще и отмечает Саше, не давит', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.press('Не поняла задание');
  assert.match(w.partner.last(), /Попробую проще/);
  assert.match(w.owner.last(), /не поняла задание/i);
  assert.equal(w.store.data.partner.taskHistory.at(-1)?.clarified ?? w.store.data.partner.task.clarified, true);
});

test('«Он спит»: бот не торопит', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.press('Он спит');
  assert.match(w.partner.last(), /Не будим/);
});

test('пауза без вины: «пауза» → срок → тишина → «вернулась»', async () => {
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
  assert.equal(w.partner.texts().length, n, 'на паузе — ни заданий, ни напоминаний');
  await w.partner.say('вернулась');
  assert.match(w.partner.last(), /С возвращением/);
  await w.at(at('2026-11-21', '19:30'));
  assert.match(w.partner.last(), /Задание на сегодня/);
});

test('если «вялый или не ест»: напарница пишет — бот снимает задание и замолкает до её слова', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30'));
  await w.partner.say('Пип вялый и не ест');
  assert.match(w.partner.last(), /Тогда не снимаем/);
  assert.match(w.owner.last(), /вялый|не ест/i, 'Саша узнаёт');
  const n = w.partner.texts().length;
  await w.at(at('2026-11-16', '19:30'));
  assert.equal(w.partner.texts().length, n);
});

test('итоги недели: воскресенье 19:00, «Выложено: N из 5», просьба о скриншоте, разбор цифр из текста', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю'); await w.partner.video(); await w.afterQuiet();
  await w.partner.press('Всё хорошо'); await w.partner.press('Выложила везде');
  await w.at(at('2026-11-22', '19:00'));
  const t = w.partner.last();
  assert.match(t, /Итоги недели с Пипом/);
  assert.match(t, /Выложено: 1 из 5/);
  assert.match(t, /скриншот статистики из YouTube Studio/);
  assert.match(t, /Что зашло: пока не знаем/, 'честно: данных мало');
  assert.deepEqual(w.partner.labels(), ['Пришлю скриншот', 'Позже', 'Хочу реже']);
  assert.doesNotMatch(t, /молодец/, 'похвала без данных убрана');

  await w.partner.press('Пришлю скриншот');
  await w.partner.photo();
  assert.match(w.partner.last(), /Скриншот сохранила/);
  await w.partner.say('YouTube EN 3410 +21\nYouTube RU 1870 +9\nTikTok 5200 +34\nInstagram 960 +4');
  assert.match(w.partner.last(), /Записала/);
  assert.equal(w.store.data.stats.length, 4);
  assert.equal(w.store.data.stats.find((s) => s.platform === 'tiktok').views, 5200);
  await w.partner.press('Хочу реже').catch(() => {});
});

test('«Хочу реже»: бот переходит на лёгкий режим', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at('2026-11-22T19:00:00+07:00');
  await w.partner.press('Хочу реже');
  assert.match(w.partner.last(), /буду присылать реже/);
  assert.equal(w.store.data.partner.cadence, 'light');
});

test('несколько кусочков подряд собираются в один ролик', async () => {
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

test('слишком тёмная съёмка: одно мягкое предупреждение и выбор, решает она', async () => {
  const w = makeWorld({ montage: fakeMontage({ probeResult: { duration: 12, width: 1080, height: 1920, luma: 18, hasAudio: true } }) });
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю');
  await w.partner.video(); await w.afterQuiet();
  assert.match(w.partner.last(), /Зверька почти не видно: слишком темно/);
  assert.match(w.partner.last(), /лампу сбоку, не в глаза/);
  assert.deepEqual(w.partner.labels(), ['Собери этот ролик', 'Сниму заново']);
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 0, 'без её слова не собираем');
  await w.partner.press('Собери этот ролик');
  await w.idle();
  assert.equal(w.partner.videos().length, 1);
  assertClean(w);
});

test('слишком яркий кадр: предупреждение про свет, ролик всё равно соберём', async () => {
  const w = makeWorld({ montage: fakeMontage({ probeResult: { duration: 12, width: 1080, height: 1920, luma: 232, hasAudio: true } }) });
  await w.register(); await w.partner.press('Поняла');
  await w.at(at(DAY1, '19:30')); await w.partner.press('Снимаю');
  await w.partner.video(); await w.afterQuiet();
  assert.match(w.partner.last(), /Свет в кадре яркий/);
  assert.match(w.partner.last(), /решение за тобой/);
  await w.partner.press('Собери этот ролик'); await w.idle();
  assert.equal(w.partner.videos().length, 1);
});

test('день 100: вместо фиксированного плана — три карточки; выбор, «Другие», «Своя идея», «Сегодня пропускаю»', async () => {
  const w = makeWorld({ start: '2027-02-22T09:00:00+07:00' });
  await w.register();
  seedLongHistory(w, 99);
  await w.at('2027-02-22T19:30:00+07:00');
  const t = w.partner.last();
  assert.match(t, /Что снимем сегодня\? Выбирай\./);
  assert.equal((t.match(/^\d\. /gm) ?? []).length, 3, 'три карточки');
  assert.deepEqual(w.partner.labels(), ['Беру 1', 'Беру 2', 'Беру 3', 'Другие', 'Своя идея', 'Сегодня пропускаю']);
  const lastUsed = w.store.data.partner.taskHistory.at(-1).id;
  assert.doesNotMatch(t, new RegExp(w.bot.taskTitle(lastUsed)), 'то, что снимали вчера, не предлагаем (охлаждение)');

  await w.partner.press('Другие');
  assert.match(w.partner.last(), /Что снимем сегодня\?/);
  await w.partner.press('Беру 2');
  assert.match(w.partner.texts().at(-2), /Принято: «/);
  assert.match(w.partner.last(), /Задание на сегодня/);
  await w.partner.press('Беру 2').catch(() => {});
  assertClean(w);
});

test('день 100: «Своя идея» и «Сегодня пропускаю» без объяснений', async () => {
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

test('день 100 (когда будут цифры по роликам, автодоступ): таблица по каналам и вывод по данным', async () => {
  const w = makeWorld({ start: '2027-02-22T09:00:00+07:00' });
  await w.register(); seedLongHistory(w, 99);
  await w.at('2027-02-28T19:00:00+07:00');
  const t = w.partner.last();
  assert.match(t, /Итоги недели/);
  for (const p of ['YouTube EN', 'YouTube RU', 'TikTok', 'Instagram']) assert.match(t, new RegExp(p));
  assert.match(t, /Лучший ролик/);
  assert.doesNotMatch(t, /пока не знаем/, 'на сотом ролике «пока не знаем» — отписка');
  assert.match(t, /Что общего|лучше всего/);
  assert.doesNotMatch(t, /скриншот/i, 'пока автодоступа нет — просим цифры; но таблица уже есть: не просим повторно то, что есть');
});

test('Саша: /status показывает связь с напарницей, неделю и что ждёт; сообщения напарницы целиком не пересылаются', async () => {
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

test('пока напарница не подключена, задания никому не уходят; чужой не получает ничего', async () => {
  const w = makeWorld();
  await w.at(at(DAY1, '19:30'));
  assert.equal(w.tg.log.length, 0);
  await w.stranger.say('привет');
  assert.equal(w.tg.to(OWNER).length, 0);
});

test('итоги недели не приходят новичку в первое воскресенье', async () => {
  const w = makeWorld(); // 15 ноября 2026 — воскресенье, день 1
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:00'));
  assert.doesNotMatch(w.partner.all(), /Итоги недели/);
  await w.at(at('2026-11-15', '19:30'));
  assert.match(w.partner.last(), /Задание на сегодня/);
});
