// Приложение напарницы: папка «Входящие» → очередь → монтаж по одному. Видео подхватывается, когда файл докопирован.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('видео ждёт, пока докопируется; остальные файлы игнорируются', async () => {
  const studio = fakeStudio();
  const { inDir, make } = setup(studio);
  const inbox = make();
  writeFileSync(join(inDir, 'поссум.mp4'), 'a');
  writeFileSync(join(inDir, 'заметка.txt'), 'x');
  inbox.scan();
  assert.equal(inbox.list().length, 0, 'с первого взгляда ещё копируется');
  appendFileSync(join(inDir, 'поссум.mp4'), 'bb');
  inbox.scan();
  assert.equal(inbox.list().length, 0, 'размер меняется — ждём');
  inbox.scan();
  await inbox.idle();
  const [job] = inbox.list();
  assert.equal(job.name, 'поссум.mp4');
  assert.equal(job.status, 'done');
  assert.equal(job.verdict, 'выкладывать');
  assert.ok(job.dir.endsWith('.готово'));
  assert.equal(studio.calls.length, 1);
});

test('монтаж по одному ролику за раз', async () => {
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

test('сбой → понятная ошибка; «Переделать» запускает заново', async () => {
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

test('после перезапуска готовое не монтируется снова, прерванное — доделывается', async () => {
  const studio = fakeStudio();
  const { inDir, statePath, make } = setup(studio);
  writeFileSync(join(inDir, 'old.mp4'), 'old');
  const first = make();
  first.scan(); first.scan();
  await first.idle();
  assert.equal(studio.calls.length, 1);

  // имитация: приложение закрыли посреди монтажа второго ролика
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
  assert.deepEqual(names, ['old.mp4', 'mid.mp4'], 'old не повторился, mid доделан один раз');
});

test('изменения видны окну через onChange', async () => {
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

test('файл берётся, только когда не менялся stableMs (по часам)', () => {
  const studio = fakeStudio();
  const { inDir, statePath } = setup(studio);
  let t = 1000;
  const inbox = createInbox({ inDir, statePath, studio, stableMs: 15_000, now: () => t });
  writeFileSync(join(inDir, 'долгий.mp4'), 'a');
  inbox.scan();
  t += 3000; inbox.scan();
  assert.equal(inbox.list().length, 0, 'через 3 с ещё рано');
  t += 13_000; inbox.scan();
  assert.equal(inbox.list().length, 1, 'через 16 с без изменений — в очередь');
});

test('испорченный файл очереди сохраняется как .bak, а не теряется молча', () => {
  const studio = fakeStudio();
  const { statePath, make } = setup(studio);
  writeFileSync(statePath, '{битый json');
  const inbox = make();
  assert.equal(inbox.list().length, 0);
  assert.ok(existsSync(`${statePath}.bak`));
  assert.equal(readFileSync(`${statePath}.bak`, 'utf8'), '{битый json');
});
