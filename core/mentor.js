// Наставник: напарница спрашивает обычными словами — «чем угостить?», «как выложить?», «можно ли надеть костюмчик?».
// Есть ключ — отвечает нейросеть по каталогу и правилам; нет ключа, ошибка или ответ не прошёл проверку — отвечает каталог по словам.
// Имя питомца (settings.petNames) никогда не уходит в нейросеть и не показывается в ответе: заменяем на «зверёк».

import { LIGHT } from './director.js';
import { IDEAS, NO_COSTUME, SAFE_TREATS, FORBIDDEN, POSTING } from './ideas.js';

// \w в JS не видит кириллицу — только \p{L} с флагом u
const BANNED = /вспышк|бел(ый|ого|ом) свет|включ\p{L}* свет|ярк\p{L}* свет|по имени/iu;
const COSTUME = /одежд|костюм|наряд|одеть|одева|надеть|наде[нв]|шапочк|шлейк|поводок|свитер|платьиц/i;
// Предложение с одеждой или запретной едой пропускаем, только если в нём твёрдое «нельзя» и нет разрешающего слова.
// «вместо» и «безопасно» отказом не считаются («Вместо ужина дайте шоколад»). Лишняя тревога не страшна — ответит каталог.
// Только твёрдый запрет и отдельное «нет». «не нужно», «не стоит», «запрещено» — не в счёт: «не нужно бояться» — это разрешение.
// «вредный», «ядовитый», «опасно» — тоже не отказ: «Дай шоколад — вредный, но ничего» — это совет дать.
const NEGATION = /нельзя|не да(вать|вай|йте|ём|ем)|не корм|не наде|не одева|(?<![\p{L}])нет(?![\p{L}])/iu;
// «дай», «не опасен», «не вредит», «не запрещено», «не бойтесь», «полезен», «ничего страшного», «мелочь» — это разрешение, а не отказ.
const PERMIT = /(?<!не\s)(?<![\p{L}])(можно|дай(?![\p{L}])|давай|дайте|дать|угост|угощайте|наденьте|надень|оденьте|одень|безопасн|полезн|полезен)|(?<![\p{L}])не\s+(опас|вред|запрещ|страш|бой|нужно бо|стоит бо)|бояться|ничего(?![\p{L}])|мелоч/iu;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Только падежные окончания и ласкательные формы — не «любые 3 буквы», иначе «Мася» съедает «масло».
const ENDINGS = [
  'а', 'я', 'у', 'ю', 'е', 'ы', 'и', 'о', 'ой', 'ей', 'ом', 'ем', 'ою', 'ею',
  'ка', 'ки', 'ке', 'ку', 'кой', 'ька', 'ьки', 'ьке', 'ьку', 'ькой', 'ик', 'ика', 'ику', 'ике', 'иком', 'чик', 'чика', 'чику', 'чиком',
  'очка', 'очки', 'очке', 'очку', 'очкой', 'ечка', 'ечки', 'ечке', 'ечку', 'ечкой', 'енька', 'еньки', 'еньке', 'еньку', 'енькой', 'уля', 'ули', 'уле', 'улю', 'улей',
].sort((a, b) => b.length - a.length).join('|');

/** Заменить имена питомца на «зверёк» (без учёта регистра, с падежными окончаниями). */
export function redactNames(text, petNames = []) {
  let out = String(text ?? '');
  for (const n of petNames || []) {
    const name = String(n || '').trim();
    if (name.length < 2) continue;
    // Основа без последней гласной: Вова → Вов + а|у|е|ой|ка|очка…
    const stem = /[аяоеуыиюё]$/i.test(name) && name.length > 2 ? name.slice(0, -1) : name;
    out = out.replace(new RegExp(`(?<![\\p{L}])(?:${esc(name)}|${esc(stem)}(?:${ENDINGS})?)(?![\\p{L}])`, 'giu'), 'зверёк');
  }
  return out;
}

const forbiddenIn = (text) => FORBIDDEN.filter(([root]) => new RegExp(`(?<![\\p{L}])${root}`, 'iu').test(text));

/** Проверка ответа нейросети: нет запрещённого света, нет советов надеть одежду или дать запретную еду. */
export function unsafe(answer) {
  if (BANNED.test(answer)) return 'свет';
  for (const sentence of String(answer).split(/(?<=[.!?\n])\s*/)) {
    const costume = COSTUME.test(sentence);
    const food = forbiddenIn(sentence).length > 0;
    if (!costume && !food) continue;
    // «Нарядиться может человек» — наряд на человеке, не на зверьке
    if (costume && !food && /человек/i.test(sentence) && !/на него|\bему\b|зверь|поссум|питом/i.test(sentence)) continue;
    if (NEGATION.test(sentence) && !PERMIT.test(sentence)) continue;
    return costume ? 'одежда' : 'еда';
  }
  return '';
}

const ideaRef = (id) => IDEAS.find((i) => i.id === id);
const list = (xs) => xs.map((x) => `• ${x}`).join('\n');

/** Ответ без нейросети: по ключевым словам вопроса. Порядок важен — сначала опасное. */
export function fallback(question) {
  const q = String(question || '').toLowerCase();
  const bad = forbiddenIn(q);
  if (bad.length) {
    return { answer: `Нет, это давать нельзя: ${bad.map(([, l]) => l).join('; ')}. Для зверька это вредно или опасно.\n\nМожно крошечный кусочек из этого списка:\n${list(SAFE_TREATS)}`, ideaIds: ['plate'] };
  }
  if (COSTUME.test(q)) {
    return { answer: `${NO_COSTUME.title}. ${NO_COSTUME.why}\n\nВместо этого:\n${list(NO_COSTUME.instead)}`, ideaIds: ['season', 'pouch'] };
  }
  if (/корм|угощ|угост|тарел|еда|еду|кушать|лакомств|блюд|фрукт|вкусн/.test(q)) {
    return { answer: `Угощение — крошечный кусочек, мельче горошины, вместо части обычного ужина, вымыть и порезать.\n\nМожно:\n${list(SAFE_TREATS)}\n\nНельзя: ${[...new Set(FORBIDDEN.map(([, l]) => l))].join('; ')}.`, ideaIds: ['plate', 'tasting', 'hunt'] };
  }
  if (/свет|темн|ламп|ночь|видно/.test(q)) {
    return { answer: `Свет: ${LIGHT}. Он ночной зверёк — яркий свет и вспышка его пугают и вредят глазам. Снимайте вечером, когда он сам проснулся.`, ideaIds: ['bedroom'] };
  }
  if (/выклад|пост|подпис|хэштег|хештег|тикток|tiktok|инст|reels|ютуб|youtube|shorts|профил|подписчик|вести (страниц|акк|блог)/.test(q)) {
    return { answer: POSTING.map((p) => `${p.title}\n  лучше: ${p.better}\n  хуже: ${p.worse}`).join('\n\n'), ideaIds: ['weekly'] };
  }
  if (/гуля|прогул|улиц|вывест|выход|куда/.test(q)) {
    return { answer: 'Гуляем только по дому, в мешочке на груди: 5–10 минут, медленно, без тряски. На улицу — нет: шум, собаки, птицы, холод. Шлейку и поводок не надевать.', ideaIds: ['pouch', 'shoulder'] };
  }
  if (/иде|снять|сним|сюжет|истори|придума|что делать/.test(q)) {
    const pick = ['plate', 'cafe', 'pouch', 'jumps', 'thenNow'].map(ideaRef);
    return { answer: `Вот с чего начать:\n${pick.map((i) => `• ${i.title} — ${i.why}`).join('\n')}\n\nОткройте карточку — там кадры, как снимать и как выложить.`, ideaIds: pick.map((i) => i.id) };
  }
  return { answer: 'Спросите про: что снять сегодня; чем угостить; свет; прогулки; как выложить и подписать; можно ли нарядить. Я подскажу и дам карточку с кадрами.', ideaIds: [] };
}

const SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' }, ideaIds: { type: 'array', items: { type: 'string' } } },
  required: ['answer', 'ideaIds'],
};

function context() {
  return [
    'Ты — наставник по съёмке домашнего сахарного поссума (летяги) для коротких роликов. Отвечаешь хозяйке по-русски, тепло, коротко (до 8 строк), по делу: что снять, как, как выложить, что лучше и хуже.',
    'Благополучие зверька выше контента. Жёсткие правила:',
    `— свет: ${LIGHT}; никогда не советуй вспышку или включить яркий свет;`,
    '— одежду, костюмы, шапочки, шлейки и поводки не надевать (когти цепляются, переломы лапок); если спрашивают — объясни и предложи мешочек или наряд на человеке;',
    `— угощать только безопасным, крошечным кусочком вместо части ужина: ${SAFE_TREATS.join(', ')};`,
    `— никогда не давать: ${[...new Set(FORBIDDEN.map(([, l]) => l))].join(', ')};`,
    '— в кадре только руки, без лица человека; не будить днём; на улицу не выносить; испугался или вырывается — съёмку прекращаем;',
    '— не обещай просмотров, подписчиков и денег в цифрах.',
    'Каталог идей (id — название — суть):',
    ...IDEAS.map((i) => `${i.id} — ${i.title} — ${i.why}`),
    'Правила выкладки:',
    ...POSTING.map((p) => `${p.title}: лучше — ${p.better} Хуже — ${p.worse}`),
    'Верни JSON: answer — ответ; ideaIds — до 3 id из каталога, если подходят.',
  ].join('\n');
}

/** Ответ на вопрос. history — [{q, a}] последних реплик; имена из petNames вырезаются до отправки и из ответа. */
export async function ask(question, { ai = null, history = [], petNames = [] } = {}) {
  const q = redactNames(String(question || '').slice(0, 1000), petNames);
  if (!q.trim()) return { ...fallback(''), source: 'catalog' };
  const known = new Set(IDEAS.map((i) => i.id));
  if (ai?.enabled) {
    try {
      const past = (history || []).slice(-4).map((h) => `Вопрос: ${redactNames(h.q, petNames)}\nОтвет: ${redactNames(h.a, petNames)}`).join('\n\n');
      const reply = await ai.json({ content: `${context()}\n\n${past ? `Раньше:\n${past}\n\n` : ''}Вопрос: ${q}`, schema: SCHEMA, name: 'mentor', maxTokens: 700 });
      const answer = redactNames(String(reply?.answer || '').trim(), petNames);
      if (answer && !unsafe(answer)) {
        const ideaIds = (Array.isArray(reply.ideaIds) ? reply.ideaIds : []).filter((id) => known.has(id)).slice(0, 3);
        return { answer, ideaIds, source: 'ai' };
      }
    } catch { /* нет ключа или сеть — отвечает каталог */ }
  }
  const fb = fallback(q);
  return { ...fb, answer: redactNames(fb.answer, petNames), source: 'catalog' };
}
