// Готовые тексты под три площадки. Имя питомца по умолчанию убираем (риск блокировок); флажок владельца возвращает.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function stripNames(text, names = []) {
  let out = String(text ?? '');
  for (const n of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) {
    // имя целым словом и его окончания: Пип, Пипа, Пипу, Пипом, Bonya's.
    // Границы слова обязательны: имя Tom не режет Tomorrow, Max — Maximum, Bo — Bonus.
    out = out.replace(new RegExp(`(?<!\\p{L})${esc(n)}(?:'s|s|ами|ам|ах|ом|ым|ем|ой|ою|ей|ею|а|у|е|ю|я|и|ы)?(?!\\p{L})`, 'giu'), ' ');
  }
  out = out.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  out = out.replace(/^(и|and|,|—|-)\s+/iu, '').replace(/^[,.\-—\s]+/u, '');
  return cap(out);
}

// Два канала — две аудитории: русский канал только с русскими тегами, английский — только с английскими.
const BASE_TAGS = ['питомцы', 'зверёк', 'милыеживотные'];
const BASE_TAGS_EN = ['pets', 'cuteanimals', 'cutepets'];
const CYR = /[а-яё]/i;
const hash = (list) => list.map((t) => `#${t}`).join(' ');
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

/**
 * speciesName — вид, подтверждённый владельцем ({ ru, en, tag }); без него тексты вид не называют.
 * lang — канал: 'ru' (по умолчанию) или 'en'. В английском пакете нет ни одной кириллической буквы.
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
  // в английский канал кириллица не попадает: предложения с ней выкидываем целиком
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
