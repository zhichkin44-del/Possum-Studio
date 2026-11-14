// Запуск бота локально: npm start. Токен — из data/.token (его пишет scripts/set-token.mjs) или из TELEGRAM_BOT_TOKEN. Токен не печатается.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBot } from './bot.js';
import { createStore } from './store.js';
import { createTelegram } from './telegram.js';
import { createMontage } from './montage.js';
import { apiSource } from './stats.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.POSSUM_DATA_DIR ?? join(root, 'data');
const tokenFile = join(dataDir, '.token');
const token = process.env.TELEGRAM_BOT_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
if (!token) { console.error('Нет токена. Сначала: npm run set-token (инструкция: docs/BOTFATHER.md)'); process.exit(1); }

const userCfg = existsSync(join(dataDir, 'config.json')) ? JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8')) : {};
const config = {
  dataDir,
  tzOffsetHours: Number(process.env.POSSUM_TZ ?? -new Date().getTimezoneOffset() / 60),
  taskTime: '19:30', nudgeTime: '21:30', weeklyTime: '19:00', weeklyDay: 0, quietMs: 90_000, retryDelayMs: 1500,
  maxDownloadBytes: 20 * 1024 * 1024,
  pet: { im: 'Пип', ro: 'Пипа', da: 'Пипу', vi: 'Пипа', tv: 'Пипом', en: 'Pip' },
  ...userCfg,
};

const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const tg = createTelegram({ token });
const store = createStore(join(dataDir, 'state.json'));
const montage = createMontage();
if (!montage.ffmpeg) { console.error('Не найден ffmpeg. Установи FFmpeg (winget install Gyan.FFmpeg) или задай переменную FFMPEG.'); process.exit(1); }
const statsSource = apiSource();
const bot = createBot({ tg, store, montage, clock: { now: () => new Date() }, config, log, statsSource });

const me = await tg.getMe().catch((e) => { console.error(`Telegram не отвечает или токен неверный: ${e.message}`); process.exit(1); });
log(`Бот @${me.username} запущен. Данные: ${dataDir}. Часовой пояс: UTC${config.tzOffsetHours >= 0 ? '+' : ''}${config.tzOffsetHours}.`);
const inv = bot.invites();
config.botUsername = me.username;
log(`Имя героя в текстах: «${config.pet.im}» (менять — data/config.json, ключ pet; решение по имени за Сашей).`);
if (!store.data.ownerId) log(`Саша, открой ссылку и нажми «Запустить»:  https://t.me/${me.username}?start=${inv.owner}`);
if (!store.data.partnerId) log(`Напарнице — после её согласия — ссылка:  https://t.me/${me.username}?start=${inv.partner}   (она же у Саши по команде /код)`);
if (!statsSource.connected) log('Статистика каналов: автодоступ не подключён, работаю по цифрам от напарницы.');

let stopping = false;
const ticker = setInterval(() => { bot.tick().catch((e) => log(`tick: ${e.message}`)); }, 30_000);
bot.tick().catch(() => {});

async function poll() {
  let delay = 1000;
  while (!stopping) {
    try {
      const updates = await tg.getUpdates(store.data.offset, 30);
      delay = 1000;
      for (const u of updates) {
        await bot.handleUpdate(u);
        store.data.offset = u.update_id + 1; store.save();
      }
    } catch (e) {
      if (/Conflict|409/.test(e.message)) { console.error('Бот уже запущен в другом окне (Telegram разрешает один опрос). Закрой второй экземпляр.'); process.exit(1); }
      log(`опрос: ${e.message}; повтор через ${Math.round(delay / 1000)} с`);
      await new Promise((r) => setTimeout(r, delay)); delay = Math.min(delay * 2, 60_000);
    }
  }
}
process.on('SIGINT', async () => { stopping = true; clearInterval(ticker); log('Останавливаюсь…'); await bot.idle(); store.save(); process.exit(0); });
await poll();
