// Качество готового поста: подписи на RU и EN, хештеги, первый комментарий, нет повторов подряд, без служебных слов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptions, PLATFORMS, qualityIssues } from '../src/post.js';
import { TASKS } from '../src/tasks.js';

const pet = { im: 'Пип', ro: 'Пипа', da: 'Пипу', vi: 'Пипа', tv: 'Пипом', en: 'Pip' };

test('у каждого задания есть подписи RU и EN, хештеги и первый комментарий на обоих языках', () => {
  for (const t of TASKS) {
    const c = buildCaptions({ task: t, pet, n: 0 });
    for (const p of ['yt_ru', 'yt_en']) {
      assert.ok(c[p].caption.length > 10, `${t.id}/${p}: подпись`);
      assert.ok(c[p].hashtags.length >= 3, `${t.id}/${p}: хештеги`);
      assert.ok(c[p].comment.endsWith('?'), `${t.id}/${p}: комментарий-вопрос`);
    }
    assert.match(c.yt_ru.caption, /[а-яё]/i); assert.match(c.yt_en.caption, /^[^а-яё]+$/i, `${t.id}: EN без кириллицы`);
    assert.ok(c.yt_ru.hashtags.every((h) => h.startsWith('#')));
    assert.ok(c.yt_en.hashtags.includes('#sugarglider'));
  }
});

test('четыре площадки: YouTube RU/EN, TikTok, Reels; у каждой своя подпись и свой набор хештегов', () => {
  assert.deepEqual(PLATFORMS.map((p) => p.id), ['yt_ru', 'yt_en', 'tiktok', 'reels']);
  const c = buildCaptions({ task: TASKS[0], pet, n: 3 });
  assert.ok(c.tiktok.hashtags.length <= 5, 'в TikTok хештегов не больше пяти');
  assert.ok(c.reels.hashtags.length <= 8);
  assert.ok(c.yt_ru.hashtags.includes('#shorts') || c.yt_en.hashtags.includes('#shorts'), 'YouTube Shorts: #shorts');
});

test('подписи не повторяются подряд: соседние ролики одного сценария получают разные варианты', () => {
  const t = TASKS.find((x) => x.id === 'flight');
  const a = buildCaptions({ task: t, pet, n: 0 }).yt_ru.caption;
  const b = buildCaptions({ task: t, pet, n: 1 }).yt_ru.caption;
  assert.notEqual(a, b);
});

test('в подписях нет служебных слов, запрещённых тем и чужой музыки', () => {
  const bad = [/нельзя/i, /ветеринар/i, /undefined/, /\{|\}/, /скрипт/i, /музык/i];
  for (const t of TASKS) {
    const c = buildCaptions({ task: t, pet, n: 0 });
    for (const p of Object.keys(c)) for (const re of bad) assert.doesNotMatch(c[p].caption + c[p].comment, re, `${t.id}/${p}`);
  }
});

test('проверка качества готового ролика: длина 8–20 с, 9:16, есть звук, первый кадр не чёрный', () => {
  const ok = { duration: 14, width: 1080, height: 1920, hasAudio: true, firstFrameLuma: 80, blackRatio: 0 };
  assert.deepEqual(qualityIssues(ok), []);
  assert.ok(qualityIssues({ ...ok, duration: 25 }).some((i) => /длин/.test(i)));
  assert.ok(qualityIssues({ ...ok, duration: 5 }).some((i) => /коротк/.test(i)));
  assert.ok(qualityIssues({ ...ok, width: 1920, height: 1080 }).some((i) => /вертикал/.test(i)));
  assert.ok(qualityIssues({ ...ok, hasAudio: false }).some((i) => /звук/.test(i)));
  assert.ok(qualityIssues({ ...ok, firstFrameLuma: 3 }).some((i) => /первый кадр/.test(i)));
});
