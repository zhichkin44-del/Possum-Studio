// Startup with the "old" bot: webhook, 409, command menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prepareBot, createPoller, CONFLICT_HELP, OWNER_COMMANDS } from '../src/poller.js';
import { createTelegram } from '../src/telegram.js';
import { makeWorld } from './helpers.js';

test('startup: webhook is reset dropping old messages, default menu is cleared, owner gets their own', async () => {
  const calls = []; const logs = [];
  const store = { data: {}, save() {} };
  const tg = { deleteWebhook: async (o) => calls.push(['deleteWebhook', o]), setMyCommands: async (c, o) => calls.push(['setMyCommands', c, o]) };
  await prepareBot({ tg, log: (m) => logs.push(m), ownerId: 111, store });
  assert.deepEqual(calls[0], ['deleteWebhook', { dropPending: true }]);
  assert.deepEqual(calls[1], ['setMyCommands', [], undefined]);
  assert.deepEqual(calls[2], ['setMyCommands', OWNER_COMMANDS, { chatId: 111 }]);
});

test('a failed webhook or menu reset does not crash startup, it goes to the log', async () => {
  const logs = [];
  const tg = { deleteWebhook: async () => { throw new Error('нет сети'); }, setMyCommands: async () => { throw new Error('нет сети'); } };
  await prepareBot({ tg, log: (m) => logs.push(m), ownerId: null });
  assert.ok(logs.some((l) => /webhook/i.test(l) && /нет сети/.test(l)));
  assert.ok(logs.some((l) => /menu/i.test(l)));
});

test('a 409 response in the polling loop: clear log line, retry, no crash or exit; then messages are processed', async () => {
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
  assert.equal(resets.length, 1, 'webhook is removed once per 409 series, not on every retry');
  assert.equal(handled, 1);
  assert.equal(w.store.data.offset, 51);
});

test('pause between retries on 409 grows and does not exceed a minute', async () => {
  const w = makeWorld(); const waits = []; let n = 0;
  const tg = { async getUpdates() { n++; if (n > 9) { poller.stop(); return []; } throw new Error('409'); } };
  const poller = createPoller({ tg, bot: { handleUpdate: async () => {} }, store: w.store, log: () => {}, sleep: async (ms) => waits.push(ms) });
  await poller.run();
  assert.deepEqual(waits.slice(0, 4), [1000, 2000, 4000, 8000]);
  assert.ok(Math.max(...waits) <= 60_000);
});

test('real client: deleteWebhook sends drop_pending_updates, setMyCommands — chat scope', async () => {
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

test('owner registers — the command menu is set for them at once', async () => {
  const w = makeWorld();
  await w.register();
  assert.equal(w.tg.menus.length, 1);
  assert.equal(w.tg.menus[0].chatId, 111);
  assert.equal(w.tg.menus[0].commands[0].command, 'status');
});

test('second and later starts do NOT drop messages: partner videos that arrived while the bot was off are kept', async () => {
  const calls = []; const store = { data: {}, save() {} };
  const tg = { deleteWebhook: async (o) => calls.push(o), setMyCommands: async () => {} };
  await prepareBot({ tg, log: () => {}, store });
  await prepareBot({ tg, log: () => {}, store });
  assert.deepEqual(calls, [{ dropPending: true }, { dropPending: false }]);
});

test('if the webhook reset failed, the flag is not set: the next start tries again with dropping', async () => {
  const store = { data: {}, save() {} };
  await prepareBot({ tg: { deleteWebhook: async () => { throw new Error('нет сети'); }, setMyCommands: async () => {} }, log: () => {}, store });
  assert.equal(store.data.webhookCleared, undefined);
});

test('the 409 response code from the real client reaches the polling loop (not lost when the error is wrapped)', async () => {
  const s = http.createServer((req, res) => { res.statusCode = 409; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' })); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const tg = createTelegram({ token: '123456:CODE-TOKEN-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', apiBase: `http://127.0.0.1:${s.address().port}` });
  await assert.rejects(() => tg.getUpdates(0, 1), (e) => e.code === 409);
  s.close();
});

test('after a new successful poll the 409 counter resets, and the webhook is removed again in the next series', async () => {
  const w = makeWorld(); let n = 0; const resets = [];
  const seq = ['409', 'ok', '409', 'stop'];
  const tg = { async getUpdates() { const k = seq[n++]; if (k === '409') throw new Error('409'); if (k === 'stop') { poller.stop(); } return []; } };
  const poller = createPoller({ tg, bot: { handleUpdate: async () => {} }, store: w.store, log: () => {}, sleep: async () => {}, tg409Reset: async () => resets.push(1) });
  await poller.run();
  assert.equal(resets.length, 2);
});
