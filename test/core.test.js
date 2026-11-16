// Ядро приложения и бота владельца: чистые функции (анализ, план монтажа, советы, благополучие, пакеты, настройки, ИИ-запасной путь).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveMoments } from '../core/analyze.js';
import { makePlan, PROFILES } from '../core/plan.js';
import { advise } from '../core/advise.js';
import { welfareNotes } from '../core/welfare.js';
import { buildPackages, stripNames } from '../core/packages.js';
import { loadSettings, saveSettings, maskSettings, redactSecrets, settingsPath, setVault } from '../core/settings.js';
import { fakeVault } from './vault.js';
import { createAi, templateTexts } from '../core/ai.js';
import { createLog } from '../core/publishedlog.js';

const STEP = 0.25;
// 16 с: тихо и спокойно, на 9 с — прыжок и писк
function signals({ seconds = 16, peakAt = 9, squeakAt = 9.25, luma = 90, flashAt = null } = {}) {
  const n = Math.round(seconds / STEP);
  const motion = [], loud = [], lum = [];
  for (let i = 0; i < n; i++) {
    const t = i * STEP;
    motion.push(2 + (Math.abs(t - peakAt) < 0.6 ? 20 : 0) + (Math.abs(t - 4) < 0.3 ? 8 : 0));
    loud.push(Math.abs(t - squeakAt) < 0.3 ? -12 : -45);
    lum.push(flashAt !== null && Math.abs(t - flashAt) < 0.2 ? 230 : luma);
  }
  return { step: STEP, motion, loud, luma: lum };
}

test('deriveMoments: находит прыжок, писк и лучший момент', () => {
  const a = deriveMoments(signals());
  assert.ok(Math.abs(a.duration - 16) < 0.3);
  assert.ok(Math.abs(a.best.t - 9) <= 0.75, `best=${a.best.t}`);
  assert.ok(a.peaks.some((p) => p.kind === 'move' && Math.abs(p.t - 9) <= 0.75));
  assert.ok(a.peaks.some((p) => p.kind === 'squeak' && Math.abs(p.t - 9.25) <= 0.5));
  assert.equal(a.dark, false);
  assert.deepEqual(a.flash, []);
});

test('deriveMoments: темно и вспышка замечены', () => {
  const dark = deriveMoments(signals({ luma: 18 }));
  assert.equal(dark.dark, true);
  const fl = deriveMoments(signals({ flashAt: 5 }));
  assert.ok(fl.flash.length >= 1, 'вспышка должна найтись');
});

test('deriveMoments: пустой вход не падает', () => {
  const a = deriveMoments({ step: STEP, motion: [], loud: [], luma: [] });
  assert.equal(a.duration, 0);
  assert.deepEqual(a.peaks, []);
});

test('makePlan: хук первым, 1–3 звука, длины по площадкам', () => {
  const a = deriveMoments(signals({ seconds: 40, peakAt: 25, squeakAt: 25.25 }));
  for (const name of Object.keys(PROFILES)) {
    const p = makePlan(a, name, { music: 'C:/m/track.mp3', captions: { ru: 'Прыжок!', en: 'Jump!' } });
    const total = p.segments.reduce((s, x) => s + x.len, 0);
    assert.ok(total <= PROFILES[name].maxLen + 0.01, `${name}: ${total}`);
    // лучший момент — в первые 1,5 с ролика
    assert.ok(p.hookAt <= 1.5, `${name}: hookAt=${p.hookAt}`);
    assert.ok(p.sfx.length >= 1 && p.sfx.length <= 3, `${name}: sfx=${p.sfx.length}`);
    for (const s of p.sfx) assert.ok(s.at >= 0 && s.at < total);
    assert.ok(p.zooms.length >= 1);
    assert.equal(p.captions.ru, 'Прыжок!');
  }
  assert.equal(makePlan(a, 'tiktok', { music: 'C:/m/track.mp3' }).music, null, 'TikTok — без музыки (тренд-звук ставится в приложении)');
  assert.equal(makePlan(a, 'youtube', { music: 'C:/m/track.mp3' }).music.file, 'C:/m/track.mp3');
  assert.ok(PROFILES.youtube.maxLen <= 30 && PROFILES.tiktok.maxLen <= 20 && PROFILES.reels.maxLen <= 15);
});

test('makePlan: лучший момент в середине длинного клипа — тизер в начале', () => {
  const a = deriveMoments(signals({ seconds: 16, peakAt: 12, squeakAt: 12.25 }));
  const p = makePlan(a, 'youtube', {});
  assert.ok(p.segments.length >= 1);
  assert.ok(p.hookAt <= 1.5);
  // сегменты не выходят за исходник
  for (const s of p.segments) assert.ok(s.from >= 0 && s.from + s.len <= a.duration + 0.01);
});

test('makePlan: слишком короткое видео — понятная ошибка', () => {
  const a = deriveMoments({ step: STEP, motion: [1, 2], loud: [-40, -40], luma: [90, 90] });
  assert.throws(() => makePlan(a, 'youtube', {}), /коротк/i);
});

test('advise: критерии видны, вспышка — «не советую»', () => {
  const good = advise(deriveMoments(signals()));
  assert.equal(good.verdict, 'выкладывай');
  assert.equal(good.criteria.движение, true);
  assert.equal(good.criteria.писк, true);
  assert.equal(good.criteria.светло, true);
  assert.match(good.why, /движение/);
  const calm = advise(deriveMoments({ step: STEP, motion: Array(40).fill(2), loud: Array(40).fill(-50), luma: Array(40).fill(20) }));
  assert.notEqual(calm.verdict, 'выкладывай');
  const flash = advise(deriveMoments(signals({ flashAt: 5 })));
  assert.equal(flash.verdict, 'не советую');
});

test('welfareNotes: в темноте не просим свет, про вспышку предупреждаем', () => {
  const dark = welfareNotes(deriveMoments(signals({ luma: 18 }))).join(' ');
  assert.match(dark, /ночн|ИК/i);
  assert.doesNotMatch(dark, /включи(те)? свет/i);
  const fl = welfareNotes(deriveMoments(signals({ flashAt: 5 }))).join(' ');
  assert.match(fl, /вспышк/i);
});

test('packages: имени питомца нет нигде, #Shorts в YouTube, лимиты длины', () => {
  const texts = { titleRu: 'Владимир Пип прыгает за мандарином', titleEn: 'Pip the sugar glider jumps', descRu: 'Пип снова ворует мандарин', tags: ['sugarglider', 'пип', 'поссум'] };
  const p = buildPackages(texts, { petNames: ['Владимир Пип', 'Пип', 'Pip'] });
  const all = JSON.stringify(p);
  assert.doesNotMatch(all, /пип|pip/i);
  assert.match(p.youtube.title, /#Shorts/);
  assert.ok(p.youtube.title.length <= 100);
  assert.ok(p.tiktok.caption.length <= 2200);
  assert.ok(p.instagram.caption.length <= 2200);
  assert.ok(p.youtube.tags.length >= 1);
  assert.doesNotMatch(all, /sugar glider jumps/i, 'английского заголовка в подписях нет');
  assert.doesNotMatch(stripNames('Пип и мандарин', ['Пип']), /Пип/);
  assert.match(stripNames('Пип и мандарин', ['Пип']), /^Мандарин$/);
});

test('packages: владелец может разрешить имя флажком', () => {
  const p = buildPackages({ titleRu: 'Пип прыгает', titleEn: '', descRu: '', tags: [] }, { petNames: ['Пип'], allowName: true });
  assert.match(p.youtube.title, /Пип/);
});

test('settings: сохраняются, ключи замаскированы, секреты вырезаются из ошибок', () => {
  setVault(fakeVault());
  const dir = mkdtempSync(join(tmpdir(), 'possum-set-'));
  const path = join(dir, 'settings.json');
  assert.deepEqual(loadSettings(path).youtube, {});
  saveSettings(path, { claudeKey: 'sk-ant-REDACTED1234', youtube: { clientId: 'cid', clientSecret: 'ysecret-9876' } });
  saveSettings(path, { telegram: { ownerId: '111' } });
  const s = loadSettings(path);
  assert.equal(s.youtube.clientId, 'cid');
  assert.equal(s.telegram.ownerId, '111');
  const m = maskSettings(s);
  assert.doesNotMatch(JSON.stringify(m), /SECRETSECRET|ysecret-9876/);
  assert.match(m.claudeKey, /1234$/);
  assert.equal(redactSecrets('ошибка sk-ant-REDACTED1234 тут', s), 'ошибка *** тут');
  assert.match(settingsPath({ APPDATA: '<project-dir>' }), /PossumStudio[\\/]settings\.json$/);
});

test('ai: без ключа — шаблоны и честная метка', async () => {
  const ai = createAi({ apiKey: '' });
  const r = await ai.suggest({ advice: { verdict: 'выкладывай' }, peaks: [{ kind: 'squeak' }] });
  assert.equal(r.source, 'шаблон');
  assert.ok(r.titleRu && r.titleEn);
  assert.ok(Array.isArray(r.tags) && r.tags.length);
  assert.deepEqual(Object.keys(templateTexts({})).sort(), ['descEn', 'descRu', 'tags', 'tagsEn', 'titleEn', 'titleRu']);
});

test('ai: ответ Claude разобран, ошибка — откат на шаблон без утечки ключа', async () => {
  const calls = [];
  const fake = { beta: { messages: { create: async (req) => { calls.push(req); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ titleRu: 'Ночной прыжок', titleEn: 'Night jump', descRu: 'Описание', tags: ['sugarglider'] }) }] }; } } } };
  const ai = createAi({ apiKey: 'sk-ant-REDACTED', client: fake });
  const r = await ai.suggest({ advice: { verdict: 'выкладывай' }, peaks: [] });
  assert.equal(r.source, 'claude');
  assert.equal(r.titleRu, 'Ночной прыжок');
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.equal(calls[0].output_config.format.type, 'json_schema');

  const refusing = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } };
  assert.equal((await createAi({ apiKey: 'k', client: refusing }).suggest({})).source, 'шаблон');
  const broken = { beta: { messages: { create: async () => { throw new Error('401 bad key sk-ant-REDACTED'); } } } };
  const b = await createAi({ apiKey: 'sk-ant-REDACTED', client: broken }).suggest({});
  assert.equal(b.source, 'шаблон');
  assert.doesNotMatch(b.fallbackReason, /sk-ant-REDACTED/);
});

test('publishedlog: второй раз то же видео на ту же площадку не уходит', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-log-'));
  const log = createLog(join(dir, 'published.jsonl'));
  assert.equal(log.was('C:/out/a.mp4', 'youtube'), false);
  log.add({ file: 'C:/out/a.mp4', platform: 'youtube', id: 'abc', url: 'https://youtube.com/shorts/abc' });
  assert.equal(log.was('C:/out/a.mp4', 'youtube'), true);
  assert.equal(log.was('C:/out/a.mp4', 'tiktok'), false);
  assert.ok(existsSync(join(dir, 'published.jsonl')));
  assert.match(readFileSync(join(dir, 'published.jsonl'), 'utf8'), /abc/);
});

test('packages: в TikTok есть описание, а не только заголовок и теги', () => {
  const p = buildPackages({ titleRu: 'Пять моментов', descRu: 'Собрали лучшие моменты — какой самый милый?', tags: [] });
  const lines = p.tiktok.caption.split('\n');
  assert.equal(lines[0], 'Пять моментов');
  assert.ok(lines.includes('Собрали лучшие моменты — какой самый милый?'), p.tiktok.caption);
  assert.match(lines.at(-1), /^#/);
  const empty = buildPackages({ titleRu: 'Пять моментов', descRu: '', tags: [] });
  assert.equal(empty.tiktok.caption.split('\n').length, 2, 'без описания пустой строки нет');
});
