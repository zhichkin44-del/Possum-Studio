// Two channels: Russian and English. Each video gets two text packages, each for its own audience.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPackages, stripNames } from '../core/packages.js';
import { storyTexts, applyPick } from '../core/producer.js';
import { templateTexts, createAi } from '../core/ai.js';
import { postText } from '../core/pipeline.js';

const CYR = /[а-яё]/i;
const SP = { ru: 'сахарный поссум', en: 'sugar glider' };

test('EN package: title with #Shorts, no Cyrillic in texts, tags or captions', () => {
  const p = buildPackages({ titleRu: 'Прыжок', titleEn: 'Nobody expected this jump', descRu: 'Описание', descEn: 'A tiny acrobat shows off.', tags: ['прыжок'], tagsEn: ['jump', 'прыжок'] }, { lang: 'en', speciesName: SP });
  assert.match(p.youtube.title, /^Nobody expected this jump #Shorts$/);
  for (const s of [p.youtube.title, p.youtube.description, ...p.youtube.tags, p.tiktok.caption, p.instagram.caption]) assert.doesNotMatch(s, CYR, s);
  assert.ok(p.youtube.tags.includes('jump') && p.youtube.tags.includes('sugar glider'));
  assert.match(p.tiktok.caption, /#sugarglider/);
  assert.match(p.youtube.description, /#pets/);
  assert.equal(p.lang, 'en');
});

test('EN package without English description and tags — empty description, base tags; without species — fallback title', () => {
  const p = buildPackages({ titleRu: 'Прыжок', descRu: 'Описание' }, { lang: 'en' });
  assert.equal(p.youtube.title, 'Our little friend #Shorts');
  assert.doesNotMatch(JSON.stringify(p), CYR);
  assert.equal(buildPackages({}, { lang: 'en', speciesName: SP }).youtube.title, 'Sugar glider #Shorts');
});

test('RU package unchanged: Russian title and tags, lang = ru', () => {
  const p = buildPackages({ titleRu: 'Прыжок', titleEn: 'Jump', descRu: 'Описание', descEn: 'Desc', tags: ['прыжок'] }, { speciesName: SP });
  assert.equal(p.youtube.title, 'Прыжок #Shorts');
  assert.match(p.youtube.description, /^Описание\n\n#сахарныйпоссум #питомцы/);
  assert.doesNotMatch(p.tiktok.caption, /Desc/);
  assert.equal(p.lang, 'ru');
});

test('pet name does not leak into EN, neither in Latin nor in Cyrillic', () => {
  const names = ['Боня', 'Bonya'];
  const p = buildPackages({ titleEn: "Bonya's big jump", descEn: 'Bonya jumps. Боня прыгает.', tagsEn: ['bonya', 'jump'] }, { lang: 'en', petNames: names });
  assert.doesNotMatch(JSON.stringify(p), /bonya|боня/i);
  assert.equal(stripNames('Bonyas toy', ['Bonya']), 'Toy');
  assert.equal(stripNames("Bonya's toy", ['Bonya']), 'Toy');
});

test('name is cut only as a whole word: ordinary words are unaffected in EN and RU', () => {
  assert.equal(stripNames('Tomorrow is Maximum fun, Bonus time', ['Tom', 'Max', 'Bo']), 'Tomorrow is Maximum fun, Bonus time');
  assert.equal(stripNames('Tom and Max play', ['Tom', 'Max']), 'Play');
  assert.equal(stripNames('Бобрик и Пипу мандарин', ['Боб', 'Пип']), 'Бобрик и мандарин');
  assert.equal(stripNames('Пипом доволен', ['Пип']), 'Доволен');
  const p = buildPackages({ titleEn: 'Tomorrow Bo jumps', descEn: 'A Bonus clip with Bo.', tagsEn: ['bonus'] }, { lang: 'en', petNames: ['Bo'] });
  assert.match(p.youtube.title, /^Tomorrow jumps/);
  assert.match(p.youtube.description, /Bonus clip with\./);
});

test('template story texts produce English description and tags', () => {
  for (const kind of ['top5', 'day', 'beforeAfter', 'calm', 'asmr', 'series']) {
    const t = storyTexts({ kind, variant: 1 }, { ru: 'Заголовок', en: 'Title' }, SP);
    assert.ok(t.descEn && !CYR.test(t.descEn), `${kind}: ${t.descEn}`);
    assert.match(t.descEn, /^Sugar glider\. /);
    assert.ok(t.tagsEn.length && t.tagsEn.every((x) => !CYR.test(x)), kind);
  }
  assert.doesNotMatch(storyTexts({ kind: 'top5' }, { ru: 'x', en: 'x' }, null).descEn, /glider/i);
});

test('AI template without key carries descEn and tagsEn', async () => {
  const t = templateTexts({ peaks: [{ kind: 'move' }] });
  assert.ok(t.descEn && !CYR.test(t.descEn));
  assert.ok(t.tagsEn.every((x) => !CYR.test(x)));
  const r = await createAi({ apiKey: '' }).suggest({ duration: 10 });
  assert.ok(r.descEn);
});

test('AI: descEn is taken from the response, without it — English template', async () => {
  const mk = (body) => ({ beta: { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(body) }], usage: { input_tokens: 10, output_tokens: 10 } }) } } });
  const base = { titleRu: 'Р', titleEn: 'E', descRu: 'Описание', tags: ['а'] };
  const a = await createAi({ apiKey: 'test-key-not-real', client: mk({ ...base, descEn: 'For an English audience.', tagsEn: ['cute'] }) }).suggest({ duration: 5 });
  assert.equal(a.source, 'claude');
  assert.equal(a.descEn, 'For an English audience.');
  assert.deepEqual(a.tagsEn, ['cute']);
  const b = await createAi({ apiKey: 'test-key-not-real', client: mk(base) }).suggest({ duration: 5 });
  assert.equal(b.source, 'claude');
  assert.ok(b.descEn && !CYR.test(b.descEn), 'old response without descEn — English template');
});

test('applyPick switches the English channel too; post.txt shows both channels', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chan-'));
  const ru = (t) => buildPackages({ titleRu: t, descRu: 'д' });
  const en = (t) => buildPackages({ titleEn: t, descEn: 'd' }, { lang: 'en' });
  const m = { advice: { verdict: 'хорошо', why: 'видно зверька' }, pick: 'A', packages: ru('Ру А'), packagesA: ru('Ру А'), packagesB: ru('Ру Б'), packagesEn: en('En A'), packagesEnA: en('En A'), packagesEnB: en('En B'), channels: ['ru', 'en'] };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m), 'utf8');
  const out = applyPick(dir, 'B');
  assert.match(out.packagesEn.youtube.title, /^En B/);
  const post = readFileSync(join(dir, 'пост.txt'), 'utf8');
  assert.match(post, /Канал RU/);
  assert.match(post, /Канал EN/);
  assert.match(post, /En B #Shorts/);
  assert.match(post, /Ру Б #Shorts/);
  // old manifest without EN — the post as before, without the EN section
  assert.doesNotMatch(postText({ packages: ru('Старый') }), /Канал EN/);
});
