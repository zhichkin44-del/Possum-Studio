// Сообщения бота. Источник — docs/texts/partner-messages.md и раскладки docs/layouts. Формат Telegram: HTML.
// Правила: ни слова «нельзя», ни слов про ветеринара и обогреватели; не давим; не обещаем того, чего бот не может.
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const closedBot = 'Это закрытый бот студии. Если тебе нужен доступ, спроси у Саши.';

export const hello1 = (p) => `Привет! Я помощник Саши. Каждый день пришлю одно маленькое задание: что снять с ${p.tv}, когда будешь у Саши. Ты снимаешь на телефон и присылаешь сюда: нажми скрепку и выбери видео. Я собираю ролик и пишу подпись — а выкладываешь ты, на свой канал. Твои видео и цифры нужны только для этого проекта.`;
export const hello2 = 'В комнате не жарко. Если он вялый или не ест — не снимаем.';
export const introOk = (p) => `Спасибо! Первое задание пришлю вечером, когда ${p.im} проснётся.`;
export const alreadyHere = 'Я здесь. Задание пришлю вечером.';

export const ownerHello = 'Привет! Ты подключён как владелец студии. /status — как дела у напарницы, /код — код для её подключения.';
export const ownerHelp = 'Команды: /status — как дела у напарницы, /код — код для её подключения. Видео и задания идут через напарницу.';
export const partnerConnected = 'Напарница подключилась.';

export const goOn = 'Жду ролик.';
export const later = 'Хорошо, ничего страшного. Перенесла на завтра.';
export const sleeping = 'Не будим. Снимем в другой раз — пришлю то же задание завтра.';
export const unclearIntro = 'Попробую проще.';
export const unclearTail = 'Если всё равно непонятно — напиши, что именно, и я передам Саше.';
export const unclearOwner = (title) => `Напарница не поняла задание «${title}». Я объяснила проще.`;

export const received = 'Получила! Смотрю, что можно собрать. Обычно это занимает час или меньше — пришлю готовое сюда.';
export const several = 'Получила несколько кусочков. Из них соберу один ролик. Лишние кадры сохраню для будущих роликов.';
export const duplicate = 'Это видео уже есть, повторно не собираю.';
export const tooBig = 'Это видео слишком большое для меня: Telegram не отдаёт боту файлы больше 20 МБ. Пришли покороче — до 20 секунд — и отправь как обычное видео, не файлом.';
export const downloadFailed = 'Не получилось скачать видео. Пришли, пожалуйста, ещё раз.';
export const openFailed = 'Не получилось открыть это видео. Пришли, пожалуйста, ещё раз или другим файлом.';
export const tooShort = 'Это совсем короткий кусочек. Пришли ещё кусочек, и я соберу ролик.';
export const darkWarn = 'Зверька почти не видно: слишком темно. Ничего страшного! Включи лампу сбоку, не в глаза, или снимай ближе. Этот ролик я всё равно соберу, если хочешь.';
export const brightWarn = (p) => `Посмотрела съёмку. Свет в кадре яркий, и ${p.im} мог щуриться: у поссумов очень чувствительные глаза. В следующий раз поставь лампу сбоку, не в глаза и не близко. Этот ролик я всё равно соберу, решение за тобой.`;
export const redo = 'Хорошо, жду новую съёмку.';
export const buildFailed = 'Не получилось собрать ролик. Съёмку сохранила, Саша посмотрит.';
export const buildFailedOwner = (e) => `Ролик не собрался: ${esc(String(e).slice(0, 600))}`;
export const deliveryStuck = (title, e) => `Не могу отправить напарнице готовый ролик «${esc(title)}»: ${esc(String(e).slice(0, 300))}. Ролик сохранён на ноутбуке, повторы остановил.`;

export const postIntro = '<b>Готово!</b> Вот ролик — один файл на все четыре площадки, вертикальный. Ниже — подпись для каждой: скопируй нужную.';
export const coverCaption = 'Обложка: если TikTok или Instagram попросят выбрать картинку, возьми эту.';
export const postOutro = 'Нравится? Напиши, что поменять, или выкладывай на свой канал. Сам я ничего не публикую.';
export const postWhen = '<b>Когда выкладывать:</b> сегодня вечером (время — предположение, подберём по цифрам). <b>Звук:</b> только звуки Пипа.';
export const whereAsk = 'Где выложила? Отметь, и я запомню.';
export const marked = (label) => `Отметила: ${label}.`;
export const alreadyMarked = 'Это уже отмечено.';
export const thanksPosted = 'Спасибо! Когда пришлёшь скриншот статистики, расскажу, как пошло.';
export const askCaption = 'Пришли подпись, какой хочешь, — я оставлю её как есть и добавлю хештеги.';
export const customCaptionDone = (text) => `Вот как будет:\n${esc(text)}\n\nОставляю как есть, хештеги добавила.`;
export const notYet = 'Хорошо, жду. Напиши «выложила», когда будет готово.';
export const noPostYet = 'Готового ролика пока нет. Пришли съёмку, и я соберу.';

export const nudge1 = (p) => `Как дела с ${p.tv}? Если сегодня не получилось — ничего страшного. Напиши «потом», и я перенесу.`;
export const nudge2 = 'Если сегодня не хочется снимать — это нормально. Напиши «пауза», и я помолчу, сколько скажешь. Или вот совсем маленькое: пять секунд, просто как он сидит.';

export const pauseAsk = 'Хорошо. На сколько?';
export const pauseSet = (until) => `Отдыхай. Задания не шлю до ${until}. Твои ролики и съёмка у меня сохранены.`;
export const pauseManual = 'Отдыхай. Задания не шлю, пока сама не напишешь «вернулась». Твои ролики и съёмка у меня сохранены.';
export const resumed = 'С возвращением! Пришлю задание вечером.';
export const sickReply = 'Тогда не снимаем. Скажи «вернулась», когда ему станет лучше.';
export const sickOwner = 'Напарница написала, что Пип вялый или не ест. Задания остановила до её слова.';

export const fallback = 'Я понимаю кнопки и слова: «пауза», «вернулась», «выложила», «потом». Видео присылай сюда как обычно.';
export const nonText = 'Спасибо! Видео и скриншоты принимаю, остальное пока не умею.';

export const cardsHead = '<b>Что снимем сегодня? Выбирай.</b>';
export const cardsStale = 'Эти карточки уже неактуальны. Скоро пришлю новые.';
export const picked = (title) => `Принято: «${title}».`;
export const askIdea = 'Напиши, что хочешь снять.';
export const ideaSaved = 'Записала. Снимай, как задумала, и пришли сюда.';
export const skippedToday = 'Хорошо. До завтра.';

export const askStats = 'Жду. Можно и просто цифрами, например: YouTube EN 3410 +21';
export const shotSaved = 'Скриншот сохранила и передала Саше. Если хочешь, напиши цифры — например: YouTube EN 3410 +21';
export const shotForOwner = 'Скриншот статистики от напарницы.';
export const statsSaved = (rows) => `Записала: ${rows}.`;
export const lessOften = 'Хорошо, буду присылать реже.';
export const notRushing = 'Хорошо, не тороплю.';
export const youreWelcome = 'Пожалуйста!';

// ---------- Саша: своё видео → монтаж → выкладка по кнопке ----------
export const ownerHelpStudio = 'Пришли видео поссума — смонтирую три версии (YouTube, TikTok, Reels), подскажу, что выкладывать, и выложу по твоей кнопке.\nКоманды: /status — как дела у напарницы, /код — код для неё.\nКлюч Claude и вход в YouTube/TikTok — в приложении «Поссум», раздел «Настройки».';
export const ownerNoStudio = 'Монтаж в боте не подключён: запусти бота на компьютере, где стоит приложение «Поссум» и FFmpeg.';
export const ownerTooBig = 'Telegram не отдаёт боту файлы больше 20 МБ. Пришли короче (до 30 секунд) или положи файл в папку «Входящие» приложения — там ограничения нет.';
export const ownerBuilding = 'Принял, монтирую три версии. Обычно это 1–3 минуты.';
export const ownerBuildFailed = (msg) => `Не получилось смонтировать: ${esc(String(msg).slice(0, 300))}`;
export const ownerWhere = 'Куда выкладываем? Выкладываю только после твоего нажатия. TikTok уходит во входящие черновики — звук и публикация в самом TikTok.';
export const ownerJobGone = 'Этот ролик уже не найден. Пришли видео ещё раз.';
export const ownerNotReady = 'Ролик ещё не готов — дождись трёх видео.';

export function ownerResult(m) {
  const p = m.packages ?? {};
  const lines = [
    `<b>Совет:</b> ${esc(m.advice?.verdict ?? '')}. ${esc(m.advice?.why ?? '')}`,
    ...((m.welfare ?? []).length ? ['', '<b>Забота о зверьке:</b>', ...m.welfare.map((w) => `• ${esc(w)}`)] : []),
    '', `<b>YouTube:</b> ${esc(p.youtube?.title ?? '')}`,
    `<b>TikTok:</b> ${esc(p.tiktok?.caption ?? '')}`,
    `<b>Reels:</b> ${esc(p.instagram?.caption ?? '')}`,
    '', `Тексты: ${m.texts?.source === 'claude' ? 'Claude' : 'шаблоны (ключ Claude не задан или не ответил)'}`,
  ];
  return lines.join('\n');
}

export function ownerPublished(label, r) {
  if (r.skipped) return `${label}: ${esc(r.note ?? 'уже было выложено')}`;
  if (r.manual) return `${label}: выкладка вручную.\n${(r.steps ?? []).map((s, i) => `${i + 1}. ${esc(s)}`).join('\n')}\nПодпись:\n${esc(r.caption ?? '')}`;
  const warn = (r.warnings ?? []).length ? `\n${r.warnings.map(esc).join('\n')}` : '';
  if (r.url) return `${label}: выложено — ${esc(r.url)}${warn}`;
  return `${label}: ${esc(r.note ?? 'отправлено')}${warn}`;
}
