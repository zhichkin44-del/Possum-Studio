// Mentor: the user asks in plain words — "what can I treat them with?", "how do I post it?", "can I put a little costume on?".
// With a key, a neural network answers from the catalog and the rules; without a key, on error, or if the answer fails the check — the catalog answers by keywords.
// The pet's name (settings.petNames) never goes to the neural network and never appears in the answer: it is replaced with a generic word ("the critter").

import { LIGHT } from './director.js';
import { IDEAS, NO_COSTUME, SAFE_TREATS, FORBIDDEN, POSTING } from './ideas.js';

// \w in JS does not match Cyrillic — only \p{L} with the u flag
const BANNED = /вспышк|бел(ый|ого|ом) свет|включ\p{L}* свет|ярк\p{L}* свет|по имени/iu;
const COSTUME = /одежд|костюм|наряд|одеть|одева|надеть|наде[нв]|шапочк|шлейк|поводок|свитер|платьиц/i;
// A sentence about clothing or forbidden food is skipped only if it contains a firm prohibition word ("not allowed") and no permissive word.
// "instead" and "safe" do not count as refusals ("Instead of dinner, give chocolate"). An extra alarm is harmless — the catalog will answer.
// Only a firm prohibition and a standalone "no" count. Phrases meaning "not needed", "not worth it", "forbidden" do not count: "no need to be afraid" is a permission.
// "harmful", "poisonous", "dangerous" are not refusals either: "Give chocolate — harmful, but it's fine" is advice to give it.
const NEGATION = /нельзя|не да(вать|вай|йте|ём|ем)|не корм|не наде|не одева|(?<![\p{L}])нет(?![\p{L}])/iu;
// "give", "not dangerous", "not harmful", "not forbidden", "don't be afraid", "useful", "nothing serious", "a trifle" are permissions, not refusals.
const PERMIT = /(?<!не\s)(?<![\p{L}])(можно|дай(?![\p{L}])|давай|дайте|дать|угост|угощайте|наденьте|надень|оденьте|одень|безопасн|полезн|полезен)|(?<![\p{L}])не\s+(опас|вред|запрещ|страш|бой|нужно бо|стоит бо)|бояться|ничего(?![\p{L}])|мелоч/iu;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only case endings and diminutive forms — not "any 3 letters", otherwise a pet's name would eat the word for "butter".
const ENDINGS = [
  'а', 'я', 'у', 'ю', 'е', 'ы', 'и', 'о', 'ой', 'ей', 'ом', 'ем', 'ою', 'ею',
  'ка', 'ки', 'ке', 'ку', 'кой', 'ька', 'ьки', 'ьке', 'ьку', 'ькой', 'ик', 'ика', 'ику', 'ике', 'иком', 'чик', 'чика', 'чику', 'чиком',
  'очка', 'очки', 'очке', 'очку', 'очкой', 'ечка', 'ечки', 'ечке', 'ечку', 'ечкой', 'енька', 'еньки', 'еньке', 'еньку', 'енькой', 'уля', 'ули', 'уле', 'улю', 'улей',
].sort((a, b) => b.length - a.length).join('|');

/** Replace the pet's names with "the critter" (case-insensitive, with case endings). */
export function redactNames(text, petNames = []) {
  let out = String(text ?? '');
  for (const n of petNames || []) {
    const name = String(n || '').trim();
    if (name.length < 2) continue;
    // The stem without the last vowel: "Lusha" → "Lush" + endings such as a|u|e|oy|ka|…
    const stem = /[аяоеуыиюё]$/i.test(name) && name.length > 2 ? name.slice(0, -1) : name;
    out = out.replace(new RegExp(`(?<![\\p{L}])(?:${esc(name)}|${esc(stem)}(?:${ENDINGS})?)(?![\\p{L}])`, 'giu'), 'зверёк');
  }
  return out;
}

const forbiddenIn = (text) => FORBIDDEN.filter(([root]) => new RegExp(`(?<![\\p{L}])${root}`, 'iu').test(text));

/** Check of a neural network answer: no forbidden light, no advice to put on clothes or give forbidden food. */
export function unsafe(answer) {
  if (BANNED.test(answer)) return 'свет';
  for (const sentence of String(answer).split(/(?<=[.!?\n])\s*/)) {
    const costume = COSTUME.test(sentence);
    const food = forbiddenIn(sentence).length > 0;
    if (!costume && !food) continue;
    // "a person may dress up" — the outfit is on a person, not on the pet
    if (costume && !food && /человек/i.test(sentence) && !/на него|\bему\b|зверь|поссум|питом/i.test(sentence)) continue;
    if (NEGATION.test(sentence) && !PERMIT.test(sentence)) continue;
    return costume ? 'одежда' : 'еда';
  }
  return '';
}

const ideaRef = (id) => IDEAS.find((i) => i.id === id);
const list = (xs) => xs.map((x) => `• ${x}`).join('\n');

/** Answer without a neural network: by the keywords of the question. Order matters — dangerous things first. */
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

/** Answer to a question. history — [{q, a}] of the latest replies; names from petNames are cut out before sending and from the answer. */
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
    } catch { /* no key or network — the catalog answers */ }
  }
  const fb = fallback(q);
  return { ...fb, answer: redactNames(fb.answer, petNames), source: 'catalog' };
}
