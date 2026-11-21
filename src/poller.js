// Starting and polling Telegram: preparing an old bot (webhook, command menu) and a getUpdates loop that survives 409 and network failures.

export const OWNER_COMMANDS = [
  { command: 'status', description: 'Как дела у напарницы' },
  { command: 'code', description: 'Код и ссылка для напарницы' },
];

/** An old bot may still have a webhook (then getUpdates returns 409) and an old menu: we reset both. A failure is not fatal. */
// Pending messages are discarded only on the FIRST start (they come from the bot's previous life). After that we do not: the partner's videos sent while the laptop was off must not be lost.
export async function prepareBot({ tg, log, ownerId = null, store = null }) {
  const first = !store?.data.webhookCleared;
  try {
    await tg.deleteWebhook({ dropPending: first });
    if (store) { store.data.webhookCleared = true; store.save(); }
    log(first ? 'Webhook reset, old messages from the bot’s previous life discarded (first start).' : 'Webhook removed (if there was one); messages received while the bot was off are kept.');
  } catch (e) { log(`Could not reset the webhook: ${e.message}`); }
  try {
    await tg.setMyCommands([]); // the partner has no command menu: she works with buttons
    if (ownerId) await tg.setMyCommands(OWNER_COMMANDS, { chatId: ownerId });
    log('Command menu updated (old one replaced).');
  } catch (e) { log(`Could not update the command menu: ${e.message}`); }
}

export const CONFLICT_HELP = 'Telegram отвечает 409: у этого бота ещё включён вебхук или он уже запущен в другом окне или на другом компьютере (опрашивать может только один). Закрой второй экземпляр; повторю.';

/** Polling loop. Does not crash: 409 and network errors produce a clear log line and a retry with a growing pause. */
export function createPoller({ tg, bot, store, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tg409Reset }) {
  let stopping = false;
  return {
    stop() { stopping = true; },
    async run() {
      let delay = 1000; let streak = 0; // streak — how many 409s in a row
      while (!stopping) {
        try {
          const updates = await tg.getUpdates(store.data.offset, 30);
          delay = 1000; streak = 0;
          for (const u of updates) {
            await bot.handleUpdate(u);
            store.data.offset = u.update_id + 1; store.save();
          }
        } catch (e) {
          const conflict = e.code === 409 || /Conflict|(?<!\d)409(?!\d)/.test(e.message);
          if (conflict) streak++;
          log(conflict ? `${CONFLICT_HELP} (подряд: ${streak}, пауза ${Math.round(delay / 1000)} с)` : `опрос: ${e.message}; повтор через ${Math.round(delay / 1000)} с`);
          if (conflict && streak === 1 && tg409Reset) { try { await tg409Reset(); } catch { /* ignore */ } } // the webhook is removed once per series: if the cause is a second instance, retries are useless
          await sleep(delay); delay = Math.min(delay * 2, 60_000);
        }
      }
    },
  };
}
