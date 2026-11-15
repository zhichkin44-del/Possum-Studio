// Приватность: лица людей и сигареты в ролики не попадают. Модель кадров — та же локальная CLIP, подписи предвычислены.
import test from 'node:test';
import assert from 'node:assert/strict';
import { privacyHits, markPrivate, mergeHits, createPrivacy, PRIVATE_WHY } from '../core/privacy.js';

// Игрушечные подписи в 4-мерном пространстве: 0 — лицо, 1 — сигарета, 2 — зверёк, 3 — рука с едой.
const P = {
  labels: ['face', 'cigarette', 'animal', 'hand'],
  kind: ['люди', 'сигарета', null, null],
  vectors: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
  scale: 100,
  threshold: 0.5,
};
const v = (a, b, c, d) => { const n = Math.hypot(a, b, c, d); return [a / n, b / n, c / n, d / n]; };
const pet = v(0, 0, 1, 0.2), face = v(1, 0, 0.3, 0), cig = v(0, 1, 0.2, 0.3), hand = v(0, 0.3, 0.2, 1);

test('privacyHits: по каждому кадру — люди, сигарета или чисто; кропы одного момента сводятся в один', () => {
  const hits = privacyHits([
    { t: 0.5, v: pet }, { t: 1.5, v: face }, { t: 2.5, v: pet }, { t: 2.5, v: cig }, { t: 3.5, v: hand },
  ], P);
  assert.deepEqual(hits, [{ t: 0.5, kind: null }, { t: 1.5, kind: 'люди' }, { t: 2.5, kind: 'сигарета' }, { t: 3.5, kind: null }]);
  assert.deepEqual(privacyHits([], P), []);
  assert.deepEqual(privacyHits([{ t: 1, v: face }], null), [], 'нет подписей — фильтра нет, ничего не помечено');
});

const shot = (from, len, extra = {}) => ({ from, len, best: { t: from + len / 2, kind: 'move', score: 1 }, peaks: [{ t: from + 0.5, kind: 'move', score: 1 }, { t: from + len - 0.5, kind: 'move', score: 1 }], labels: ['движение'], defects: [], score: 0.8, why: 'движение', ...extra });

test('markPrivate: кусок с сигаретой обрезан до самого длинного чистого участка, лучший момент внутри', () => {
  const shots = [shot(0, 10)];
  const hits = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5].map((t) => ({ t, kind: t > 2 && t < 5 ? 'сигарета' : null }));
  const r = markPrivate(shots, hits, { minLen: 1.5 });
  assert.equal(r.cut, 1);
  const s = shots[0];
  assert.deepEqual([s.from, s.len], [5, 5], 'с 5-й по 10-ю секунду — чисто');
  assert.ok(s.best.t >= 5 && s.best.t <= 10);
  assert.ok(s.peaks.every((p) => p.t >= 5 && p.t <= 10));
  assert.deepEqual(s.defects, []);
});

test('markPrivate: чистого куска не хватает — план в запас с причиной, в сюжеты не идёт', () => {
  const shots = [shot(0, 3), shot(3, 4)];
  const hits = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5].map((t) => ({ t, kind: t < 3 ? 'люди' : null }));
  const r = markPrivate(shots, hits, { minLen: 1.5 });
  assert.equal(r.dropped, 1);
  assert.deepEqual(shots[0].defects, ['люди']);
  assert.equal(shots[0].score, 0);
  assert.equal(shots[0].why, PRIVATE_WHY['люди']);
  assert.match(shots[0].why, /человек.*не берём/);
  assert.deepEqual(shots[1].defects, [], 'чистый план не тронут');
  assert.deepEqual([shots[1].from, shots[1].len], [3, 4]);
});

test('markPrivate: без попаданий ничего не меняется', () => {
  const shots = [shot(0, 5)];
  const before = JSON.stringify(shots);
  const r = markPrivate(shots, [{ t: 0.5, kind: null }, { t: 1.5, kind: null }], { minLen: 1.5 });
  assert.deepEqual(r, { cut: 0, dropped: 0, kinds: [] });
  assert.equal(JSON.stringify(shots), before);
});

test('подписи приватности лежат рядом с моделью: лица и сигареты, порог задан', async () => {
  const { readFileSync } = await import('node:fs');
  const L = JSON.parse(readFileSync(new URL('../core/clip-labels.json', import.meta.url), 'utf8'));
  const p = L.privacy;
  assert.ok(p, 'в clip-labels.json есть privacy');
  assert.equal(p.labels.length, p.vectors.length);
  assert.equal(p.labels.length, p.kind.length);
  assert.ok(p.kind.includes('люди') && p.kind.includes('сигарета'));
  assert.ok(p.passes.length >= 2, 'лица и сигареты — отдельные проходы');
  for (const k of ['люди', 'сигарета']) {
    const pass = p.passes.find((x) => x.kind === k);
    assert.ok(pass, k);
    assert.ok(pass.threshold > 0 && pass.threshold < 1);
    assert.ok(pass.grid >= 1 && pass.minRun >= 1);
    if (k === 'сигарета') assert.ok(pass.step > 0 && pass.step <= 0.5, 'сигарета мелькает меньше секунды — кадры не реже двух в секунду'); if (k === 'сигарета') assert.equal(pass.minRunSeen, 1, 'курильщик в ролике подтверждён — одиночный кадр с сигаретой тоже вырезается');
  }
  for (const x of p.vectors) assert.ok(Math.abs(Math.hypot(...x) - 1) < 1e-3, 'векторы нормированы');
});

test('рука в кадре — свой проход: подписи руки в группе «рука», порог не выше 0.5, серия от 2 кадров', async () => {
  const { readFileSync } = await import('node:fs');
  const { PRIVATE_WHY } = await import('../core/privacy.js');
  const p = JSON.parse(readFileSync(new URL('../core/clip-labels.json', import.meta.url), 'utf8')).privacy;
  for (const l of ['a human hand', 'a small animal in a hand', 'a person holding a small animal', 'fingers holding a piece of fruit']) {
    assert.equal(p.kind[p.labels.indexOf(l)], 'рука', l);
  }
  for (const l of ['a small furry animal', 'a sugar glider']) assert.equal(p.kind[p.labels.indexOf(l)], null, 'зверёк сам — не рука');
  const pass = p.passes.find((x) => x.kind === 'рука');
  assert.ok(pass, 'проход «рука»');
  assert.ok(pass.threshold > 0 && pass.threshold <= 0.5);
  assert.ok(pass.minRun >= 2, 'одиночный кадр с пальцами — шум');
  assert.match(PRIVATE_WHY['рука'], /рук/);
});

test('privacyHits: зверёк в ладони — «рука», зверёк сам по себе — чисто', () => {
  const P = { labels: ['hand', 'animal'], kind: ['рука', null], vectors: [[1, 0], [0, 1]], scale: 10 };
  const hits = privacyHits([{ t: 0, v: [1, 0] }, { t: 1, v: [1, 0] }, { t: 2, v: [0, 1] }], { ...P, only: 'рука', threshold: 0.5, minRun: 2 });
  assert.deepEqual(hits.map((h) => h.kind), ['рука', 'рука', null]);
});

test('privacyHits: only — считается только своя группа; серия короче minRun — шум', () => {
  const fr = [{ t: 0, v: face }, { t: 1, v: cig }, { t: 2, v: cig }, { t: 3, v: pet }, { t: 4, v: cig }];
  const smoke = privacyHits(fr, { ...P, only: 'сигарета', minRun: 2 });
  assert.deepEqual(smoke.map((h) => h.kind), [null, 'сигарета', 'сигарета', null, null], 'одиночный кадр в 4 с снят, лицо в 0 с не считается');
  const people = privacyHits(fr, { ...P, only: 'люди' });
  assert.deepEqual(people.map((h) => h.kind), ['люди', null, null, null, null]);
});

test('privacyHits: в ролике, где сигарета уже подтверждена серией, одиночные кадры тоже считаются (minRunSeen)', () => {
  const fr = [{ t: 0, v: cig }, { t: 1, v: cig }, { t: 2, v: pet }, { t: 3, v: cig }, { t: 4, v: pet }];
  const seen = privacyHits(fr, { ...P, only: 'сигарета', minRun: 2, minRunSeen: 1 });
  assert.deepEqual(seen.map((h) => h.kind), ['сигарета', 'сигарета', null, 'сигарета', null], 'кадр в 3 с не снят: курильщик в этом ролике уже есть');
  const clean = [{ t: 0, v: pet }, { t: 1, v: cig }, { t: 2, v: pet }, { t: 3, v: cig }];
  assert.deepEqual(privacyHits(clean, { ...P, only: 'сигарета', minRun: 2, minRunSeen: 1 }).map((h) => h.kind), [null, null, null, null], 'серии нет — одиночные кадры остаются шумом');
});

test('createPrivacy: minRunSeen прохода доходит до правила', async () => {
  const embedder = { available: true, embedAt: async () => [{ t: 0, v: cig }, { t: 0.5, v: cig }, { t: 1, v: pet }, { t: 1.5, v: cig }] };
  const pr = createPrivacy({ embedder, labels: { ...P, passes: [{ kind: 'сигарета', grid: 2, step: 0.5, threshold: 0.5, minRun: 2, minRunSeen: 1 }] } });
  assert.deepEqual((await pr.scan('x')).map((h) => h.kind), ['сигарета', 'сигарета', null, 'сигарета']);
});

test('mergeHits: проходы сводятся по моменту, любое попадание остаётся', () => {
  const a = [{ t: 0, kind: 'люди' }, { t: 1, kind: null }, { t: 2, kind: null }];
  const b = [{ t: 0, kind: null }, { t: 1, kind: null }, { t: 2, kind: 'сигарета' }, { t: 3, kind: null }];
  assert.deepEqual(mergeHits(a, b), [{ t: 0, kind: 'люди' }, { t: 1, kind: null }, { t: 2, kind: 'сигарета' }, { t: 3, kind: null }]);
});

test('createPrivacy: каждый проход берёт кадры своей сетки, модели нет — фильтр недоступен', async () => {
  const asked = [];
  const embedder = { available: true, async embedAt(file, { grid }) { asked.push(grid); return grid === 1 ? [{ t: 0, v: face }, { t: 1, v: pet }, { t: 2, v: pet }] : [{ t: 0, v: pet }, { t: 1, v: pet }, { t: 2, v: cig }]; } };
  const pr = createPrivacy({ embedder, labels: { ...P, passes: [{ kind: 'люди', grid: 1, threshold: 0.5, minRun: 1 }, { kind: 'сигарета', grid: 2, threshold: 0.5, minRun: 1 }] } });
  assert.equal(pr.available, true);
  assert.deepEqual(await pr.scan('a.mov'), [{ t: 0, kind: 'люди' }, { t: 1, kind: null }, { t: 2, kind: 'сигарета' }]);
  assert.deepEqual(asked, [1, 2]);
  assert.equal(createPrivacy({ embedder: { available: false }, labels: P }).available, false);
  assert.equal(createPrivacy({ embedder, labels: null }).available, false);
});

test('createPrivacy: шаг прохода доходит до эмбеддера, кадры одной сетки с разным шагом не путаются', async () => {
  const asked = [];
  const embedder = { available: true, async embedAt(file, { grid, step }) { asked.push(`${grid}/${step}`); return step === 0.5 ? [{ t: 0, v: pet }, { t: 0.5, v: cig }, { t: 1, v: cig }] : [{ t: 0, v: face }, { t: 1, v: pet }]; } };
  const pr = createPrivacy({ embedder, labels: { ...P, passes: [{ kind: 'люди', grid: 2, threshold: 0.5, minRun: 1 }, { kind: 'сигарета', grid: 2, step: 0.5, threshold: 0.5, minRun: 2 }] } });
  assert.deepEqual(await pr.scan('a.mov'), [{ t: 0, kind: 'люди' }, { t: 0.5, kind: 'сигарета' }, { t: 1, kind: 'сигарета' }]);
  assert.deepEqual(asked, ['2/1', '2/0.5']);
});

test('библиотека: лица и сигареты в запасе называются простыми словами', async () => {
  const { countSupply } = await import('../core/library.js');
  const c = { id: 'a', pet: true, shots: [{ defects: ['люди'] }, { defects: ['сигарета'] }, { defects: ['рука'] }, { defects: [] }] };
  const s = countSupply([c], () => true);
  assert.deepEqual(s.spare, { 'в кадре человек': 1, 'в кадре сигарета': 1, 'в кадре рука': 1 });
});

test('библиотека: setPrivacy вырезает момент из плана и помнит, что клип проверен', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createLibrary } = await import('../core/library.js');
  const dir = mkdtempSync(join(tmpdir(), 'priv-'));
  try {
    const lib = createLibrary({ path: join(dir, 'lib.json'), baseDir: dir });
    const { clip } = lib.ingest(join(dir, 'a.mov'), { info: { duration: 10, width: 1080, height: 1920 }, shots: [] }, { id: 'a' });
    const c = lib.get(clip.id);
    c.shots = [shot(0, 10)];
    const r = lib.setPrivacy('a', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => ({ t, kind: t >= 3 && t <= 4 ? 'сигарета' : null })), { pad: 0.5 });
    assert.equal(r.cut, 1);
    const s = lib.get('a').shots[0];
    assert.deepEqual([s.from, s.len], [5, 5], 'с 2-й по 5-ю секунду закрыто, остаётся 5–10');
    assert.equal(lib.get('a').privacy.checked, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
