// Mentor: catalog without a key, checking the neural network's answer, the pet's name never leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactNames, unsafe, fallback, ask } from '../core/mentor.js';
import { createStudio } from '../core/studio.js';
import { setVault } from '../core/settings.js';
import { fakeVault } from './vault.js';

setVault(fakeVault());
const NAME = 'Тошка'; // fake name for the test

test('the pet name is replaced in any case, foreign words are left alone', () => {
  assert.equal(redactNames('Тошка спит, дали Тошке банан, с Тошкой', [NAME]), 'зверёк спит, дали зверёк банан, с зверёк');
  assert.equal(redactNames('тошнота', [NAME]), 'тошнота');
  assert.equal(redactNames('Мася любит масло, Масечка и Масю', ['Мася']), 'зверёк любит масло, зверёк и зверёк');
  assert.equal(redactNames('Вовка и Вовочка, Вовой', ['Вова']), 'зверёк и зверёк, зверёк');
  assert.equal(redactNames('без имён', []), 'без имён');
});

test('answer check: light, clothing, food; a negation is not counted as advice', () => {
  assert.equal(unsafe('Включите свет поярче.'), 'свет');
  assert.equal(unsafe('Наденьте ему костюм пирата.'), 'одежда');
  assert.equal(unsafe('Дайте кусочек шоколада.'), 'еда');
  assert.equal(unsafe('Шоколад нельзя. Дайте кусочек яблока.'), '');
  assert.equal(unsafe('Костюмы не надевайте — лучше мешочек.'), '');
});

test('answer check: "instead of" and "safe" do not hide dangerous advice', () => {
  assert.equal(unsafe('Вместо ужина дайте шоколад.'), 'еда');
  assert.equal(unsafe('Можно шапочку, это безопасно — вместо пледа.'), 'одежда');
  assert.equal(unsafe('Шоколад нельзя, но можно чуть-чуть.'), 'еда');
  assert.equal(unsafe('Свитер не опасен, наденьте.'), 'одежда');
  assert.equal(unsafe('Виноград — не нужно бояться, он полезен.'), 'еда');
  assert.equal(unsafe('Виноград не вредит, не запрещено.'), 'еда');
  assert.equal(unsafe('Виноград совсем не опасен, дайте немного.'), 'еда');
  assert.equal(unsafe('Шоколад не стоит бояться.'), 'еда');
  assert.equal(unsafe('Шоколад вреден, его нельзя.'), '');
  assert.equal(unsafe('Дай ему шоколад — вредный, но ничего.'), 'еда');
  assert.equal(unsafe('Дай виноград, он ядовитый, но это мелочь.'), 'еда');
  assert.equal(unsafe('Шоколад — вредный, но дай кусочек.'), 'еда');
  assert.equal(unsafe('Шоколад вредный.'), 'еда');
  assert.equal(unsafe('Не давай шоколад, он вредный.'), '');
  assert.equal(unsafe('Нет, шапочку не надевайте: это стресс.'), '');
  assert.equal(unsafe('Нарядиться может человек: фартук в цвет праздника.'), '');
  assert.equal(unsafe('Человек может надеть шапочку и на него тоже.'), 'одежда');
  assert.equal(unsafe(fallback('можно шоколадку?').answer), '');
  assert.equal(unsafe(fallback('можно надеть шапочку?').answer), '');
});

test('without the neural net: hat and chocolate — refusal, not a food list', () => {
  assert.match(fallback('можно ему шапочку?').answer, /^Нарядить|нет/i);
  assert.deepEqual(fallback('можно ему шапочку?').ideaIds, ['season', 'pouch']);
  assert.match(fallback('дать кусочек шоколада?').answer, /^Нет, это давать нельзя/);
});

test('without the neural net: danger first, then the topic', () => {
  assert.match(fallback('можно дать шоколадку?').answer, /^Нет, это давать нельзя/);
  assert.deepEqual(fallback('хочу нарядить в костюм').ideaIds, ['season', 'pouch']);
  assert.ok(fallback('чем угостить с тарелочки').ideaIds.includes('plate'));
  assert.ok(fallback('как выложить в тикток').ideaIds.includes('weekly'));
  assert.ok(fallback('куда его вывести погулять').ideaIds.includes('pouch'));
  assert.equal(fallback('что снять сегодня, идеи').ideaIds.length, 5);
  assert.equal(fallback('привет').ideaIds.length, 0);
});

test('neural net: name is not sent, answer without name, bad answer and error — catalog', async () => {
  let sent = '';
  const good = { enabled: true, async json({ content }) { sent = content; return { answer: `${NAME} любит яблоко — дайте кусочек.`, ideaIds: ['plate', 'нет-такой'] }; } };
  const r = await ask('Чем угостить Тошку?', { ai: good, history: [{ q: `${NAME} спит`, a: 'ок' }], petNames: [NAME] });
  assert.equal(r.source, 'ai');
  assert.ok(!sent.includes('Тошк') && !r.answer.includes('Тошк'));
  assert.deepEqual(r.ideaIds, ['plate']);

  const bad = { enabled: true, async json() { return { answer: 'Включите яркий свет и наденьте шапочку.', ideaIds: [] }; } };
  assert.equal((await ask('как снимать ночью', { ai: bad })).source, 'catalog');
  const err = { enabled: true, async json() { throw new Error('сеть'); } };
  const e = await ask('чем угостить', { ai: err });
  assert.equal(e.source, 'catalog');
  assert.ok(e.ideaIds.includes('plate'));
  assert.equal((await ask('чем угостить', { ai: null })).source, 'catalog');
});

test('neural net advises danger under "instead of"/"safe" — answer from the catalog, not its own', async () => {
  for (const bad of ['Вместо ужина дайте шоколад.', 'Можно шапочку, это безопасно.', 'Свитер безопасно, наденьте.', 'Виноград — не нужно бояться, он полезен.', 'Виноград не вредит, не запрещено.', 'Дай ему шоколад — вредный, но ничего.', 'Дай виноград, он ядовитый, но это мелочь.', 'Шоколад — вредный, но дай кусочек.']) {
    const ai = { enabled: true, async json() { return { answer: bad, ideaIds: ['plate'] }; } };
    const r = await ask('чем угостить и во что нарядить?', { ai });
    assert.equal(r.source, 'catalog', bad);
    assert.ok(!r.answer.includes(bad), bad);
    assert.equal(unsafe(r.answer), '', bad);
  }
});

test('studio.mentor takes names from settings and does not send them; studio.ideas returns the catalog', async () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-mentor-'));
  mkdirSync(join(root, 'cfg'), { recursive: true });
  writeFileSync(join(root, 'cfg', 'settings.json'), JSON.stringify({ petNames: [NAME] }));
  let sent = '';
  const aiFactory = () => ({ enabled: true, async json({ content }) { sent = content; return { answer: 'Снимите тарелочку.', ideaIds: ['plate'] }; } });
  const studio = createStudio({ path: join(root, 'cfg', 'settings.json'), dataRoot: join(root, 'data'), media: { tools: {} }, aiFactory });
  const r = await studio.mentor(`${NAME} проснулся, что снять?`, []);
  assert.equal(r.source, 'ai');
  assert.ok(sent.length && !sent.includes('Тошк'));
  assert.ok(studio.ideas().ideas.length >= 12);
});
