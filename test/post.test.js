// Quality of the finished post: captions in RU and EN, hashtags, the first comment, no repeats in a row, no service words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptions, PLATFORMS, qualityIssues } from '../src/post.js';
import { TASKS } from '../src/tasks.js';

const pet = { im: 'Пип', ro: 'Пипа', da: 'Пипу', vi: 'Пипа', tv: 'Пипом', en: 'Pip' };

test('every task has RU and EN captions, hashtags and a first comment in both languages', () => {
  for (const t of TASKS) {
    const c = buildCaptions({ task: t, pet, n: 0 });
    for (const p of ['yt_ru', 'yt_en']) {
      assert.ok(c[p].caption.length > 10, `${t.id}/${p}: caption`);
      assert.ok(c[p].hashtags.length >= 3, `${t.id}/${p}: hashtags`);
      assert.ok(c[p].comment.endsWith('?'), `${t.id}/${p}: comment is a question`);
    }
    assert.match(c.yt_ru.caption, /[а-яё]/i); assert.match(c.yt_en.caption, /^[^а-яё]+$/i, `${t.id}: EN without Cyrillic`);
    assert.ok(c.yt_ru.hashtags.every((h) => h.startsWith('#')));
    assert.ok(c.yt_en.hashtags.includes('#sugarglider'));
  }
});

test('four platforms: YouTube RU/EN, TikTok, Reels; each has its own caption and its own hashtag set', () => {
  assert.deepEqual(PLATFORMS.map((p) => p.id), ['yt_ru', 'yt_en', 'tiktok', 'reels']);
  const c = buildCaptions({ task: TASKS[0], pet, n: 3 });
  assert.ok(c.tiktok.hashtags.length <= 5, 'TikTok has no more than five hashtags');
  assert.ok(c.reels.hashtags.length <= 8);
  assert.ok(c.yt_ru.hashtags.includes('#shorts') || c.yt_en.hashtags.includes('#shorts'), 'YouTube Shorts: #shorts');
});

test('captions do not repeat in a row: neighbouring clips of one scenario get different variants', () => {
  const t = TASKS.find((x) => x.id === 'flight');
  const a = buildCaptions({ task: t, pet, n: 0 }).yt_ru.caption;
  const b = buildCaptions({ task: t, pet, n: 1 }).yt_ru.caption;
  assert.notEqual(a, b);
});

test('captions contain no service words, banned topics or foreign music', () => {
  const bad = [/нельзя/i, /ветеринар/i, /undefined/, /\{|\}/, /скрипт/i, /музык/i];
  for (const t of TASKS) {
    const c = buildCaptions({ task: t, pet, n: 0 });
    for (const p of Object.keys(c)) for (const re of bad) assert.doesNotMatch(c[p].caption + c[p].comment, re, `${t.id}/${p}`);
  }
});

test('quality check of a finished clip: length 8–20 s, 9:16, has sound, first frame is not black', () => {
  const ok = { duration: 14, width: 1080, height: 1920, hasAudio: true, firstFrameLuma: 80, blackRatio: 0 };
  assert.deepEqual(qualityIssues(ok), []);
  assert.ok(qualityIssues({ ...ok, duration: 25 }).some((i) => /длин/.test(i)));
  assert.ok(qualityIssues({ ...ok, duration: 5 }).some((i) => /коротк/.test(i)));
  assert.ok(qualityIssues({ ...ok, width: 1920, height: 1080 }).some((i) => /вертикал/.test(i)));
  assert.ok(qualityIssues({ ...ok, hasAudio: false }).some((i) => /звук/.test(i)));
  assert.ok(qualityIssues({ ...ok, firstFrameLuma: 3 }).some((i) => /первый кадр/.test(i)));
});
