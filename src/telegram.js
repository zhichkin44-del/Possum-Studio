// Thin Telegram Bot API client on fetch, no dependencies. The token lives only in a closure: it is never logged and never ends up in errors.
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';

const redact = (s, token) => String(s).split(token).join('***');

export function createTelegram({ token, fetchImpl = fetch, apiBase = 'https://api.telegram.org' }) {
  if (!token) throw new Error('No bot token. Run: npm run set-token');
  const url = (m) => `${apiBase}/bot${token}/${m}`;

  async function call(method, params = {}, { timeoutMs = 40_000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: ctrl.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        const err = new Error(`Telegram ${method}: ${body.description ?? res.status}`);
        err.code = body.error_code ?? res.status; err.retryAfter = body.parameters?.retry_after;
        throw err;
      }
      return body.result;
    } catch (e) {
      const out = new Error(redact(e.message, token));
      out.code = e.code; out.retryAfter = e.retryAfter; // keep the response code (e.g. 409)
      throw out;
    } finally { clearTimeout(timer); }
  }

  const keyboard = (buttons) => (buttons ? { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } : undefined);

  async function upload(method, field, path, params, timeoutMs = 120_000) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    form.append(field, await openAsBlob(path), basename(path));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url(method), { method: 'POST', body: form, signal: ctrl.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(`Telegram ${method}: ${body.description ?? res.status}`);
      return body.result;
    } catch (e) { throw new Error(redact(e.message, token)); } finally { clearTimeout(timer); }
  }

  return {
    getMe: () => call('getMe'),
    deleteWebhook: ({ dropPending = false } = {}) => call('deleteWebhook', { drop_pending_updates: dropPending }),
    // chatId — the menu only for this chat (The owner's); without it, the default menu. An empty list removes the old menu.
    setMyCommands: (commands, { chatId } = {}) => call('setMyCommands', { commands, ...(chatId ? { scope: { type: 'chat', chat_id: chatId } } : {}) }),
    getUpdates: (offset, timeout = 30) => call('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] }, { timeoutMs: (timeout + 15) * 1000 }),
    async sendMessage(chat, text, opts = {}) {
      try {
        return await call('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard(opts.buttons) });
      } catch (e) {
        // broken markup (e.g. "<" from an error text) must not lose the message
        if (!/can't parse entities|parse/i.test(e.message)) throw e;
        const plain = String(text).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        return call('sendMessage', { chat_id: chat, text: plain, disable_web_page_preview: true, reply_markup: keyboard(opts.buttons) });
      }
    },
    sendVideo: (chat, path, opts = {}) => upload('sendVideo', 'video', path, { chat_id: chat, caption: opts.caption, parse_mode: 'HTML', supports_streaming: true, width: 1080, height: 1920 }),
    sendPhoto: (chat, path, opts = {}) => upload('sendPhoto', 'photo', path, { chat_id: chat, caption: opts.caption, parse_mode: 'HTML' }),
    answerCallback: (id, text) => call('answerCallbackQuery', { callback_query_id: id, text }),
    editButtons: (chat, messageId, buttons) => call('editMessageReplyMarkup', { chat_id: chat, message_id: messageId, reply_markup: keyboard(buttons) ?? { inline_keyboard: [] } }).catch(() => {}),
    async download(fileId, dest, { timeoutMs = 300_000 } = {}) {
      const f = await call('getFile', { file_id: fileId });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${apiBase}/file/bot${token}/${f.file_path}`, { signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`Telegram download: ${res.status}`);
        mkdirSync(dirname(dest), { recursive: true });
        await pipeline(Readable.fromWeb(res.body), createWriteStream(dest), { signal: ctrl.signal });
        return dest;
      } catch (e) {
        throw new Error(redact(ctrl.signal.aborted ? `Telegram download: timeout ${Math.round(timeoutMs / 1000)} s` : e.message, token));
      } finally { clearTimeout(timer); }
    },
  };
}
