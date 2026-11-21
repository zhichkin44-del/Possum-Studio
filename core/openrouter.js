// AI key from OpenRouter (sk-or-…): cheap models without an Anthropic balance. A Claude key (sk-ant-…) goes as before, through the SDK.
// OpenRouter — an OpenAI-compatible Chat Completions API, called via fetch, with no new dependencies.
// No import of settings.js: settings takes the model list from here itself.

export const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const CLAUDE_DEFAULT = 'claude-opus-5-5'; // default model for a Claude key (= DEFAULTS.model)

// OpenRouter prices, $ per 1M tokens (input / output). Source — https://openrouter.ai/models
// (API https://openrouter.ai/api/v1/models, fields pricing.prompt / pricing.completion × 1e6), 16.11.2026. When it changes, we edit it here.
export const OR_PRICES = {
  'anthropic/claude-haiku-5.5': { in: 0.10, out: 0.50 },
  'google/gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
};
export const OR_DEFAULT = 'anthropic/claude-haiku-5.5';
/** Choice in settings (both models accept images and a JSON schema). */
export const OR_MODELS = [
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5 — по умолчанию' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — самая дешёвая' },
];

/** By key prefix: 'openrouter' | 'anthropic' | '' (no key). */
export function providerOf(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return '';
  return k.startsWith('sk-or-') ? 'openrouter' : 'anthropic';
}

/** Which model the request will actually use with this key. */
export function modelFor(key, model) {
  if (providerOf(key) === 'openrouter') return OR_PRICES[model] ? model : OR_DEFAULT;
  return typeof model === 'string' && model.startsWith('claude-') ? model : CLAUDE_DEFAULT;
}

/** Request cost: usage.cost if OpenRouter sent it, otherwise tokens × price. Unknown model — 0. */
export function orCost(model, usage = {}) {
  if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost)) return usage.cost;
  const p = OR_PRICES[model];
  if (!p) return 0;
  return ((usage?.prompt_tokens ?? 0) * p.in + (usage?.completion_tokens ?? 0) * p.out) / 1e6;
}

/** Careful parsing: a string or an array of parts; we strip ``` fences; we take from the first "{" to the last "}". */
export function parseJsonLoose(content) {
  const text = Array.isArray(content)
    ? content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
    : String(content ?? '');
  const s = text.replace(/```(?:json)?/gi, '').trim();
  if (!s) throw new Error('empty reply');
  try { return JSON.parse(s); } catch { /* below — we cut the object out of the text */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON in the reply');
  try { return JSON.parse(s.slice(a, b + 1)); } catch { throw new Error('reply is not JSON'); }
}

/**
 * One request to OpenRouter with a reply by JSON schema.
 * content — a string or an array of parts ({type:'text'} / {type:'image_url'}).
 * → { json, usage, cost, model }. Errors — Error with a short text (there is no key in them: we do not put it there).
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
      provider: { require_parameters: true }, // only providers that support a JSON schema
    }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON — the status error comes below */ }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message ? String(body.error.message).slice(0, 120) : 'нет ответа';
    throw new Error(`HTTP ${res.status ?? '?'}: ${msg}`);
  }
  const choice = body?.choices?.[0];
  if (!choice) throw new Error('empty reply');
  if (choice.finish_reason === 'content_filter') throw new Error('model refused');
  const json = parseJsonLoose(choice.message?.content);
  return { json, usage: body.usage ?? {}, cost: orCost(model, body.usage ?? {}), model };
}
