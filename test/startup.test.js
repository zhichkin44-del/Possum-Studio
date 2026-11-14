// Запуск со «старым» ботом: вебхук, 409, меню команд.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prepareBot, createPoller, CONFLICT_HELP, OWNER_COMMANDS } from '../src/poller.js';
import { createTelegram } from '../src/telegram.js';
import { makeWorld } from './helpers.js';

test('старт: вебхук сбрасывается с отбрасыванием старых сообщений, меню по умолчанию очищается, у Саши — своё', async () => {
  const calls = []; const logs = [];
  const store = { data: {}, save() {} };
  const tg = { deleteWebhook: async (o) => calls.push(['deleteWebhook', o]), setMyCommands: async (c, o) => calls.push(['setMyCommands', c, o]) };
  await prepareBot({ tg, log: (m) => logs.push(m), ownerId: 111, store });
  assert.deepEqual(calls[0], ['deleteWebhook', { dropPending: true }]);
  assert.deepEqual(calls[1], ['setMyCommands', [], undefined]);
  assert.deepEqual(calls[2], ['setMyCommands', OWNER_COMMANDS, { chatId: 111 }]);
});

test('сбой сброса вебхука или меню не роняет запуск, а попадает в лог', async () => {
  const logs = [];
  const tg = { deleteWebhook: async () => { throw new Error('нет сети'); }, setMyCommands: async () => { throw new Error('нет сети'); } };
  await prepareBot({ tg, log: (m) => logs.push(m), ownerId: null });
  assert.ok(logs.some((l) => /вебхук/i.test(l) && /нет сети/.test(l)));
  assert.ok(logs.some((l) => /меню/i.test(l)));
});

test('ответ 409 в цикле опроса: понятная строка в лог, повтор, без падения и выхода; потом сообщения обрабатываются', async () => {
  const w = makeWorld();
  const logs = []; let n = 0; let handled = 0; const resets = [];
  const tg = {
    async getUpdates() {
      n++;
      if (n <= 3) throw new Error('Telegram getUpdates: Conflict: terminated by other getUpdates request (409)');
      if (n === 4) return [{ update_id: 50, message: { message_id: 1, chat: { id: 333 }, from: { id: 333 }, text: 'привет' } }];
      poller.stop(); return [];
    },
  };
  const bot = { handleUpdate: async () => { handled++; } };
  const poller = createPoller({ tg, bot, store: w.store, log: (m) => logs.push(m), sleep: async () => {}, tg409Reset: async () => resets.push(1) });
  await poller.run();
  assert.equal(logs.filter((l) => l.includes(CONFLICT_HELP)).length, 3);
  assert.equal(resets.length, 1, 'вебхук снимаем один раз за серию 409, а не на каждом повторе');
  assert.equal(handled, 1);
  assert.equal(w.store.data.offset, 51);
});

test('пауза между повторами при 409 растёт и не превышает минуты', async () => {
  const w = makeWorld(); const waits = []; let n = 0;
  const tg = { async getUpdates() { n++; if (n > 9) { poller.stop(); return []; } throw new Error('409'); } };
  const poller = createPoller({ tg, bot: { handleUpdate: async () => {} }, store: w.store, log: () => {}, sleep: async (ms) => waits.push(ms) });
  await poller.run();
  assert.deepEqual(waits.slice(0, 4), [1000, 2000, 4000, 8000]);
  assert.ok(Math.max(...waits) <= 60_000);
});

test('настоящий клиент: deleteWebhook шлёт drop_pending_updates, setMyCommands — scope чата', async () => {
  const calls = [];
  const s = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result: true }));
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const tg = createTelegram({ token: '123456:START-TOKEN-ABCDEFGHIJKLMNOPQRSTUVWXYZ012', apiBase: `http://127.0.0.1:${s.address().port}` });
  await tg.deleteWebhook({ dropPending: true });
  await tg.setMyCommands([]);
  await tg.setMyCommands(OWNER_COMMANDS, { chatId: 111 });
  assert.match(calls[0].url, /deleteWebhook$/); assert.equal(calls[0].body.drop_pending_updates, true);
  assert.deepEqual(calls[1].body, { commands: [] });
  assert.deepEqual(calls[2].body.scope, { type: 'chat', chat_id: 111 });
  assert.equal(calls[2].body.commands[0].command, 'status');
  s.close();
});

test('Саша регистрируется — ему сразу ставится меню команд', async () => {
  const w = makeWorld();
  await w.register();
  assert.equal(w.tg.menus.length, 1);
  assert.equal(w.tg.menus[0].chatId, 111);
  assert.equal(w.tg.menus[0].commands[0].command, 'status');
});

test('второй и следующие запуски НЕ отбрасывают сообщения: видео напарницы, пришедшие пока бот был выключен, сохраняются', async () => {
  const calls = []; const store = { data: {}, save() {} };
  const tg = { deleteWebhook: async (o) => calls.push(o), setMyCommands: async () => {} };
  await prepareBot({ tg, log: () => {}, store });
  await prepareBot({ tg, log: () => {}, store });
  assert.deepEqual(calls, [{ dropPending: true }, { dropPending: false }]);
});

test('если сброс вебхука не удался, флаг не ставится: следующий запуск попробует снова с отбрасыванием', async () => {
  const store = { data: {}, save() {} };
  await prepareBot({ tg: { deleteWebhook: async () => { throw new Error('нет сети'); }, setMyCommands: async () => {} }, log: () => {}, store });
  assert.equal(store.data.webhookCleared, undefined);
});

test('код ответа 409 из настоящего клиента доходит до цикла опроса (не теряется при обёртке ошибки)', async () => {
  const s = http.createServer((req, res) => { res.statusCode = 409; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' })); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const tg = createTelegram({ token: '123456:CODE-TOKEN-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', apiBase: `http://127.0.0.1:${s.address().port}` });
  await assert.rejects(() => tg.getUpdates(0, 1), (e) => e.code === 409);
  s.close();
});

test('после нового успешного опроса счётчик 409 обнуляется, и вебхук снимается снова при следующей серии', async () => {
  const w = makeWorld(); let n = 0; const resets = [];
  const seq = ['409', 'ok', '409', 'stop'];
  const tg = { async getUpdates() { const k = seq[n++]; if (k === '409') throw new Error('409'); if (k === 'stop') { poller.stop(); } return []; } };
  const poller = createPoller({ tg, bot: { handleUpdate: async () => {} }, store: w.store, log: () => {}, sleep: async () => {}, tg409Reset: async () => resets.push(1) });
  await poller.run();
  assert.equal(resets.length, 2);
});
