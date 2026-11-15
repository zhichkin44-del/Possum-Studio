// Готовые тексты под три площадки. Имя питомца по умолчанию убираем (риск блокировок); флажок владельца возвращает.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function stripNames(text, names = []) {
  let out = String(text ?? '');
  for (const n of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) {
    // имя и его падежные окончания: Пип, Пипа, Пипу, Пипом
    out = out.replace(new RegExp(`${esc(n)}[а-яё]{0,3}`, 'giu'), ' ');
  }
  out = out.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  out = out.replace(/^(и|and|,|—|-)\s+/iu, '').replace(/^[,.\-—\s]+/u, '');
  return cap(out);
}

// только русские теги: подписи по-русски
const BASE_TAGS = ['питомцы', 'зверёк', 'милыеживотные'];
const hash = (list) => list.map((t) => `#${t}`).join(' ');
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

/** speciesName — вид, подтверждённый владельцем ({ ru, en, tag }); без него тексты вид не называют. */
export function buildPackages(texts, { petNames = [], allowName = false, speciesName = null } = {}) {
  const sp = speciesName?.ru ? speciesName : null;
  const spTags = sp ? [sp.tag || sp.ru.replace(/\s+/g, ''), sp.en?.replace(/\s+/g, '').toLowerCase()].filter(Boolean) : [];
  const TAGS = [...spTags.slice(0, 1), ...BASE_TAGS];
  const TT_TAGS = [...spTags, ...BASE_TAGS];
  const IG_TAGS = TT_TAGS;
  const clean = (s) => (allowName ? String(s ?? '').trim() : stripNames(s, petNames));
  const titleRu = clean(texts.titleRu) || (sp ? cap(sp.ru) : 'Наш зверёк');
  const descRu = clean(texts.descRu);
  const tags = [...new Set([...(texts.tags ?? []).map((t) => clean(String(t).replace(/^#/, '')).toLowerCase()), ...(sp ? [sp.ru] : [])])]
    .filter((t) => t && t.length <= 30);

  const ytTitle = `${cut(titleRu, 100 - ' #Shorts'.length)} #Shorts`;
  const body = descRu;
  return {
    youtube: { title: ytTitle, description: cut(`${body}\n\n${hash(TAGS)}`.trim(), 4900), tags: tags.slice(0, 15), privacyStatus: 'public' },
    tiktok: { caption: cut([titleRu, descRu, hash(TT_TAGS)].filter(Boolean).join('\n'), 2200) },
    instagram: { caption: cut([titleRu, descRu, hash(IG_TAGS)].filter(Boolean).join('\n'), 2200) },
  };
}
