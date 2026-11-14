// Запуск и опрос Telegram: подготовка старого бота (вебхук, меню команд) и цикл getUpdates, который переживает 409 и сетевые сбои.

export const OWNER_COMMANDS = [
  { command: 'status', description: 'Как дела у напарницы' },
  { command: 'code', description: 'Код и ссылка для напарницы' },
];

/** Старый бот мог остаться с вебхуком (тогда getUpdates даёт 409) и со старым меню: сбрасываем и то и другое. Сбой не фатален. */
// Накопившиеся сообщения отбрасываем только при ПЕРВОМ запуске (там они от прежней жизни бота). Дальше — нет: видео напарницы, присланные, пока ноутбук был выключен, не должны пропасть.
export async function prepareBot({ tg, log, ownerId = null, store = null }) {
  const first = !store?.data.webhookCleared;
  try {
    await tg.deleteWebhook({ dropPending: first });
    if (store) { store.data.webhookCleared = true; store.save(); }
    log(first ? 'Вебхук сброшен, старые сообщения от прежней жизни бота отброшены (первый запуск).' : 'Вебхук снят (если был); сообщения, пришедшие пока бот был выключен, сохранены.');
  } catch (e) { log(`Не удалось сбросить вебхук: ${e.message}`); }
  try {
    await tg.setMyCommands([]); // у напарницы меню команд нет: она работает кнопками
    if (ownerId) await tg.setMyCommands(OWNER_COMMANDS, { chatId: ownerId });
    log('Меню команд обновлено (старое заменено).');
  } catch (e) { log(`Не удалось обновить меню команд: ${e.message}`); }
}

export const CONFLICT_HELP = 'Telegram отвечает 409: у этого бота ещё включён вебхук или он уже запущен в другом окне или на другом компьютере (опрашивать может только один). Закрой второй экземпляр; повторю.';

/** Цикл опроса. Не падает: 409 и сетевые ошибки — понятная строка в лог и повтор с нарастающей паузой. */
export function createPoller({ tg, bot, store, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tg409Reset }) {
  let stopping = false;
  return {
    stop() { stopping = true; },
    async run() {
      let delay = 1000; let streak = 0; // streak — сколько 409 подряд
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
          if (conflict && streak === 1 && tg409Reset) { try { await tg409Reset(); } catch { /* ignore */ } } // вебхук снимаем один раз за серию: если дело в втором экземпляре, повторы бесполезны
          await sleep(delay); delay = Math.min(delay * 2, 60_000);
        }
      }
    },
  };
}
