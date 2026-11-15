// Конвейер: видео → анализ → совет и забота о зверьке → тексты → три монтажа (YT/TikTok/Reels) → обложка → manifest.json + пост.txt.
// Ничего не выкладывает: публикация отдельно и только по кнопке владельца.
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

export function postText(m) {
  const p = m.packages;
  return [
    `Совет: ${m.advice.verdict}. ${m.advice.why}`,
    ...(m.welfare.length ? ['', 'Забота о зверьке:', ...m.welfare.map((w) => `• ${w}`)] : []),
    '', `Тексты: ${m.texts.source}${m.texts.fallbackReason ? ` (${m.texts.fallbackReason})` : ''}`,
    '', '— YouTube Shorts —', p.youtube.title, p.youtube.description, `Теги: ${p.youtube.tags.join(', ')}`,
    '', '— TikTok —', p.tiktok.caption,
    '', '— Instagram Reels —', p.instagram.caption,
    '', 'Файлы:', ...Object.entries(m.outputs).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
}

/**
 * processVideo — один ролик целиком.
 * deps: media (createMedia), ai (createAi), assetsDir (звуки/колыбельная), musicDir (своя музыка), font (ttf), onStep(text).
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
  const texts = await ai.suggest({ duration: analysis.duration, peaks: analysis.peaks, dark: analysis.dark, advice });
  const petNames = settings.petNames ?? [];
  const allowName = Boolean(settings.allowName);
  const packages = buildPackages(texts, { petNames, allowName });
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
    advice, welfare, texts, packages, outputs, cover, music: { file: music, own: own.includes(music) },
    plans,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(dir, 'пост.txt'), postText(manifest), 'utf8');
  rmSync(work, { recursive: true, force: true });
  onStep('Готово');
  return manifest;
}
