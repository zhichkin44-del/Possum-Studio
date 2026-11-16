// Экраны и инструкция говорят одно и то же (круг 12 Haiku): одна цифра в итоге, одна плашка у ролика,
// одно действие напарницы, видимый выбор на листах кадров, выкладка с карточки календаря.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../app/ui/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/ui/style.css', import.meta.url), 'utf8');
const doc = readFileSync(new URL('../docs/APP.md', import.meta.url), 'utf8');

test('итог пачки: у списка недостающих видов нет второй цифры', () => {
  assert.doesNotMatch(app, /Каких роликов не хватило: \$\{/);
});

test('экран ролика: «перед выкладкой» — одна плашка, подсказка внизу без повтора', () => {
  const clip = app.slice(app.indexOf('async function openSlot'), app.indexOf('<details class="card"><summary>Подписи'));
  assert.ok(clip.length > 1000, 'нашёл экран ролика');
  assert.equal((clip.match(/class="note"/g) ?? []).length, 1, 'ровно одна плашка');
  assert.equal((clip.match(/еред выкладкой/g) ?? []).length, 1, '«перед выкладкой» один раз');
  assert.match(clip, /Перед отправкой спрошу подтверждение/);
});

test('карточка календаря: можно сразу выложить', () => {
  const card = app.slice(app.indexOf('function slotCard'), app.indexOf('async function loadCalendar'));
  assert.match(card, /data-open[^>]*>Открыть и выложить</);
});

test('листы кадров: превью светлее, выбранная кнопка залита цветом', () => {
  assert.match(css, /\.pets img\s*\{[^}]*brightness\(/);
  assert.match(css, /\.pets button\.on\s*\{[^}]*background:/);
});

test('напарница: одно действие — кнопка «Отправить видео монтажёру», и в окне, и в инструкции', () => {
  assert.match(app, /'Отправить видео монтажёру'/);
  assert.match(html, /«Отправить видео монтажёру»/);
  const partner = doc.slice(doc.indexOf('### Напарница'), doc.indexOf('### монтажёр'));
  assert.match(partner, /«Отправить видео монтажёру»/);
  assert.doesNotMatch(partner, /кидать видео во «Входящие»/);
});

test('инструкция: есть установка для монтажёра, TikTok — понятно, кто публикует', () => {
  assert.match(doc, /### монтажёр: установка/);
  assert.doesNotMatch(doc, /публикует она/);
  assert.doesNotMatch(doc.split('\n').slice(0, 4).join('\n'), /Отдельное приложение для напарницы/);
});

test('заголовок B топ-5 не обещает того, чего нет в кадре', async () => {
  const { HOOK_VARIANTS } = await import('../core/producer.js');
  for (const t of HOOK_VARIANTS.top5) assert.doesNotMatch(t.ru, /удивил/);
});

test('эталон: отказ «не видно зверька» показывается у кнопки, кнопку можно нажать снова', () => {
  const ref = app.slice(app.indexOf('function renderReference'), app.indexOf('function renderSpecies'));
  assert.match(ref, /r.refused/);
  const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
  const h = main.slice(main.indexOf("'species:reference'"), main.indexOf("'species:set'"));
  assert.ok(h.indexOf('r.refused') > 0 && h.indexOf('r.refused') < h.indexOf('setLast'), 'отказ не затирает последнюю пачку');
});

// ── круг 13 Haiku: выбор на листе виден словами, итог пачки без жаргона, ключ — где взять ──
test('лист «Мой зверёк / Не он»: выбор подписан словами и галочкой, видео можно открыть', () => {
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

test('итог пачки «не хватило»: простые слова, без «отложено», «моментов», «копия»', async () => {
  const prod = readFileSync(new URL('../core/producer.js', import.meta.url), 'utf8');
  const line = prod.slice(prod.indexOf("type: 'more'") - 900, prod.indexOf("type: 'more'") + 200);
  assert.doesNotMatch(line, /отложено|моментов/);
  const lib = readFileSync(new URL('../core/library.js', import.meta.url), 'utf8');
  const spare = lib.slice(lib.indexOf('const SPARE_WHY'), lib.indexOf('\n', lib.indexOf('const SPARE_WHY')));
  assert.doesNotMatch(spare, /'копия'|'коротко'\]/);
  assert.match(spare, /одинаковые видео/);
});

test('заметки: если из одного видео больше двух кусков — сказано почему', async () => {
  const { notesText } = await import('../core/pipeline.js');
  const src = (file) => ({ at: '0:00', to: '0:03', file, from: '0:01', till: '0:04' });
  const m = { advice: { verdict: 'выкладывать', why: 'ок' }, sources: [src('A.mp4'), src('A.mp4'), src('A.mp4'), src('B.mp4')] };
  assert.match(notesText(m), /Из видео «A\.mp4» 3 куска: других подходящих видео не хватило/);
  m.sources = [src('A.mp4'), src('A.mp4'), src('B.mp4')];
  assert.doesNotMatch(notesText(m), /не хватило/);
});

test('настройки: где взять ключ ИИ, без непонятной фразы про доллары', () => {
  const s = html.slice(html.indexOf('Ключ ИИ <input'), html.indexOf('<legend>YouTube'));
  assert.match(s, /console\.anthropic\.com/);
  assert.match(s, /API Keys/);
  assert.match(s, /без ключа всё работает/i);
  assert.doesNotMatch(s, /в долларах/);
});

test('инструкция: правило «не больше двух с видео» — пока хватает других', () => {
  const vova = readFileSync(new URL('../docs/test-vova.md', import.meta.url), 'utf8');
  assert.doesNotMatch(vova, /не больше двух с клипа, если есть другие/);
  assert.match(vova, /не больше двух с одного видео, пока хватает других/);
  assert.doesNotMatch(vova, /отложено/);
  assert.doesNotMatch(doc, /отложено \(копия/);
});
