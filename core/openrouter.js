// Ключ ИИ от OpenRouter (sk-or-…): дешёвые модели без баланса Anthropic. Ключ Claude (sk-ant-…) идёт как раньше, через SDK.
// OpenRouter — OpenAI-совместимый Chat Completions, вызываем через fetch, без новых зависимостей.
// Без импорта settings.js: settings сам берёт отсюда список моделей.

export const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const CLAUDE_DEFAULT = 'claude-opus-5-5'; // модель по умолчанию для ключа Claude (= DEFAULTS.model)

// Цены OpenRouter, $ за 1 млн токенов (вход / выход). Источник — https://openrouter.ai/models
// (API https://openrouter.ai/api/v1/models, поле pricing.prompt / pricing.completion × 1e6), 16.11.2026. Меняется — правим здесь.
export const OR_PRICES = {
  'anthropic/claude-haiku-5.5': { in: 0.10, out: 0.50 },
  'google/gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
};
export const OR_DEFAULT = 'anthropic/claude-haiku-5.5';
/** Выбор в настройках (обе модели принимают картинки и JSON-схему). */
export const OR_MODELS = [
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5 — по умолчанию' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — самая дешёвая' },
];

/** По префиксу ключа: 'openrouter' | 'anthropic' | '' (нет ключа). */
export function providerOf(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return '';
  return k.startsWith('sk-or-') ? 'openrouter' : 'anthropic';
}

/** Какой моделью реально пойдёт запрос при этом ключе. */
export function modelFor(key, model) {
  if (providerOf(key) === 'openrouter') return OR_PRICES[model] ? model : OR_DEFAULT;
  return typeof model === 'string' && model.startsWith('claude-') ? model : CLAUDE_DEFAULT;
}

/** Стоимость запроса: usage.cost, если OpenRouter его прислал, иначе токены × цена. Неизвестная модель — 0. */
export function orCost(model, usage = {}) {
  if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost)) return usage.cost;
  const p = OR_PRICES[model];
  if (!p) return 0;
  return ((usage?.prompt_tokens ?? 0) * p.in + (usage?.completion_tokens ?? 0) * p.out) / 1e6;
}

/** Осторожный разбор: строка или массив частей; срезаем ```-ограды; берём от первой «{» до последней «}». */
export function parseJsonLoose(content) {
  const text = Array.isArray(content)
    ? content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
    : String(content ?? '');
  const s = text.replace(/```(?:json)?/gi, '').trim();
  if (!s) throw new Error('пустой ответ');
  try { return JSON.parse(s); } catch { /* ниже — вырезаем объект из текста */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('в ответе нет JSON');
  try { return JSON.parse(s.slice(a, b + 1)); } catch { throw new Error('ответ — не JSON'); }
}

/**
 * Один запрос к OpenRouter с ответом по JSON-схеме.
 * content — строка или массив частей ({type:'text'} / {type:'image_url'}).
 * → { json, usage, cost, model }. Ошибки — Error с коротким текстом (ключа в них нет: мы его туда не кладём).
 */
export async function chatJson({ apiKey, model = OR_DEFAULT, content, schema, name = 'answer', maxTokens = 1024, fetchImpl = fetch }) {
  const res = await fetchImpl(OR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Possum Studio' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      provider: { require_parameters: true }, // только провайдеры, которые держат JSON-схему
    }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* не JSON — ниже ошибка по статусу */ }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message ? String(body.error.message).slice(0, 120) : 'нет ответа';
    throw new Error(`HTTP ${res.status ?? '?'}: ${msg}`);
  }
  const choice = body?.choices?.[0];
  if (!choice) throw new Error('пустой ответ');
  if (choice.finish_reason === 'content_filter') throw new Error('модель отказалась');
  const json = parseJsonLoose(choice.message?.content);
  return { json, usage: body.usage ?? {}, cost: orCost(model, body.usage ?? {}), model };
}
