// Producer: a batch of videos → analysis (signals + Haiku) → library → stories → editing → calendar.
// Publishes nothing: each video is a ready package in its own folder and a slot in the calendar; a person publishes it with the button.
import { mkdirSync, statfsSync, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { makeSheet } from './vision.js';
import { orderByScenario } from './director.js';
import { makeStories, commit, whyNotKinds, pieceAround, storyWhy, KINDS, KIND_RU } from './stories.js';
import { renderStory, storyInputs, coverArgs, pieceAt } from './story-render.js';
import { makeCover, bestCoverAt } from './render.js';
import { buildPackages } from './packages.js';
import { pickMusic } from './assets.js';
import { welfareNotes } from './welfare.js';
import { writePost } from './pipeline.js';
import { dayKey } from './calendar.js';

const r1 = (x) => Math.round(x * 10) / 10;

/** Title variant B — a hook based on the story type (A — the story title). */
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
// English channel: its own texts for an English-speaking audience, not a translation of the Russian ones.
const TAGS_EN = { top5: ['top5', 'cute'], day: ['dayinthelife'], beforeAfter: ['beforeandafter'], calm: ['calm'], asmr: ['asmr'], series: ['series'] };
const DESC_EN = {
  top5: ['Five best moments. Which one is your favorite? Tell us in the comments.', 'Five moments from our little one\'s life. Which one wins?', 'The best moments in one clip. Which is the cutest?'],
  day: ['Sleeps all day, wakes up at dusk.', 'A full day in the life of a tiny night animal.', 'Naps by day, busy by night.'],
  beforeAfter: ['Quiet at first, then straight to business.', 'All calm, and then it got busy.', 'Silence first, then action.'],
  calm: ['Calm moments of a busy little life.', 'No rush. Just watch how our little friend lives.', 'Quiet minutes of a tiny night animal.'],
  asmr: ['No music, just the real sound.', 'No music: listen to the munching.', 'Headphones on. Only live sound.'],
  series: ['An episode from our little friend\'s life.', 'Watch what our little friend is up to.', 'Another episode. Tell us what you want to see next.', 'New episode: busy with important things.'],
};
const pickFrom = (d, story) => (Array.isArray(d) ? d[(story.variant ?? 0) % d.length] : (d ?? ''));
const pickDesc = (story) => pickFrom(DESC[story.kind], story);
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const low1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);
/** The kind is confirmed by the owner — the template title names it: "Sugar Possum: five moments…". */
export function withSpecies(title, sp) {
  if (!sp?.ru) return title;
  return { ru: `${cap1(sp.ru)}: ${low1(title.ru)}`, en: sp.en ? `${cap1(sp.en)}: ${low1(title.en ?? '')}` : title.en };
}
export function storyTexts(story, title, sp = null) {
  const d = pickDesc(story);
  const e = pickFrom(DESC_EN[story.kind], story);
  return {
    titleRu: title.ru, titleEn: title.en, descRu: sp?.ru ? `${cap1(sp.ru)}. ${d}` : d, tags: TAGS[story.kind] ?? [],
    descEn: sp?.en ? `${cap1(sp.en)}. ${e}` : e, tagsEn: [...(TAGS_EN[story.kind] ?? []), 'pets', 'cuteanimals'],
  };
}

/** Free disk space (bytes) or null if unknown. */
export function diskFree(path) {
  try { const s = statfsSync(path); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

const mmss = (t) => { const x = Math.max(0, Math.round(t)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };

/** Where each piece of the video comes from: time in the video, the source video and the time in it — so that every moment can be checked. */
export function storySources(story, lib) {
  let at = 0;
  return story.pieces.map((p) => {
    const row = { caption: p.caption ?? null, at: mmss(at), to: mmss(at + p.len), file: lib.get(p.clip)?.name ?? p.clip, from: mmss(p.from), till: mmss(p.from + p.len) };
    at += p.len;
    return row;
  });
}

/** Choice of title A/B: the chosen variant goes into manifest.packages (publishing takes packages). */
export function applyPick(dir, pick) {
  const file = join(dir, 'manifest.json');
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (!['A', 'B'].includes(pick) || !m.packagesA) return m;
  m.pick = pick;
  m.packages = pick === 'B' ? m.packagesB : m.packagesA;
  if (m.packagesEnA) m.packagesEn = pick === 'B' ? m.packagesEnB : m.packagesEnA;
  writeFileSync(`${file}.tmp`, JSON.stringify(m, null, 2), 'utf8');
  renameSync(`${file}.tmp`, file);
  writePost(dir, m);
  return m;
}

/** A night story: more than half of the pieces come from night clips. */
/** Night care note — if at least one piece was shot at night: care matters more than statistics. */
// Posts must not advise light, flash or "repeat" — the pet is nocturnal and it is harmful for it.
const BANNED = /повтор|включите свет|вспышк/i;

export const isNight = (story, lib) => story.pieces.some((p) => lib.get(p.clip)?.night);

/** Why the model did not find the pet: the video is dark (not an IR night) — we say exactly that, not "your pet is not there". */
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
 * What happened to a video the person brought back with the "This is my pet" button: whether it went into a new video, or why not.
 * why — the reason from assembly (e.g. "such kinds were already this week"). "Barely in frame" —
 * only when the video really has no usable piece at all.
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

/** Videos with the pet where it is not visible (held in a fist): we do not use them in videos and say how to re-shoot. */
export function reshootText(clips = []) {
  return clips.filter((c) => c?.pet === true && c.privacy?.hidden?.hidden && !(c.used ?? []).length)
    .map((c) => `${String(c.name ?? c.id).replace(/.[^.]+$/, '')}: зверька не видно, переснимите 2–3 с у мордочки — в ролики не взято`);
}

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
const pieces = (n) => `${n} ${plural(n, 'кусок', 'куска', 'кусков')} видео`;

/** What to shoot more of if kinds are blocked by the "do not repeat the same thing" rule: from kinds that have not appeared for a long time. */
const SHOOT = { asmr: 'как зверёк ест — со звуком', beforeAfter: 'как спит, а потом просыпается', calm: 'спокойные моменты без прыжков', day: 'утро, день и вечер одного дня', top5: 'разные занятия: ест, лазает, играет', series: 'одно занятие несколько раз' };

/**
 * The "not enough" summary in human words: how many pieces are not in videos yet, where the rest went,
 * and what to shoot more. closed — kinds the material allows, but they already happened this week.
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

export function createProducer({ lib, calendar, vision, media, outRoot, workRoot, font = null, musicList = [], petNames = [], species = null, privacy = null, ai = null, scenario = null, privacyPad = 1, speciesName = null, now = () => Date.now(), maxStories = 7, minFreeBytes = 2e9 }) {
  mkdirSync(outRoot, { recursive: true });
  mkdirSync(workRoot, { recursive: true });

  /** One file: signals → library → Haiku analysis. An error in one file does not drop the whole batch. */
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
    // people's faces and cigarettes — cut out of the plans before the stories (local model, no network needed)
    let priv = null;
    const pc = lib.get(clip.id) ?? clip;
    if (privacy?.available && lib.setPrivacy && (added || !pc.privacy?.checked)) {
      try { priv = lib.setPrivacy(clip.id, await privacy.scan(lib.realPath(pc) ?? file), { pad: privacyPad }); } catch { priv = null; }
    }
    // "not taken" — both by the frame analysis and by the model/person decision (pet === false); the reason goes into the batch summary
    const c = lib.get(clip.id) ?? clip;
    const notPet = Boolean(c.vision?.notPet || c.pet === false);
    return { file, id: clip.id, added, by, night: clip.night, notPet, ...(notPet ? { why: c.petWhy ?? 'на видео нет вашего зверька' } : {}), ...(verdict ? { species: verdict } : {}), ...(priv?.kinds?.length ? { privacy: priv } : {}) };
  }

  const canJudge = () => Boolean(species?.available && species.hasReference());

  /**
   * Every video goes through a check for faces and cigarettes before the stories — even one analysed earlier without the model.
   * If the check failed — the video does not go into videos, and the error goes into the batch summary. With no model at all — videos are assembled,
   * but marked "no check was done" (unchecked), and the person reviews them before publishing.
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
   * Is it our pet — by the local model and the reference. "Mine" — straight into videos; "not him" and "empty" — not taken;
   * "not sure" (and a dispute with Claude) — to the person in one batch. A kind marked by a person is not decided again.
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

  /** The reference was given — decide all videos whose kind is still undecided (decisions made by the model or a person are left alone). */
  async function rejudge() {
    const out = {};
    if (!canJudge()) return out;
    for (const c of lib.all()) {
      if (c.vision?.notPet || c.pet != null) continue;
      try { out[c.id] = await judgeSpecies(c); } catch { /* the video is gone — it stays unmarked */ }
    }
    return out;
  }

  /**
   * Cover: the sharpest, normally lit frame of the video (bestCoverAt), but taken from the source —
   * without the "No." caption, a dark frame is brightened. If that fails — a frame of the finished video; and if that fails too — the cover can be taken in the app.
   */
  async function storyCover(story, video, cover, first) {
    let coverAt = Math.max(0.1, Math.min(first.len - 0.1, first.peak ?? first.len / 2));
    let luma = 120;
    try {
      const sig = await media.signals(video);
      coverAt = bestCoverAt(sig) ?? coverAt;
      if (sig?.step && sig.luma?.length) luma = sig.luma[Math.min(sig.luma.length - 1, Math.round(coverAt / sig.step))] ?? 120;
    } catch { /* the best moment of the first piece remains */ }
    try {
      const inputs = storyInputs(story, lib);
      const hit = pieceAt(inputs, coverAt);
      await media.ffmpeg(coverArgs({ src: hit.piece.src, at: hit.srcAt, orient: hit.piece.orient, out: cover, luma }));
      return;
    } catch { /* below — a frame from the finished video */ }
    try { await makeCover({ video, at: coverAt, out: cover, media }); } catch { /* the cover can be taken as a frame in the app */ }
  }

  /** Texts for the video from Claude based on the story facts; no key, an error or a forbidden word — a template with the reason. */
  async function claudeTexts(story, draft, night) {
    if (!ai?.enabled) return { source: 'шаблон', reason: 'нет ключа ИИ — тексты по шаблону' };
    let r;
    try {
      r = await ai.suggest({
        duration: story.total, dark: night, species: speciesName?.ru,
        advice: { verdict: story.needsReview ? 'посмотрите перед выкладкой' : 'можно выкладывать', why: story.why },
        story: story.kind, draft: draft?.ru, captions: story.pieces.map((p) => p.caption).filter(Boolean),
      });
    } catch (e) { return { source: 'шаблон', reason: `Claude недоступен (${String(e?.message ?? e).slice(0, 120)}) — тексты по шаблону` }; }
    if (r?.source !== 'claude') return { source: 'шаблон', reason: r?.fallbackReason ?? 'Claude не ответил — тексты по шаблону' };
    if (BANNED.test([r.titleRu, r.titleEn, r.descRu, r.descEn, ...(r.tags ?? []), ...(r.tagsEn ?? [])].join(' ')) || /\bflash|turn (on )?the lights?/i.test(r.descEn ?? '')) return { source: 'шаблон', reason: 'текст Claude не подошёл (свет, вспышка или повтор) — тексты по шаблону' };
    return r;
  }

  /** Story → a folder with mp4, cover, texts A/B, manifest.json, post.txt; a slot in the calendar. */
  async function produce(story) {
    const dir = join(outRoot, `${calendar.nextFree?.() ?? dayKey(now())}_${story.id}`);
    mkdirSync(dir, { recursive: true });
    const video = join(dir, 'video.mp4');
    const music = story.quiet ? null : (musicList.length ? { file: pickMusic(musicList, story.id) } : null);
    await renderStory({ story, lib, out: video, workDir: join(workRoot, story.id), font, media, music });
    const first = story.pieces[0];
    const cover = join(dir, 'cover.jpg');
    // cover — the best moment of the first piece (where the pet is best visible)
    await storyCover(story, video, cover, first);

    const titles = { A: withSpecies(story.title, speciesName), B: withSpecies(titleB(story), speciesName) };
    const night = isNight(story, lib);
    // If there is a Claude key, Claude writes texts A; the source is set by the fact of the reply, B stays a template.
    const t = await claudeTexts(story, story.title, night);
    if (t.source === 'claude') titles.A = { ru: t.titleRu, en: t.titleEn };
    const textsA = t.source === 'claude' ? t : storyTexts(story, titles.A, speciesName);
    const textsB = storyTexts(story, titles.B, speciesName);
    const packagesA = buildPackages(textsA, { petNames, speciesName });
    const packagesB = buildPackages(textsB, { petNames, speciesName });
    // the second channel is English: the same picture, texts for an English-speaking audience
    const packagesEnA = buildPackages(textsA, { petNames, speciesName, lang: 'en' });
    const packagesEnB = buildPackages(textsB, { petNames, speciesName, lang: 'en' });
    const manifest = {
      kind: 'story', id: story.id, storyKind: story.kind, story,
      createdAt: new Date(now()).toISOString(),
      outputs: { youtube: video, tiktok: video, reels: video },
      cover, titles, pick: 'A', packages: packagesA, packagesA, packagesB,
      channels: ['ru', 'en'], packagesEn: packagesEnA, packagesEnA, packagesEnB,
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
   * The best free plan to replace the removed moment (pieces — what is left in the video):
   * no more than 2 moments from one video, the video is not from a neighbouring calendar video and not already in 2 videos this week.
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
   * "Remove moment": the person saw that the pet is not visible in the moment (or it is not the right pet).
   * The plan is marked "no pet" (it no longer goes into stories), the video is re-edited without it,
   * a fresh moment takes its place in the top 5. Cover, sources, post.txt and notes — again.
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
     * The whole batch of files. onProgress({stage, i, n, name, eta}) — eta in seconds (by the average step duration).
     * Returns {files, made, decisions, stats, disk}.
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
   * Assembling videos from what is already in the library. There is a local model — without a reference we ask for 3–5 shots once,
   * with the reference we edit what is recognized, and unsure ones go to the person in one batch. No model and no Claude — the person marks everything.
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
        // the model is there, the reference is not: we ask for pet photos once, then we recognize it ourselves
        res.decisions.push({ type: 'reference', text: 'Покажите вашего зверька: 3–5 фото или видео, где его хорошо видно. Это один раз — дальше узнаю его сам.' });
        onProgress({ stage: 'ждёт снимков зверька', i: 0, n: 0, name: '', eta: 0 });
        res.stats = lib.stats();
        return res;
      }
      if (wait.length && canJudge()) {
        // the model recognizes it itself; the person gets only those it is unsure about. Editing goes on without them.
        res.decisions.push({ type: 'confirm', clips: wait.map((c) => ({ id: c.id, name: c.name, sheet: sheet(c.id), video: lib.realPath?.(c) ?? null })), text: `Не уверен в ${wait.length} видео. Отметьте, где ваш зверёк, и нажмите «Собрать ролики». Не отмеченные не возьму.` });
      } else if (wait.length) {
        res.decisions.push({ type: 'confirm', clips: wait.map((c) => ({ id: c.id, name: c.name, sheet: sheet(c.id), video: lib.realPath?.(c) ?? null })), text: `Отметьте, где ваш зверёк: по 9 кадрам из каждого видео. Видео с другим животным в ролики не попадут.` });
        onProgress({ stage: 'ждёт отметки', i: 0, n: 0, name: '', eta: 0 });
        res.stats = lib.stats();
        return res;
      }
      // privacy before the stories: videos analysed without the model or with a failed check are reviewed now
      const pv = await sweepPrivacy(onProgress, res);
      const free = calendar.free();
      if (free === 0) {
        res.decisions.push({ type: 'full', text: 'Календарь на 14 дней заполнен — новые ролики соберу, когда освободится день' });
      } else {
        // a story of the same type as the day's scenario is edited in the order of the scenario's frames
        const labelsOf = (p) => lib.get(p.clip)?.shots?.[p.shot]?.labels ?? [];
        const stories = makeStories(pv.view, { history: calendar.history(), now: now(), count: Math.min(maxStories, free), focus }).map((st) => orderByScenario(st, scenario, labelsOf));
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
          // an honest reason in plain words: how many pieces are not in videos yet, why they were not assembled, and what to shoot more of
          const s = lib.supply?.();
          res.decisions.push({ type: 'more', text: moreText(s, want - stories.length, not.filter((w) => w.gated)) });
        }
        for (const t of reshootText(lib.all?.() ?? [])) res.decisions.push({ type: 'reshoot', text: t });
        // which kinds were not assembled and why — so it is visible what the batch lacks
        for (const w of not) res.decisions.push({ type: 'missing', kind: w.kind, gated: w.gated, text: `«${w.name}» не собран: ${w.why}` });
      }
    }
    onProgress({ stage: 'готово', i: 1, n: 1, name: '', eta: 0 });
    res.stats = lib.stats();
    return res;
  }
}
