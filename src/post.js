// Готовый пост: подписи, хештеги и первый комментарий под четыре площадки + проверка качества ролика.
export const PLATFORMS = [
  { id: 'yt_ru', label: 'YouTube RU', lang: 'ru' },
  { id: 'yt_en', label: 'YouTube EN', lang: 'en' },
  { id: 'tiktok', label: 'TikTok', lang: 'ru' },
  { id: 'reels', label: 'Instagram Reels', lang: 'ru' },
];

const TAGS = {
  ru: ['#сахарныйпоссум', '#поссум', '#ночнойзверёк', '#милота', '#питомец'],
  en: ['#sugarglider', '#nocturnalpet', '#cuteanimals', '#exoticpet', '#petsofinstagram'],
};

// По 3 варианта на сценарий; вариант берём по номеру ролика, чтобы соседние подписи не повторялись.
const BANK = {
  wake: {
    ru: [(p) => `${p.im} просыпается. Смотри, как медленно он решает, вылезать ли.`, (p) => `Вечер, и ${p.im} открыл глаза.`, (p) => `Первый взгляд ${p.ro} после сна.`],
    en: [(p) => `${p.im} is waking up. Watch how long he takes to decide.`, (p) => `Evening. ${p.im} just opened his eyes.`, (p) => `${p.im}'s very first look after sleeping.`],
    q: { ru: 'Кто у вас просыпается вечером?', en: 'Who wakes up at night in your house?' },
  },
  treat: {
    ru: [(p) => `${p.im} получил кусочек и очень серьёзен.`, (p) => `Слышишь, как ${p.im} хрустит?`, (p) => `Лапки заняты: ${p.im} ужинает.`],
    en: [(p) => `${p.im} got a tiny treat and he is very serious about it.`, (p) => `Can you hear ${p.im} crunch?`, (p) => `Paws are busy: ${p.im} is having dinner.`],
    q: { ru: 'А что любит ваш питомец?', en: 'What does your pet love to snack on?' },
  },
  hand: {
    ru: [(p) => `${p.im} решает, идти ли на руку.`, (p) => `Доверие, шаг за шагом: ${p.im} идёт к руке.`, (p) => `Сам подошёл. ${p.im} сегодня смелый.`],
    en: [(p) => `${p.im} is deciding whether to step onto the hand.`, (p) => `Trust, step by step: ${p.im} walks to the hand.`, (p) => `He came on his own. ${p.im} is brave today.`],
    q: { ru: 'Как долго ваш питомец привыкал к рукам?', en: 'How long did your pet take to trust your hands?' },
  },
  night: {
    ru: [(p) => `Чем ${p.im} занят, пока все тихо.`, (p) => `Ночная смена ${p.ro}.`, (p) => `${p.im} на работе. Не мешаем.`],
    en: [(p) => `What ${p.im} does when everything is quiet.`, (p) => `${p.im} on the night shift.`, (p) => `${p.im} is at work. Do not disturb.`],
    q: { ru: 'Чем занят ваш питомец ночью?', en: 'What does your pet do at night?' },
  },
  prop: {
    ru: [(p) => `${p.im} и огромная загадочная вещь.`, (p) => `Что это такое? Версия ${p.ro}.`, (p) => `${p.im} знакомится с новым соседом.`],
    en: [(p) => `${p.im} meets a huge mysterious thing.`, (p) => `What is this? ${p.im}'s theory.`, (p) => `${p.im} meets a new neighbor.`],
    q: { ru: 'Чего боится ваш питомец?', en: 'What is your pet afraid of?' },
  },
  pouch: {
    ru: [(p) => `${p.im} выглядывает из мешочка. Видно только мордочку.`, (p) => `Маленький домик ${p.ro}.`, (p) => `Тихо. ${p.im} сидит в мешочке.`],
    en: [(p) => `${p.im} peeks out of his pouch. Only the nose shows.`, (p) => `${p.im}'s tiny home.`, (p) => `Quiet. ${p.im} is in the pouch.`],
    q: { ru: 'Где любит прятаться ваш питомец?', en: 'Where does your pet love to hide?' },
  },
  moment: {
    ru: [(p) => `Три секунды ${p.ro}.`, (p) => `Поймали момент: ${p.im} смотрит в камеру.`, (p) => `${p.im} потягивается. Это всё.`],
    en: [(p) => `Three seconds of ${p.im}.`, (p) => `We caught a moment: ${p.im} looks at the camera.`, (p) => `${p.im} stretches. That is it.`],
    q: { ru: 'Какой момент вы бы сохранили?', en: 'Which pet moment would you keep forever?' },
  },
  flight: {
    ru: [(p) => `${p.im} полетел. Смотри до конца.`, (p) => `Взлёт и посадка ${p.ro}.`, (p) => `Раскрыл «крылья» и вперёд. ${p.im} в воздухе.`],
    en: [(p) => `${p.im} took off. Watch until the end.`, (p) => `${p.im}'s takeoff and landing.`, (p) => `Wings out, here he goes. ${p.im} in the air.`],
    q: { ru: 'Как далеко, по-вашему, он пролетел?', en: 'How far do you think he glided?' },
  },
  chase: {
    ru: [(p) => `${p.im} в погоне. Кто кого догонит?`, (p) => `Бег по дивану. ${p.im} за добычей.`, (p) => `Ни шагу назад: ${p.im} гонится.`],
    en: [(p) => `${p.im} on a chase. Who catches who?`, (p) => `A race across the sofa. ${p.im} is after it.`, (p) => `No stopping: ${p.im} is chasing.`],
    q: { ru: 'За чем гоняется ваш питомец?', en: 'What does your pet love to chase?' },
  },
  palm: {
    ru: [(p) => `Тишина. ${p.im} на ладони.`, (p) => `${p.im} сам сел на руку. Слышишь его?`, (p) => `Тихий момент на ладони.`],
    en: [(p) => `Silence. ${p.im} on the palm.`, (p) => `${p.im} sat on the hand himself. Can you hear him?`, (p) => `A quiet moment on the palm.`],
    q: { ru: 'Какой звук делает ваш питомец?', en: 'What sound does your pet make?' },
  },
  name: {
    ru: [(p) => `Позвала ${p.vi} по имени. Повернёт голову?`, (p) => `${p.im}, это тебя зовут.`, (p) => `Узнаёт ли ${p.im} своё имя?`],
    en: [(p) => `I called ${p.im} by name. Will he turn his head?`, (p) => `${p.im}, that is you they are calling.`, (p) => `Does ${p.im} know his name?`],
    q: { ru: 'Откликается ли ваш питомец на имя?', en: 'Does your pet answer to its name?' },
  },
  route: {
    ru: [(p) => `Маршрут ${p.ro}: с дивана на кресло.`, (p) => `${p.im} выбирает, куда лететь.`, (p) => `Комната как трасса. ${p.im} летит.`],
    en: [(p) => `${p.im}'s route: from sofa to armchair.`, (p) => `${p.im} chooses where to fly.`, (p) => `The room is a runway. ${p.im} is gliding.`],
    q: { ru: 'Куда бы вы поставили следующую «посадку»?', en: 'Where would you place his next landing spot?' },
  },
  between: {
    ru: [(p) => `${p.im} летает между двумя людьми.`, (p) => `От одного к другому. ${p.im} не промахивается.`, (p) => `Туда и обратно: ${p.im} в деле.`],
    en: [(p) => `${p.im} glides between two people.`, (p) => `From one to the other. ${p.im} never misses.`, (p) => `There and back: ${p.im} at work.`],
    q: { ru: 'Кому он полетит первым?', en: 'Who will he fly to first?' },
  },
};

const TT_Q = ['Как думаешь, что он сделает дальше?', 'Угадаешь, чем это закончится?', 'Кого он тебе напоминает?'];
const IG_Q = ['Отметь друга, который тоже ночной 🌙', 'Поделись с тем, кого это порадует', 'Сохрани, чтобы вернуться к этому позже'];

const FALLBACK = {
  ru: [(p) => `${p.im} сегодня.`, (p) => `Ещё один вечер с ${p.tv}.`],
  en: [(p) => `${p.im} today.`, (p) => `Another evening with ${p.im}.`],
  q: { ru: 'А у вас дома кто-нибудь ночной?', en: 'Do you have a night owl at home?' },
};

const pick = (arr, n) => arr[((n % arr.length) + arr.length) % arr.length];

/** Подписи для четырёх площадок. n — номер ролика (для ротации вариантов). */
export function buildCaptions({ task, pet, n = 0 }) {
  const bank = (task && BANK[task.id]) || FALLBACK;
  const ru = pick(bank.ru, n)(pet);
  const ruTt = pick(bank.ru, n + 1)(pet); // на каждой площадке свой вариант: подписи не дублируются
  const ruIg = pick(bank.ru, n + 2)(pet);
  const en = pick(bank.en, n)({ ...pet, im: pet.en ?? pet.im });
  const tags = (lang, k, extra = []) => [...TAGS[lang].slice(0, k), ...extra];
  return {
    yt_ru: { caption: ru, hashtags: tags('ru', 2, ['#shorts']), comment: bank.q.ru },
    yt_en: { caption: en, hashtags: tags('en', 2, ['#shorts']), comment: bank.q.en },
    tiktok: { caption: ruTt, hashtags: tags('ru', 2, ['#sugarglider']), comment: pick(TT_Q, n) },
    reels: { caption: ruIg, hashtags: [...tags('ru', 2), ...tags('en', 2)], comment: pick(IG_Q, n) },
  };
}

/** Что не так с готовым роликом (пусто — всё хорошо). Лист проверки до выдачи напарнице. */
export function qualityIssues(r) {
  const issues = [];
  if (r.duration > 20.5) issues.push(`слишком длинный (${r.duration.toFixed(1)} с, нужно до 20)`);
  if (r.duration < 8 - 0.5 && r.duration >= 0) issues.push(`слишком короткий (${r.duration.toFixed(1)} с, нужно от 8)`);
  if (!(r.height > r.width)) issues.push('не вертикальный (нужно 9:16)');
  if (r.width && r.height && Math.abs(r.width / r.height - 9 / 16) > 0.02) issues.push('не 9:16');
  if (!r.hasAudio) issues.push('нет звука');
  if (typeof r.firstFrameLuma === 'number' && r.firstFrameLuma < 8) issues.push('первый кадр чёрный');
  if (typeof r.blackRatio === 'number' && r.blackRatio > 0.3) issues.push('много чёрных кадров');
  if (typeof r.loudness === 'number' && Math.abs(r.loudness + 14) > 2.5) issues.push(`громкость ${r.loudness.toFixed(1)} LUFS (нужно около −14)`);
  if (typeof r.hookMotion === 'number' && r.hookMotion < 0.25) issues.push('первые 1,5 с почти неподвижны (хук слабый)');
  return issues;
}

