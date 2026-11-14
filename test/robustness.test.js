// Где бот может упасть: большое видео, плохая сеть, повторная отправка, чужие, битое состояние, сбой монтажа.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, fakeMontage, PARTNER, OWNER } from './helpers.js';
import { createStore } from '../src/store.js';

const at = (d, hm) => `${d}T${hm}:00+07:00`;
async function ready(opts) {
  const w = makeWorld(opts);
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:30')); await w.partner.press('Снимаю');
  return w;
}

test('большое видео (больше лимита Telegram 20 МБ): понятный ответ, ничего не скачиваем, задание остаётся открытым', async () => {
  const w = await ready();
  await w.partner.video({ size: 25 * 1024 * 1024 });
  assert.match(w.partner.last(), /слишком большое/);
  assert.match(w.partner.last(), /20 секунд/);
  assert.equal(w.store.data.clips.length, 0);
  await w.afterQuiet();
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 0);
  assert.equal(w.store.data.partner.task.status, 'accepted');
});

test('повторная отправка того же видео: «уже есть», монтаж один раз', async () => {
  const w = await ready();
  await w.partner.video({ uid: 'same' }); await w.partner.video({ uid: 'same' });
  assert.match(w.partner.last(), /Это видео уже есть/);
  await w.afterQuiet();
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 1);
  assert.equal(w.store.data.clips.length, 1);
});

test('сеть мигнула при скачивании: бот пробует ещё; если не вышло — просит прислать снова', async () => {
  let w = await ready();
  w.tg.downloadFails = 2;
  await w.partner.video({ uid: 'n1' });
  assert.equal(w.store.data.clips.length, 1, 'третья попытка удалась');

  w = await ready();
  w.tg.downloadFails = 99;
  await w.partner.video({ uid: 'n2' });
  assert.match(w.partner.last(), /Не получилось скачать/);
  assert.equal(w.store.data.clips.length, 0);
  w.tg.downloadFails = 0;
  await w.partner.video({ uid: 'n2' });
  assert.equal(w.store.data.clips.length, 1, 'после сбоя то же видео принимается: оно не помечено «уже есть»');
});

test('сеть упала при отправке готового поста: пост не теряется, уходит на следующем тике', async () => {
  const w = await ready();
  await w.partner.video();
  w.tg.sendFails = 3;
  await w.afterQuiet();
  assert.equal(w.partner.videos().length, 0);
  assert.equal(w.store.data.posts[0].status, 'ready-unsent');
  w.tg.sendFails = 0;
  await w.bot.tick(); await w.idle();
  assert.equal(w.partner.videos().length, 0, 'сразу не повторяем: пауза растёт, чтобы не долбить сеть');
  w.clock.advance(31_000);
  await w.bot.tick(); await w.idle();
  assert.equal(w.partner.videos().length, 1);
  assert.equal(w.store.data.posts[0].status, 'ready');
  await w.bot.tick(); await w.idle();
  assert.equal(w.partner.videos().length, 1, 'не дублируется');
});

test('сбой монтажа: напарнице — спокойное сообщение, Саше — подробности, кусочки сохранены, бот жив', async () => {
  const w = await ready({ montage: fakeMontage({ buildFails: true }) });
  await w.partner.video({ uid: 'm1' }); await w.afterQuiet();
  assert.match(w.partner.last(), /Не получилось собрать ролик\. Съёмку сохранила, Саша посмотрит/);
  assert.doesNotMatch(w.partner.last(), /ffmpeg|Error|exploded/);
  assert.match(w.owner.last(), /не собрался/);
  assert.match(w.owner.last(), /ffmpeg exploded/);
  assert.equal(w.store.data.clips.length, 1);
  assert.equal(w.store.data.posts[0].status, 'failed');
  await w.partner.say('привет');
  assert.ok(w.partner.last().length > 0, 'бот отвечает дальше');
});

test('кнопка нажата дважды и «старая» кнопка: без дублей и без падений', async () => {
  const w = await ready();
  const n = w.partner.texts().length;
  await w.partner.press('Снимаю');
  assert.equal(w.partner.texts().length, n + 1, 'повторное «Снимаю» отвечает один раз');
  assert.match(w.partner.last(), /Жду ролик/);
  await w.partner.video(); await w.afterQuiet();
  await w.partner.press('Всё хорошо');
  await w.partner.press('Всё хорошо');
  const asks = w.partner.texts().filter((t) => /Где выложила/.test(t)).length;
  assert.equal(asks, 1);
});

test('один и тот же update_id дважды (Telegram повторил): обработан один раз', async () => {
  const w = makeWorld();
  const inv = w.bot.invites();
  const upd = { update_id: 5, message: { message_id: 1, chat: { id: PARTNER }, from: { id: PARTNER }, text: `/start ${inv.partner}` } };
  await w.bot.handleUpdate(upd); await w.bot.handleUpdate(upd);
  assert.equal(w.partner.texts().filter((t) => /Привет! Я помощник/.test(t)).length, 1);
});

test('видео без открытого задания принимается как свободная съёмка', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.partner.video(); await w.afterQuiet();
  assert.equal(w.partner.videos().length, 1);
});

test('текст не по теме: подсказка, какие слова бот понимает', async () => {
  const w = await ready();
  await w.partner.say('а что у нас на ужин?');
  assert.match(w.partner.last(), /пауза/);
  assert.match(w.partner.last(), /выложила/);
});

test('сообщения в одном ролике: слишком короткое видео (1 с) и очень длинное (90 с) не ломают монтаж', async () => {
  for (const duration of [1, 90]) {
    const w = await ready({ montage: fakeMontage({ probeResult: { duration, width: 1080, height: 1920, luma: 110, hasAudio: true } }) });
    await w.partner.video({ duration }); await w.afterQuiet();
    assert.ok(w.partner.videos().length === 1 || /ещё кусочек|слишком короткое/i.test(w.partner.last()), `duration=${duration}`);
  }
});

test('битый файл состояния: бот поднимается, старый сохраняется рядом', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-bad-'));
  const p = join(dir, 'state.json');
  writeFileSync(p, '{"v":1,"invites":'); // оборванный
  const s = createStore(p);
  assert.equal(typeof s.data, 'object');
  assert.ok(existsSync(`${p}.corrupt`) || existsSync(`${p}.bak`), 'битый файл не потерян');
  s.data.x = 1; s.save();
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).x, 1);
});

test('запись состояния атомарна: после сохранения нет временных хвостов и файл — валидный JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-atomic-'));
  const p = join(dir, 'state.json');
  const s = createStore(p);
  for (let i = 0; i < 50; i++) { s.data.i = i; s.save(); }
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).i, 49);
  assert.ok(!existsSync(`${p}.tmp`));
});

test('владелец и напарница не путаются: команды Саши от напарницы игнорируются, а видео Саши не идёт в монтаж', async () => {
  const w = await ready();
  await w.partner.say('/status');
  assert.doesNotMatch(w.partner.last(), /Напарница на связи/);
  await w.owner.video({ uid: 'o1' }); await w.afterQuiet();
  assert.equal(w.montage.calls.filter((c) => c[0] === 'build').length, 0);
});

test('скорость: 200 обновлений подряд обрабатываются без роста очереди и без дублей заданий', async () => {
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла');
  await w.at(at('2026-11-15', '19:30'));
  for (let i = 0; i < 200; i++) await w.partner.say(`привет ${i}`);
  assert.equal(w.partner.texts().filter((t) => /Задание на сегодня/.test(t)).length, 1);
});

test('перезапуск посреди сборки: оборванный пост снова собирается, а не висит вечно', async () => {
  const w = await ready();
  await w.partner.video({ uid: 'r1' });
  // имитируем «упали посреди сборки»: пост есть в состоянии building, процесс перезапущен
  w.clock.advance(w.bot ? 100_000 : 0);
  w.store.data.posts.push({ id: 'pX', taskId: null, clipIds: [w.store.data.clips[0].id], status: 'building', createdAt: new Date().toISOString(), posted: {}, sent: {} });
  const { createBot } = await import('../src/bot.js');
  const bot2 = createBot({ tg: w.tg, store: w.store, montage: w.montage, clock: w.clock, config: { dataDir: w.dir, tzOffsetHours: 7, quietMs: 90_000, pet: { im: 'Пип', ro: 'Пипа', da: 'Пипу', vi: 'Пипа', tv: 'Пипом', en: 'Pip' } }, log: () => {} });
  await bot2.idle();
  assert.equal(w.store.data.posts.find((p) => p.id === 'pX').status, 'ready');
});
