// Продюсер: пачка видео → разбор (сигналы + Haiku) → библиотека → сюжеты → монтаж → календарь.
// Ничего не выкладывает: каждый ролик — готовый пакет в своей папке и слот в календаре; выкладывает человек кнопкой.
import { mkdirSync, statfsSync, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { makeSheet } from './vision.js';
import { makeStories, commit, whyNotKinds, pieceAround, storyWhy, KINDS, KIND_RU } from './stories.js';
import { renderStory, storyInputs, coverArgs, pieceAt } from './story-render.js';
import { makeCover, bestCoverAt } from './render.js';
import { buildPackages } from './packages.js';
import { pickMusic } from './assets.js';
import { welfareNotes } from './welfare.js';
import { writePost } from './pipeline.js';
import { dayKey } from './calendar.js';

const r1 = (x) => Math.round(x * 10) / 10;

/** Вариант B заголовка — крючок по виду сюжета (A — заголовок сюжета). */
export const HOOK_VARIANTS = {
  top5: [
    { ru: 'Пять моментов, которые хочется пересмотреть', en: '5 moments worth watching again' },
    { ru: 'Пять лучших моментов зверька', en: 'Top 5 moments of this little animal' },
    { ru: 'Какой момент лучший? Пишите номер', en: 'Which one is best? Comment the number' },
  ],
  day: [
    { ru: 'Сутки ночного зверька за минуту', en: '24 hours of a night animal in one minute' },
    { ru: 'Днём спит, ночью живёт', en: 'Sleeps by day, lives by night' },
    { ru: 'Что зверёк делает, пока мы спим', en: 'What this little animal does while we sleep' },
  ],
  beforeAfter: [
    { ru: 'Сначала тихо. Потом — за дело', en: 'Quiet at first. Then busy' },
    { ru: 'Было спокойно… и вот', en: 'It was calm… and then' },
    { ru: 'Сначала и потом', en: 'First and then' },
  ],
  calm: [
    { ru: 'Минутка спокойствия со зверьком', en: 'A calm minute with a little animal' },
    { ru: 'Без спешки: зверёк по своим делам', en: 'No rush: a little animal doing its thing' },
    { ru: 'Тихий вечер маленького зверька', en: 'A quiet evening of a tiny animal' },
  ],
  asmr: [
    { ru: 'Просто послушайте, как он хрустит', en: 'Just listen to him crunch' },
    { ru: 'Включите звук', en: 'Sound on' },
    { ru: 'Лучше в наушниках', en: 'Best with headphones' },
  ],
};
export const HOOKS = Object.fromEntries(Object.entries(HOOK_VARIANTS).map(([k, v]) => [k, v[0]]));
export function titleB(story) {
  const v = HOOK_VARIANTS[story.kind];
  if (v) return v[(story.variant ?? 0) % v.length];
  return { ru: `${story.title.ru} — что дальше?`, en: `${story.title.en} — what next?` };
}

const TAGS = { top5: ['топ5', 'милота'], day: ['деньизжизни'], beforeAfter: ['сначалаипотом'], calm: ['спокойно'], asmr: ['асмр'], series: ['сериал'] };
const DESC = {
  top5: ['Пять лучших моментов. Какой ваш любимый? Пишите номер.', 'Пять моментов из жизни нашего зверька. Какой понравился больше?', 'Собрали лучшие моменты — какой самый милый?'],
  day: ['Ночной зверёк: днём спит, вечером просыпается.', 'Как проходят сутки у маленького ночного зверька.', 'Днём сон, ночью дела — обычный день зверька.'],
  beforeAfter: ['Сначала тихо, потом — за своими делами.', 'Было спокойно, а потом зверёк занялся делами.', 'Сначала тишина, потом движение.'],
  calm: ['Спокойные моменты: зверёк занят своими делами.', 'Без спешки — просто посмотрите, как живёт наш зверёк.', 'Тихие минуты маленького ночного зверька.'],
  asmr: ['Тихо, без музыки — только звук.', 'Без музыки: слышно, как зверёк ест.', 'Наденьте наушники — только живой звук.'],
  series: ['Эпизод из жизни нашего зверька.', 'Чем занят зверёк — смотрите.', 'Ещё один эпизод — пишите, что ждёте дальше.', 'Новая серия: зверёк за своими делами.'],
};
const pickDesc = (story) => { const d = DESC[story.kind]; return Array.isArray(d) ? d[(story.variant ?? 0) % d.length] : (d ?? ''); };
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const low1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);
/** Вид подтверждён владельцем — шаблонный заголовок его называет: «Сахарный поссум: пять моментов…». */
export function withSpecies(title, sp) {
  if (!sp?.ru) return title;
  return { ru: `${cap1(sp.ru)}: ${low1(title.ru)}`, en: sp.en ? `${cap1(sp.en)}: ${low1(title.en ?? '')}` : title.en };
}
export function storyTexts(story, title, sp = null) {
  const d = pickDesc(story);
  return { titleRu: title.ru, titleEn: title.en, descRu: sp?.ru ? `${cap1(sp.ru)}. ${d}` : d, tags: TAGS[story.kind] ?? [] };
}

/** Свободное место на диске (байт) или null, если не узнать. */
export function diskFree(path) {
  try { const s = statfsSync(path); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

const mmss = (t) => { const x = Math.max(0, Math.round(t)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };

/** Откуда каждый кусок ролика: время в ролике, исходное видео и время в нём — чтобы проверить каждый момент. */
export function storySources(story, lib) {
  let at = 0;
  return story.pieces.map((p) => {
    const row = { caption: p.caption ?? null, at: mmss(at), to: mmss(at + p.len), file: lib.get(p.clip)?.name ?? p.clip, from: mmss(p.from), till: mmss(p.from + p.len) };
    at += p.len;
    return row;
  });
}

/** Выбор заголовка A/B: в manifest.packages кладётся выбранный вариант (выкладка берёт packages). */
export function applyPick(dir, pick) {
  const file = join(dir, 'manifest.json');
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (!['A', 'B'].includes(pick) || !m.packagesA) return m;
  m.pick = pick;
  m.packages = pick === 'B' ? m.packagesB : m.packagesA;
  writeFileSync(`${file}.tmp`, JSON.stringify(m, null, 2), 'utf8');
  renameSync(`${file}.tmp`, file);
  writePost(dir, m);
  return m;
}

/** Сюжет ночной: больше половины кусков из ночных клипов. */
/** Ночная заметка о заботе — если хоть один кусок снят ночью: забота важнее статистики. */
// В постах нельзя советовать свет, вспышку и «повторить» — зверёк ночной, ему это вредно.
const BANNED = /повтор|включите свет|вспышк/i;

export const isNight = (story, lib) => story.pieces.some((p) => lib.get(p.clip)?.night);

/** Почему модель не нашла зверька: видео тёмное (не ИК-ночь) — так и говорим, а не «нет вашего зверька». */
export function emptyWhy(c) {
  const shots = c?.shots ?? [];
  if (!shots.length) return 'зверька в кадре почти нет';
  const dark = shots.every((s) => (s.defects ?? []).some((d) => d === 'чёрный' || d === 'слишком темно'));
  const ls = shots.map((s) => s.luma).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  const med = ls.length ? ls[Math.floor(ls.length / 2)] : null;
  const night = Boolean(c.night) || shots.some((s) => (s.labels ?? []).includes('ИК'));
  return dark || (!night && med != null && med < 22) ? 'слишком темно — зверька на кадрах не видно' : 'зверька в кадре почти нет';
}

/**
 * Что стало с видео, которое человек вернул кнопкой «Это мой зверёк»: вошло в новый ролик или почему нет.
 * why — причина от сборки (например, «такие виды уже были на этой неделе»). «Почти не попадает в кадр» —
 * только когда у видео правда нет ни одного годного куска.
 */
export function petFate(c, madeIds = [], why = null) {
  if (!c) return null;
  const name = String(c.name ?? c.id);
  const short = name.replace(/.[^.]+$/, '');
  const inClip = (c.used ?? []).some((u) => madeIds.includes(u.story));
  if (inClip) return { id: c.id, name, inClip, text: `${short}: ваш зверёк — вошло в ролик` };
  const good = (c.shots ?? []).some((s) => !(s.defects ?? []).length);
  const text = good
    ? `${short}: ваш зверёк, но в ролик не вошло — ${why || 'не хватило других кусков на ролик'}`
    : `${short}: ваш зверёк, но ${/^слишком темно/.test(emptyWhy(c)) ? 'кадры слишком тёмные' : 'зверька не видно, переснимите 2–3 с у мордочки'} — в ролик не вошло`;
  return { id: c.id, name, inClip, text };
}

/** Видео со зверьком, где его не видно (зажат в кулаке): в ролики не берём и говорим, как переснять. */
export function reshootText(clips = []) {
  return clips.filter((c) => c?.pet === true && c.privacy?.hidden?.hidden && !(c.used ?? []).length)
    .map((c) => `${String(c.name ?? c.id).replace(/.[^.]+$/, '')}: зверька не видно, переснимите 2–3 с у мордочки — в ролики не взято`);
}

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
const pieces = (n) => `${n} ${plural(n, 'кусок', 'куска', 'кусков')} видео`;

/** Что доснять, если виды закрыты правилом «не повторять одно и то же»: из видов, которых давно не было. */
const SHOOT = { asmr: 'как зверёк ест — со звуком', beforeAfter: 'как спит, а потом просыпается', calm: 'спокойные моменты без прыжков', day: 'утро, день и вечер одного дня', top5: 'разные занятия: ест, лазает, играет', series: 'одно занятие несколько раз' };

/**
 * Итог «не хватило» человеческими словами: сколько кусков ещё не в роликах, куда делись остальные,
 * и что доснять. closed — виды, которые материал позволяет, но они уже были на этой неделе.
 */
export function moreText(s, k, closed = []) {
  const head = `Не хватило видео ещё на ${k} ${plural(k, 'ролик', 'ролика', 'роликов')}`;
  const spare = Object.keys(s?.spare ?? {}).length ? ` Не подошли: ${Object.entries(s.spare).map(([w, v]) => `${w} — ${v}`).join(', ')}.` : '';
  const left = s ? Math.max(0, s.good - (s.busy ?? 0)) : 0;
  const names = closed.map((w) => `«${w.name ?? KIND_RU[w.kind] ?? w.kind}»`);
  if (s && left && names.length) {
    const ask = ['asmr', 'beforeAfter', 'calm', 'day', 'top5', 'series'].filter((x) => !closed.some((w) => w.kind === x)).map((x) => SHOOT[x]).filter(Boolean).slice(0, 3);
    return `${head}: ${pieces(left)} ещё не в роликах, но из них выходят только ${names.join(', ')}, а такие уже были на этой неделе.${spare} Доснимите что-то другое: ${ask.join('; ')}`;
  }
  const why = !s ? 'мало свободных кусков видео' : !s.good ? 'годных кусков видео со зверьком нет' : !left ? `все ${pieces(s.good)} со зверьком уже в роликах` : `со зверьком ${pieces(s.good)}, в роликах уже ${s.busy ?? 0}, свободных ${left}`;
  return `${head}: ${why}.${spare} На ролик нужно 5 кусков (топ-5) или 2–3 (спокойные) — добавьте новые видео`;
}

const NO_PRIVACY = 'проверки лиц и сигарет не было — убедитесь, что в кадре нет людей и сигарет';

export function createProducer({ lib, calendar, vision, media, outRoot, workRoot, font = null, musicList = [], petNames = [], species = null, privacy = null, ai = null, privacyPad = 1, speciesName = null, now = () => Date.now(), maxStories = 7, minFreeBytes = 2e9 }) {
  mkdirSync(outRoot, { recursive: true });
  mkdirSync(workRoot, { recursive: true });

  /** Один файл: сигналы → библиотека → разбор Haiku. Ошибка файла не роняет пачку. */
  async function ingestOne(file) {
    const info = await media.probe(file);
    if (!(info?.duration >= 1)) return { file, skipped: 'короче секунды — пропущен' };
    const sig = await media.signals(file, { info });
    const { clip, added } = lib.ingest(file, { ...sig, info });
    let by = clip.vision?.by ?? null;
    if (added || !clip.vision) {
      let sheet = null;
      try { sheet = await makeSheet({ src: lib.realPath(clip) ?? file, clip, out: join(workRoot, 'sheets', `${clip.id}.jpg`), media }); } catch { sheet = null; }
      const v = await vision.analyze({ clip, image: sheet?.file ?? null, frames: sheet?.frames ?? [] });
      lib.setVision(clip.id, v);
      by = v.by;
    }
    const verdict = await judgeSpecies(clip, file);
    // лица людей и сигареты — вырезаются из планов до сюжетов (локальная модель, сеть не нужна)
    let priv = null;
    const pc = lib.get(clip.id) ?? clip;
    if (privacy?.available && lib.setPrivacy && (added || !pc.privacy?.checked)) {
      try { priv = lib.setPrivacy(clip.id, await privacy.scan(lib.realPath(pc) ?? file), { pad: privacyPad }); } catch { priv = null; }
    }
    // «не взято» — и по разбору кадров, и по решению модели/человека (pet === false); причина идёт в итог пачки
    const c = lib.get(clip.id) ?? clip;
    const notPet = Boolean(c.vision?.notPet || c.pet === false);
    return { file, id: clip.id, added, by, night: clip.night, notPet, ...(notPet ? { why: c.petWhy ?? 'на видео нет вашего зверька' } : {}), ...(verdict ? { species: verdict } : {}), ...(priv?.kinds?.length ? { privacy: priv } : {}) };
  }

  const canJudge = () => Boolean(species?.available && species.hasReference());

  /**
   * Каждое видео перед сюжетами проходит проверку лиц и сигарет — даже разобранное раньше без модели.
   * Проверка упала — видео в ролики не идёт, ошибка в итоге пачки. Модели нет вовсе — ролики собираются,
   * но с пометкой «проверки не было» (unchecked), и человек смотрит их перед выкладкой.
   */
  async function sweepPrivacy(onProgress, res) {
    if (!privacy) return { view: lib, unchecked: false };
    if (!privacy.available || !lib.setPrivacy) {
      res.decisions.push({ type: 'privacy', text: 'Проверки лиц и сигарет не было: нет локальной модели. Посмотрите каждый ролик перед выкладкой.' });
      return { view: lib, unchecked: true };
    }
    const todo = lib.all().filter((c) => !c.privacy?.checked && !c.vision?.notPet && c.pet !== false);
    const bad = new Set();
    for (let k = 0; k < todo.length; k++) {
      const c = todo[k];
      onProgress({ stage: 'проверка лиц и сигарет', i: k, n: todo.length, name: c.name, eta: null });
      const path = lib.realPath?.(c) ?? null;
      try {
        if (!path) throw new Error('видео не найдено на диске');
        lib.setPrivacy(c.id, await privacy.scan(path), { pad: privacyPad });
      } catch (e) {
        bad.add(c.id);
        res.errors.push({ file: c.name, error: `проверка лиц и сигарет не прошла, видео в ролики не взято: ${String(e?.message ?? e).slice(0, 150)}` });
      }
    }
    if (!bad.size) return { view: lib, unchecked: false };
    return { view: { ...lib, all: () => lib.all().filter((c) => !bad.has(c.id)) }, unchecked: false };
  }

  /**
   * Свой ли зверёк — по локальной модели и эталону. «Мой» — сразу в ролики; «не он» и «пусто» — не берём;
   * «не уверен» (и спор с Claude) — человеку одной пачкой. Вид, отмеченный человеком, не перерешивается.
   */
  async function judgeSpecies(clip, file = null) {
    const c = lib.get(clip.id) ?? clip;
    if (!canJudge() || c.vision?.notPet || c.pet != null) return null;
    const j = await species.judge(lib.realPath(c) ?? file, c.id);
    if (j.verdict === 'mine') lib.setPet(c.id, true, { by: 'clip' });
    else if ((j.verdict === 'other' || j.verdict === 'empty') && c.vision?.by !== 'claude') lib.setPet(c.id, false, { by: 'clip', why: j.verdict === 'empty' ? emptyWhy(c) : 'на видео не ваш зверёк' });
    else lib.markUnsure?.(c.id);
    return j.verdict;
  }

  /** Эталон дали — решить все видео, где вид ещё не решён (решённое моделью или человеком не трогаем). */
  async function rejudge() {
    const out = {};
    if (!canJudge()) return out;
    for (const c of lib.all()) {
      if (c.vision?.notPet || c.pet != null) continue;
      try { out[c.id] = await judgeSpecies(c); } catch { /* видео пропало — останется неотмеченным */ }
    }
    return out;
  }

  /**
   * Обложка: самый чёткий, нормально освещённый кадр ролика (bestCoverAt), но взятый из исходника —
   * без подписи «№», тёмный кадр высветлен. Не вышло — кадр готового ролика; и это не вышло — обложку можно взять в приложении.
   */
  async function storyCover(story, video, cover, first) {
    let coverAt = Math.max(0.1, Math.min(first.len - 0.1, first.peak ?? first.len / 2));
    let luma = 120;
    try {
      const sig = await media.signals(video);
      coverAt = bestCoverAt(sig) ?? coverAt;
      if (sig?.step && sig.luma?.length) luma = sig.luma[Math.min(sig.luma.length - 1, Math.round(coverAt / sig.step))] ?? 120;
    } catch { /* остаётся лучший момент первого куска */ }
    try {
      const inputs = storyInputs(story, lib);
      const hit = pieceAt(inputs, coverAt);
      await media.ffmpeg(coverArgs({ src: hit.piece.src, at: hit.srcAt, orient: hit.piece.orient, out: cover, luma }));
      return;
    } catch { /* ниже — кадр из готового ролика */ }
    try { await makeCover({ video, at: coverAt, out: cover, media }); } catch { /* обложку можно взять кадром в приложении */ }
  }

  /** Тексты к ролику от Claude по фактам сюжета; нет ключа, ошибка или запретное слово — шаблон с причиной. */
  async function claudeTexts(story, draft, night) {
    if (!ai?.enabled) return { source: 'шаблон', reason: 'нет ключа Claude — тексты по шаблону' };
    let r;
    try {
      r = await ai.suggest({
        duration: story.total, dark: night, species: speciesName?.ru,
        advice: { verdict: story.needsReview ? 'посмотрите перед выкладкой' : 'можно выкладывать', why: story.why },
        story: story.kind, draft: draft?.ru, captions: story.pieces.map((p) => p.caption).filter(Boolean),
      });
    } catch (e) { return { source: 'шаблон', reason: `Claude недоступен (${String(e?.message ?? e).slice(0, 120)}) — тексты по шаблону` }; }
    if (r?.source !== 'claude') return { source: 'шаблон', reason: r?.fallbackReason ?? 'Claude не ответил — тексты по шаблону' };
    if (BANNED.test([r.titleRu, r.titleEn, r.descRu, ...(r.tags ?? [])].join(' '))) return { source: 'шаблон', reason: 'текст Claude не подошёл (свет, вспышка или повтор) — тексты по шаблону' };
    return r;
  }

  /** Сюжет → папка с mp4, обложкой, текстами A/B, manifest.json, пост.txt; слот в календаре. */
  async function produce(story) {
    const dir = join(outRoot, `${calendar.nextFree?.() ?? dayKey(now())}_${story.id}`);
    mkdirSync(dir, { recursive: true });
    const video = join(dir, 'video.mp4');
    const music = story.quiet ? null : (musicList.length ? { file: pickMusic(musicList, story.id) } : null);
    await renderStory({ story, lib, out: video, workDir: join(workRoot, story.id), font, media, music });
    const first = story.pieces[0];
    const cover = join(dir, 'cover.jpg');
    // обложка — лучший момент первого куска (где зверька лучше всего видно)
    await storyCover(story, video, cover, first);

    const titles = { A: withSpecies(story.title, speciesName), B: withSpecies(titleB(story), speciesName) };
    const night = isNight(story, lib);
    // Ключ Claude есть — тексты A пишет Claude; источник ставится по факту ответа, B остаётся шаблоном.
    const t = await claudeTexts(story, story.title, night);
    if (t.source === 'claude') titles.A = { ru: t.titleRu, en: t.titleEn };
    const packagesA = buildPackages(t.source === 'claude' ? t : storyTexts(story, titles.A, speciesName), { petNames, speciesName });
    const packagesB = buildPackages(storyTexts(story, titles.B, speciesName), { petNames, speciesName });
    const manifest = {
      kind: 'story', id: story.id, storyKind: story.kind, story,
      createdAt: new Date(now()).toISOString(),
      outputs: { youtube: video, tiktok: video, reels: video },
      cover, titles, pick: 'A', packages: packagesA, packagesA, packagesB,
      advice: { verdict: story.needsReview ? 'посмотрите перед выкладкой' : 'можно выкладывать', why: story.why || 'собрано из моментов, где зверька хорошо видно и он спокоен' },
      welfare: welfareNotes({ dark: night, always: true, kind: story.kind }),
      texts: t.source === 'claude' ? { source: 'claude' } : { source: 'шаблон', reason: t.reason },
      needsReview: story.needsReview ?? null,
      sources: storySources(story, lib),
      music: music ? basename(music.file) : null,
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    writePost(dir, manifest);
    commit(lib, story, now());
    const slot = calendar.add({ id: story.id, kind: story.kind, dir, titles, textsSource: manifest.texts.source, needsReview: story.needsReview ?? null, why: manifest.advice.why, total: story.total });
    return { story, dir, slot, manifest };
  }

  /**
   * Лучший свободный план на замену убранного момента (pieces — что осталось в ролике):
   * не больше 2 моментов с одного видео, видео не из соседних по календарю роликов и не уже в 2 роликах за неделю.
   */
  function replacementFor(story, pieces) {
    const per = {};
    for (const p of pieces) per[p.clip] = (per[p.clip] ?? 0) + 1;
    const taken = new Set(story.pieces.map((p) => `${p.clip}:${p.shot}`));
    const slots = calendar.all?.() ?? [];
    const k = slots.findIndex((x) => x.id === story.id);
    const near = new Set([slots[k - 1]?.id, slots[k + 1]?.id].filter(Boolean));
    let best = null;
    for (const c of lib.all()) {
      if ((per[c.id] ?? 0) >= 2) continue;
      const others = new Set((c.used ?? []).filter((u) => u.story !== story.id && now() - u.at < 7 * 864e5).map((u) => u.story));
      if (!per[c.id] && (others.size >= 2 || [...others].some((id) => near.has(id)))) continue;
      c.shots.forEach((sh, i) => {
        if (sh.len < 1.5 || taken.has(`${c.id}:${i}`) || !lib.isFree(c.id, i)) return;
        const score = sh.score + (c.stars ?? 0) * 0.05;
        if (!best || score > best.score) best = { c, i, score };
      });
    }
    return best;
  }

  /**
   * «Убрать момент»: человек увидел, что в моменте зверька не видно (или не тот зверёк).
   * План помечается «нет зверька» (в сюжеты больше не идёт), ролик перемонтируется без него,
   * в топ-5 на его место встаёт свежий момент. Обложка, источники, пост.txt и заметки — заново.
   */
  async function removePiece(dir, idx) {
    const file = join(dir, 'manifest.json');
    const m = JSON.parse(readFileSync(file, 'utf8'));
    const story = m.story;
    const piece = story?.pieces?.[idx];
    if (!piece) throw new Error('Такого момента в ролике нет');
    lib.markNoPet?.(piece.clip, piece.shot);
    let pieces = story.pieces.filter((_, k) => k !== idx);
    let added = null;
    if (story.kind === 'top5') {
      const r = replacementFor(story, pieces);
      if (r) { added = pieceAround(r.c, r.i, 3); pieces = [added, ...pieces]; }
      else throw new Error('Свежего момента на замену нет — этот ролик лучше не выкладывать (кнопка «Не выкладывать»)');
      pieces = pieces.map((p, k) => ({ ...p, caption: `№${pieces.length - k}` }));
    } else if (pieces.length < 2) {
      throw new Error('Без этого момента ролик слишком короткий — нажмите «Не выкладывать»');
    }
    const next = { ...story, pieces, total: Math.round(pieces.reduce((t, p) => t + p.len, 0) * 100) / 100, why: storyWhy(pieces) };
    const video = join(dir, 'video.mp4');
    const tmp = join(dir, 'video.new.mp4');
    const music = m.music ? (musicList.find((x) => basename(x) === m.music) ?? null) : null;
    await renderStory({ story: next, lib, out: tmp, workDir: join(workRoot, `${story.id}-edit`), font, media, music: music ? { file: music } : null });
    renameSync(tmp, video);
    const cover = join(dir, 'cover.jpg');
    await storyCover(next, video, cover, pieces[0]);
    if (added) lib.markUsed(added.clip, added.shot, story.id, now());
    const removed = m.sources?.[idx] ?? null;
    Object.assign(m, {
      story: next, sources: storySources(next, lib),
      advice: { ...m.advice, why: next.why },
      removed: [...(m.removed ?? []), { ...(removed ?? {}), removedAt: new Date(now()).toISOString() }],
      editedAt: new Date(now()).toISOString(),
    });
    writeFileSync(`${file}.tmp`, JSON.stringify(m, null, 2), 'utf8');
    renameSync(`${file}.tmp`, file);
    writePost(dir, m);
    calendar.update?.(story.id, { why: next.why, total: next.total });
    return { manifest: m, replaced: Boolean(added) };
  }

  return {
    /**
     * Пачка файлов целиком. onProgress({stage, i, n, name, eta}) — eta в секундах (по средней длительности шага).
     * Возвращает {files, made, decisions, stats, disk}.
     */
    async run(files, onProgress = () => {}) {
      const res = { files: [], made: [], decisions: [], errors: [], stats: null, disk: diskFree(outRoot) };
      if (res.disk !== null && res.disk < minFreeBytes) {
        res.decisions.push({ type: 'disk', text: `На диске меньше ${r1(minFreeBytes / 1e9)} ГБ — освободите место, монтаж подождёт` });
        return res;
      }
      const t0 = Date.now();
      for (let i = 0; i < files.length; i++) {
        const done = Date.now() - t0;
        const eta = i ? Math.round(((done / i) * (files.length - i)) / 1000) : null;
        onProgress({ stage: 'разбор', i, n: files.length, name: basename(files[i]), eta });
        try { res.files.push(await ingestOne(files[i])); }
        catch (e) { res.errors.push({ file: basename(files[i]), error: String(e?.message ?? e).slice(0, 200) }); }
      }
      const b = await build(onProgress, { disk: res.disk });
      return { ...b, files: res.files, errors: [...res.errors, ...b.errors] };
    },
    build, ingestOne, produce, removePiece, rejudge,
  };

  /**
   * Сборка роликов из того, что уже в библиотеке. Есть локальная модель — без эталона просим 3–5 снимков один раз,
   * с эталоном монтируем узнанное, неуверенные — человеку одной пачкой. Нет модели и Claude — человек отмечает всё.
   */
  async function build(onProgress = () => {}, { disk = diskFree(outRoot), focus = null } = {}) {
    const res = { files: [], made: [], decisions: [], errors: [], stats: null, disk };
    if (disk !== null && disk < minFreeBytes) {
      res.decisions.push({ type: 'disk', text: `На диске меньше ${r1(minFreeBytes / 1e9)} ГБ — освободите место, монтаж подождёт` });
      res.stats = lib.stats();
      return res;
    }
    {
      const sheet = (id) => { const f = join(workRoot, 'sheets', `${id}.jpg`); return existsSync(f) ? f : null; };
      const wait = lib.pending?.() ?? [];
      if (species?.available && !species.hasReference()) {
        // модель есть, эталона нет: один раз просим снимки зверька, дальше узнаём сами
        res.decisions.push({ type: 'reference', text: 'Покажите вашего зверька: 3–5 фото или видео, где его хорошо видно. Это один раз — дальше узнаю его сам.' });
        onProgress({ stage: 'ждёт снимков зверька', i: 0, n: 0, name: '', eta: 0 });
        res.stats = lib.stats();
        return res;
      }
      if (wait.length && canJudge()) {
        // модель узнаёт сама; человеку — только те, где не уверена. Монтаж идёт без них.
        res.decisions.push({ type: 'confirm', clips: wait.map((c) => ({ id: c.id, name: c.name, sheet: sheet(c.id), video: lib.realPath?.(c) ?? null })), text: `Не уверен в ${wait.length} видео. Отметьте, где ваш зверёк, и нажмите «Собрать ролики». Не отмеченные не возьму.` });
      } else if (wait.length) {
        res.decisions.push({ type: 'confirm', clips: wait.map((c) => ({ id: c.id, name: c.name, sheet: sheet(c.id), video: lib.realPath?.(c) ?? null })), text: `Отметьте, где ваш зверёк: по 9 кадрам из каждого видео. Видео с другим животным в ролики не попадут.` });
        onProgress({ stage: 'ждёт отметки', i: 0, n: 0, name: '', eta: 0 });
        res.stats = lib.stats();
        return res;
      }
      // приватность до сюжетов: видео, разобранное без модели или с упавшей проверкой, досматривается сейчас
      const pv = await sweepPrivacy(onProgress, res);
      const free = calendar.free();
      if (free === 0) {
        res.decisions.push({ type: 'full', text: 'Календарь на 14 дней заполнен — новые ролики соберу, когда освободится день' });
      } else {
        const stories = makeStories(pv.view, { history: calendar.history(), now: now(), count: Math.min(maxStories, free), focus });
        for (const s of stories) {
          if (pv.unchecked && !s.needsReview) s.needsReview = NO_PRIVACY;
          else if (pv.unchecked) s.needsReview = `${s.needsReview}; ${NO_PRIVACY}`;
        }
        const t1 = Date.now();
        for (let k = 0; k < stories.length; k++) {
          const eta = k ? Math.round((((Date.now() - t1) / k) * (stories.length - k)) / 1000) : null;
          onProgress({ stage: 'монтаж', i: k, n: stories.length, name: stories[k].title.ru, eta });
          try {
            const p = await produce(stories[k]);
            res.made.push({ id: p.story.id, kind: p.story.kind, dir: p.dir, day: p.slot?.day ?? null, titles: p.manifest.titles, textsSource: p.manifest.texts.source, why: p.manifest.advice.why, needsReview: p.manifest.needsReview });
          } catch (e) { res.errors.push({ story: stories[k].id, error: String(e?.message ?? e).slice(0, 200) }); }
        }
        for (const m of res.made) {
          if (m.day) res.decisions.push({ type: 'publish', id: m.id, text: `Выложить «${m.titles.A.ru}» ${m.day} в ${calendar.hour}:00?` });
          if (m.needsReview) res.decisions.push({ type: 'review', id: m.id, text: `Посмотрите «${m.titles.A.ru}»: ${m.needsReview}` });
        }
        if (res.made.length) res.decisions.push({ type: 'title', text: `У всех роликов выбран заголовок A; вариант B можно выбрать в календаре.` });
        const want = Math.min(maxStories, free);
        const not = whyNotKinds(lib, stories, { history: calendar.history(), now: now() });
        if (stories.length < want) {
          // честная причина простыми словами: сколько кусков ещё не в роликах, почему не собрались и что доснять
          const s = lib.supply?.();
          res.decisions.push({ type: 'more', text: moreText(s, want - stories.length, not.filter((w) => w.gated)) });
        }
        for (const t of reshootText(lib.all?.() ?? [])) res.decisions.push({ type: 'reshoot', text: t });
        // какие виды не собраны и почему — чтобы было видно, чего не хватает в пачке
        for (const w of not) res.decisions.push({ type: 'missing', kind: w.kind, gated: w.gated, text: `«${w.name}» не собран: ${w.why}` });
      }
    }
    onProgress({ stage: 'готово', i: 1, n: 1, name: '', eta: 0 });
    res.stats = lib.stats();
    return res;
  }
}
