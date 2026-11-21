// Round 15: "This is my critter" — the summary says what happened to the video (went into the video or why not) and how many videos are already in the calendar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { petFate } from '../core/producer.js';

const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
const st = readFileSync(new URL('../core/studio.js', import.meta.url), 'utf8');

const dark = { id: 'sg', name: 'Sugarglider.mp4', night: false, used: [], shots: [{ defects: ['чёрный'], luma: 7, labels: [] }, { defects: ['чёрный'], luma: 6, labels: [] }] };

test('taken video with no pieces in the clip: reason "too dark", "not in the clip"', () => {
  const f = petFate(dark, []);
  assert.equal(f.name, 'Sugarglider.mp4');
  assert.equal(f.inClip, false);
  assert.match(f.text, /^Sugarglider: ваш зверёк, но кадры слишком тёмные — в ролик не вошло$/);
  assert.doesNotMatch(f.text, /повтор|включите свет|вспышк/i);
});

test('taken video whose pieces are in the new clip: "in the clip"', () => {
  const c = { ...dark, used: [{ shot: 0, story: 's1', at: 1 }] };
  const f = petFate(c, ['s1']);
  assert.equal(f.inClip, true);
  assert.match(f.text, /^Sugarglider: ваш зверёк — вошло в ролик$/);
  assert.equal(petFate(c, ['other']).inClip, false, 'old clip does not count');
  assert.equal(petFate(null, []), null);
});

test('studio: confirmPets returns the fate of marked ones and how many clips are in the calendar', () => {
  const body = st.slice(st.indexOf('async function confirmPets'), st.indexOf('async function setReference'));
  assert.match(body, /r\.confirmed = /);
  assert.match(body, /petFate\(/);
  assert.match(body, /r\.queued = /);
});

test('result: rows per taken video and "already N in calendar", "To calendar" button if there are clips', () => {
  const last = app.slice(app.indexOf('function renderLast'), app.indexOf('function renderReference'));
  assert.match(last, /l\.confirmed/);
  assert.match(last, /В календаре уже/);
  assert.match(last, /queued/);
  assert.match(last, /made\.length \|\| l\.queued/);
});

test('result "This is my pet" reaches the window: setLast does not lose confirmed and queued', async () => {
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

test('usable pieces exist but were not included: the reason is named, not "barely in frame"', () => {
  const c = { id: 'c', name: 'IMG_0120.MOV', night: false, used: [], shots: [{ defects: [], luma: 90, labels: ['движение'] }] };
  const f = petFate(c, [], 'виды «Топ-5» и «Серия» уже были на этой неделе');
  assert.equal(f.inClip, false);
  assert.doesNotMatch(f.text, /почти не попадает|не видно|тёмные/);
  assert.match(f.text, /^IMG_0120: ваш зверёк, но в ролик не вошло — виды «Топ-5» и «Серия» уже были на этой неделе$/);
  assert.match(petFate(c, []).text, /в ролик не вошло — /, 'without a reason — still not "not in frame"');
  assert.doesNotMatch(petFate(c, []).text, /почти не попадает|не видно/);
});
