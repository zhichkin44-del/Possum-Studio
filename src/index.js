// Run the bot locally: npm start. Token comes from data/.token (written by scripts/set-token.mjs) or from TELEGRAM_BOT_TOKEN. The token is never printed.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBot } from './bot.js';
import { createStore } from './store.js';
import { createTelegram } from './telegram.js';
import { createMontage } from './montage.js';
import { apiSource } from './stats.js';
import { prepareBot, createPoller } from './poller.js';
import { createStudio } from '../core/studio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.POSSUM_DATA_DIR ?? join(root, 'data');
const tokenFile = join(dataDir, '.token');
const token = process.env.TELEGRAM_BOT_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
if (!token) { console.error('No token. First run: npm run set-token (get a token from @BotFather, see README)'); process.exit(1); }

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
if (!montage.ffmpeg) { console.error('ffmpeg not found. Install FFmpeg (winget install Gyan.FFmpeg) or set the FFMPEG variable.'); process.exit(1); }
const statsSource = apiSource();
// Studio core: video from the owner → three edits + advice → publishing by his button. Keys live in the owner's settings, not here.
let studio = null;
try { studio = createStudio({ dataRoot: join(dataDir, 'studio'), log }); }
catch (e) { log(`Studio unavailable (editing for the owner is off): ${e.message}`); }
const bot = createBot({ tg, store, montage, clock: { now: () => new Date() }, config, log, statsSource, studio });

const me = await tg.getMe().catch((e) => { console.error(`Telegram is not responding or the token is invalid: ${e.message}`); process.exit(1); });
log(`Bot @${me.username} started. Data: ${dataDir}. Time zone: UTC${config.tzOffsetHours >= 0 ? '+' : ''}${config.tzOffsetHours}.`);
const inv = bot.invites();
config.botUsername = me.username;
log(`Pet name in texts: «${config.pet.im}» (change in data/config.json, key pet; the decision about the name is the owner's).`);
if (!store.data.ownerId) log(`The owner, open the link and press "Start":  https://t.me/${me.username}?start=${inv.owner}`);
if (!store.data.partnerId) log(`For the partner, after she agrees, the link is:  https://t.me/${me.username}?start=${inv.partner}   (The owner also gets it via the /код command)`);
if (!statsSource.connected) log('Channel statistics: auto-access not connected, working from the partner’s figures.');

const poller = createPoller({ tg, bot, store, log, tg409Reset: () => tg.deleteWebhook({ dropPending: false }) });
await prepareBot({ tg, log, ownerId: store.data.ownerId, store });
const ticker = setInterval(() => { bot.tick().catch((e) => log(`tick: ${e.message}`)); }, 30_000);
bot.tick().catch(() => {});

process.on('SIGINT', async () => { poller.stop(); clearInterval(ticker); log('Stopping…'); await bot.idle(); store.save(); process.exit(0); });
await poller.run();
