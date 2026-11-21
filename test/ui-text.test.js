// Screens and the instructions say the same thing (Haiku round 12): one number in the total, one badge per video,
// one action for the user, a visible choice on the frame sheets, publishing from the calendar card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../app/ui/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/ui/style.css', import.meta.url), 'utf8');

test('batch result: the missing-kinds list has no second number', () => {
  assert.doesNotMatch(app, /Каких роликов не хватило: \$\{/);
});

test('clip screen: "before publishing" — one note, hint at the bottom without a repeat', () => {
  const clip = app.slice(app.indexOf('async function openSlot'), app.indexOf('<details class="card"><summary>Подписи'));
  assert.ok(clip.length > 1000, 'found the clip screen');
  assert.equal((clip.match(/class="note"/g) ?? []).length, 1, 'exactly one note');
  assert.equal((clip.match(/еред выкладкой/g) ?? []).length, 1, '"before publishing" once');
  assert.match(clip, /Перед отправкой спрошу подтверждение/);
});

test('calendar card: can be published right away', () => {
  const card = app.slice(app.indexOf('function slotCard'), app.indexOf('async function loadCalendar'));
  assert.match(card, /data-open[^>]*>Посмотреть перед выкладкой</);
});

test('frame sheets: previews are lighter, the selected button is filled with colour', () => {
  assert.match(css, /\.pets img\s*\{[^}]*brightness\(/);
  assert.match(css, /\.pets button\.on\s*\{[^}]*background:/);
});

test('partner: one action — the "Send video to editor" button, both in the window and in the instructions', () => {
  assert.match(app, /'Отправить видео монтажёру'/);
  assert.match(html, /«Отправить видео монтажёру»/);
});

test('top-5 title B does not promise what is not in the frame', async () => {
  const { HOOK_VARIANTS } = await import('../core/producer.js');
  for (const t of HOOK_VARIANTS.top5) assert.doesNotMatch(t.ru, /удивил/);
});

test('reference: the "pet not visible" refusal is shown by the button, the button can be pressed again', () => {
  const ref = app.slice(app.indexOf('function renderReference'), app.indexOf('function renderSpecies'));
  assert.match(ref, /r.refused/);
  const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
  const h = main.slice(main.indexOf("'species:reference'"), main.indexOf("'species:set'"));
  assert.ok(h.indexOf('r.refused') > 0 && h.indexOf('r.refused') < h.indexOf('setLast'), 'refusal does not overwrite the last batch');
});

// ── Haiku round 13: the choice on the sheet is shown in words, the batch total without jargon, where to get the key ──
test('"My pet / Not him" sheet: the choice is labelled with words and a tick, the video can be opened', () => {
  const c = app.slice(app.indexOf('function renderConfirm'), app.indexOf('function renderStatus'));
  assert.match(c, /ещё не отмечено/);
  assert.match(c, /Выбрано: беру в ролики/);
  assert.match(c, /Выбрано: не беру/);
  assert.match(c, /✓/);
  assert.match(c, /Открыть видео/);
  assert.match(c, /api\.open\(/);
  const prod = readFileSync(new URL('../core/producer.js', import.meta.url), 'utf8');
  assert.match(prod, /video: lib\.realPath/);
});

test('batch result "not enough": plain words, without "postponed", "moments", "copy"', async () => {
  const prod = readFileSync(new URL('../core/producer.js', import.meta.url), 'utf8');
  const line = prod.slice(prod.indexOf("type: 'more'") - 900, prod.indexOf("type: 'more'") + 200);
  assert.doesNotMatch(line, /отложено|моментов/);
  const lib = readFileSync(new URL('../core/library.js', import.meta.url), 'utf8');
  const spare = lib.slice(lib.indexOf('const SPARE_WHY'), lib.indexOf('\n', lib.indexOf('const SPARE_WHY')));
  assert.doesNotMatch(spare, /'копия'|'коротко'\]/);
  assert.match(spare, /одинаковые видео/);
});

test('notes: if one video yields more than two pieces — the reason is stated', async () => {
  const { notesText } = await import('../core/pipeline.js');
  const src = (file) => ({ at: '0:00', to: '0:03', file, from: '0:01', till: '0:04' });
  const m = { advice: { verdict: 'выкладывать', why: 'ок' }, sources: [src('A.mp4'), src('A.mp4'), src('A.mp4'), src('B.mp4')] };
  assert.match(notesText(m), /Из видео «A\.mp4» 3 куска: других подходящих видео не хватило/);
  m.sources = [src('A.mp4'), src('A.mp4'), src('B.mp4')];
  assert.doesNotMatch(notesText(m), /не хватило/);
});

test('settings: where to get the AI key, without a confusing phrase about dollars', () => {
  const s = html.slice(html.indexOf('Ключ ИИ <input'), html.indexOf('<legend>YouTube'));
  assert.match(s, /console\.anthropic\.com/);
  assert.match(s, /API Keys/);
  assert.match(s, /без ключа всё работает/i);
  assert.doesNotMatch(s, /в долларах/);
});
