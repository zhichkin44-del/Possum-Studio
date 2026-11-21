// The user's app: "Inbox" folder → queue → editing one at a time. A video is picked up once its file has finished copying.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createInbox } from '../app/inbox.js';

function setup(studio) {
  const root = mkdtempSync(join(tmpdir(), 'possum-inbox-'));
  const inDir = join(root, 'Входящие');
  const statePath = join(root, '.jobs.json');
  mkdirSync(inDir, { recursive: true });
  const make = () => createInbox({ inDir, statePath, studio, stableMs: 0 });
  return { root, inDir, statePath, make };
}

function fakeStudio({ fails = 0 } = {}) {
  const s = {
    calls: [], running: 0, maxRunning: 0, fails,
    async process(src, onStep) {
      s.calls.push(src); s.running++; s.maxRunning = Math.max(s.maxRunning, s.running);
      onStep('Смотрю ролик');
      await new Promise((r) => setTimeout(r, 5));
      s.running--;
      if (s.fails > 0) { s.fails--; throw new Error('сбой монтажа'); }
      return { dir: `${src}.готово`, advice: { verdict: 'выкладывать', why: 'смешно' } };
    },
  };
  return s;
}

test('video waits until the copy finishes; other files are ignored', async () => {
  const studio = fakeStudio();
  const { inDir, make } = setup(studio);
  const inbox = make();
  writeFileSync(join(inDir, 'поссум.mp4'), 'a');
  writeFileSync(join(inDir, 'заметка.txt'), 'x');
  inbox.scan();
  assert.equal(inbox.list().length, 0, 'still copying at first glance');
  appendFileSync(join(inDir, 'поссум.mp4'), 'bb');
  inbox.scan();
  assert.equal(inbox.list().length, 0, 'size is changing — waiting');
  inbox.scan();
  await inbox.idle();
  const [job] = inbox.list();
  assert.equal(job.name, 'поссум.mp4');
  assert.equal(job.status, 'done');
  assert.equal(job.verdict, 'выкладывать');
  assert.ok(job.dir.endsWith('.готово'));
  assert.equal(studio.calls.length, 1);
});

test('editing one clip at a time', async () => {
  const studio = fakeStudio();
  const { inDir, make } = setup(studio);
  const inbox = make();
  for (const n of ['1.mp4', '2.MOV', '3.webm']) writeFileSync(join(inDir, n), n);
  inbox.scan(); inbox.scan();
  await inbox.idle();
  assert.equal(studio.calls.length, 3);
  assert.equal(studio.maxRunning, 1);
  assert.ok(inbox.list().every((j) => j.status === 'done'));
});

test('failure → clear error; "Redo" starts over', async () => {
  const studio = fakeStudio({ fails: 1 });
  const { inDir, make } = setup(studio);
  const inbox = make();
  writeFileSync(join(inDir, 'a.mp4'), 'a');
  inbox.scan(); inbox.scan();
  await inbox.idle();
  let [job] = inbox.list();
  assert.equal(job.status, 'error');
  assert.equal(job.error, 'сбой монтажа');
  inbox.redo(job.id);
  await inbox.idle();
  [job] = inbox.list();
  assert.equal(job.status, 'done');
  assert.equal(job.error, null);
});

test('after restart, finished items are not edited again, interrupted ones are finished', async () => {
  const studio = fakeStudio();
  const { inDir, statePath, make } = setup(studio);
  writeFileSync(join(inDir, 'old.mp4'), 'old');
  const first = make();
  first.scan(); first.scan();
  await first.idle();
  assert.equal(studio.calls.length, 1);

  // simulation: the app was closed in the middle of editing the second video
  writeFileSync(join(inDir, 'mid.mp4'), 'mid');
  const st = JSON.parse((await import('node:fs')).readFileSync(statePath, 'utf8'));
  st.jobs.push({ id: 'mid1', key: 'x', name: 'mid.mp4', src: join(inDir, 'mid.mp4'), status: 'working', step: 'Монтирую' });
  writeFileSync(statePath, JSON.stringify(st));

  const second = make();
  second.resume();
  await second.idle();
  second.scan(); second.scan();
  await second.idle();
  const names = studio.calls.map((c) => c.split(/[\\/]/).pop());
  assert.deepEqual(names, ['old.mp4', 'mid.mp4'], 'old was not repeated, mid was finished once');
});

test('changes are visible to the window via onChange', async () => {
  const studio = fakeStudio();
  const root = mkdtempSync(join(tmpdir(), 'possum-inbox-'));
  const seen = [];
  const inbox = createInbox({ inDir: join(root, 'in'), statePath: join(root, 's.json'), studio, stableMs: 0, onChange: (list) => seen.push(list.map((j) => j.status).join(',')) });
  writeFileSync(join(root, 'in', 'v.mp4'), 'v');
  inbox.scan(); inbox.scan();
  await inbox.idle();
  assert.ok(seen.includes('working'));
  assert.equal(seen.at(-1), 'done');
});

test('file is picked up only when unchanged for stableMs (by clock)', () => {
  const studio = fakeStudio();
  const { inDir, statePath } = setup(studio);
  let t = 1000;
  const inbox = createInbox({ inDir, statePath, studio, stableMs: 15_000, now: () => t });
  writeFileSync(join(inDir, 'долгий.mp4'), 'a');
  inbox.scan();
  t += 3000; inbox.scan();
  assert.equal(inbox.list().length, 0, 'after 3 s still too early');
  t += 13_000; inbox.scan();
  assert.equal(inbox.list().length, 1, 'after 16 s unchanged — into the queue');
});

test('while the file is being copied, it is visible in Inbox at once — not "Nothing yet"', () => {
  const studio = fakeStudio();
  const { inDir, statePath } = setup(studio);
  let t = 1000; let shown = [];
  const inbox = createInbox({ inDir, statePath, studio, stableMs: 15_000, now: () => t, onChange: (l) => { shown = l; } });
  writeFileSync(join(inDir, 'копия.mp4'), 'a');
  writeFileSync(join(inDir, 'заметка.txt'), 'x');
  inbox.scan();
  assert.equal(inbox.list().length, 0, 'still too early for the queue');
  assert.deepEqual(shown.map((j) => [j.name, j.status]), [['копия.mp4', 'copying']]);
  t += 16_000; inbox.scan();
  assert.ok(!shown.some((j) => j.status === 'copying'), 'copy finished — the "copying" entry disappeared');
  assert.equal(shown.filter((j) => j.name === 'копия.mp4').length, 1, 'no duplicate');
});

test('file removed from the folder before the copy finished — disappears from the list too', async () => {
  const studio = fakeStudio();
  const { inDir, statePath } = setup(studio);
  const { rmSync } = await import('node:fs');
  let shown = [];
  const inbox = createInbox({ inDir, statePath, studio, stableMs: 15_000, onChange: (l) => { shown = l; } });
  writeFileSync(join(inDir, 'передумал.mp4'), 'a');
  inbox.scan();
  assert.equal(shown.length, 1);
  rmSync(join(inDir, 'передумал.mp4'));
  inbox.scan();
  assert.equal(shown.length, 0);
});

test('corrupted queue file is saved as .bak, not silently lost', () => {
  const studio = fakeStudio();
  const { statePath, make } = setup(studio);
  writeFileSync(statePath, '{битый json');
  const inbox = make();
  assert.equal(inbox.list().length, 0);
  assert.ok(existsSync(`${statePath}.bak`));
  assert.equal(readFileSync(`${statePath}.bak`, 'utf8'), '{битый json');
});

test('batch: the whole queue goes to batch in one pass; errors and skips per file; result is saved', async () => {
  const { inDir, statePath, root } = setup(fakeStudio());
  const calls = []; const got = [];
  const batch = async (files, onProgress) => {
    calls.push(files.map((f) => basename(f)).sort());
    onProgress({ stage: 'разбор', i: 0, n: files.length, name: '1.mp4', eta: null });
    onProgress({ stage: 'монтаж', i: 0, n: 2, name: 'Топ-5', eta: 3 });
    return {
      files: [{ file: join(inDir, '1.mp4'), id: '1' }, { file: join(inDir, '3.mp4'), skipped: 'короче секунды — пропущен' }],
      errors: [{ file: '2.mp4', error: 'битый файл' }, { story: 'top5-x', error: 'ffmpeg упал' }],
      made: [{ id: 'day-1', kind: 'day' }], decisions: [{ type: 'publish', id: 'day-1', text: 'Выложить?' }], disk: 5e9,
    };
  };
  const inbox = createInbox({ inDir, statePath, studio: null, stableMs: 0, batch, onBatch: (r) => got.push(r) });
  for (const n of ['1.mp4', '2.mp4', '3.mp4']) writeFileSync(join(inDir, n), n);
  inbox.scan(); inbox.scan();
  await inbox.idle();
  assert.deepEqual(calls, [['1.mp4', '2.mp4', '3.mp4']], 'one pass for the whole batch');
  const by = Object.fromEntries(inbox.list().map((j) => [j.name, j]));
  assert.equal(by['1.mp4'].step, 'Разобран');
  assert.deepEqual([by['2.mp4'].status, by['2.mp4'].error], ['error', 'битый файл']);
  assert.equal(by['3.mp4'].step, 'короче секунды — пропущен');
  assert.ok(inbox.list().every((j) => !('eta' in j)));
  assert.equal(inbox.last().made.length, 1);
  assert.deepEqual(inbox.last().errors.map((e) => e.story), ['top5-x'], 'result has only editing errors');
  assert.equal(got.length, 1);
  const again = createInbox({ inDir, statePath, studio: null, stableMs: 0, batch });
  assert.equal(again.last().decisions[0].text, 'Выложить?', 'result survives restart');
  assert.ok(existsSync(join(root, '.jobs.json')));
});

test('whole batch failed — all files get a clear error, app stays alive', async () => {
  const { inDir, statePath } = setup(fakeStudio());
  const inbox = createInbox({ inDir, statePath, studio: null, stableMs: 0, batch: async () => { throw new Error('нет ffmpeg'); } });
  writeFileSync(join(inDir, 'a.mp4'), 'a');
  inbox.scan(); inbox.scan();
  await inbox.idle();
  assert.deepEqual(inbox.list().map((j) => [j.status, j.error]), [['error', 'нет ffmpeg']]);
});

test('build after marking the pet: result updates; batch video count and result survive restart', async () => {
  const { inDir, statePath } = setup(fakeStudio());
  const batch = async (files) => ({ files: files.map((f, i) => ({ file: f, id: String(i) })), errors: [], made: [], decisions: [{ type: 'confirm', clips: [], text: 'Отметьте' }] });
  const inbox = createInbox({ inDir, statePath, studio: null, stableMs: 0, batch });
  for (const n of ['a.mp4', 'b.mp4']) writeFileSync(join(inDir, n), n);
  inbox.scan(); inbox.scan();
  await inbox.idle();
  assert.equal(inbox.last().decisions[0].type, 'confirm');
  const l = inbox.setLast({ made: [{ id: 'day-1', kind: 'day' }], decisions: [{ type: 'publish', id: 'day-1', text: 'Выложить?' }], errors: [] });
  assert.equal(l.made.length, 1);
  assert.equal(l.n, 2, 'batch had two videos');
  assert.equal(l.decisions[0].type, 'publish', 'mark question was sent');
  const again = createInbox({ inDir, statePath, studio: null, stableMs: 0, batch });
  assert.equal(again.last().decisions[0].text, 'Выложить?');
  assert.equal(again.last().n, l.n);
});

test('foreign pet in batch: video marked "not taken", not "error" or "parsed"; notPet count in result', async () => {
  const { inDir, statePath } = setup(fakeStudio());
  const batch = async (files) => ({
    files: [{ file: join(inDir, 'a.mp4'), id: 'a' }, { file: join(inDir, 'b.mp4'), notPet: true }],
    errors: [], made: [], decisions: [],
  });
  const inbox = createInbox({ inDir, statePath, studio: null, stableMs: 0, batch });
  for (const n of ['a.mp4', 'b.mp4']) writeFileSync(join(inDir, n), n);
  inbox.scan(); inbox.scan();
  await inbox.idle();
  const by = Object.fromEntries(inbox.list().map((j) => [j.name, j]));
  assert.equal(by['b.mp4'].status, 'notpet');
  assert.equal(by['b.mp4'].error, null);
  assert.match(by['b.mp4'].step, /не ваш зверёк/);
  assert.notEqual(by['a.mp4'].status, 'notpet');
  assert.equal(inbox.last().notPet, 1);
});

test('publish dialog: default and Esc — "Cancel"; a stray Enter publishes nothing', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'app', 'main.js'), 'utf8');
  const m = src.match(/buttons:\s*\['Выложить',\s*'Отмена'\][^}]*/);
  assert.ok(m, 'publish dialog found');
  assert.match(m[0], /defaultId:\s*1/);
  assert.match(m[0], /cancelId:\s*1/);
});

test('reference → mark: step clips are summed; videos dropped by the model get "not taken" status with a reason', async () => {
  const { inDir, statePath } = setup(fakeStudio());
  const batch = async (files) => ({ files: files.map((f, i) => ({ file: f, id: String(i) })), errors: [], made: [], decisions: [{ type: 'reference', text: 'Покажите' }] });
  const inbox = createInbox({ inDir, statePath, studio: null, stableMs: 0, batch });
  for (const n of ['a.mp4', 'b.mp4', 'c.mp4']) writeFileSync(join(inDir, n), n);
  inbox.scan(); inbox.scan();
  await inbox.idle();
  const l1 = inbox.setLast({ made: [{ id: 'day-1' }], decisions: [{ type: 'confirm', clips: [{ id: 'c' }] }], errors: [], rejected: [{ name: 'b.mp4', why: 'зверька в кадре почти нет' }] });
  assert.equal(l1.notPet, 1);
  const b = inbox.list().find((j) => j.name === 'b.mp4');
  assert.equal(b.status, 'notpet');
  assert.match(b.step, /почти нет/);
  const l2 = inbox.setLast({ made: [], decisions: [], errors: [], rejected: [{ name: 'b.mp4', why: 'зверька в кадре почти нет' }, { name: 'c.mp4', why: null }] });
  assert.deepEqual(l2.made.map((m) => m.id), ['day-1'], 'step clip with reference was not lost');
  assert.equal(l2.notPet, 2);
  assert.deepEqual(l2.rejected.map((r) => r.name), ['b.mp4', 'c.mp4']);
  assert.equal(inbox.list().find((j) => j.name === 'c.mp4').status, 'notpet');
  const l3 = inbox.setLast({ made: [{ id: 'day-2' }], decisions: [], errors: [] });
  assert.deepEqual(l3.made.map((m) => m.id), ['day-2'], 'after a finished step the result does not accumulate');
});
