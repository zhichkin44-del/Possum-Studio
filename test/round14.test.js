// Круг 14 Haiku: ролик не открывается серым ИК-куском; тёмное видео — причина «слишком темно» и его можно вернуть;
// в вопросе о виде выбор виден словами; в итоге пачки у каждой цифры единица и сказано, сколько кусков нужно на ролик.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeStories } from '../core/stories.js';
import { emptyWhy, moreText } from '../core/producer.js';

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();
const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');

function shot(from, len, labels, score = 0.6, extra = {}) {
  return { from, len, score, best: { t: from + len / 2, kind: 'move', score }, peaks: [], labels, defects: [], why: 'план', hash: null, ...extra };
}
function clip(id, shots, extra = {}) {
  return { id, name: `${id}.mp4`, rel: `${id}.mp4`, orient: 'vertical', hasAudio: true, created: null, night: false, shots, labels: [], stars: 0, used: [], vision: null, ...extra };
}
function fakeLib(clips) {
  const db = Object.fromEntries(clips.map((c) => [c.id, c]));
  return {
    all: () => Object.values(db),
    get: (id) => db[id] ?? null,
    realPath: (c) => `/v/${c.rel}`,
    isFree(id, i) { const s = db[id]?.shots[i]; return Boolean(s && !s.defects.length && !db[id].used.some((u) => u.shot === i && NOW - u.at < 7 * DAY)); },
    markUsed(id, s, story, at) { db[id].used.push({ shot: s, story, at }); },
  };
}

// как в прогоне r13: ИК-видео (bagel) и дневное (Missouri), лучшие баллы поровну
function r13() {
  const ir = clip('bagel', [shot(0, 4, ['ИК', 'без звука'], 0.6), shot(4, 5.5, ['ИК', 'движение', 'без звука'], 0.84)], { night: true });
  const day = clip('missouri', [shot(0, 5.5, ['писк'], 0.6), shot(5.5, 5.5, ['движение'], 0.84), shot(11, 5.75, [], 0.6)]);
  return [ir, day];
}
const top5Of = (clips) => makeStories(fakeLib(clips), { history: [], now: NOW, count: 3 }).find((s) => s.kind === 'top5');

test('топ-5: первым показом (№5) идёт дневной кусок, если он есть; ИК — в середину', () => {
  const t = top5Of(r13());
  assert.ok(t, 'топ-5 собран');
  assert.equal(t.pieces.length, 5);
  assert.deepEqual(t.pieces.map((p) => p.caption), ['№5', '№4', '№3', '№2', '№1']);
  assert.equal(t.pieces[0].clip, 'missouri', 'ролик не открывается серым ИК-куском');
});

test('топ-5: лучший кусок остаётся №1', () => {
  const clips = r13();
  clips[1].shots[1].score = 0.95; // дневной «движение» — лучший
  const t = top5Of(clips);
  const last = t.pieces.at(-1);
  assert.equal(last.clip, 'missouri');
  assert.equal(last.caption, '№1');
});

test('топ-5: все куски ИК — порядок не ломается, ролик собирается', () => {
  const ir = (id) => clip(id, [shot(0, 4, ['ИК', 'движение'], 0.7), shot(4, 4, ['ИК'], 0.6)], { night: true });
  const t = top5Of([ir('a'), ir('b'), ir('c')]);
  assert.ok(t);
  assert.equal(t.pieces.length, 5);
});

test('тёмное видео «зверька нет»: причина — «слишком темно», а не «нет вашего зверька»', () => {
  const dark = clip('sg', [shot(0, 5.5, [], 0, { defects: ['чёрный'], luma: 7 }), shot(5.5, 6.5, [], 0, { defects: ['чёрный'], luma: 6 })]);
  assert.match(emptyWhy(dark), /слишком темно/);
  const dim = clip('d', [shot(0, 5, [], 0.5, { luma: 15 }), shot(5, 5, [], 0.5, { luma: 18 })]);
  assert.match(emptyWhy(dim), /слишком темно/);
  const light = clip('l', [shot(0, 5, [], 0.5, { luma: 120 })]);
  assert.match(emptyWhy(light), /почти нет/);
  const night = clip('n', [shot(0, 5, ['ИК'], 0.5, { luma: 15 })], { night: true });
  assert.doesNotMatch(emptyWhy(night), /слишком темно/, 'ИК-ночь не темнота');
  const prod = readFileSync(new URL('../core/producer.js', import.meta.url), 'utf8');
  const j = prod.slice(prod.indexOf('async function judgeSpecies'), prod.indexOf('async function judgeSpecies') + 900);
  assert.match(j, /emptyWhy\(/);
});

test('«Не взято»: у каждого видео своя причина и кнопка «Это мой зверёк»', async () => {
  const st = readFileSync(new URL('../core/studio.js', import.meta.url), 'utf8');
  assert.match(st.slice(st.indexOf('const rejected'), st.indexOf('\n', st.indexOf('const rejected'))), /id: c\.id/);
  const last = app.slice(app.indexOf('function renderLast'), app.indexOf('function renderReference'));
  assert.doesNotMatch(last, /— нет вашего зверька</);
  assert.match(last, /Это мой зверёк/);
  assert.match(last, /api\.confirmPets\(/);
});

test('вопрос «Это сахарный поссум?»: «Да» не залита заранее, выбор подписан словами и остаётся виден', () => {
  const sp = app.slice(app.indexOf('function renderSpecies'), app.indexOf('function renderConfirm'));
  assert.doesNotMatch(sp, /class="primary" id="spYes"/);
  assert.match(sp, /ещё не отмечено/);
  assert.match(sp, /✓ Выбрано: да, сахарный поссум/);
  assert.match(sp, /✓ Выбрано: другой зверь/);
  assert.doesNotMatch(sp, /!speciesSt\.asked/, 'после ответа блок не прячется');
});

test('итог «не хватило»: понятные слова вместо «N из M», единица у каждой цифры, что доснять', () => {
  const t = moreText({ good: 7, busy: 5, spare: { 'одинаковые видео': 4, темно: 1 } }, 1);
  assert.match(t, /^Не хватило видео ещё на 1 ролик: /);
  assert.match(t, /со зверьком 7 кусков видео, в роликах уже 5, свободных 2[.]/);
  assert.match(t, /Не подошли: одинаковые видео — 4, темно — 1[.]/);
  assert.doesNotMatch(t, /свободных .* \d+ из \d+/, 'голого «свободных N из M» нет');
  assert.ok(t.length < 240, 'строка короткая: ' + t.length);
  assert.match(t, /На ролик нужно 5 кусков \(топ-5\) или 2–3 \(спокойные\)/);
  assert.match(t, /добавьте новые видео$/);
  assert.doesNotMatch(t, /отложено|моментов|копия|повтор|включите свет|вспышк/i);
  assert.match(moreText({ good: 11, busy: 0, spare: {} }, 5), /на 5 роликов: со зверьком 11 кусков видео, в роликах уже 0, свободных 11[.]/);
  assert.match(moreText(null, 2), /на 2 ролика: /);
  assert.match(moreText({ good: 12, busy: 12, spare: {} }, 9), /на 9 роликов: все 12 кусков видео со зверьком уже в роликах[.]/);
  // кусков хватает, но виды закрыты правилом разнообразия — так и сказано, и что доснять
  const g = moreText({ good: 36, busy: 16, spare: {} }, 3, [{ kind: 'top5', name: 'Топ-5 моментов' }, { kind: 'series', name: 'Серия' }]);
  assert.match(g, /20 кусков видео ещё не в роликах, но из них выходят только «Топ-5 моментов», «Серия», а такие уже были на этой неделе/);
  assert.match(g, /Доснимите что-то другое: .*ест — со звуком/);
  assert.doesNotMatch(g, /\d+ из \d+|повтор|включите свет|вспышк/i);
});
