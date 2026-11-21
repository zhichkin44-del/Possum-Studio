// A real Telegram client against a local fake Bot API server (no internet).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelegram } from '../src/telegram.js';

const TOKEN = '123456:TEST-TOKEN-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

function server(handler) {
  return new Promise((resolve) => {
    const calls = [];
    const s = http.createServer(async (req, res) => {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString('utf8');
      calls.push({ url: req.url, body });
      handler(req, res, body, calls);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, calls, base: `http://127.0.0.1:${s.address().port}` }));
  });
}

test('sendMessage: HTML, buttons become inline_keyboard; response is parsed', async () => {
  const { s, calls, base } = await server((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result: { message_id: 7 } })); });
  const tg = createTelegram({ token: TOKEN, apiBase: base });
  const r = await tg.sendMessage(5, '<b>Привет</b>', { buttons: [[{ text: 'Да', data: 'a:yes' }]] });
  assert.equal(r.message_id, 7);
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.parse_mode, 'HTML');
  assert.deepEqual(sent.reply_markup, { inline_keyboard: [[{ text: 'Да', callback_data: 'a:yes' }]] });
  s.close();
});

test('Telegram error contains no token, even if it is in the error URL', async () => {
  const { s, base } = await server((req, res) => { res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, error_code: 401, description: `Unauthorized ${TOKEN}` })); });
  const tg = createTelegram({ token: TOKEN, apiBase: base });
  await assert.rejects(() => tg.getMe(), (e) => { assert.ok(!e.message.includes(TOKEN), e.message); return true; });
  s.close();
});

test('network unavailable: clear error without token', async () => {
  const tg = createTelegram({ token: TOKEN, apiBase: 'http://127.0.0.1:1' });
  await assert.rejects(() => tg.getMe(), (e) => !e.message.includes(TOKEN));
});

test('download: getFile → file is saved in full', async () => {
  const payload = Buffer.alloc(300_000, 7);
  const { s, base } = await server((req, res) => {
    if (req.url.includes('/getFile')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true, result: { file_path: 'videos/file_1.mp4' } })); }
    if (req.url.includes('/file/bot')) { res.setHeader('content-type', 'video/mp4'); return res.end(payload); }
    res.statusCode = 404; res.end('{}');
  });
  const tg = createTelegram({ token: TOKEN, apiBase: base });
  const dest = join(mkdtempSync(join(tmpdir(), 'possum-dl-')), 'a', 'clip.mp4');
  await tg.download('FILEID', dest);
  assert.equal(readFileSync(dest).length, payload.length);
  s.close();
});

test('sendVideo uploads the file via multipart', async () => {
  const { s, calls, base } = await server((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result: { message_id: 9 } })); });
  const tg = createTelegram({ token: TOKEN, apiBase: base });
  const f = join(mkdtempSync(join(tmpdir(), 'possum-up-')), 'v.mp4'); writeFileSync(f, Buffer.alloc(50_000, 1));
  const r = await tg.sendVideo(5, f, {});
  assert.equal(r.message_id, 9);
  assert.match(calls[0].body, /name="video"/);
  s.close();
});

test('without a token the client is not created', () => {
  assert.throws(() => createTelegram({ token: '' }), /No bot token/);
});
