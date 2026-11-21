// Director: "What to shoot today". The day's scenario — a story type (KINDS from stories.js) and a list of frames.
// Frame: what to catch, light, angle, how many seconds, and the markers (core/shots.js, core/vision.js) by which we see whether it was shot.
// If there is an AI key, the AI rewrites the scenario texts (ai.json); no key or a bad reply — the template. Markers and light are always ours.

import { KINDS } from './stories.js';

/** The light is the same in every frame: the pet is nocturnal, its eyes are sensitive. */
export const LIGHT = 'без белого света и вспышки — тусклый тёплый свет сбоку';
const HANDS = 'В кадре только руки и зверёк, без лица. Если он прячется или вырывается — съёмку прекращаем.';
const BANNED = /вспышк|бел(ый|ого|ом) свет|включ\p{L}* свет|ярк\p{L}* свет|по имени/iu; // \w does not match Cyrillic

const shot = (what, angle, secs, labels) => ({ what, light: LIGHT, angle, secs, labels });

/** Templates: one per story type, frames in editing order. Texts come from the daily task (src/tasks.js) and the shooting memo. */
export const SCENARIOS = [
  {
    id: 'meal', kind: 'asmr', title: 'Ужин со звуком', hook: 'Слышно, как хрустит?',
    shots: [
      shot('подходит к еде — общий план', 'сбоку, на уровне стола, телефон на подставке', '10–15 секунд', ['движение', 'лазает']),
      shot('ест крупно: мордочка и лапки, слышно хруст', 'близко, чтобы видны лапки; телефон не трогать', '20–30 секунд', ['ест', 'asmr?']),
      shot('финал: умывается или смотрит в камеру', 'мордочка крупно', '5–10 секунд', ['умывается', 'смотрит в камеру']),
    ],
  },
  {
    id: 'wake', kind: 'beforeAfter', title: 'Сначала спал, потом…', hook: 'Он просыпается…',
    shots: [
      shot('спит или дремлет в домике', 'на уровне мордочки, чуть сбоку, без рук', '10–15 секунд', ['спит', 'спокойно']),
      shot('первый потяг и взгляд, выбирается наружу', 'то же место, запись не выключать', '15–20 секунд', ['движение', 'смотрит в камеру']),
    ],
  },
  {
    id: 'day', kind: 'day', title: 'Один день', hook: 'Как проходит его день',
    shots: [
      shot('утро: сонный в домике или в мешочке', 'мордочка в кадре сразу', '10 секунд', ['спит', 'спокойно']),
      shot('день: ест что-то новое (не цитрус)', 'близко, чтобы видны лапки', '10–15 секунд', ['ест']),
      shot('вечер: лазает или играет', 'издали, чтобы видно весь путь', '15–20 секунд', ['лазает', 'играет', 'движение']),
    ],
  },
  {
    id: 'five', kind: 'top5', title: 'Пять дел за вечер', hook: 'Чем он занят?',
    shots: [
      shot('ест', 'близко, лапки в кадре', '10 секунд', ['ест']),
      shot('лазает по ветке или домику', 'сбоку, весь зверёк в кадре', '15 секунд', ['лазает']),
      shot('играет с рукой или игрушкой', 'на уровне стола, видно руку и зверька', '10–15 секунд', ['играет']),
      shot('прыжок — запись включить за 3–5 секунд до него', 'сбоку, чтобы виден весь прыжок', '10–20 секунд', ['прыжок']),
      shot('финал: умывается', 'мордочка крупно', '5–10 секунд', ['умывается']),
    ],
  },
  {
    id: 'calm', kind: 'calm', title: 'Тихий вечер', hook: 'Тихо…',
    shots: [
      shot('тихо сидит на ладони', 'крупно, мордочка на ладони', '15–20 секунд', ['спокойно']),
      shot('умывается', 'близко, телефон на подставке', '10–15 секунд', ['умывается']),
      shot('засыпает в мешочке или домике', 'мордочка в кадре, без рук', '15–20 секунд', ['спит']),
    ],
  },
  {
    id: 'jumps', kind: 'series', title: 'Прыжок за прыжком', hook: 'Он полетел?!',
    shots: [
      shot('первый прыжок к тебе с плеча или кресла', 'сбоку, весь пролёт в кадре; телефон на подставке', '10–20 секунд', ['прыжок']),
      shot('второй прыжок — с другого места', 'издали, чтобы видно, откуда и куда', '10–20 секунд', ['прыжок']),
      shot('приземлился и смотрит в камеру', 'мордочка крупно', '5 секунд', ['смотрит в камеру']),
    ],
  },
];

export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Day template: in rotation, but not the story type that was last in the calendar. */
export function pickScenario({ now = Date.now(), history = [] } = {}) {
  const last = [...(Array.isArray(history) ? history : [])].sort((x, y) => (x.at ?? 0) - (y.at ?? 0)).at(-1)?.kind ?? null;
  let i = Math.floor(dayStart(now) / 864e5) % SCENARIOS.length;
  if (SCENARIOS[i].kind === last) i = (i + 1) % SCENARIOS.length;
  const s = SCENARIOS[i];
  return { ...s, shots: s.shots.map((x, n) => ({ ...x, n: n + 1 })), date: dayKey(now), note: HANDS, source: 'шаблон' };
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'hook', 'shots'],
  properties: {
    title: { type: 'string' }, hook: { type: 'string' },
    shots: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['what', 'angle', 'secs'], properties: { what: { type: 'string' }, angle: { type: 'string' }, secs: { type: 'string' } } } },
  },
};

const brief = (s) => [
  'Ты режиссёр коротких вертикальных роликов про сахарного поссума (ночной зверёк). Перепиши сценарий съёмки на сегодня живее и конкретнее, по-русски, коротко, на «ты».',
  `Тип ролика: ${s.kind}. Кадры (порядок и число не меняй, суть кадра сохрани):`,
  ...s.shots.map((x) => `${x.n}. ${x.what} | угол: ${x.angle} | ${x.secs}`),
  'Правила: благополучие зверька выше кадра; без белого света и вспышки; в кадре только руки, без лица человека; не называй имён; одежду на зверька не надевать.',
  'Верни JSON: title (до 40 знаков), hook (крючок, до 30 знаков), shots — what, angle, secs для каждого кадра.',
].join('\n');

const tidy = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** AI texts on top of the template: markers, light and story type come from the template; a bad reply — the template as it was. */
export async function aiScenario(ai, base) {
  if (!ai?.enabled || typeof ai.json !== 'function') return base;
  try {
    const j = await ai.json({ content: brief(base), schema: SCHEMA, name: 'shoot_plan', maxTokens: 900 });
    const shots = Array.isArray(j?.shots) ? j.shots : [];
    if (shots.length !== base.shots.length || !tidy(j.title, 60)) return { ...base, fallbackReason: 'ответ ИИ неполный — сценарий по шаблону' };
    const texts = [j.title, j.hook, ...shots.flatMap((x) => [x.what, x.angle, x.secs])].join(' ');
    if (BANNED.test(texts)) return { ...base, fallbackReason: 'ИИ предложил то, что зверьку вредно или показывает людей, — сценарий по шаблону' };
    return {
      ...base, title: tidy(j.title, 60), hook: tidy(j.hook, 40) || base.hook, source: 'ИИ',
      shots: base.shots.map((x, k) => ({ ...x, what: tidy(shots[k].what, 120) || x.what, angle: tidy(shots[k].angle, 100) || x.angle, secs: tidy(shots[k].secs, 30) || x.secs })),
    };
  } catch (e) {
    return { ...base, fallbackReason: `ИИ недоступен (${tidy(e?.message ?? e, 120)}) — сценарий по шаблону` };
  }
}

const low = (a) => (a ?? []).map((l) => String(l).toLowerCase());
const fits = (want, labels) => { const have = low(labels); return low(want).some((w) => have.includes(w)); };

/**
 * What from the scenario is already shot: good plans of videos added since the start of the scenario's day (own pet, no defects).
 * Returns frames with have/found and the count "shot X of Y".
 */
export function coverage(scenario, clips = [], { since = null } = {}) {
  const from = since ?? (scenario?.date ? new Date(`${scenario.date}T00:00:00`).getTime() : 0);
  const fresh = clips.filter((c) => c && c.pet !== false && (c.addedAt ?? 0) >= from);
  const shots = (scenario?.shots ?? []).map((x) => {
    const found = [];
    for (const c of fresh) (c.shots ?? []).forEach((s, i) => { if (!s.defects?.length && fits(x.labels, s.labels)) found.push({ clip: c.id, shot: i, name: c.name }); });
    return { ...x, have: found.length > 0, found: found.slice(0, 5) };
  });
  const done = shots.filter((s) => s.have).length;
  return { shots, done, total: shots.length, missing: shots.filter((s) => !s.have).map((s) => s.n), clips: fresh.length };
}

// The order of the pieces in these stories is set by the story itself ("First/Then", morning→evening) — we do not touch it.
const FIXED = new Set(['day', 'beforeAfter']);

/**
 * Editing by scenario: each piece takes the place of the first matching frame of the scenario; non-matching ones go to the end.
 * Captions and "hold the frame" are tied to the position (No. 5…No. 1, "Episode"), so they stay in their places.
 */
export function orderByScenario(story, scenario, labelsOf) {
  if (!story || !scenario || story.kind !== scenario.kind || FIXED.has(story.kind) || !KINDS.includes(story.kind)) return story;
  const rank = (p) => { const k = scenario.shots.findIndex((x) => fits(x.labels, labelsOf(p))); return k < 0 ? scenario.shots.length : k; };
  const sorted = story.pieces.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.p);
  if (sorted.every((p, i) => p === story.pieces[i])) return story;
  const pieces = sorted.map((p, i) => {
    const slot = story.pieces[i];
    const out = { ...p, caption: slot.caption ?? null };
    if (slot.hold) out.hold = true; else delete out.hold;
    return out;
  });
  return { ...story, pieces, byScenario: scenario.id };
}
