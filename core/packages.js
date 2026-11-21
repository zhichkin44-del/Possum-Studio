// Ready texts for three platforms. The pet's name is removed by default (risk of blocks); the owner's flag brings it back.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function stripNames(text, names = []) {
  let out = String(text ?? '');
  for (const n of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) {
    // the name as a whole word and its endings: Pip, Pipa, Pipu, Pipom, Bonya's.
    // Word boundaries are required: the name Tom does not cut Tomorrow, Max — Maximum, Bo — Bonus.
    out = out.replace(new RegExp(`(?<!\\p{L})${esc(n)}(?:'s|s|ами|ам|ах|ом|ым|ем|ой|ою|ей|ею|а|у|е|ю|я|и|ы)?(?!\\p{L})`, 'giu'), ' ');
  }
  out = out.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  out = out.replace(/^(и|and|,|—|-)\s+/iu, '').replace(/^[,.\-—\s]+/u, '');
  return cap(out);
}

// Two channels — two audiences: the Russian channel only with Russian tags, the English one only with English tags.
const BASE_TAGS = ['питомцы', 'зверёк', 'милыеживотные'];
const BASE_TAGS_EN = ['pets', 'cuteanimals', 'cutepets'];
const CYR = /[а-яё]/i;
const hash = (list) => list.map((t) => `#${t}`).join(' ');
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

/**
 * speciesName — the species confirmed by the owner ({ ru, en, tag }); without it the texts do not name the species.
 * lang — channel: 'ru' (default) or 'en'. The English package has not a single Cyrillic letter.
 */
export function buildPackages(texts, { petNames = [], allowName = false, speciesName = null, lang = 'ru' } = {}) {
  const en = lang === 'en';
  const sp = (en ? speciesName?.en : speciesName?.ru) ? speciesName : null;
  const enTag = (s) => s.replace(/\s+/g, '').toLowerCase();
  const spTags = !sp ? [] : en ? [enTag(sp.en)] : [sp.tag || sp.ru.replace(/\s+/g, ''), sp.en ? enTag(sp.en) : ''].filter(Boolean);
  const base = en ? BASE_TAGS_EN : BASE_TAGS;
  const TAGS = [...spTags.slice(0, 1), ...base];
  const TT_TAGS = [...spTags, ...base];
  const IG_TAGS = TT_TAGS;
  const clean = (s) => (allowName ? String(s ?? '').trim() : stripNames(s, petNames));
  // Cyrillic does not go into the English channel: sentences containing it are dropped whole
  const latin = (s) => (en ? String(s ?? '').split(/(?<=[.!?…])\s+/).filter((x) => !CYR.test(x)).join(' ') : s);
  const title = clean(latin(en ? texts.titleEn : texts.titleRu)) || (sp ? cap(en ? sp.en : sp.ru) : en ? 'Our little friend' : 'Наш зверёк');
  const desc = clean(latin(en ? texts.descEn : texts.descRu));
  const tags = [...new Set([...((en ? texts.tagsEn : texts.tags) ?? []).map((t) => clean(String(t).replace(/^#/, '')).toLowerCase()), ...(sp ? [en ? sp.en.toLowerCase() : sp.ru] : [])])]
    .filter((t) => t && t.length <= 30 && !(en && CYR.test(t)));

  const ytTitle = `${cut(title, 100 - ' #Shorts'.length)} #Shorts`;
  return {
    lang: en ? 'en' : 'ru',
    youtube: { title: ytTitle, description: cut(`${desc}\n\n${hash(TAGS)}`.trim(), 4900), tags: tags.slice(0, 15), privacyStatus: 'public' },
    tiktok: { caption: cut([title, desc, hash(TT_TAGS)].filter(Boolean).join('\n'), 2200) },
    instagram: { caption: cut([title, desc, hash(IG_TAGS)].filter(Boolean).join('\n'), 2200) },
  };
}
