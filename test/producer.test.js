// Этап 2, шаг 4: продюсер (пачка → разбор → сюжеты → пакеты → календарь) на поддельных media, библиотеке и Haiku.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createProducer, titleB, applyPick, diskFree, HOOKS, isNight } from '../core/producer.js';
import { createCalendar } from '../core/calendar.js';
import { createVision } from '../core/vision.js';
import { KINDS } from '../core/stories.js';
import { countSupply } from '../core/library.js';
import * as privacyMod from '../core/privacy.js';
import { createAi } from '../core/ai.js';

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();

function shot(from, len, labels, score = 0.6, extra = {}) {
  return { from, len, score, best: { t: from + len / 2, kind: 'move', score }, peaks: [], labels, defects: [], why: `план ${labels.join(',')}`, hash: null, ...extra };
}

const unmarked = (c) => c?.pet == null && (Boolean(c?.petUnsure) || (Boolean(c?.vision?.by) && c.vision.by !== 'claude'));

/** Поддельная библиотека с контрактом core/library.js: ingest по шаблону из sig.tpl. */
function fakeLib(now = () => NOW) {
  const db = {};
  return {
    all: () => Object.values(db),
    get: (id) => db[id] ?? null,
    realPath: (c) => (c.missing ? null : `/v/${c.name}`),
    ingest(file, sig) {
      const id = basename(file);
      if (db[id]) return { clip: db[id], added: false };
      db[id] = { id, name: id, orient: 'vertical', hasAudio: true, created: null, night: false, labels: [], stars: 0, used: [], vision: null, ...sig.tpl };
      return { clip: db[id], added: true };
    },
    setVision(id, v) { db[id].vision = { by: v.by, mood: v.mood ?? null, asmr: Boolean(v.asmr), cost: v.cost ?? 0 }; return db[id]; },
    setPet(id, yes, { by = 'owner', why = null } = {}) { const c = db[id]; c.pet = Boolean(yes); c.petBy = by; c.petWhy = why; c.petUnsure = false; if (!c.pet) for (const s of c.shots) { s.defects.push('не ваш зверёк'); s.score = 0; } return c; },
    markUnsure(id) { const c = db[id]; if (c && c.pet == null) c.petUnsure = true; return c; },
    pending: () => Object.values(db).filter(unmarked),
    isFree(id, i) { const c = db[id]; const s = c?.shots[i]; if (!s || s.defects.length || unmarked(c)) return false; return !c.used.some((u) => u.shot === i && now() - u.at < 7 * DAY); },
    markUsed(id, s, story, at) { db[id].used.push({ shot: s, story, at }); },
    markNoPet(id, s) { const x = db[id]?.shots[s]; if (!x) return null; x.defects.push('нет зверька'); x.score = 0; return x; },
    supply() { return countSupply(Object.values(db), (id, i) => this.isFree(id, i)); },
    stats: () => ({ clips: Object.keys(db).length }),
  };
}

/** Поддельный ffmpeg: создаёт файл-результат (последний аргумент). */
function fakeMedia(world, { failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    tools: { ffmpeg: 'fake', ffprobe: 'fake' },
    async probe(file) { const w = world[basename(file)]; if (!w) throw new Error('битый файл'); return w.info; },
    async signals(file) { return { tpl: world[basename(file)].tpl }; },
    async ffmpeg(args) {
      calls.push(args);
      const out = args[args.length - 1];
      if (failOn && String(out).includes(failOn)) throw new Error('ffmpeg упал');
      mkdirSync(join(out, '..'), { recursive: true });
      writeFileSync(out, 'x');
    },
  };
}

/** Мир из 12 клипов: движение, сон, ИК-ночь, ASMR-хруст, прыжки. */
function world(more = 0) {
  const w = {};
  const add = (name, labels, extra = {}) => { w[name] = { info: { duration: 8, width: 1080, height: 1920, hasAudio: true }, tpl: { shots: [shot(0, 4, labels, 0.6 + Object.keys(w).length * 0.01, extra.shot ?? {})], ...(extra.clip ?? {}) } }; };
  for (let k = 0; k < 5 + more; k++) add(`move${k}.mp4`, ['движение', 'играет']);
  add('rest.mp4', ['спокойно']);
  add('sleep.mp4', ['спит', 'спокойно']);
  add('wash.mp4', ['умывается']);
  add('night.mp4', ['ИК', 'движение'], { clip: { night: true } });
  add('crunch.mp4', ['ест', 'asmr?']);
  add('jump1.mp4', ['прыжок', 'движение'], { shot: { peaks: [{ t: 1, kind: 'move', score: 0.9 }] } });
  add('jump2.mp4', ['прыжок', 'движение'], { shot: { peaks: [{ t: 1, kind: 'move', score: 0.8 }] } });
  w['short.mp4'] = { info: { duration: 0.4, width: 1080, height: 1920, hasAudio: true }, tpl: { shots: [] } };
  return w;
}

function setup(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'possum-prod-'));
  let t = NOW;
  const now = () => t;
  const W = world(opts.more ?? 0);
  const media = fakeMedia(W, opts);
  const lib = fakeLib(now);
  const calendar = createCalendar({ path: join(root, 'calendar.json'), now });
  const calls = [];
  const client = { messages: { create: async (req) => { calls.push(req); return { content: [{ type: 'text', text: JSON.stringify({ mood: 'игривый', asmr: false, frames: [] }) }], usage: { input_tokens: 1500, output_tokens: 120 } }; } } };
  const vision = createVision({ apiKey: opts.noKey ? '' : 'test-key-not-real', client: opts.noKey ? null : client, cachePath: join(root, 'cost.json'), now });
  const producer = createProducer({ lib, calendar, vision, media, outRoot: join(root, 'Готово'), workRoot: join(root, 'work'), now, minFreeBytes: 0, species: opts.species, ...opts.prod });
  const files = Object.keys(W).map((n) => join(root, 'in', n));
  return { root, lib, calendar, vision, producer, files, media, calls, setNow: (x) => { t = x; } };
}

test('пачка 13 видео → разбор, 3 сюжета разных видов, пакеты A/B, слоты в календаре, решения', async () => {
  const { producer, files, calendar, calls } = setup();
  const prog = [];
  const r = await producer.run(files, (p) => prog.push(p));
  assert.equal(r.files.length, 13);
  assert.equal(r.files.find((f) => f.file.endsWith('short.mp4')).skipped, 'короче секунды — пропущен');
  assert.equal(r.made.length, 3);
  assert.equal(r.made.length, 3);
  assert.equal(new Set(r.made.map((m) => m.kind)).size, 3, 'три разных вида');
  for (const m of r.made) {
    assert.ok(KINDS.includes(m.kind));
    for (const f of ['video.mp4', 'cover.jpg', 'manifest.json', 'пост.txt']) assert.ok(existsSync(join(m.dir, f)), `${f} в ${m.dir}`);
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.equal(man.outputs.reels, join(m.dir, 'video.mp4'));
    assert.notEqual(man.titles.A.ru, man.titles.B.ru);
    assert.ok(man.packagesA.youtube.title && man.packagesB.youtube.title);
    assert.ok(m.day, 'есть день в календаре');
    assert.ok(m.why);
    // откуда каждый момент: время в ролике и в исходном видео — и в заметках, чтобы проверить руками
    assert.equal(man.sources.length, man.story.pieces.length);
    assert.match(man.sources[0].at, /^0:00$/);
    for (const s of man.sources) assert.match(s.from + s.till, /^\d+:\d\d\d+:\d\d$/);
    const notes = readFileSync(join(m.dir, 'заметки.txt'), 'utf8');
    assert.match(notes, /Из чего собран ролик/);
    assert.ok(notes.includes(man.sources[0].file), 'имя исходного видео в заметках');
  }
  assert.equal(calendar.free(), 11);
  assert.ok(r.decisions.some((d) => d.type === 'publish' && /в 18:00\?$/.test(d.text)));
  assert.equal(r.decisions.filter((d) => d.type === 'title').length, 1);
  // прогресс: разбор по каждому файлу, монтаж, готово; ETA появляется со второго шага
  assert.equal(prog.filter((p) => p.stage === 'разбор').length, 13);
  assert.equal(prog[0].eta, null);
  assert.equal(typeof prog[1].eta, 'number');
  assert.equal(prog.at(-1).stage, 'готово');
  // тексты не советуют повторять трюк и не просят свет
  for (const d of r.decisions) assert.doesNotMatch(d.text, /повтор|включите свет|вспышк/i);
});

test('повторная пачка тех же файлов: Haiku второй раз не платим, планы заняты — новых сюжетов меньше или «закиньте ещё»', async () => {
  const { producer, files, calls } = setup();
  await producer.run(files);
  const n = calls.length;
  const r2 = await producer.run(files);
  assert.equal(calls.length, n, 'уже разобранные клипы не отправляются в Haiku');
  assert.ok(r2.files.filter((f) => f.id).every((f) => f.added === false));
  const r3 = await producer.run(files);
  if (!r3.made.length) assert.ok(r3.decisions.some((d) => d.type === 'more'));
});

test('без ключа API — разбор по сигналам, ролики всё равно собираются', async () => {
  const { producer, files, calls, lib } = setup({ noKey: true });
  const r = await producer.run(files);
  assert.equal(calls.length, 0);
  assert.ok(r.files.filter((f) => f.id).every((f) => f.by === 'сигналы'));
  assert.ok(r.decisions.some((d) => d.type === 'confirm'));
  for (const c of lib.pending()) lib.setPet(c.id, true);
  assert.ok((await producer.build()).made.length >= 1);
});

test('битый файл и упавший монтаж не роняют пачку', async () => {
  const { producer, files, root } = setup({ failOn: 'top5' });
  const r = await producer.run([...files, join(root, 'in', 'битый.mp4')]);
  assert.ok(r.errors.some((e) => e.file === 'битый.mp4'));
  assert.ok(r.errors.some((e) => String(e.story).startsWith('top5')));
  assert.ok(r.made.length >= 1, 'остальные сюжеты собраны');
});

test('календарь заполнен — новых роликов не монтирует, говорит почему', async () => {
  const { producer, files, calendar } = setup();
  for (let k = 0; k < 14; k++) calendar.add({ id: `old${k}`, kind: 'day' });
  const r = await producer.run(files);
  assert.equal(r.made.length, 0);
  assert.ok(r.decisions.some((d) => d.type === 'full'));
});

test('свободных дней меньше трёх — сюжетов столько, сколько дней', async () => {
  const { producer, files, calendar } = setup();
  for (let k = 0; k < 13; k++) calendar.add({ id: `old${k}`, kind: 'day' });
  const r = await producer.run(files);
  assert.equal(r.made.length, 1);
  assert.equal(calendar.free(), 0);
});

test('мало места на диске — монтаж не начинается', async () => {
  const { files, lib, calendar, vision, media, root } = setup();
  const p = createProducer({ lib, calendar, vision, media, outRoot: join(root, 'o'), workRoot: join(root, 'w'), now: () => NOW, minFreeBytes: Number.MAX_SAFE_INTEGER });
  const r = await p.run(files);
  if (r.disk === null) return; // statfs недоступен — проверять нечего
  assert.equal(r.files.length, 0);
  assert.ok(r.decisions.some((d) => d.type === 'disk'));
});

test('ночной сюжет — заметка о ИК без света; фейлы — «посмотрите»', async () => {
  const { producer, files } = setup({ prod: { maxStories: 6 } });
  const r = await producer.run(files);
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.ok(man.welfare.length >= 1, 'заметка о заботе в каждом ролике');
    for (const w of man.welfare) assert.doesNotMatch(w, /включите свет|поднесите/i);
    if (man.needsReview) {
      assert.equal(man.advice.verdict, 'посмотрите перед выкладкой');
      assert.ok(r.decisions.some((d) => d.type === 'review' && d.id === m.id));
    }
  }
  assert.ok(!r.decisions.some((d) => d.type === 'claude'), 'плашки «Claude не подключён» больше нет');
});

test('без Claude вид не проверен: сначала отметка по листам кадров, «не он» в ролики не идёт', async () => {
  const { producer, files, lib } = setup({ noKey: true });
  const r = await producer.run(files);
  assert.equal(r.made.length, 0, 'до отметки ролики не собираются');
  const ask = r.decisions.find((d) => d.type === 'confirm');
  assert.ok(ask, 'просит отметить');
  assert.equal(ask.clips.length, 12, 'все видео с разбором, кроме слишком короткого');
  for (const c of ask.clips) assert.ok(c.id && c.name);
  assert.match(ask.text, /где ваш зверёк/);
  // отметили: прыжки — «не он», остальное — «мой»
  for (const c of ask.clips) lib.setPet(c.id, !c.id.startsWith('jump'));
  assert.equal(lib.pending().length, 0);
  const r2 = await producer.build();
  assert.ok(r2.made.length >= 1);
  assert.ok(!r2.decisions.some((d) => d.type === 'confirm'));
  for (const m of r2.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.ok(!man.story.pieces.some((p) => p.clip.startsWith('jump')), 'отмеченное «не он» не берётся');
  }
});

test('выбор заголовка B переписывает packages и пост.txt', async () => {
  const { producer, files } = setup();
  const r = await producer.run(files);
  const m = r.made[0];
  const man = applyPick(m.dir, 'B');
  assert.equal(man.pick, 'B');
  assert.equal(man.packages.youtube.title, man.packagesB.youtube.title);
  assert.match(readFileSync(join(m.dir, 'пост.txt'), 'utf8'), new RegExp(man.packagesB.youtube.title.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(applyPick(m.dir, 'Z').pick, 'B', 'чужой вариант игнорируется');
});

test('крючки B: на каждый вид, без имени зверька', () => {
  for (const k of ['top5', 'day', 'beforeAfter', 'calm', 'asmr']) assert.ok(HOOKS[k].ru && HOOKS[k].en);
  assert.ok(!HOOKS.fails, 'фейлов нет');
  for (const v of Object.values(HOOKS)) assert.doesNotMatch(v.ru, /досмотрите|до №1|проснулся/i);
  const s = titleB({ kind: 'series', title: { ru: 'Поссум ест · эпизод 2', en: 'x' } });
  assert.match(s.ru, /эпизод 2/);
  assert.ok(diskFree(tmpdir()) === null || diskFree(tmpdir()) > 0);
});

test('папка ролика названа по дню его слота, а не по сегодняшнему', async () => {
  const { producer, files } = setup();
  const r = await producer.run(files);
  assert.ok(r.made.length >= 2);
  for (const m of r.made) assert.ok(basename(m.dir).startsWith(m.day), `${basename(m.dir)} ↔ ${m.day}`);
  assert.equal(new Set(r.made.map((m) => m.day)).size, r.made.length);
});

test('B-заголовок зависит от варианта сюжета', async () => {
  const { titleB, HOOK_VARIANTS } = await import('../core/producer.js');
  assert.deepEqual(titleB({ kind: 'top5', variant: 1, title: { ru: 'x', en: 'x' } }), HOOK_VARIANTS.top5[1]);
  assert.deepEqual(titleB({ kind: 'top5', title: { ru: 'x', en: 'x' } }), HOOK_VARIANTS.top5[0]);
  for (const v of Object.values(HOOK_VARIANTS)) for (const t of v) assert.doesNotMatch(t.ru, /Пип|повтор|ещё раз|свет|вспышк/i);
});

test('«Убрать момент» в топ-5: план помечен «нет зверька», на место — свежий момент, подписи №N…№1, пост и заметки заново', async () => {
  const { producer, files, lib, calendar, media } = setup({ more: 6 }); // серии берут до 4 моментов — замене нужен запас
  const r = await producer.run(files);
  const m = r.made.find((x) => x.kind === 'top5') ?? r.made[0];
  const before = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
  const gone = before.story.pieces[1];
  const nCalls = media.calls.length;
  assert.equal(before.story.kind, 'top5', 'в тестовом мире есть топ-5');
  const { manifest, replaced } = await producer.removePiece(m.dir, 1);
  assert.equal(replaced, true);
  assert.ok(media.calls.length > nCalls, 'ролик перемонтирован');
  assert.ok(lib.get(gone.clip).shots[gone.shot].defects.includes('нет зверька'));
  assert.equal(lib.isFree(gone.clip, gone.shot), false, 'убранный план в сюжеты больше не идёт');
  const ps = manifest.story.pieces;
  assert.equal(ps.length, before.story.pieces.length);
  assert.ok(!ps.some((p) => p.clip === gone.clip && p.shot === gone.shot), 'убранного момента нет');
  assert.deepEqual(ps.map((p) => p.caption), ps.map((_, k) => `№${ps.length - k}`));
  assert.equal(manifest.sources.length, ps.length);
  assert.equal(manifest.removed.length, 1);
  assert.ok(manifest.removed[0].removedAt);
  const per = {}; for (const p of ps) per[p.clip] = (per[p.clip] ?? 0) + 1;
  assert.ok(Object.values(per).every((n) => n <= 2), 'не больше 2 моментов с одного видео');
  const notes = readFileSync(join(m.dir, 'заметки.txt'), 'utf8');
  assert.ok(notes.includes(manifest.sources[0].file));
  assert.equal(calendar.all().find((s) => s.id === m.id || s.dir === m.dir)?.why, manifest.story.why);
});

test('«Убрать момент»: короткий ролик не пересобирается — просит «Не выкладывать»; чужой номер — ошибка', async () => {
  const { producer, files } = setup();
  const r = await producer.run(files);
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    await assert.rejects(producer.removePiece(m.dir, 99), /Такого момента/);
    if (man.story.kind !== 'top5' && man.story.pieces.length === 2) {
      await assert.rejects(producer.removePiece(m.dir, 0), /Не выкладывать/);
      assert.equal(JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8')).story.pieces.length, 2, 'ролик не тронут');
    }
  }
});

test('календарь: update меняет только пояснение и длину', () => {
  const root = mkdtempSync(join(tmpdir(), 'possum-cal-'));
  const cal = createCalendar({ path: join(root, 'c.json'), now: () => NOW });
  const { id } = cal.add({ id: 'x1', kind: 'top5', why: 'старое', total: 15 });
  const u = cal.update(id, { why: 'новое', total: 12, status: 'published' });
  assert.equal(u.why, 'новое'); assert.equal(u.total, 12); assert.notEqual(u.status, 'published');
  assert.equal(cal.update('нет-такого', { why: 'x' }), null);
});

test('собрал меньше, чем просили, — причина честная: сколько подходящих кусков, сколько занято, что не подошло', async () => {
  const { producer, files } = setup({ prod: { maxStories: 12 } });
  const r = await producer.run(files);
  const more = r.decisions.find((d) => d.type === 'more');
  assert.ok(more, JSON.stringify(r.decisions.map((d) => d.type)));
  assert.match(more.text, /^Не хватило видео ещё на \d+ ролик(а|ов)?: (все \d+ куск\S* видео со зверьком уже в роликах|со зверьком \d+ куск\S* видео, в роликах уже \d+, свободных \d+)/);
  assert.match(more.text, /добавьте новые видео$/);
  assert.doesNotMatch(more.text, /Собрал|за неделю| из \d+:|отложено|моментов|копия/);
  assert.doesNotMatch(more.text, /уже в 2 роликах/);
  assert.doesNotMatch(more.text, /повтор|включите свет|вспышк/i);
});

// ── Вид без ключа: локальная модель кадров + эталон «своего зверька» (core/species.js). Человеку — только неуверенные. ──
/** Поддельный суд вида: вердикт по имени файла, остальное — «мой». */
test('лица и сигареты: фильтр вырезает момент из плана, весь план с человеком — в запас; второй прогон не проверяет снова', async () => {
  const scanned = [];
  const privacy = { available: true, async scan(file) { scanned.push(basename(file)); const n = basename(file); if (n === 'move0.mp4') return [0, 1, 2, 3].map((t) => ({ t, kind: t <= 1 ? 'сигарета' : null })); if (n === 'move1.mp4') return [0, 1, 2, 3].map((t) => ({ t, kind: 'люди' })); return [0, 1, 2, 3].map((t) => ({ t, kind: null })); } };
  const { producer, files, lib } = setup({ noKey: true, species: fakeSpecies(), prod: { privacy, privacyPad: 0 } });
  lib.setPrivacy = (id, hits, opts) => { const { markPrivate } = privacyMod; const c = lib.get(id); const r = markPrivate(c.shots, hits, { step: 1, ...opts }); c.privacy = { checked: true, ...r }; return r; };
  const r = await producer.run(files);
  const f = (n) => r.files.find((x) => x.file.endsWith(n));
  assert.deepEqual(f('move0.mp4').privacy, { cut: 1, dropped: 0, kinds: ['сигарета'] });
  assert.deepEqual([lib.get('move0.mp4').shots[0].from, lib.get('move0.mp4').shots[0].len], [1.5, 2.5], 'сигарета до 1.5 с вырезана');
  assert.deepEqual(f('move1.mp4').privacy, { cut: 0, dropped: 1, kinds: ['люди'] });
  assert.deepEqual(lib.get('move1.mp4').shots[0].defects, ['люди']);
  assert.equal(f('move2.mp4').privacy, undefined, 'чистое видео — без пометки');
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    for (const p of man.story.pieces.filter((x) => x.clip === 'move0.mp4')) assert.ok(p.from >= 1.5, 'кусок с сигаретой в ролик не попал');
    assert.ok(!man.story.pieces.some((p) => p.clip === 'move1.mp4'), 'план с человеком в ролик не попал');
  }
  const n = scanned.length;
  await producer.run(files);
  assert.equal(scanned.length, n, 'проверенное видео второй раз не сканируется');
});

function fakeSpecies(verdicts = {}, { ref = true } = {}) {
  const judged = []; const learned = [];
  return {
    judged, learned, available: true,
    hasReference: () => ref, setRef(v) { ref = v; },
    async judge(file, id) { judged.push(id); if (!ref) return { verdict: 'unsure', score: null }; const v = verdicts[basename(file)] ?? 'mine'; return { verdict: v, score: v === 'mine' ? 0.95 : 0.8, animal: v === 'empty' ? 0.1 : 1 }; },
    learn(id) { learned.push(id); return true; },
  };
}
const SPECIES_WORDS = /поссум|sugar ?glider|possum|glider/i;

test('без ключа, с эталоном: свои — сразу в ролики, чужие и пустые — нет, спрашивает только про неуверенные', async () => {
  const species = fakeSpecies({ 'jump1.mp4': 'other', 'jump2.mp4': 'empty', 'wash.mp4': 'unsure' });
  const { producer, files, lib } = setup({ noKey: true, species });
  const r = await producer.run(files);
  assert.ok(r.made.length >= 1, 'ролики собраны без отметки каждого видео');
  const ask = r.decisions.find((d) => d.type === 'confirm');
  assert.ok(ask, 'неуверенное — одной пачкой');
  assert.deepEqual(ask.clips.map((c) => c.name), ['wash.mp4']);
  assert.match(ask.text, /^Не уверен в 1 видео/);
  assert.doesNotMatch(ask.text, /повтор|включите свет|вспышк/i);
  assert.equal(lib.get('jump1.mp4').pet, false);
  assert.equal(lib.get('jump2.mp4').pet, false);
  assert.equal(lib.get('move0.mp4').pet, true);
  const f = (n) => r.files.find((x) => x.file.endsWith(n));
  assert.deepEqual([f('jump1.mp4').notPet, f('jump1.mp4').why], [true, 'на видео не ваш зверёк'], 'отброшенное моделью видно в итоге с причиной');
  assert.deepEqual([f('jump2.mp4').notPet, f('jump2.mp4').why], [true, 'зверька в кадре почти нет']);
  assert.equal(f('wash.mp4').notPet, false, 'неуверенное не отброшено — ждёт человека');
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.ok(!man.story.pieces.some((p) => /^(jump|wash)/.test(p.clip)), 'чужое, пустое и неуверенное не берётся');
  }
});

test('без ключа, модель есть, эталона нет: просит 3–5 снимков один раз, роликов и «закиньте ещё» нет; дали эталон — собирает', async () => {
  const species = fakeSpecies({}, { ref: false });
  const { producer, files } = setup({ noKey: true, species });
  const r = await producer.run(files);
  assert.equal(r.made.length, 0);
  const ref = r.decisions.find((d) => d.type === 'reference');
  assert.ok(ref, JSON.stringify(r.decisions.map((d) => d.type)));
  assert.match(ref.text, /3–5/);
  for (const t of ['confirm', 'more', 'missing']) assert.ok(!r.decisions.some((d) => d.type === t), `нет «${t}»`);
  species.setRef(true);
  await producer.rejudge();
  const r2 = await producer.build();
  assert.ok(r2.made.length >= 1);
  assert.ok(!r2.decisions.some((d) => d.type === 'reference'));
});

test('ключ есть, Claude «зверёк есть», а модель — «чужой»: не берём молча, спрашиваем', async () => {
  const species = fakeSpecies({ 'jump1.mp4': 'other' });
  const { producer, files } = setup({ species });
  const r = await producer.run(files);
  const ask = r.decisions.find((d) => d.type === 'confirm');
  assert.deepEqual(ask?.clips.map((c) => c.name), ['jump1.mp4']);
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.ok(!man.story.pieces.some((p) => p.clip === 'jump1.mp4'));
  }
});

test('пока вид не подтверждён, тексты не называют вид; подтверждён — можно', async () => {
  const species = fakeSpecies();
  const { producer, files } = setup({ noKey: true, species });
  const r = await producer.run(files);
  assert.ok(r.made.length >= 1);
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    const texts = JSON.stringify({ t: man.titles, a: man.packagesA, b: man.packagesB, p: man.packages, w: man.welfare });
    assert.doesNotMatch(texts, SPECIES_WORDS);
    assert.doesNotMatch(readFileSync(join(m.dir, 'пост.txt'), 'utf8'), SPECIES_WORDS);
  }
  for (const d of r.decisions) assert.doesNotMatch(d.text, SPECIES_WORDS);
  const s2 = setup({ noKey: true, species: fakeSpecies(), prod: { speciesName: { ru: 'сахарный поссум', en: 'sugar glider', tag: 'сахарныйпоссум' } } });
  const r2 = await s2.producer.run(s2.files);
  const man2 = JSON.parse(readFileSync(join(r2.made[0].dir, 'manifest.json'), 'utf8'));
  assert.match(JSON.stringify(man2.packagesA), /сахарныйпоссум/);
});

test('ночная заметка о заботе — если хоть один кусок ролика ночной, а не только большинство', () => {
  const lib = { get: (id) => ({ n: { night: true }, d1: { night: false }, d2: { night: false } })[id] };
  assert.equal(isNight({ pieces: [{ clip: 'd1' }, { clip: 'd2' }, { clip: 'n' }] }, lib), true);
  assert.equal(isNight({ pieces: [{ clip: 'd1' }, { clip: 'd2' }] }, lib), false);
});

// Ключ Claude вводит сам монтажёр — ввёл, значит согласен на вызовы. Источник текстов — по факту ответа.
const aiClient = (reply) => {
  const asked = [];
  return { asked, beta: { messages: { create: async (req) => { asked.push(req); if (reply instanceof Error) throw reply; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] }; } } } };
};
const CLAUDE_TEXT = { titleRu: 'Зверёк нашёл тыкву и не отдаёт', titleEn: 'Found a pumpkin, not sharing', descRu: 'Ночной обход: тыква, апельсин и ни капли стыда.', tags: ['тыква', 'зверёк'] };

test('ключ есть: тексты A от Claude, texts.source = claude, пост с текстом Claude; B — запасной шаблон', async () => {
  const c = aiClient(CLAUDE_TEXT);
  const ai = createAi({ apiKey: 'test-key-not-real', client: c });
  const { producer, files } = setup({ prod: { ai } });
  const r = await producer.run(files);
  assert.ok(r.made.length >= 1);
  assert.equal(c.asked.length, r.made.length, 'один вызов на ролик');
  for (const m of r.made) {
    const man = JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8'));
    assert.equal(man.texts.source, 'claude');
    assert.equal(man.titles.A.ru, CLAUDE_TEXT.titleRu);
    assert.match(man.packagesA.youtube.title, /тыкву/);
    assert.match(man.packagesA.instagram.caption, /апельсин/);
    assert.doesNotMatch(man.packagesB.youtube.title, /тыкву/, 'B остаётся шаблоном');
    assert.match(readFileSync(join(m.dir, 'пост.txt'), 'utf8'), /тыкву/);
    assert.equal(m.textsSource, 'claude');
  }
});

test('ключ есть, сеть упала: шаблон и честная причина; без ключа — шаблон без вызовов', async () => {
  const c = aiClient(new Error('getaddrinfo ENOTFOUND api.anthropic.com'));
  const { producer, files } = setup({ prod: { ai: createAi({ apiKey: 'test-key-not-real', client: c }) } });
  const r = await producer.run(files);
  assert.ok(r.made.length >= 1 && c.asked.length >= 1);
  const man = JSON.parse(readFileSync(join(r.made[0].dir, 'manifest.json'), 'utf8'));
  assert.equal(man.texts.source, 'шаблон');
  assert.match(man.texts.reason, /Claude недоступен/);
  assert.doesNotMatch(man.texts.reason, /test-key-not-real/);
  assert.equal(r.made[0].textsSource, 'шаблон');

  const s2 = setup({ noKey: true, species: fakeSpecies(), prod: { ai: createAi({ apiKey: '' }) } });
  const r2 = await s2.producer.run(s2.files);
  const man2 = JSON.parse(readFileSync(join(r2.made[0].dir, 'manifest.json'), 'utf8'));
  assert.equal(man2.texts.source, 'шаблон');
  assert.match(man2.texts.reason, /нет ключа/);
});

test('Claude прислал запретное (свет, вспышка, повтор) — текст не берём, шаблон с причиной', async () => {
  const c = aiClient({ ...CLAUDE_TEXT, descRu: 'Включите свет и снимите со вспышкой!' });
  const { producer, files } = setup({ prod: { ai: createAi({ apiKey: 'test-key-not-real', client: c }) } });
  const r = await producer.run(files);
  const man = JSON.parse(readFileSync(join(r.made[0].dir, 'manifest.json'), 'utf8'));
  assert.equal(man.texts.source, 'шаблон');
  assert.match(man.texts.reason, /не подошёл/);
  assert.doesNotMatch(JSON.stringify(man.packagesA), /вспышк|включите свет/i);
});

test('шаблонные тексты называют вид, если владелец его подтвердил', async () => {
  const { storyTexts, withSpecies } = await import('../core/producer.js');
  const sp = { ru: 'сахарный поссум', en: 'sugar glider' };
  const story = { kind: 'top5', variant: 2 };
  const t = withSpecies({ ru: 'Пять моментов из жизни зверька', en: '5 moments' }, sp);
  assert.equal(t.ru, 'Сахарный поссум: пять моментов из жизни зверька');
  assert.match(t.en, /^Sugar glider: /);
  assert.match(storyTexts(story, t, sp).descRu, /^Сахарный поссум\. /);
  assert.deepEqual(withSpecies({ ru: 'Пять', en: 'Five' }, null), { ru: 'Пять', en: 'Five' }, 'вид не подтверждён — не называем');
  assert.doesNotMatch(storyTexts(story, { ru: 'x', en: 'x' }, null).descRu, /поссум/i);
});

// Пачка разобрана, когда модели не было (или проверка упала): перед сюжетами сборка сама досматривает видео.
// Иначе рука с сигаретой из непроверенного видео попадает в ролик (IMG_0125, прогон 15.11).
const privSetLib = (lib) => { lib.setPrivacy = (id, hits, opts) => { const c = lib.get(id); const r = privacyMod.markPrivate(c.shots, hits, { step: 1, ...opts }); c.privacy = { checked: true, ...r }; return r; }; };
const smoke = (bad) => async (file) => { const n = basename(file); return [0, 1, 2, 3].map((t) => ({ t, kind: n === bad ? 'сигарета' : null })); };
const pieces = async (made) => made.flatMap((m) => JSON.parse(readFileSync(join(m.dir, 'manifest.json'), 'utf8')).story.pieces);

test('приватность: видео, разобранное без проверки, сборка досматривает до сюжетов — сигарета в ролик не попадает', async () => {
  const scanned = [];
  const privacy = { available: false, async scan(f) { scanned.push(basename(f)); return smoke('move0.mp4')(f); } };
  const { producer, files, lib } = setup({ noKey: true, species: fakeSpecies(), prod: { privacy, privacyPad: 0 } });
  privSetLib(lib);
  for (const f of files) { try { await producer.ingestOne(f); } catch { /* битый — мимо */ } }
  assert.equal(scanned.length, 0, 'при разборе модели не было');
  privacy.available = true;
  const r = await producer.build();
  assert.ok(scanned.includes('move0.mp4'), 'непроверенное видео досмотрено при сборке');
  assert.equal(lib.get('move0.mp4').privacy?.checked, true);
  assert.ok(r.made.length > 0);
  assert.ok(!(await pieces(r.made)).some((p) => p.clip === 'move0.mp4'), 'план с сигаретой в ролик не попал');
  const n = scanned.length;
  await producer.build();
  assert.equal(scanned.length, n, 'проверенное второй раз не сканируется');
});

test('приватность: проверка видео упала — видео в ролики не идёт, ошибка видна, а не проглочена', async () => {
  const privacy = { available: true, async scan(f) { if (basename(f) === 'move0.mp4') throw new Error('модель не открылась'); return smoke(null)(f); } };
  const { producer, files, lib } = setup({ noKey: true, species: fakeSpecies(), prod: { privacy, privacyPad: 0 } });
  privSetLib(lib);
  const r = await producer.run(files);
  assert.ok(r.made.length > 0);
  assert.ok(!(await pieces(r.made)).some((p) => p.clip === 'move0.mp4'), 'непроверенное видео в ролик не попало');
  const e = r.errors.find((x) => x.file === 'move0.mp4');
  assert.ok(e, 'ошибка проверки в итоге пачки');
  assert.match(e.error, /лиц и сигарет/);
});

test('приватность: модели нет — ролики собираются, но каждый с пометкой «проверки лиц и сигарет не было»', async () => {
  const { producer, files } = setup({ noKey: true, species: fakeSpecies(), prod: { privacy: { available: false, async scan() { return []; } } } });
  const r = await producer.run(files);
  assert.ok(r.made.length > 0);
  for (const m of r.made) assert.match(m.needsReview ?? '', /лиц и сигарет/);
  assert.ok(r.decisions.some((d) => d.type === 'privacy' && /не было/.test(d.text)));
});
