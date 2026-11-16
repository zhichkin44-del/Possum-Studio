// Шаг Б разбора, по желанию: лист 3×3 из лучших кадров клипа → Haiku → что делает зверёк по каждому кадру.
// Без ключа (или при дневном потолке) — метки из сигналов, честно «без Claude». Кэш по id клипа.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { stripNames } from './packages.js';
import { redactSecrets } from './settings.js';
import { providerOf, modelFor, chatJson } from './openrouter.js';

export const VISION_MODEL = 'claude-haiku-5-5'; // зашита, отдельно от модели текстов
export const ACTIONS = ['ест', 'прыжок', 'умывается', 'спит', 'играет', 'лазает', 'прячется', 'смотрит в камеру'];
export const PRICE = { in: 0.10, out: 0.50 }; // $ за 1 млн токенов, Haiku 5.5 (из PLAN); цены OpenRouter — в core/openrouter.js
export const CELL = { w: 384, h: 216 };       // 3×3 → 1152×648
const MOODS = ['спокойный', 'игривый', 'любопытный', 'сонный', 'насторожен'];
const r6 = (x) => Math.round(x * 1e6) / 1e6;

const SCHEMA = {
  type: 'object',
  properties: {
    frames: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', description: 'номер кадра 1..9' },
          action: { type: 'string', enum: [...ACTIONS, 'не видно'] },
          stress: { type: 'boolean', description: 'зверёк упал, испуган или в стрессе' },
        },
        required: ['n', 'action', 'stress'],
        additionalProperties: false,
      },
    },
    mood: { type: 'string', enum: MOODS },
    best: { type: 'integer', description: 'номер лучшего кадра для обложки 1..9' },
    asmr: { type: 'boolean', description: 'спокойно ест или хрустит — годится для ASMR' },
    pet: { type: 'boolean', description: 'на кадрах сахарный поссум, а не другое животное' },
  },
  required: ['frames', 'mood', 'best', 'asmr', 'pet'],
  additionalProperties: false,
};

const PROMPT = [
  'На картинке 9 кадров одного видео с сахарным поссумом, сетка 3×3: кадры 1–3 — верхний ряд слева направо, 4–6 — средний, 7–9 — нижний.',
  'Для каждого кадра скажи, что делает зверёк (одно слово из списка; «не видно», если зверька нет или не разобрать) и есть ли признаки стресса или падения.',
  'Ночные и инфракрасные (серые) кадры — это нормально, зверёк ночной; темнота — не брак.',
  'pet: false, если на кадрах другое животное (кошка, собака, хорёк, хомяк…) или зверька нет совсем.',
  'Ещё: общее настроение, лучший кадр для обложки, годится ли видео для ASMR (тихо ест, хрустит).',
  'Только то, что видно на кадрах. Без советов про свет и вспышку. Без имён.',
].join('\n');

/** 9 кадров для листа: середины/лучшие моменты лучших хороших планов; если планов мало — несколько точек на план. */
export function pickSheetFrames(clip, count = 9) {
  const good = clip.shots.map((s, i) => ({ s, i })).filter((x) => !x.s.defects.length);
  const pool = (good.length ? good : clip.shots.map((s, i) => ({ s, i }))).sort((a, b) => b.s.score - a.s.score);
  if (!pool.length) return [];
  const take = pool.slice(0, count);
  const per = Math.ceil(count / take.length);
  const out = [];
  for (const { s, i } of take) {
    for (let k = 0; k < per && out.length < count; k++) {
      const t = k === 0 ? s.best?.t ?? s.from + s.len / 2 : s.from + (s.len * (k + 0.5)) / per;
      out.push({ shot: i, t: Math.round(Math.min(s.from + s.len - 0.05, Math.max(s.from, t)) * 100) / 100 });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** ffmpeg: 9 кадров → лист 1152×648 JPEG. */
export function sheetArgs({ src, frames, out }) {
  const fr = frames.slice(0, 9);
  while (fr.length < 9) fr.push(fr[fr.length - 1]);
  const inputs = fr.flatMap((f) => ['-ss', f.t.toFixed(3), '-i', src]);
  const parts = fr.map((_, k) => `[${k}:v]scale=${CELL.w}:${CELL.h}:force_original_aspect_ratio=decrease,pad=${CELL.w}:${CELL.h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,trim=end_frame=1[c${k}]`);
  const layout = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => `${col * CELL.w}_${row * CELL.h}`)).join('|');
  parts.push(`${fr.map((_, k) => `[c${k}]`).join('')}xstack=inputs=9:layout=${layout}[sheet]`);
  return ['-y', ...inputs, '-filter_complex', parts.join(';'), '-map', '[sheet]', '-frames:v', '1', '-q:v', '4', out];
}

export async function makeSheet({ src, clip, out, media }) {
  const frames = pickSheetFrames(clip);
  if (!frames.length) return null;
  mkdirSync(dirname(out), { recursive: true });
  await media.ffmpeg(sheetArgs({ src, frames, out }), { timeoutMs: 180_000 });
  return { file: out, frames };
}

/** Метки без Claude: из сигналов, честно помечены. */
export function signalVision(clip, note = 'без Claude') {
  const asmr = clip.shots.some((s) => s.labels.includes('asmr?') && !s.defects.length);
  return { by: 'сигналы', note, mood: null, asmr, cost: 0, frames: [] };
}

/** Ответ модели → формат library.setVision: n кадра → индекс плана, «стресс» — блок. */
export function toVision(j, frames, { cost = 0, petNames = [] } = {}) {
  const out = [];
  for (const f of Array.isArray(j?.frames) ? j.frames : []) {
    const pick = frames[Number(f.n) - 1];
    if (!pick) continue;
    const labels = [];
    if (ACTIONS.includes(f.action)) labels.push(f.action);
    if (f.action === 'прыжок') labels.push('движение');
    if (f.stress === true) labels.push('стресс');
    if (f.action === 'не видно') labels.push('нет зверька');
    if (labels.length) out.push({ shot: pick.shot, labels });
  }
  const mood = MOODS.includes(j?.mood) ? j.mood : (j?.mood ? stripNames(String(j.mood), petNames).slice(0, 40) : null);
  const best = frames[Number(j?.best) - 1];
  return { by: 'claude', notPet: j?.pet === false, mood, asmr: j?.asmr === true, cost: r6(cost), frames: out, bestShot: best?.shot ?? null, bestT: best?.t ?? null };
}

export function costOf(usage = {}) {
  const inTok = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  return (inTok * PRICE.in + (usage.output_tokens ?? 0) * PRICE.out) / 1e6;
}

/**
 * Разборщик. analyze({clip, image}) → vision для library.setVision.
 * image — Buffer JPEG листа (или путь), frames — какие планы на листе (из makeSheet).
 */
export function createVision({ apiKey = '', client = null, model, dailyCapUsd = 0.25, cachePath = null, now = () => Date.now(), petNames = [], fetchImpl = fetch } = {}) {
  // Ключ OpenRouter — модель из настроек (по умолчанию Haiku через OpenRouter); ключ Claude — Haiku через SDK, как раньше.
  const viaOr = providerOf(apiKey) === 'openrouter';
  model = viaOr ? modelFor(apiKey, model) : (model ?? VISION_MODEL);
  const who = viaOr ? 'OpenRouter' : 'Claude';
  let sdk = client;
  let cache = { spend: {}, clips: {} };
  if (cachePath && existsSync(cachePath)) { try { cache = { spend: {}, clips: {}, ...JSON.parse(readFileSync(cachePath, 'utf8')) }; } catch { /* битый кэш — начинаем заново */ } }
  const save = () => {
    if (!cachePath) return;
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(`${cachePath}.tmp`, JSON.stringify(cache));
    renameSync(`${cachePath}.tmp`, cachePath);
  };
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const spentToday = () => cache.spend[today()] ?? 0;
  async function getClient() {
    if (sdk) return sdk;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = new Anthropic({ apiKey });
    return sdk;
  }

  return {
    enabled: Boolean(apiKey || client),
    model,
    spentToday,
    cached: (id) => cache.clips[id] ?? null,
    async analyze({ clip, image, frames }) {
      if (cache.clips[clip.id]) return { ...cache.clips[clip.id], fromCache: true };
      if (!apiKey && !client) return signalVision(clip);
      if (!image || !frames?.length) return signalVision(clip, 'нет кадров для разбора');
      if (spentToday() >= dailyCapUsd) return signalVision(clip, `дневной потолок $${dailyCapUsd} — без ${who} до завтра`);
      try {
        const data = (Buffer.isBuffer(image) ? image : readFileSync(image)).toString('base64');
        if (viaOr) {
          let r;
          try {
            r = await chatJson({ apiKey, model, schema: SCHEMA, name: 'vision_labels', maxTokens: 1024, fetchImpl, content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${data}` } },
              { type: 'text', text: PROMPT },
            ] });
          } catch (e) {
            return signalVision(clip, `OpenRouter недоступен (${redactSecrets(e?.message ?? e, { claudeKey: apiKey }).slice(0, 160)})`);
          }
          cache.spend[today()] = r6(spentToday() + r.cost);
          const v = { ...toVision(r.json, frames, { cost: r.cost, petNames }), provider: 'openrouter', model };
          cache.clips[clip.id] = v;
          save();
          return v;
        }
        const c = await getClient();
        const res = await c.messages.create({
          model,
          max_tokens: 1024,
          output_config: { format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text: PROMPT },
          ] }],
        });
        const cost = costOf(res.usage);
        cache.spend[today()] = r6(spentToday() + cost);
        if (res.stop_reason === 'refusal') { save(); return signalVision(clip, 'Claude отказался — метки из сигналов'); }
        const text = (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        const v = toVision(JSON.parse(text), frames, { cost, petNames });
        cache.clips[clip.id] = v;
        save();
        return v;
      } catch (e) {
        return signalVision(clip, `Claude недоступен (${redactSecrets(e?.message ?? e, { claudeKey: apiKey }).slice(0, 160)})`);
      }
    },
  };
}
