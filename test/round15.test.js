// Круг 15: «Это мой зверёк» — итог говорит, что стало с видео (вошло в ролик или почему нет) и сколько роликов уже в календаре.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { petFate } from '../core/producer.js';

const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
const st = readFileSync(new URL('../core/studio.js', import.meta.url), 'utf8');

const dark = { id: 'sg', name: 'Sugarglider.mp4', night: false, used: [], shots: [{ defects: ['чёрный'], luma: 7, labels: [] }, { defects: ['чёрный'], luma: 6, labels: [] }] };

test('взятое видео без кусков в ролике: причина «слишком темно», «в ролик не вошло»', () => {
  const f = petFate(dark, []);
  assert.equal(f.name, 'Sugarglider.mp4');
  assert.equal(f.inClip, false);
  assert.match(f.text, /^Sugarglider: ваш зверёк, но кадры слишком тёмные — в ролик не вошло$/);
  assert.doesNotMatch(f.text, /повтор|включите свет|вспышк/i);
});

test('взятое видео, куски которого в новом ролике: «вошло в ролик»', () => {
  const c = { ...dark, used: [{ shot: 0, story: 's1', at: 1 }] };
  const f = petFate(c, ['s1']);
  assert.equal(f.inClip, true);
  assert.match(f.text, /^Sugarglider: ваш зверёк — вошло в ролик$/);
  assert.equal(petFate(c, ['other']).inClip, false, 'старый ролик не считается');
  assert.equal(petFate(null, []), null);
});

test('студия: confirmPets возвращает судьбу отмеченных и сколько роликов в календаре', () => {
  const body = st.slice(st.indexOf('async function confirmPets'), st.indexOf('async function setReference'));
  assert.match(body, /r\.confirmed = /);
  assert.match(body, /petFate\(/);
  assert.match(body, /r\.queued = /);
});

test('итог: строки по взятым видео и «в календаре уже N», кнопка «В календарь», если там есть ролики', () => {
  const last = app.slice(app.indexOf('function renderLast'), app.indexOf('function renderReference'));
  assert.match(last, /l\.confirmed/);
  assert.match(last, /В календаре уже/);
  assert.match(last, /queued/);
  assert.match(last, /made\.length \|\| l\.queued/);
});

test('итог «Это мой зверёк» доходит до окна: setLast не теряет confirmed и queued', async () => {
  const { mkdtempSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createInbox } = await import('../app/inbox.js');
  const root = mkdtempSync(join(tmpdir(), 'possum-r15-'));
  const inDir = join(root, 'Входящие'); mkdirSync(inDir, { recursive: true });
  const inbox = createInbox({ inDir, statePath: join(root, '.jobs.json'), studio: { async process() { return {}; } }, stableMs: 0 });
  const l = inbox.setLast({ made: [], decisions: [], errors: [], confirmed: [{ name: 'Sugarglider.mp4', inClip: false, text: 'Sugarglider: ваш зверёк, но кадры слишком тёмные — в ролик не вошло' }], queued: 1 });
  assert.equal(l.confirmed.length, 1);
  assert.match(l.confirmed[0].text, /в ролик не вошло/);
  assert.equal(l.queued, 1);
  const l2 = inbox.setLast({ made: [], decisions: [], errors: [] });
  assert.deepEqual(l2.confirmed, []);
  assert.equal(l2.queued, null);
});

test('годные куски есть, но не вошло: причина не «почти не попадает в кадр», а названная', () => {
  const c = { id: 'c', name: 'IMG_0120.MOV', night: false, used: [], shots: [{ defects: [], luma: 90, labels: ['движение'] }] };
  const f = petFate(c, [], 'виды «Топ-5» и «Серия» уже были на этой неделе');
  assert.equal(f.inClip, false);
  assert.doesNotMatch(f.text, /почти не попадает|не видно|тёмные/);
  assert.match(f.text, /^IMG_0120: ваш зверёк, но в ролик не вошло — виды «Топ-5» и «Серия» уже были на этой неделе$/);
  assert.match(petFate(c, []).text, /в ролик не вошло — /, 'без причины — всё равно не «не попадает в кадр»');
  assert.doesNotMatch(petFate(c, []).text, /почти не попадает|не видно/);
});
