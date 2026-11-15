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

const TAGS = ['sugarglider', 'сахарныйпоссум', 'shorts'];
const TT_TAGS = ['sugarglider', 'сахарныйпоссум', 'питомцы'];
const IG_TAGS = ['sugarglider', 'сахарныйпоссум', 'reels'];
const hash = (list) => list.map((t) => `#${t}`).join(' ');
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

export function buildPackages(texts, { petNames = [], allowName = false } = {}) {
  const clean = (s) => (allowName ? String(s ?? '').trim() : stripNames(s, petNames));
  const titleRu = clean(texts.titleRu) || 'Сахарный поссум';
  const titleEn = clean(texts.titleEn);
  const descRu = clean(texts.descRu);
  const tags = [...new Set([...(texts.tags ?? []).map((t) => clean(String(t).replace(/^#/, '')).toLowerCase()), 'sugar glider', 'сахарный поссум'])]
    .filter((t) => t && t.length <= 30);

  const ytTitle = `${cut(titleRu, 100 - ' #Shorts'.length)} #Shorts`;
  const body = [descRu, titleEn].filter(Boolean).join('\n');
  return {
    youtube: { title: ytTitle, description: cut(`${body}\n\n${hash(TAGS)}`.trim(), 4900), tags: tags.slice(0, 15), privacyStatus: 'public' },
    tiktok: { caption: cut([titleRu, titleEn, hash(TT_TAGS)].filter(Boolean).join('\n'), 2200) },
    instagram: { caption: cut([titleRu, descRu, titleEn, hash(IG_TAGS)].filter(Boolean).join('\n'), 2200) },
  };
}
