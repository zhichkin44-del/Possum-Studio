// Тестовый мир: поддельный Telegram, поддельный монтаж, поддельные часы, «напарница» и «Саша» как пользователи.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBot } from '../src/bot.js';
import { createStore } from '../src/store.js';

export const OWNER = 111;
export const PARTNER = 222;
export const STRANGER = 333;

export const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export class FakeTelegram {
  constructor() {
    this.log = []; // {chat, kind, text, buttons, path, id}
    this.nextId = 1;
    this.downloadFails = 0;
    this.sendFails = 0;
    this.answered = [];
    this.files = new Map(); // file_id -> {size}
    this.menus = []; this.webhookCalls = [];
  }
  async setMyCommands(commands, opts = {}) { this.menus.push({ commands, chatId: opts.chatId ?? null }); }
  async deleteWebhook(opts = {}) { this.webhookCalls.push(opts); }
  _push(rec) {
    if (this.sendFails > 0) { this.sendFails--; throw new Error('network down'); }
    rec.id = this.nextId++;
    this.log.push(rec);
    return { message_id: rec.id };
  }
  async sendMessage(chat, text, opts = {}) { return this._push({ chat, kind: 'text', text, buttons: opts.buttons ?? null }); }
  async sendVideo(chat, path, opts = {}) { return this._push({ chat, kind: 'video', path, text: opts.caption ?? '' }); }
  async sendPhoto(chat, path, opts = {}) { return this._push({ chat, kind: 'photo', path, text: opts.caption ?? '' }); }
  async answerCallback(id) { this.answered.push(id); }
  async editButtons(chat, messageId, buttons) {
    const m = this.log.find((r) => r.id === messageId && r.chat === chat);
    if (m) m.buttons = buttons;
  }
  async download(fileId, dest) {
    if (this.downloadFails > 0) { this.downloadFails--; throw new Error('download failed'); }
    writeFileSync(dest, `fake-video:${fileId}`);
    return dest;
  }
  // что видит пользователь
  to(chat) { return this.log.filter((r) => r.chat === chat); }
}

export function fakeMontage(over = {}) {
  const m = {
    calls: [],
    probeResult: { duration: 14, width: 1080, height: 1920, luma: 110, hasAudio: true },
    buildFails: false,
    async probe(path) { m.calls.push(['probe', path]); return typeof m.probeResult === 'function' ? m.probeResult(path) : m.probeResult; },
    async build({ clips, title, outDir }) {
      m.calls.push(['build', clips.length, title]);
      if (m.buildFails) throw new Error('ffmpeg exploded');
      return {
        video: join(outDir, 'final_1080p_vertical.mp4'), cover: join(outDir, 'cover.jpg'), proof: join(outDir, 'proof.jpg'),
        duration: 14, width: 1080, height: 1920, hasAudio: true, firstFrameLuma: 90, blackRatio: 0,
      };
    },
    ...over,
  };
  return m;
}

export function makeClock(startIso) {
  const c = { t: new Date(startIso), now() { return new Date(this.t.getTime()); }, set(iso) { this.t = new Date(iso); }, advance(ms) { this.t = new Date(this.t.getTime() + ms); } };
  return c;
}

export function makeWorld(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'possum-'));
  const clock = makeClock(opts.start ?? '2026-11-15T09:00:00+07:00');
  const tg = new FakeTelegram();
  const store = createStore(join(dir, 'state.json'));
  const montage = opts.montage ?? fakeMontage();
  const config = {
    dataDir: dir, tzOffsetHours: 7, taskTime: '19:30', nudgeTime: '21:30', weeklyTime: '19:00', weeklyDay: 0,
    quietMs: 90_000, maxDownloadBytes: 20 * 1024 * 1024, pet: { im: 'Пип', ro: 'Пипа', da: 'Пипу', vi: 'Пипа', tv: 'Пипом', en: 'Pip' },
    ...(opts.config ?? {}),
  };
  const bot = createBot({ tg, store, montage, clock, config, log: () => {}, studio: opts.studio ?? null });
  let updateId = 1000;

  const user = (id, name) => {
    const u = {
      id,
      async say(text) { await bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id }, from: { id }, text } }); },
      async video({ size = 5_000_000, duration = 14, uid = `v${updateId}`, fileName } = {}) {
        await bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id }, from: { id }, video: { file_id: `f-${uid}`, file_unique_id: uid, file_size: size, duration, file_name: fileName } } });
      },
      async photo(uid = `p${updateId}`) {
        await bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id }, from: { id }, photo: [{ file_id: `f-${uid}`, file_unique_id: uid, file_size: 90_000 }] } });
      },
      async press(label) {
        const msgs = tg.to(id).filter((r) => r.buttons);
        for (let i = msgs.length - 1; i >= 0; i--) {
          const flat = msgs[i].buttons.flat();
          const b = flat.find((x) => strip(x.text) === label);
          if (b) {
            await bot.handleUpdate({ update_id: updateId++, callback_query: { id: `cb${updateId}`, from: { id }, message: { message_id: msgs[i].id, chat: { id } }, data: b.data } });
            return;
          }
        }
        throw new Error(`нет кнопки «${label}»; есть: ${msgs.map((m) => m.buttons.flat().map((x) => x.text).join('|')).join(' // ')}`);
      },
      texts() { return tg.to(id).filter((r) => r.kind === 'text').map((r) => strip(r.text)); },
      last() { const t = u.texts(); return t[t.length - 1] ?? ''; },
      all() { return u.texts().join('\n---\n'); },
      labels() { const m = tg.to(id).filter((r) => r.buttons); return m.length ? m[m.length - 1].buttons.flat().map((x) => strip(x.text)) : []; },
      videos() { return tg.to(id).filter((r) => r.kind === 'video'); },
    };
    return u;
  };
  const partner = user(PARTNER, 'partner');
  const owner = user(OWNER, 'owner');
  const stranger = user(STRANGER, 'stranger');

  const world = {
    dir, clock, tg, store, montage, bot, config, partner, owner, stranger,
    async register() {
      const inv = bot.invites();
      await owner.say(`/start ${inv.owner}`);
      await partner.say(`/start ${inv.partner}`);
    },
    async at(iso) { clock.set(iso); await bot.tick(); await bot.idle(); },
    async idle() { await bot.idle(); },
    async afterQuiet() { clock.advance(config.quietMs + 1000); await bot.tick(); await bot.idle(); },
  };
  return world;
}
