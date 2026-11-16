// Этап 2, шаг 3: генератор сюжетов и аргументы монтажа из нескольких клипов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, TITLES, TITLE_VARIANTS, pieceAround, partOfDay, gateReason, kindOrder, makeStories, commit, whyNotKinds, KIND_RU, tiredClips } from '../core/stories.js';
import { buildStoryArgs, storyInputs, STYLES, planStyle, seedOf } from '../core/story-render.js';

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();

function shot(from, len, labels, score = 0.6, extra = {}) {
  return { from, len, score, best: { t: from + len / 2, kind: 'move', score }, peaks: [], labels, defects: [], why: `план ${labels.join(',')}`, hash: null, ...extra };
}
function clip(id, shots, extra = {}) {
  return { id, name: `${id}.mp4`, rel: `${id}.mp4`, orient: 'vertical', hasAudio: true, created: null, night: false, shots, labels: [], stars: 0, used: [], vision: null, ...extra };
}
/** Поддельная библиотека с тем же контрактом, что core/library.js (isFree: 7 дней, без дефектов). */
function fakeLib(clips, now = NOW) {
  const db = Object.fromEntries(clips.map((c) => [c.id, c]));
  return {
    all: () => Object.values(db),
    get: (id) => db[id] ?? null,
    realPath: (c) => (c.missing ? null : `/v/${c.rel}`),
    isFree(id, i) {
      const c = db[id]; const s = c?.shots[i];
      if (!s || s.defects.length) return false;
      return !c.used.some((u) => u.shot === i && now - u.at < 7 * DAY);
    },
    markUsed(id, s, story, at) { db[id].used.push({ shot: s, story, at }); },
  };
}
const many = (n, labels, pfx = 'c', score = 0.5) => Array.from({ length: n }, (_, k) => clip(`${pfx}${k}`, [shot(0, 3, labels, score + k * 0.01)]));

// ── кусок и часть суток ────────────────────────────────────────────────────
test('pieceAround: кусок внутри плана вокруг лучшего момента', () => {
  const c = clip('a', [shot(10, 8, ['движение'], 0.7, { best: { t: 17.5 } })]);
  const p = pieceAround(c, 0, 3, '№1');
  assert.equal(p.len, 3);
  assert.ok(p.from >= 10 && p.from + p.len <= 18, JSON.stringify(p));
  assert.equal(p.caption, '№1');
  const short = pieceAround(clip('b', [shot(0, 1.6, ['спокойно'])]), 0, 3);
  assert.equal(short.len, 1.6); assert.equal(short.from, 0);
});

test('partOfDay: только по времени съёмки; без даты — не угадываем', () => {
  const at = (h) => new Date(2026, 10, 15, h, 30).toISOString();
  assert.equal(partOfDay({ created: at(7) }), 'Утро');
  assert.equal(partOfDay({ created: at(13) }), 'День');
  assert.equal(partOfDay({ created: at(19) }), 'Вечер');
  assert.equal(partOfDay({ created: at(23) }), 'Ночь');
  assert.equal(partOfDay({ created: at(3) }), 'Ночь');
  assert.equal(partOfDay({}), null);
});

// ── ворота разнообразия ───────────────────────────────────────────────────
test('ворота: тот же вид подряд нельзя; за неделю мало видов — нужен новый', () => {
  assert.equal(gateReason('top5', [], NOW), null);
  assert.match(gateReason('top5', [{ kind: 'top5', at: NOW - DAY }], NOW), /последним/);
  const week = [{ kind: 'top5', at: NOW - 4 * DAY }, { kind: 'day', at: NOW - 3 * DAY }, { kind: 'top5', at: NOW - 2 * DAY }, { kind: 'day', at: NOW - DAY }];
  assert.match(gateReason('top5', week, NOW), /мало разных/);
  assert.equal(gateReason('asmr', week, NOW), null);
  const old = week.map((h) => ({ ...h, at: h.at - 10 * DAY }));
  assert.equal(gateReason('top5', old, NOW), null, 'старше недели не считается');
});

test('kindOrder: давно не было — раньше; без истории — топ-5 первым', () => {
  assert.equal(kindOrder([], NOW)[0], 'top5');
  assert.deepEqual([...kindOrder([], NOW)].sort(), [...KINDS].sort());
  const o = kindOrder([{ kind: 'top5', at: NOW - DAY }], NOW);
  assert.ok(o.indexOf('top5') === o.length - 1, o.join());
});

// ── каждый вид ────────────────────────────────────────────────────────────
test('топ-5: пять планов, счёт №5 → №1, лучший последним', () => {
  const lib = fakeLib(many(6, ['движение']));
  const [s] = makeStories(lib, { now: NOW, count: 1 });
  assert.equal(s.kind, 'top5');
  assert.deepEqual(s.pieces.map((p) => p.caption), ['№5', '№4', '№3', '№2', '№1']);
  assert.equal(s.pieces.at(-1).clip, 'c5', 'самый высокий балл — №1');
  assert.equal(new Set(s.pieces.map((p) => `${p.clip}:${p.shot}`)).size, 5);
  assert.deepEqual(s.title, TITLES.top5);
  assert.equal(s.total, Math.round(s.pieces.reduce((t, p) => t + p.len, 0) * 100) / 100);
});

test('топ-5: меньше пяти годных планов — топа нет (короткие < 1,5 с не берутся)', () => {
  const clips = [...many(4, ['движение']), clip('x', [shot(0, 1.2, ['движение'], 0.9)])];
  const out = makeStories(fakeLib(clips), { now: NOW, count: 3 });
  assert.ok(!out.some((s) => s.kind === 'top5'));
});

test('день из жизни: ≥ 3 части суток по времени съёмки, по порядку утро → ночь', () => {
  const at = (h) => new Date(2026, 10, 14, h, 0).toISOString();
  const clips = [clip('n', [shot(0, 5, ['ИК'])], { created: at(23) }), clip('m', [shot(0, 5, ['спокойно'])], { created: at(8) }), clip('e', [shot(0, 5, ['ест'])], { created: at(19) })];
  const out = makeStories(fakeLib(clips), { now: NOW, count: 1, history: [{ kind: 'top5', at: NOW - DAY }] });
  const day = out.find((s) => s.kind === 'day');
  assert.ok(day, JSON.stringify(out.map((s) => s.kind)));
  assert.deepEqual(day.pieces.map((p) => p.caption), ['Утро', 'Вечер', 'Ночь']);
  assert.deepEqual(day.pieces.map((p) => p.clip), ['m', 'e', 'n']);
});

test('день из жизни: две части суток — нет', () => {
  const at = (h) => new Date(2026, 10, 14, h, 0).toISOString();
  const clips = [clip('a', [shot(0, 5, ['ИК'])], { created: at(23) }), clip('b', [shot(0, 5, ['ест'])], { created: at(1) }), clip('c', [shot(0, 5, ['ест'])], { created: at(19) })];
  assert.ok(!makeStories(fakeLib(clips), { now: NOW, count: 6 }).some((s) => s.kind === 'day'));
});

test('сначала/потом: один клип, «потом» позже и заметно подвижнее; спал — свой заголовок', () => {
  const lib = fakeLib([clip('a', [shot(0, 5, ['спит'], 0.6, { motion: 0.3 }), shot(5, 5, ['движение', 'играет'], 0.6, { motion: 4 })])]);
  const ba = makeStories(lib, { now: NOW, count: 6 }).find((s) => s.kind === 'beforeAfter');
  assert.ok(ba);
  assert.deepEqual(ba.pieces.map((p) => [p.caption, p.shot]), [['Сначала', 0], ['Потом', 1]]);
  assert.match(ba.title.ru, /проснулся/);
  // «потом» почти так же спокойно — пары нет
  const weak = fakeLib([clip('a', [shot(0, 5, ['спокойно'], 0.6, { motion: 1 }), shot(5, 5, ['движение'], 0.6, { motion: 2 })])]);
  assert.ok(!makeStories(weak, { now: NOW, count: 6 }).some((s) => s.kind === 'beforeAfter'));
});

test('фейлов нет в видах; ролик с прыжком или писком — «посмотрите перед выкладкой»', () => {
  assert.ok(!KINDS.includes('fails'));
  const lib = fakeLib(many(6, ['движение', 'прыжок']));
  const [t] = makeStories(lib, { now: NOW, count: 1 });
  assert.equal(t.kind, 'top5');
  assert.match(t.needsReview, /убедитесь/);
  const checked = many(6, ['движение']).map((c) => ({ ...c, vision: { by: 'claude' } }));
  const [ok] = makeStories(fakeLib(checked), { now: NOW, count: 1 });
  assert.ok(!ok.needsReview);
  // без Claude вид зверька человек отметил заранее по листам кадров — лишней плашки «посмотрите» нет
  const [raw] = makeStories(fakeLib(many(6, ['движение'])), { now: NOW, count: 1 });
  assert.ok(!raw.needsReview);
});

test('спокойные моменты: два-три спокойных плана, сначала из разных клипов, без прыжков', () => {
  const lib = fakeLib([...many(3, ['спокойно'], 'q'), clip('j', [shot(0, 4, ['спокойно', 'прыжок'], 0.99)])]);
  const c = makeStories(lib, { now: NOW, count: 6 }).find((s) => s.kind === 'calm');
  assert.ok(c);
  assert.equal(c.pieces.length, 3);
  assert.equal(new Set(c.pieces.map((p) => p.clip)).size, 3);
  assert.ok(!c.pieces.some((p) => p.clip === 'j'));
  const two = makeStories(fakeLib(many(2, ['спокойно'])), { now: NOW, count: 6 }).find((s) => s.kind === 'calm');
  assert.ok(two, 'двух спокойных планов хватает');
  assert.equal(two.pieces.length, 2);
  assert.ok(!makeStories(fakeLib(many(1, ['спокойно'])), { now: NOW, count: 6 }).some((s) => s.kind === 'calm'));
});

test('ASMR: со звуком, ≥ 4 с, слышно, как ест; просто тихо — нет', () => {
  const lib = fakeLib([clip('a', [shot(0, 8, ['спокойно', 'asmr?', 'ест'])])]);
  const a = makeStories(lib, { now: NOW, count: 6 }).find((s) => s.kind === 'asmr');
  assert.ok(a);
  assert.equal(a.quiet, true);
  assert.ok(a.total >= 4);
  const mute = fakeLib([clip('a', [shot(0, 8, ['спокойно', 'asmr?', 'ест'])], { hasAudio: false })]);
  assert.ok(!makeStories(mute, { now: NOW, count: 6 }).some((s) => s.kind === 'asmr'));
  const silent = fakeLib([clip('a', [shot(0, 8, ['спокойно', 'asmr?'])])]);
  assert.ok(!makeStories(silent, { now: NOW, count: 6 }).some((s) => s.kind === 'asmr'), 'тишина без еды — не ASMR');
  const said = fakeLib([clip('a', [shot(0, 8, ['спокойно', 'asmr?'])], { vision: { asmr: true } })]);
  assert.ok(makeStories(said, { now: NOW, count: 6 }).some((s) => s.kind === 'asmr'), 'разбор Claude сказал «ASMR»');
  const short = fakeLib([clip('a', [shot(0, 3, ['спокойно', 'asmr?', 'ест'])])]);
  assert.ok(!makeStories(short, { now: NOW, count: 6 }).some((s) => s.kind === 'asmr'));
});

test('серия: тема ≥ 3 планов, «Эпизод N» по истории (когда все куски из одного видео)', () => {
  const lib = fakeLib([clip('e', Array.from({ length: 3 }, (_, k) => shot(k * 6, 5, ['ест'], 0.6 - k * 0.01)))]);
  const hist = [{ kind: 'series', at: NOW - 20 * DAY }, { kind: 'top5', at: NOW - DAY }];
  const s = makeStories(lib, { now: NOW, count: 6, history: hist }).find((x) => x.kind === 'series');
  assert.ok(s);
  assert.equal(s.theme, 'ест');
  assert.equal(s.pieces[0].caption, 'Эпизод 2');
  assert.match(s.title.ru, /эпизод 2/);
  const spread = makeStories(fakeLib(many(3, ['ест'])), { now: NOW, count: 6, history: hist }).find((x) => x.kind === 'series');
  assert.equal(spread?.theme, 'ест');
  assert.equal(spread.pieces[0].caption, null);
  assert.equal(spread.title.ru, 'Зверёк ест');
  assert.ok(!makeStories(fakeLib(many(2, ['ест'])), { now: NOW, count: 6 }).some((x) => x.kind === 'series'));
});

// ── пачка ─────────────────────────────────────────────────────────────────
function richLib() {
  const at = (h) => new Date(2026, 10, 14, h, 0).toISOString();
  return fakeLib([
    ...many(6, ['движение', 'играет'], 'j', 0.6),
    clip('m', [shot(0, 5, ['спит'])], { created: at(8) }),
    clip('d', [shot(0, 5, ['спокойно', 'asmr?']), shot(5, 6, ['ест', 'asmr?'])], { created: at(13) }),
    clip('n', [shot(0, 5, ['ИК', 'движение'])], { created: at(23) }),
    ...many(3, ['ест'], 'e', 0.3),
  ]);
}

test('makeStories: три сюжета разных видов, ни один план не повторяется', () => {
  const out = makeStories(richLib(), { now: NOW, count: 3 });
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map((s) => s.kind)).size, 3);
  const keys = out.flatMap((s) => s.pieces.map((p) => `${p.clip}:${p.shot}`));
  assert.equal(new Set(keys).size, keys.length, 'план в пачке один раз');
  for (const s of out) assert.match(s.id, new RegExp(`^${s.kind}-2026-11-15-[0-9a-f]{6}$`));
});

test('makeStories: брак, «стресс» и занятые за неделю планы не берутся', () => {
  const clips = many(7, ['прыжок']); // «прыжок» — не тема серии
  clips[6].shots[0].defects = ['стресс']; clips[6].shots[0].score = 0.99;
  clips[5].shots[0].defects = ['размыто']; clips[5].shots[0].score = 0.98;
  clips[4].used.push({ shot: 0, story: 'x', at: NOW - 2 * DAY });
  clips[3].used.push({ shot: 0, story: 'y', at: NOW - 9 * DAY }); // старше недели — снова свободен
  const out = makeStories(fakeLib(clips), { now: NOW, count: 1 });
  assert.equal(out.length, 0, 'годных планов 4 — топ-5 не собрать, остальным видам не подходят');
  clips.push(clip('z', [shot(0, 3, ['прыжок'], 0.1)]));
  const [s] = makeStories(fakeLib(clips), { now: NOW, count: 1 });
  const ids = s.pieces.map((p) => p.clip);
  assert.ok(!ids.includes('c6') && !ids.includes('c5') && !ids.includes('c4'), ids.join());
  assert.ok(ids.includes('c3'));
});

test('makeStories: пустая библиотека — пусто, без ошибки', () => {
  assert.deepEqual(makeStories(fakeLib([]), { now: NOW }), []);
});

test('commit: планы заняты на 7 дней, запись для истории', () => {
  const lib = richLib();
  const [s] = makeStories(lib, { now: NOW, count: 1 });
  const h = commit(lib, s, NOW);
  assert.deepEqual(h, { kind: s.kind, at: NOW, id: s.id });
  for (const p of s.pieces) assert.equal(lib.isFree(p.clip, p.shot), false);
  const next = makeStories(lib, { now: NOW, count: 1, history: [h] });
  assert.notEqual(next[0]?.kind, s.kind, 'тот же вид подряд не идёт');
  const used = new Set(s.pieces.map((p) => `${p.clip}:${p.shot}`));
  assert.ok(next[0].pieces.every((p) => !used.has(`${p.clip}:${p.shot}`)));
});

// ── монтаж: аргументы ffmpeg ──────────────────────────────────────────────
const fc = (args) => args[args.indexOf('-filter_complex') + 1];

test('монтаж: горизонтальный — размытый фон + кадр по центру; вертикальный — кадрирование', () => {
  const args = buildStoryArgs({ out: 'o.mp4', pieces: [
    { src: 'a.mp4', from: 1, len: 3, hasAudio: true, orient: 'horizontal' },
    { src: 'b.mp4', from: 0, len: 2.5, hasAudio: true, orient: 'vertical' },
  ] });
  const f = fc(args);
  assert.match(f, /\[0:v\]split=2/);
  assert.match(f, /gblur/);
  assert.match(f, /fg0]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960/);
  assert.doesNotMatch(f, /brightness=-/, 'фон не затемнён');
  assert.match(f, /overlay=\(W-w\)\/2:\(H-h\)\/2/);
  assert.match(f, /\[1:v\]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920/);
  assert.match(f, /concat=n=2:v=1:a=1/);
  assert.match(f, /fps=30/);
  assert.match(f, /loudnorm/);
  assert.deepEqual(args.slice(args.indexOf('-t', args.indexOf('-filter_complex')), args.indexOf('-t', args.indexOf('-filter_complex')) + 2), ['-t', '5.500']);
  assert.deepEqual(args.slice(1, 7), ['-ss', '1.000', '-t', '3.000', '-i', 'a.mp4']);
  assert.ok(args.includes('bt709'));
});

test('монтаж: кусок без звука — тишина нужной длины', () => {
  const f = fc(buildStoryArgs({ out: 'o.mp4', pieces: [{ src: 'a.mp4', from: 0, len: 2, hasAudio: false, orient: 'square' }] }));
  assert.match(f, /aevalsrc=0:c=stereo:s=48000:d=2\.000\[a0\]/);
  assert.doesNotMatch(f, /\[0:a\]/);
});

test('монтаж: тихий (ASMR) — без loudnorm и без музыки, только ограничение пиков', () => {
  const args = buildStoryArgs({ out: 'o.mp4', quiet: true, music: { file: 'm.mp3' }, pieces: [{ src: 'a.mp4', from: 0, len: 6, hasAudio: true, orient: 'vertical' }] });
  const f = fc(args);
  assert.match(f, /alimiter=limit=0\.89/);
  assert.doesNotMatch(f, /loudnorm/);
  assert.ok(!args.includes('m.mp3'));
  const loud = buildStoryArgs({ out: 'o.mp4', music: { file: 'm.mp3' }, pieces: [{ src: 'a.mp4', from: 0, len: 6, hasAudio: true, orient: 'vertical' }] });
  assert.ok(loud.includes('m.mp3'));
  assert.match(fc(loud), /amix=inputs=2/);
});

test('монтаж: подписи каждого куска — только на его время', () => {
  const f = fc(buildStoryArgs({ out: 'o.mp4', captionFiles: [['c0.txt'], ['c1a.txt', 'c1b.txt']], pieces: [
    { src: 'a.mp4', from: 0, len: 3, hasAudio: true, orient: 'vertical' },
    { src: 'b.mp4', from: 0, len: 2, hasAudio: true, orient: 'vertical' },
  ] }));
  assert.match(f, /textfile=c0\.txt.*enable='between\(t,0\.000,2\.980\)'/);
  assert.match(f, /textfile=c1a\.txt.*y=h\*0\.11\+0:enable='between\(t,3\.000,4\.980\)'/);
  assert.match(f, /textfile=c1b\.txt.*y=h\*0\.11\+112:/);
});

// ── стили монтажа по виду сюжета ─────────────────────────────────────────
const three = [
  { src: 'a.mp4', from: 1, len: 3, hasAudio: true, orient: 'vertical' },
  { src: 'b.mp4', from: 0, len: 2, hasAudio: false, orient: 'horizontal' },
  { src: 'c.mp4', from: 4, len: 2.5, hasAudio: true, orient: 'vertical' },
];
const totalOf = (args) => args[args.indexOf('-t', args.indexOf('-filter_complex')) + 1];

test('стили: у каждого вида сюжета свой стиль, все переходы — настоящие xfade', () => {
  for (const k of KINDS) assert.ok(STYLES[k], `нет стиля для ${k}`);
  const XFADE = new Set(['fade', 'fadeblack', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideup', 'smoothleft', 'smoothright', 'smoothup', 'zoomin']);
  for (const s of Object.values(STYLES)) for (const t of s.trans) assert.ok(XFADE.has(t), t);
});

test('стили: переходы xfade/acrossfade, длина ролика = сумма кусков, подписи не сдвинуты', () => {
  const args = buildStoryArgs({ out: 'o.mp4', pieces: three, style: STYLES.day, captionFiles: [['c0.txt'], [], ['c2.txt']] });
  const f = fc(args);
  assert.doesNotMatch(f, /concat=/);
  assert.match(f, /\[v0\]\[v1\]xfade=transition=\w+:duration=0\.500:offset=3\.000\[vx1\]/);
  assert.match(f, /\[vx1\]\[v2\]xfade=transition=\w+:duration=0\.500:offset=5\.000\[vc\]/);
  assert.match(f, /\[ax1\]\[a2\]acrossfade=d=0\.500/);
  assert.equal(totalOf(args), '7.500');
  // первые два куска читаются на 0,5 с дольше (хвост под переход), последний — ровно
  assert.deepEqual(args.slice(1, 7), ['-ss', '1.000', '-t', '3.500', '-i', 'a.mp4']);
  assert.match(f, /aevalsrc=0:c=stereo:s=48000:d=2\.500\[a1\]/);
  assert.ok(args.includes('c.mp4') && args[args.indexOf('c.mp4') - 2] === '2.500');
  assert.match(f, /textfile=c2\.txt.*enable='between\(t,5\.000,7\.480\)'/);
  assert.match(f, /zoompan=z='1\.07-0\.07\*min|zoompan=z='1\+0\.07\*min/);
});

test('стили: переход не длиннее трети самого короткого куска', () => {
  const p = planStyle([{ len: 3 }, { len: 0.9 }], STYLES.calm);
  assert.equal(p.d, 0.3);
  assert.equal(planStyle([{ len: 3 }], STYLES.calm).d, 0);
  assert.equal(planStyle([{ len: 3 }], null), null);
});

test('стили: топ-5 — резкий наезд, встряска на крючке и №1, №1 замедлен из середины окна', () => {
  const args = buildStoryArgs({ out: 'o.mp4', pieces: three, style: STYLES.top5 });
  const f = fc(args);
  assert.match(f, /if\(lt\(on,6\)/);
  assert.equal((f.match(/crop=1040:1848/g) ?? []).length, 2, 'встряска только у первого и последнего');
  // крючок трясётся сразу, №1 — после въезда перехода 0,25 с (8 кадров), а не под ним
  assert.match(f, /between\(n,0,9\)/);
  assert.match(f, /between\(n,8,17\)/);
  assert.match(f, /\[2:v\][^;]*setpts=PTS\/0\.6/);
  assert.match(f, /\[2:a\][^;]*atempo=0\.6/);
  // окно №1: 2,5 с × 0,6 = 1,5 с исходника, со сдвигом 0,5 с к середине
  assert.equal(args[args.indexOf('c.mp4') - 4], '4.500');
  assert.equal(args[args.indexOf('c.mp4') - 2], '1.500');
  assert.equal(totalOf(args), '7.500');
});

test('стили: тихий (ASMR) — мягкие fade, без встряски и замедления', () => {
  const f = fc(buildStoryArgs({ out: 'o.mp4', quiet: true, pieces: three, style: STYLES.asmr }));
  assert.match(f, /xfade=transition=fade/);
  assert.doesNotMatch(f, /crop=1040:1848|setpts=PTS\/|atempo/);
  assert.match(f, /alimiter/);
});

test('стили: seed меняет первый переход — два ролика одного вида не одинаковы', () => {
  const firsts = new Set([0, 1, 2, 3, 4].map((s) => planStyle(three, STYLES.top5, s).trans[0]));
  assert.ok(firsts.size >= 3);
  assert.notEqual(seedOf('top5-a'), seedOf('top5-b'));
});

test('монтаж: пустой сюжет — понятная ошибка; пропавший файл — тоже', () => {
  assert.throws(() => buildStoryArgs({ out: 'o.mp4', pieces: [] }), /Пустой/);
  const lib = fakeLib([clip('a', [shot(0, 3, ['ест'])], { missing: true, orient: 'horizontal' })]);
  assert.throws(() => storyInputs({ pieces: [{ clip: 'a', shot: 0, from: 0, len: 3 }] }, lib), /Нет исходника.*a\.mp4/);
  const ok = fakeLib([clip('b', [shot(0, 3, ['ест'])], { orient: 'horizontal', hasAudio: false })]);
  assert.deepEqual(storyInputs({ pieces: [{ clip: 'b', shot: 0, from: 1, len: 2, caption: 'Утро' }] }, ok),
    [{ src: '/v/b.mp4', from: 1, len: 2, hasAudio: false, orient: 'horizontal', caption: 'Утро' }]);
});

test('день из жизни без времени съёмки не собирается — по свету не угадываем', () => {
  const L = (luma) => ({ luma });
  const clips = [clip('b', [shot(0, 5, ['движение'], 0.7, L(150))]), clip('m', [shot(0, 5, ['движение'], 0.6, L(90))]), clip('d', [shot(0, 5, ['движение'], 0.5, L(30))])];
  assert.ok(!makeStories(fakeLib(clips), { now: NOW, count: 6 }).some((s) => s.kind === 'day'));
});

test('сначала/потом: «потом» раньше по времени не берётся', () => {
  const lib = fakeLib([clip('a', [shot(0, 5, ['ИК', 'движение'], 0.6, { motion: 5 }), shot(5, 5, ['ИК', 'спокойно'], 0.6, { motion: 0.2 })])]);
  assert.ok(!makeStories(lib, { now: NOW, count: 6 }).some((s) => s.kind === 'beforeAfter'));
});

test('повтор вида — другой заголовок; без имени зверька и без просьб повторить', () => {
  const lib = fakeLib(many(15, ['движение']));
  const hist = [{ kind: 'top5', at: NOW - 3 * DAY }, { kind: 'calm', at: NOW - 2 * DAY }];
  const s = makeStories(lib, { now: NOW, count: 1, history: hist }).find((x) => x.kind === 'top5');
  if (s) { assert.equal(s.variant, 1); assert.deepEqual(s.title, TITLE_VARIANTS.top5[1]); }
  for (const v of Object.values(TITLE_VARIANTS)) {
    assert.equal(new Set(v.map((t) => t.ru)).size, v.length);
    for (const t of v) assert.doesNotMatch(t.ru, /Пип|повтор|ещё раз|включ.*свет|вспышк/i);
  }
});

test('топ-5: не больше двух моментов с клипа, если есть другие; сначала/потом — из одного клипа', () => {
  const big = clip('big', [0, 5, 10, 15, 20].map((t, k) => shot(t, 5, ['движение'], 0.95 - k * 0.01)));
  const rest = ['a', 'b', 'c'].map((id, k) => clip(id, [shot(0, 5, ['движение'], 0.5 - k * 0.01)]));
  const t5 = makeStories(fakeLib([big, ...rest]), { now: NOW, count: 1 }).find((s) => s.kind === 'top5');
  assert.ok(t5);
  assert.equal(t5.pieces.filter((p) => p.clip === 'big').length, 2);
  const lib = fakeLib([
    clip('x', [shot(0, 5, ['спокойно'], 0.6, { motion: 0.5 }), shot(5, 5, ['движение'], 0.9, { motion: 4 })]),
    clip('y', [shot(0, 5, ['спокойно'], 0.7, { motion: 0.5 }), shot(5, 5, ['движение'], 0.4, { motion: 4 })]),
  ]);
  const ba = makeStories(lib, { now: NOW, count: 6 }).find((s) => s.kind === 'beforeAfter');
  assert.ok(ba);
  assert.equal(ba.pieces[0].clip, ba.pieces[1].clip);
});

test('совет к ролику: человеческими словами, время прыжка — в готовом ролике', async () => {
  const { storyWhy } = await import('../core/stories.js');
  const why = storyWhy([
    { clip: 'a', from: 90, len: 3, why: 'прыжок на 91.75 с' },
    { clip: 'b', from: 10, len: 3, why: 'слышен писк, смена позы на 11.5 с' },
  ]);
  assert.equal(why, '2 момента из 2 видео, резкий прыжок около 0:01, слышен писк');
  assert.doesNotMatch(why, /91|смена позы/);
  assert.equal(storyWhy([{ clip: 'a', from: 0, len: 2, why: 'ночная съёмка' }]), '1 момент из 1 видео, снято ночью в ИК');
  assert.equal(storyWhy(Array.from({ length: 5 }, () => ({ clip: 'a', from: 0, len: 1, why: 'зверёк занят своими делами' }))), '5 моментов из 1 видео');
  // ИК только в части моментов — так и пишем, а не «снято ночью»
  const mixed = storyWhy([{ clip: 'a', from: 0, len: 2, why: 'ночная съёмка' }, { clip: 'b', from: 0, len: 2, why: 'зверёк занят своими делами' }, { clip: 'c', from: 0, len: 2, why: '' }]);
  assert.equal(mixed, '3 момента из 3 видео, часть снята ночью в ИК');
});

test('забота о зверьке: совет зависит от вида ролика, ночью — про ИК', async () => {
  const { welfareNotes } = await import('../core/welfare.js');
  const kinds = ['top5', 'day', 'beforeAfter', 'calm', 'asmr', 'series'];
  const texts = kinds.map((kind) => welfareNotes({ always: true, kind }).join(' '));
  assert.equal(new Set(texts).size, kinds.length);
  for (const t of texts) assert.doesNotMatch(t, /включите свет|повторите|ещё раз/i);
  assert.match(welfareNotes({ dark: true, always: true, kind: 'calm' }).join(' '), /ИК/);
});

test('обложка: самый чёткий нормально освещённый кадр без смазки, края не берём', async () => {
  const { bestCoverAt } = await import('../core/render.js');
  const sig = { step: 0.5, sharp: [9, 2, 5, 9, 3, 1], luma: [120, 120, 120, 30, 120, 120], motion: [0, 0, 0, 0, 0, 0], info: { duration: 3 } };
  assert.equal(bestCoverAt(sig), 1, 'кадр 0 и последний — край, кадр 3 тёмный');
  assert.equal(bestCoverAt({ ...sig, motion: [0, 0, 40, 0, 0, 0] }), 2);
  assert.equal(bestCoverAt({ step: 0.5, sharp: [] }), null);
  // кадр с умеренным движением лучше неподвижного (пустая сцена), даже если тот чуть резче
  assert.equal(bestCoverAt({ step: 0.5, sharp: [1, 9, 7, 1], luma: [120, 120, 120, 120], motion: [0, 0, 5, 0], info: { duration: 2 } }), 1);
  // тёмный ИК-кадр не берём, даже если он самый чёткий; все тёмные — берём лучший из тёмных
  const ir = { step: 0.5, sharp: [1, 9, 2, 1], luma: [120, 50, 120, 120], info: { duration: 2 } };
  assert.equal(bestCoverAt(ir), 1);
  assert.equal(bestCoverAt({ ...ir, luma: [30, 30, 30, 30] }), 0.5);
});

test('почему не собраны виды: по каждому несобранному — понятная причина', () => {
  const none = whyNotKinds(fakeLib([]), [], { now: NOW });
  assert.equal(none.length, KINDS.length);
  for (const w of none) { assert.equal(w.name, KIND_RU[w.kind]); assert.match(w.why, /^нужн/); }
  const lib = richLib();
  const out = makeStories(lib, { now: NOW, count: 3 });
  const miss = whyNotKinds(lib, out, { now: NOW });
  assert.equal(miss.length, KINDS.length - out.length, 'собранные не попадают в список');
  for (const w of miss) assert.ok(!out.some((s) => s.kind === w.kind) && w.why.length > 10);
  assert.ok(!miss.some((w) => /Пип/.test(w.why)));
});

// ── разнообразие исходных видео (итерация 5: одна ванна в трёх роликах подряд) ──
const clipsOf = (s) => new Set(s.pieces.map((p) => p.clip));

test('tiredClips: прошлый ролик пачки и 2 ролика за неделю — «устали»; давнее не считается', () => {
  const a = clip('a', [shot(0, 3, ['движение'])], { used: [{ shot: 0, story: 's1', at: NOW - DAY }, { shot: 0, story: 's2', at: NOW - 2 * DAY }] });
  const b = clip('b', [shot(0, 3, ['движение'])], { used: [{ shot: 0, story: 's1', at: NOW - 10 * DAY }, { shot: 0, story: 's0', at: NOW - 9 * DAY }] });
  const c = clip('c', [shot(0, 3, ['движение'])]);
  const d = clip('d', [shot(0, 3, ['движение'])], { used: [{ shot: 0, story: 'last', at: NOW - DAY }] });
  const lib = fakeLib([a, b, c, d]);
  assert.deepEqual([...tiredClips(lib, { now: NOW })].sort(), ['a']);
  // пачка пуста — прошлый ролик берём из истории по id
  assert.deepEqual([...tiredClips(lib, { now: NOW, history: [{ kind: 'top5', at: NOW - DAY, id: 'last' }] })].sort(), ['a', 'd']);
  // в пачке уже есть ролик из c — c устал (соседний день)
  assert.ok(tiredClips(lib, { now: NOW, batch: [['c']] }).has('c'));
  // d был в ролике на неделе и уже в одном ролике пачки — второй раз за неделю
  assert.ok(tiredClips(lib, { now: NOW, batch: [['d'], ['c']] }).has('d'));
});

test('соседние ролики пачки не из одного исходного видео, если есть другие', () => {
  // 14 видео по одному плану, у каждого все метки — любой вид может взять любое
  const labels = ['движение', 'ест', 'спокойно', 'asmr?', 'исследует'];
  const clips = Array.from({ length: 14 }, (_, k) => clip(`v${k}`, [shot(0, 4, labels, 0.5 + k * 0.01), shot(5, 4, labels, 0.5 + k * 0.01)]));
  const out = makeStories(fakeLib(clips), { now: NOW, count: 3 });
  assert.equal(out.length, 3);
  for (let k = 1; k < out.length; k++) {
    const shared = [...clipsOf(out[k])].filter((id) => clipsOf(out[k - 1]).has(id));
    assert.deepEqual(shared, [], `ролики ${k} и ${k + 1} делят исходник`);
  }
});

test('одно видео — не больше чем в 2 роликах пачки за неделю', () => {
  const labels = ['движение', 'ест', 'спокойно', 'asmr?', 'исследует'];
  // у «звезды» много хороших планов, у остальных по одному — раньше она попадала в каждый ролик
  const star = clip('star', Array.from({ length: 10 }, (_, k) => shot(k * 5, 4, labels, 0.95)));
  const rest = Array.from({ length: 16 }, (_, k) => clip(`r${k}`, [shot(0, 4, labels, 0.4 + k * 0.01)]));
  const out = makeStories(fakeLib([star, ...rest]), { now: NOW, count: 5 });
  assert.ok(out.length >= 4, `собрано ${out.length}`);
  assert.ok(out.filter((s) => clipsOf(s).has('star')).length <= 2, out.map((s) => [...clipsOf(s)].join(',')).join(' | '));
});

test('мало видео — всё равно собирает из того, что есть (запасной путь без ограничения)', () => {
  const one = clip('only', Array.from({ length: 12 }, (_, k) => shot(k * 5, 4, ['движение', 'спокойно'], 0.8 - k * 0.01)));
  const out = makeStories(fakeLib([one]), { now: NOW, count: 2 });
  assert.equal(out.length, 2);
  assert.ok(out.every((s) => clipsOf(s).has('only')));
});

test('серия: в видео ≥ 3 планов темы — эпизод из него одного, иначе подборка из разных видео', () => {
  const run = (id, n) => clip(id, Array.from({ length: n }, (_, k) => shot(k * 5, 4, ['лазает'], 0.9 - k * 0.01)));
  const [s] = makeStories(fakeLib([run('big', 6), run('x', 1), run('y', 1)]), { now: NOW, count: 1, history: [{ kind: 'top5', at: NOW - DAY }] });
  assert.equal(s?.kind, 'series');
  assert.deepEqual([...clipsOf(s)], ['big'], JSON.stringify(s.pieces.map((p) => p.clip)));
  const [t] = makeStories(fakeLib([run('a', 2), run('x', 1), run('y', 1)]), { now: NOW, count: 1, history: [{ kind: 'top5', at: NOW - DAY }] });
  assert.equal(t?.kind, 'series');
  assert.equal(clipsOf(t).size, 3, JSON.stringify(t.pieces.map((p) => p.clip)));
});

test('лимит недели исчерпан у всех — лучше ни одного ролика, чем видео третий раз за неделю', () => {
  const labels = ['движение', 'ест', 'спокойно', 'asmr?', 'исследует'];
  const busy = [{ shot: 99, story: 'w1', at: NOW - DAY }, { shot: 99, story: 'w2', at: NOW - 2 * DAY }];
  const clips = Array.from({ length: 10 }, (_, k) => clip(`b${k}`, [shot(0, 4, labels, 0.5 + k * 0.01), shot(5, 4, labels, 0.5 + k * 0.01)], { used: busy.map((u) => ({ ...u })) }));
  const out = makeStories(fakeLib(clips), { now: NOW, count: 3 });
  assert.equal(out.length, 0);
});

test('серия: ролик не короче 15 с — по 5 с на момент, при коротких планах берётся четвёртый', async () => {
  const { SERIES_MIN } = await import('../core/stories.js');
  const run = (id, n, len) => clip(id, Array.from({ length: n }, (_, k) => shot(k * 8, len, ['лазает'], 0.9 - k * 0.01)));
  const hist = [{ kind: 'top5', at: NOW - DAY }];
  const [long] = makeStories(fakeLib([run('a', 2, 7), run('b', 2, 7), run('c', 2, 7)]), { now: NOW, count: 1, history: hist });
  assert.equal(long?.kind, 'series');
  assert.equal(long.pieces.length, 3);
  assert.ok(long.total >= SERIES_MIN, `длина ${long.total}`);
  const [short] = makeStories(fakeLib([run('a', 2, 4.5), run('b', 2, 4.5), run('c', 2, 4.5)]), { now: NOW, count: 1, history: hist });
  assert.equal(short?.kind, 'series');
  assert.equal(short.pieces.length, 4, 'три плана по 4,5 с — мало, добавлен четвёртый');
  assert.ok(short.total >= SERIES_MIN, `длина ${short.total}`);
});

test('топ-5: короткие планы не делают ролик короче 15 с — длинные планы берутся длиннее', async () => {
  const { SERIES_MIN } = await import('../core/stories.js');
  const lens = [2, 2, 6, 6, 6];
  const lib = fakeLib(lens.map((len, k) => clip(`t${k}`, [shot(0, len, ['движение'], 0.9 - k * 0.01)])));
  const [s] = makeStories(lib, { now: NOW, count: 1, history: [] });
  assert.equal(s?.kind, 'top5');
  assert.equal(s.pieces.length, 5);
  assert.ok(s.total >= SERIES_MIN, `длина ${s.total}`);
  for (const p of s.pieces) assert.ok(p.len <= 5, `кусок ${p.len} с — не длиннее 5 с`);
});

// ── «Это мой зверёк» после недели топ-5/серий (случай директора, r2: IMG_0120) ─────────────
// За неделю 4 ролика top5/series/top5/series — ворота разнообразия закрывают оба вида, а других из этих
// видео не собрать. Видео, которое человек только что отметил, всё равно должно войти в ролик.
const weekTS = [
  { kind: 'top5', at: NOW - 4 * DAY }, { kind: 'series', at: NOW - 3 * DAY },
  { kind: 'top5', at: NOW - 2 * DAY }, { kind: 'series', at: NOW - DAY, id: 'w4' },
];
const r2Lib = () => {
  const old = Array.from({ length: 6 }, (_, k) => clip(`IMG_01${10 + k}`, [shot(0, 4, ['ест'], 0.7 - k * 0.01), shot(5, 4, ['ест'], 0.6 - k * 0.01), shot(10, 4, ['ест'], 0.5)],
    { used: [{ shot: 0, story: `w${1 + (k % 2)}`, at: NOW - 3 * DAY }] }));
  const pet = clip('IMG_0120', [shot(0, 6.75, ['движение'], 0.52), shot(6.75, 6.5, ['движение'], 0.76)]);
  return fakeLib([...old, pet]);
};

test('focus: без отметки ворота дают 0 роликов — с отметкой отмеченное видео входит в ролик', () => {
  assert.equal(makeStories(r2Lib(), { now: NOW, count: 3, history: weekTS }).length, 0, 'так было у директора');
  const out = makeStories(r2Lib(), { now: NOW, count: 3, history: weekTS, focus: new Set(['IMG_0120']) });
  assert.ok(out.length >= 1, 'хотя бы один ролик');
  assert.ok(out.some((s) => s.pieces.some((p) => p.clip === 'IMG_0120')), 'кусок IMG_0120 в ролике');
});

test('focus: когда ворота открыты, отмеченное видео берётся первым', () => {
  const out = makeStories(r2Lib(), { now: NOW, count: 1, history: [], focus: new Set(['IMG_0120']) });
  assert.equal(out.length, 1);
  assert.ok(out[0].pieces.some((p) => p.clip === 'IMG_0120'));
});

// ── итог 6 зрителей (15.11): повтор, крючок, заголовок ─────────────────────
test('повтор: два ролика одного вида не собраны из одних и тех же видео (в пачке)', () => {
  const mv = (id, n, base) => clip(id, Array.from({ length: n }, (_, k) => shot(k * 5, 4, ['движение'], base - k * 0.01)));
  const calm = (id) => clip(id, [shot(0, 4, ['спокойно'], 0.5)]);
  const lib = fakeLib([mv('A', 3, 0.95), mv('B', 3, 0.94), mv('C', 3, 0.93), mv('D', 2, 0.7), mv('E', 2, 0.69), mv('F', 2, 0.68), calm('S1'), calm('S2'), calm('S3')]);
  const out = makeStories(lib, { now: NOW, count: 3 });
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    if (out[i].kind !== out[j].kind) continue;
    const shared = [...clipsOf(out[i])].filter((c) => clipsOf(out[j]).has(c));
    assert.ok(shared.length < 2, `${out[i].kind} дважды из ${shared}`);
  }
});

test('повтор: топ-5 этой недели не повторяет файлы прошлого топ-5 недели', () => {
  const was = [{ shot: 99, story: 'w1', at: NOW - 3 * DAY }];
  const mv = (id, base, extra = {}) => clip(id, [shot(0, 4, ['бежит'], base), shot(5, 4, ['бежит'], base - 0.01)], extra);
  const lib = fakeLib([mv('A', 0.95, { used: was.map((u) => ({ ...u })) }), mv('B', 0.94, { used: was.map((u) => ({ ...u })) }), mv('C', 0.93, { used: was.map((u) => ({ ...u })) }), mv('D', 0.7), mv('E', 0.69), mv('F', 0.68)]);
  const hist = [{ kind: 'top5', at: NOW - 3 * DAY, id: 'w1' }, { kind: 'calm', at: NOW - DAY, id: 'w2' }];
  const t = makeStories(lib, { now: NOW, count: 1, history: hist }).find((s) => s.kind === 'top5');
  assert.ok(t, 'топ-5 собран из других видео');
  const shared = [...clipsOf(t)].filter((c) => ['A', 'B', 'C'].includes(c));
  assert.ok(shared.length < 2, `общие с прошлым топ-5: ${shared}`);
});

test('крючок: топ-5 открывается самым живым куском (не №1), короткий — до 2 с', () => {
  const clips = Array.from({ length: 6 }, (_, k) => clip(`c${k}`, [shot(0, 6, ['движение'], 0.5 + k * 0.01, { motion: 0.1 })]));
  clips[2].shots[0] = shot(0, 6, ['движение'], 0.52, { motion: 0.9, peaks: [{ kind: 'move', t: 3, score: 0.9 }] });
  const [s] = makeStories(fakeLib(clips), { now: NOW, count: 1 });
  assert.equal(s.kind, 'top5');
  assert.equal(s.pieces[0].clip, 'c2', 'первая секунда — самое живое движение');
  assert.ok(s.pieces[0].len <= 2, `первый кусок ${s.pieces[0].len} с`);
  assert.equal(s.pieces.at(-1).clip, 'c5', '№1 — по-прежнему лучший');
  assert.ok(s.total >= 15, `длина ${s.total}`);
});

test('заголовок: «Эпизод N» — только когда все куски из одного видео и по порядку', () => {
  const hist = [{ kind: 'top5', at: NOW - DAY }];
  const one = clip('big', Array.from({ length: 4 }, (_, k) => shot(k * 5, 4, ['лазает'], 0.9 - k * 0.01)));
  const [a] = makeStories(fakeLib([one]), { now: NOW, count: 1, history: hist });
  assert.equal(a?.kind, 'series');
  assert.deepEqual([...clipsOf(a)], ['big']);
  assert.equal(a.pieces[0].caption, 'Эпизод 1');
  assert.match(a.title.ru, /эпизод 1/);
  const sh = a.pieces.map((p) => p.shot);
  assert.deepEqual(sh, [...sh].sort((x, y) => x - y), 'куски по порядку съёмки');
  const spread = ['x', 'y', 'z'].map((id) => clip(id, [shot(0, 6, ['лазает'], 0.8)]));
  const [b] = makeStories(fakeLib(spread), { now: NOW, count: 1, history: hist });
  assert.equal(b?.kind, 'series');
  assert.ok(clipsOf(b).size > 1);
  assert.ok(b.pieces.every((p) => !/эпизод/i.test(p.caption ?? '')), 'куски разных видео — не «Эпизод»');
  assert.doesNotMatch(b.title.ru, /эпизод/i);
  assert.doesNotMatch(b.title.en, /episode/i);
});

test('заголовок: совет к серии не пишет «занят сам» (в кадре бывает кормление с руки)', async () => {
  const { welfareNotes } = await import('../core/welfare.js');
  for (const n of welfareNotes({ kind: 'series' })) assert.doesNotMatch(n, /занят сам/i);
});
