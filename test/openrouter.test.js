// AI key: Claude (sk-ant-…) — via the Anthropic SDK, OpenRouter (sk-or-…) — via fetch to openrouter.ai/api/v1.
// No real keys or network: a fake fetch and a fake client. The key never gets into reasons or logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { providerOf, modelFor, OR_MODELS, OR_DEFAULT, OR_PRICES, OR_URL, chatJson, orCost, parseJsonLoose } from '../core/openrouter.js';
import { createAi, textCost } from '../core/ai.js';
import { createVision } from '../core/vision.js';
import { migrateSettings, maskSettings, redactSecrets, DEFAULTS } from '../core/settings.js';

const OR_KEY = 'sk-or-v1-REDACTEDcdef'; // fake
const ANT_KEY = 'sk-ant-REDACTEDfake';             // fake
const IMG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const shot = (from, len, score) => ({ from, len, score, best: { t: from + len / 2, kind: 'move', score }, peaks: [], labels: [], defects: [], why: '', hash: null });
const clip = { id: 'c1', name: 'a.mp4', shots: [shot(0, 4, 0.9), shot(4, 4, 0.8)] };
const frames = [{ shot: 0, t: 2 }, { shot: 1, t: 6 }];
const TEXTS = { titleRu: 'Прыжок', titleEn: 'Jump', descRu: 'Зверёк прыгает.', tags: ['питомцы'] };
const VIS = { frames: [{ n: 1, action: 'ест', stress: false }], mood: 'спокойный', best: 1, asmr: true, pet: true };

/** Fake fetch: records requests, answers as OpenRouter. */
function fakeFetch(reply, { usage = { prompt_tokens: 1000, completion_tokens: 200 }, status = 200, throwMsg = null, raw = null } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (throwMsg) throw new Error(throwMsg);
    const json = raw ?? { choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) }, finish_reason: 'stop' }], usage };
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
  };
  f.calls = calls;
  return f;
}
const antClient = (reply) => {
  const calls = [];
  const create = async (req) => { calls.push(req); return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: JSON.stringify(reply) }] }; };
  return { calls, beta: { messages: { create } }, messages: { create } };
};

test('provider by prefix: sk-ant → Anthropic, sk-or → OpenRouter, empty → none', () => {
  assert.equal(providerOf(ANT_KEY), 'anthropic');
  assert.equal(providerOf(OR_KEY), 'openrouter');
  assert.equal(providerOf('  ' + OR_KEY), 'openrouter');
  assert.equal(providerOf(''), '');
  assert.equal(providerOf(undefined), '');
});

test('OpenRouter models: default Claude Haiku, second — Gemini Flash-Lite; IDs and prices from the OpenRouter list', () => {
  assert.equal(OR_DEFAULT, 'anthropic/claude-haiku-5.5');
  assert.deepEqual(OR_MODELS.map((m) => m.id), ['anthropic/claude-haiku-5.5', 'google/gemini-2.5-flash-lite']);
  assert.deepEqual(OR_PRICES['anthropic/claude-haiku-5.5'], { in: 0.10, out: 0.50 });
  assert.deepEqual(OR_PRICES['google/gemini-2.5-flash-lite'], { in: 0.10, out: 0.40 });
  assert.equal(OR_URL, 'https://openrouter.ai/api/v1/chat/completions');
  const src = readFileSync(new URL('../core/openrouter.js', import.meta.url), 'utf8');
  assert.match(src, /openrouter\.ai\/models/, 'the source of prices is named in a comment');
});

test('modelFor: OpenRouter key — model from the list or Haiku; Claude key — Claude model', () => {
  assert.equal(modelFor(OR_KEY, 'google/gemini-2.5-flash-lite'), 'google/gemini-2.5-flash-lite');
  assert.equal(modelFor(OR_KEY, 'claude-opus-5-5'), OR_DEFAULT);
  assert.equal(modelFor(OR_KEY, 'openai/whatever'), OR_DEFAULT);
  assert.equal(modelFor(ANT_KEY, 'claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(modelFor(ANT_KEY, 'google/gemini-2.5-flash-lite'), DEFAULTS.model);
});

test('settings: OpenRouter model survives migration, a foreign one is reset', () => {
  assert.equal(migrateSettings({ model: 'google/gemini-2.5-flash-lite', schema: 2 }).model, 'google/gemini-2.5-flash-lite');
  assert.equal(migrateSettings({ model: 'anthropic/claude-haiku-5.5', schema: 2 }).model, 'anthropic/claude-haiku-5.5');
  assert.equal(migrateSettings({ model: 'openai/gpt-x', schema: 2 }).model, DEFAULTS.model);
});

test('mask: key is hidden, provider and the model used to count spend are visible', () => {
  const m = maskSettings({ ...DEFAULTS, claudeKey: OR_KEY, model: 'google/gemini-2.5-flash-lite' });
  assert.equal(m.claudeKey, `•••${OR_KEY.slice(-4)}`);
  assert.equal(m.provider, 'openrouter');
  assert.equal(m.aiModel, 'google/gemini-2.5-flash-lite');
  assert.ok(!JSON.stringify(m).includes(OR_KEY.slice(0, 12)));
  const a = maskSettings({ ...DEFAULTS, claudeKey: ANT_KEY });
  assert.equal(a.provider, 'anthropic');
  assert.equal(a.aiModel, 'claude-opus-5-5');
});

test('textCost knows both OpenRouter models', () => {
  for (const id of ['anthropic/claude-haiku-5.5', 'google/gemini-2.5-flash-lite']) {
    const c = textCost(id);
    assert.ok(c, id);
    assert.equal(c.priceIn, OR_PRICES[id].in);
    assert.equal(c.priceOut, OR_PRICES[id].out);
    assert.ok(c.perClipMax > c.perClip && c.perClip > 0);
  }
});

test('texts, sk-ant: go through the Anthropic client, fetch is not touched', async () => {
  const client = antClient(TEXTS);
  const fetchImpl = fakeFetch(TEXTS);
  const r = await createAi({ apiKey: ANT_KEY, client, model: 'claude-opus-5-5', fetchImpl }).suggest({});
  assert.equal(r.source, 'claude');
  assert.equal(client.calls.length, 1);
  assert.equal(fetchImpl.calls.length, 0);
});

test('texts, sk-or: POST to OpenRouter, Bearer, JSON schema, require_parameters, Haiku model by default', async () => {
  const fetchImpl = fakeFetch(TEXTS);
  const client = antClient(TEXTS);
  const r = await createAi({ apiKey: OR_KEY, client, model: 'claude-opus-5-5', fetchImpl }).suggest({ duration: 12 });
  assert.equal(client.calls.length, 0, 'the Anthropic client is not called with an OpenRouter key');
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init, body } = fetchImpl.calls[0];
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${OR_KEY}`);
  assert.equal(body.model, 'anthropic/claude-haiku-5.5');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, ['titleRu', 'titleEn', 'descRu', 'tags', 'descEn', 'tagsEn']);
  assert.equal(body.provider.require_parameters, true);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(r.source, 'claude', 'the "AI wrote" flag is unchanged — the library and window depend on it');
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, 'anthropic/claude-haiku-5.5');
  assert.equal(r.titleRu, 'Прыжок');
});

test('texts, sk-or: the chosen Gemini goes into the request; a response in ```-fences is parsed', async () => {
  const fetchImpl = fakeFetch('```json\n' + JSON.stringify(TEXTS) + '\n```');
  const r = await createAi({ apiKey: OR_KEY, model: 'google/gemini-2.5-flash-lite', fetchImpl }).suggest({});
  assert.equal(fetchImpl.calls[0].body.model, 'google/gemini-2.5-flash-lite');
  assert.equal(r.source, 'claude');
  assert.equal(r.model, 'google/gemini-2.5-flash-lite');
});

test('texts, sk-or: network refusal → template with an honest label, no key in the reason', async () => {
  const fetchImpl = fakeFetch(null, { throwMsg: `connect ECONNREFUSED; Authorization: Bearer ${OR_KEY} key=${OR_KEY}` });
  const r = await createAi({ apiKey: OR_KEY, fetchImpl }).suggest({});
  assert.equal(r.source, 'шаблон');
  assert.match(r.fallbackReason, /^OpenRouter недоступен \(.*\) — тексты по шаблону$/);
  assert.ok(!r.fallbackReason.includes(OR_KEY));
  assert.ok(!r.fallbackReason.includes('sk-or-'));
});

test('texts, sk-or: HTTP 401 / broken JSON / incomplete response → template', async () => {
  const e401 = fakeFetch(null, { status: 401, raw: { error: { message: 'No auth credentials found', code: 401 } } });
  const a = await createAi({ apiKey: OR_KEY, fetchImpl: e401 }).suggest({});
  assert.equal(a.source, 'шаблон');
  assert.match(a.fallbackReason, /OpenRouter недоступен \(.*401.*\)/);
  const broken = await createAi({ apiKey: OR_KEY, fetchImpl: fakeFetch('вот вам {не json') }).suggest({});
  assert.equal(broken.source, 'шаблон');
  assert.match(broken.fallbackReason, /OpenRouter/);
  const partial = await createAi({ apiKey: OR_KEY, fetchImpl: fakeFetch({ titleRu: 'x' }) }).suggest({});
  assert.equal(partial.source, 'шаблон');
  assert.equal(partial.fallbackReason, 'ответ OpenRouter неполный — тексты по шаблону');
  const empty = await createAi({ apiKey: OR_KEY, fetchImpl: fakeFetch(null, { raw: { choices: [] } }) }).suggest({});
  assert.equal(empty.source, 'шаблон');
});

test('response parsing: string, array of parts, fences, text around JSON; garbage — error', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose([{ type: 'text', text: '{"a":' }, { type: 'text', text: '2}' }]), { a: 2 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":3}\n```'), { a: 3 });
  assert.deepEqual(parseJsonLoose('Вот ответ: {"a":4} — готово'), { a: 4 });
  assert.throws(() => parseJsonLoose('нет json'));
  assert.throws(() => parseJsonLoose(''));
});

test('vision, sk-or: the picture goes as image_url data:image/jpeg;base64 to the chosen model, spend counts toward the daily limit', async () => {
  const fetchImpl = fakeFetch(VIS, { usage: { prompt_tokens: 1000, completion_tokens: 200 } });
  const v = createVision({ apiKey: OR_KEY, model: 'google/gemini-2.5-flash-lite', fetchImpl });
  const r = await v.analyze({ clip, image: IMG, frames });
  const { url, init, body } = fetchImpl.calls[0];
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init.headers.Authorization, `Bearer ${OR_KEY}`);
  assert.equal(body.model, 'google/gemini-2.5-flash-lite');
  const parts = body.messages[0].content;
  const img = parts.find((p) => p.type === 'image_url');
  assert.equal(img.image_url.url, `data:image/jpeg;base64,${IMG.toString('base64')}`);
  assert.ok(parts.some((p) => p.type === 'text'));
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(r.by, 'claude', 'the "AI parsed" flag is unchanged');
  assert.equal(r.provider, 'openrouter');
  const expect = (1000 * 0.10 + 200 * 0.40) / 1e6;
  assert.ok(Math.abs(r.cost - expect) < 1e-9);
  assert.ok(Math.abs(v.spentToday() - expect) < 1e-9);
});

test('vision, sk-or: default model — Haiku via OpenRouter; usage.cost is used if OpenRouter sent it', async () => {
  const fetchImpl = fakeFetch(VIS, { usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.0042 } });
  const v = createVision({ apiKey: OR_KEY, fetchImpl });
  const r = await v.analyze({ clip, image: IMG, frames });
  assert.equal(fetchImpl.calls[0].body.model, 'anthropic/claude-haiku-5.5');
  assert.equal(r.cost, 0.0042);
  assert.equal(v.spentToday(), 0.0042);
});

test('vision, sk-or: daily cap also works for OpenRouter', async () => {
  const fetchImpl = fakeFetch(VIS, { usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0.3 } });
  const v = createVision({ apiKey: OR_KEY, fetchImpl, dailyCapUsd: 0.25 });
  await v.analyze({ clip, image: IMG, frames });
  const r2 = await v.analyze({ clip: { ...clip, id: 'c2' }, image: IMG, frames });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(r2.by, 'сигналы');
  assert.match(r2.note, /дневной потолок/);
});

test('vision, sk-or: network refusal and broken JSON → labels from signals, no key in the note', async () => {
  const down = createVision({ apiKey: OR_KEY, fetchImpl: fakeFetch(null, { throwMsg: `fetch failed Bearer ${OR_KEY}` }) });
  const a = await down.analyze({ clip, image: IMG, frames });
  assert.equal(a.by, 'сигналы');
  assert.match(a.note, /^OpenRouter недоступен/);
  assert.ok(!a.note.includes(OR_KEY) && !a.note.includes('sk-or-'));
  const bad = createVision({ apiKey: OR_KEY, fetchImpl: fakeFetch('не json вовсе') });
  const b = await bad.analyze({ clip, image: IMG, frames });
  assert.equal(b.by, 'сигналы');
});

test('vision, sk-ant: goes through the Anthropic client, as before', async () => {
  const client = antClient(VIS);
  const fetchImpl = fakeFetch(VIS);
  const r = await createVision({ apiKey: ANT_KEY, client, fetchImpl }).analyze({ clip, image: IMG, frames });
  assert.equal(client.calls.length, 1);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(r.by, 'claude');
});

test('redactSecrets strips sk-or- even without settings', () => {
  const t = redactSecrets(`ошибка ${OR_KEY} и ${ANT_KEY}`);
  assert.ok(!t.includes('sk-or-') && !t.includes('sk-ant-'));
});

test('OpenRouter key does not reach the console, neither on success nor on failure', async () => {
  const seen = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => seen.push(a.map(String).join(' '));
  try {
    await createAi({ apiKey: OR_KEY, fetchImpl: fakeFetch(TEXTS) }).suggest({});
    await createAi({ apiKey: OR_KEY, fetchImpl: fakeFetch(null, { throwMsg: `boom ${OR_KEY}` }) }).suggest({});
    await createVision({ apiKey: OR_KEY, fetchImpl: fakeFetch(VIS) }).analyze({ clip, image: IMG, frames });
    await createVision({ apiKey: OR_KEY, fetchImpl: fakeFetch(null, { throwMsg: `boom ${OR_KEY}` }) }).analyze({ clip: { ...clip, id: 'z' }, image: IMG, frames });
    await chatJson({ apiKey: OR_KEY, model: OR_DEFAULT, content: 'x', schema: { type: 'object' }, name: 't', fetchImpl: fakeFetch({}) });
  } finally { Object.assign(console, orig); }
  assert.ok(!seen.join('\n').includes(OR_KEY));
});

test('orCost: usage.cost or tokens × price; unknown model — 0', () => {
  assert.equal(orCost('google/gemini-2.5-flash-lite', { cost: 0.01 }), 0.01);
  assert.ok(Math.abs(orCost('anthropic/claude-haiku-5.5', { prompt_tokens: 1e6, completion_tokens: 1e6 }) - 0.6) < 1e-12);
  assert.equal(orCost('x/y', { prompt_tokens: 100 }), 0);
});

test('window: "AI key" with a caption about both keys, model choice in settings', () => {
  const html = readFileSync(new URL('../app/ui/index.html', import.meta.url), 'utf8');
  assert.match(html, /Ключ ИИ/);
  assert.match(html, /Подойдёт ключ Claude \(sk-ant…\) или OpenRouter \(sk-or…\)/);
  assert.doesNotMatch(html, /<h3>Ключ Claude/);
  const sel = html.slice(html.indexOf('<select name="model"'), html.indexOf('</select>', html.indexOf('<select name="model"')));
  assert.match(sel, /value="anthropic\/claude-haiku-5\.5"/);
  assert.match(sel, /value="google\/gemini-2\.5-flash-lite"/);
  assert.match(html, /name="claudeKey" type="password"/, 'mask and field type as before');
  const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
  assert.match(main, /textCost\(need\(\)\.masked\(\)\.aiModel\)/);
});
