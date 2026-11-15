// Тексты к ролику: Claude (если владелец дал ключ) или шаблоны — с честной меткой источника.
import { redactSecrets } from './settings.js';

const SCHEMA = {
  type: 'object',
  properties: {
    titleRu: { type: 'string' },
    titleEn: { type: 'string' },
    descRu: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['titleRu', 'titleEn', 'descRu', 'tags'],
  additionalProperties: false,
};

const TEMPLATES = {
  move: { titleRu: 'Прыжок, которого никто не ждал', titleEn: 'Nobody expected this jump', descRu: 'Сахарный поссум показывает, кто тут главный акробат.' },
  squeak: { titleRu: 'Он что-то сказал. Переведите', titleEn: 'He said something. Translate?', descRu: 'Сахарный поссум возмущён и не скрывает этого.' },
  none: { titleRu: 'Сахарный поссум занят важными делами', titleEn: 'Sugar glider on a very important mission', descRu: 'Маленький ночной зверёк и его большие планы.' },
};

export function templateTexts(facts = {}) {
  const kinds = (facts.peaks ?? []).map((p) => p.kind);
  const t = kinds.includes('squeak') ? TEMPLATES.squeak : kinds.includes('move') ? TEMPLATES.move : TEMPLATES.none;
  return { ...t, tags: ['sugarglider', 'сахарныйпоссум', 'поссум', 'питомцы', 'cute'] };
}

function prompt(facts) {
  const f = {
    длительность: facts.duration, вердикт: facts.advice?.verdict, почему: facts.advice?.why,
    моменты: (facts.peaks ?? []).map((p) => `${p.kind === 'move' ? 'прыжок' : 'писк'} на ${p.t?.toFixed?.(1)} с`),
    темно: facts.dark,
  };
  return [
    'Ты помогаешь вести канал про сахарного поссума (Shorts, TikTok, Reels). Придумай цепкий заголовок по-русски, перевод на английский, короткое описание (1–2 предложения) и до 8 тегов без «#».',
    'Правила: не называй кличку питомца и никаких политиков; не обещай просмотры и деньги; не советуй включать свет или снимать со вспышкой; пиши по фактам ниже, без выдумок.',
    `Факты анализа ролика: ${JSON.stringify(f)}`,
  ].join('\n');
}

const valid = (j) => j && typeof j.titleRu === 'string' && j.titleRu.trim() && typeof j.titleEn === 'string'
  && typeof j.descRu === 'string' && Array.isArray(j.tags);

export function createAi({ apiKey = '', client = null, model = 'claude-opus-5-5' } = {}) {
  let sdk = client;
  async function getClient() {
    if (sdk) return sdk;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = new Anthropic({ apiKey });
    return sdk;
  }
  const fallback = (facts, reason) => ({ ...templateTexts(facts), source: 'шаблон', fallbackReason: reason });

  return {
    enabled: Boolean(apiKey),
    async suggest(facts = {}) {
      if (!apiKey) return fallback(facts, 'нет ключа Claude — тексты по шаблону');
      try {
        const c = await getClient();
        const res = await c.beta.messages.create({
          model,
          max_tokens: 1500,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content: prompt(facts) }],
        });
        if (res.stop_reason === 'refusal') return fallback(facts, 'Claude отказался — тексты по шаблону');
        const text = (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        const j = JSON.parse(text);
        if (!valid(j)) return fallback(facts, 'ответ Claude неполный — тексты по шаблону');
        return { titleRu: j.titleRu, titleEn: j.titleEn, descRu: j.descRu, tags: j.tags.slice(0, 8), source: 'claude' };
      } catch (e) {
        return fallback(facts, `Claude недоступен (${redactSecrets(e?.message ?? e, { claudeKey: apiKey }).slice(0, 200)}) — тексты по шаблону`);
      }
    },
  };
}
