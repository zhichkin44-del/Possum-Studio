// Pipeline: video → analysis → advice and pet care → texts → three edits (YT/TikTok/Reels) → cover → manifest.json + post.txt.
// Publishes nothing: publishing is separate and only by the owner's button.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { deriveMoments } from './analyze.js';
import { advise } from './advise.js';
import { welfareNotes } from './welfare.js';
import { buildPackages, stripNames } from './packages.js';
import { makePlan, PROFILES } from './plan.js';
import { ensureSfx, ensureMusic, listMusic, pickMusic } from './assets.js';
import { renderPlan, makeCover } from './render.js';

const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');

// first letter capitalized, period at the end
const sentence = (t) => { const x = String(t ?? '').trim(); return x ? x[0].toUpperCase() + x.slice(1) + (/[.!?…]$/.test(x) ? '' : '.') : ''; };

/** If more than two pieces come from one video — why (the rule "no more than two while there are enough others"). */
function manyFromOne(sources = []) {
  const n = {};
  for (const x of sources) n[x.file] = (n[x.file] ?? 0) + 1;
  return Object.entries(n).filter(([, k]) => k > 2).map(([f, k]) => `Из видео «${f}» ${k} куска: других подходящих видео не хватило.`);
}

/** Service notes for the owner (not for the feed): advice and pet care. */
export function notesText(m) {
  return [
    'Это заметки для вас, не для публикации.', '',
    `Совет: ${m.advice.verdict}. ${sentence(m.advice.why)}`,
    ...(m.needsReview ? [`Проверьте: ${sentence(m.needsReview)}`] : []),
    ...(m.sources?.length ? ['', 'Из чего собран ролик (проверьте каждый момент):', ...m.sources.map((x, k) => `${k + 1}. ${x.at}–${x.to} в ролике${x.caption ? ` (${x.caption})` : ''}: видео «${x.file}», ${x.from}–${x.till}`)] : []),
    ...manyFromOne(m.sources),
    ...(m.welfare?.length ? ['', 'Забота о зверьке:', ...m.welfare.map((w) => `• ${w}`)] : []),
  ].join('\n');
}

/** Writes post.txt (platform texts) and notes.txt (advice and care). */
export function writePost(dir, m) {
  writeFileSync(join(dir, 'пост.txt'), postText(m), 'utf8');
  writeFileSync(join(dir, 'заметки.txt'), notesText(m), 'utf8');
}

/** post.txt — only the platform texts; it can be copied as a whole. */
const block = (p) => [
  '— YouTube Shorts —', p.youtube.title, p.youtube.description, `Теги: ${p.youtube.tags.join(', ')}`,
  '', '— TikTok —', p.tiktok.caption,
  '', '— Instagram Reels —', p.instagram.caption,
];
export function postText(m) {
  if (!m.packagesEn) return block(m.packages).join('\n');
  return ['=== Канал RU ===', ...block(m.packages), '', '=== Канал EN ===', ...block(m.packagesEn)].join('\n');
}

/**
 * processVideo — one whole video.
 * deps: media (createMedia), ai (createAi), assetsDir (sounds/lullaby), musicDir (own music), font (ttf), onStep(text).
 */
export async function processVideo({ src, outRoot, settings = {}, media, ai, assetsDir, musicDir, font, profiles = Object.keys(PROFILES), onStep = () => {} }) {
  const name = basename(src, extname(src)).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'video';
  const dir = join(outRoot, `${stamp()}_${name}`);
  mkdirSync(dir, { recursive: true });

  onStep('Смотрю ролик');
  const sig = await media.signals(src);
  const analysis = { ...deriveMoments(sig), info: sig.info };
  if (!(analysis.duration >= 1)) throw new Error('Видео слишком короткое: нужно хотя бы 1 секунда.');
  const advice = advise(analysis);
  const welfare = welfareNotes(analysis);

  onStep('Пишу тексты');
  const speciesName = settings.speciesName?.ru ? settings.speciesName : null;
  const texts = await ai.suggest({ duration: analysis.duration, peaks: analysis.peaks, dark: analysis.dark, advice, species: speciesName?.ru });
  const petNames = settings.petNames ?? [];
  const allowName = Boolean(settings.allowName);
  const packages = buildPackages(texts, { petNames, allowName, speciesName });
  const packagesEn = buildPackages(texts, { petNames, allowName, speciesName, lang: 'en' });
  const capRu = allowName ? texts.titleRu : stripNames(texts.titleRu, petNames);
  const capEn = allowName ? texts.titleEn : stripNames(texts.titleEn, petNames);

  onStep('Готовлю звуки');
  const sfxFiles = await ensureSfx(join(assetsDir, 'sfx'), media);
  const own = listMusic(musicDir);
  const music = pickMusic(own, name) ?? await ensureMusic(join(assetsDir, 'music'), media);

  const outputs = {}, plans = {};
  const work = join(dir, '_work');
  for (const prof of profiles) {
    onStep(`Монтирую: ${PROFILES[prof].label}`);
    const plan = makePlan(analysis, prof, { music, captions: { ru: capRu, en: capEn } });
    const out = join(dir, `${prof}.mp4`);
    await renderPlan({ src, plan, info: sig.info, sfxFiles, out, workDir: work, font, media });
    outputs[prof] = out; plans[prof] = plan;
  }
  onStep('Делаю обложку');
  const first = profiles[0];
  const cover = join(dir, 'cover.jpg');
  await makeCover({ video: outputs[first], at: Math.min(plans[first].hookAt + 0.2, plans[first].total - 0.1), out: cover, media });

  const manifest = {
    src, dir, createdAt: new Date().toISOString(),
    analysis: { duration: analysis.duration, peaks: analysis.peaks, best: analysis.best, dark: analysis.dark, flash: analysis.flash },
    advice, welfare, texts, packages, packagesEn, channels: ['ru', 'en'], outputs, cover, music: { file: music, own: own.includes(music) },
    plans,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writePost(dir, manifest);
  rmSync(work, { recursive: true, force: true });
  onStep('Готово');
  return manifest;
}
