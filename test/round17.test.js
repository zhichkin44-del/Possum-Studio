// Round 17 (director's remark on 0128): the animal in a fist is almost not visible — the video is confirmed as "your critter",
// but we take no pieces from it; a refusal with the hint "the animal is not visible, reshoot 2–3 s at the face".
// 0120 and 0129 (the animal is visible, held in the palm) stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiddenShare, createPrivacy } from '../core/privacy.js';
import { petFate, reshootText } from '../core/producer.js';
import { createLibrary } from '../core/library.js';

const nrm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
// labels: 0 — bare hand, 1 — animal in the palm, 2 — cigarette
const P = { labels: ['a human hand', 'a person holding a small animal', 'cigarette'], kind: ['рука', 'рука', 'сигарета'], vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], scale: 10 };
const H = { labels: ['a human hand'], threshold: 0.2, share: 0.45 };
const palm = nrm([0.2, 1, 0]);   // the animal in the palm is visible
const fist = nrm([1, 0.5, 0]);   // fist: more bare hand
const film = (f, n = 20) => Array.from({ length: n }, (_, k) => k * 0.5).map((t) => ({ t, v: f(t) }));

test('share of moments where only a hand is visible: fist for the whole clip — almost 1, palm with a pet — 0', () => {
  assert.equal(hiddenShare(film(() => palm), P, H), 0);
  assert.ok(hiddenShare(film(() => fist), P, H) > 0.9);
  const half = hiddenShare(film((t) => (t < 5 ? fist : palm)), P, H);
  assert.ok(half > 0.4 && half < 0.6, String(half));
  assert.equal(hiddenShare([], P, H), 0);
  assert.equal(hiddenShare(film(() => fist), P, { ...H, labels: ['нет такой подписи'] }), 0);
});

test('in settings — the "pet not visible" rule', () => {
  const p = JSON.parse(readFileSync(new URL('../core/clip-labels.json', import.meta.url), 'utf8')).privacy;
  assert.ok(p.hidden?.labels?.length >= 2 && p.hidden.labels.every((l) => p.labels.includes(l)));
  assert.ok(p.hidden.share > 0.3 && p.hidden.share < 0.7);
});

test('createPrivacy: scan returns hidden only for a fist', async () => {
  const mk = (f) => createPrivacy({ embedder: { available: true, embedAt: async () => film(f) }, labels: { ...P, passes: [{ kind: 'сигарета', grid: 1, threshold: 0.9, minRun: 2 }], moment: { grid: 1, step: 0.5, len: 2 }, hidden: H } });
  const a = await mk(() => fist).scan('a.mov');
  assert.equal(a.hidden?.hidden, true);
  const b = await mk(() => palm).scan('b.mov');
  assert.equal(b.hidden?.hidden, false);
});

const shot = (from, len) => ({ from, len, best: { t: from + 1, kind: 'move', score: 1 }, peaks: [], labels: ['движение'], defects: [], score: 0.8, why: 'движение' });

test('confirmed video where the pet is not visible: no pieces, refusal with a hint; a repeat does not multiply defects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r17-'));
  try {
    const lib = createLibrary({ path: join(dir, 'lib.json'), baseDir: dir });
    for (const id of ['k', 'p']) {
      lib.ingest(join(dir, id + '.mov'), { info: { duration: 14, width: 1080, height: 1920 }, shots: [] }, { id });
      lib.get(id).shots = [shot(0, 7), shot(7, 7)];
    }
    const hk = [0, 1, 2].map((t) => ({ t, kind: null })); hk.hidden = { share: 0.6, hidden: true };
    const hp = [0, 1, 2].map((t) => ({ t, kind: null })); hp.hidden = { share: 0, hidden: false };
    lib.setPrivacy('k', hk); lib.setPrivacy('k', hk);
    lib.setPrivacy('p', hp);
    lib.setPet('k', true); lib.setPet('p', true);
    const k = lib.get('k');
    assert.ok(k.shots.every((s) => s.defects.filter((d) => d === 'нет зверька').length === 1));
    assert.ok(lib.get('p').shots.every((s) => !s.defects.length));
    const f = petFate({ ...k, name: 'IMG_0128.MOV', used: [] }, []);
    assert.match(f.text, /^IMG_0128: .*зверька не видно, переснимите 2–3 с у мордочки/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('batch: a video where the pet is not visible gets a separate "reshoot" line in the result, even without a human mark', () => {
  const hidden = { id: 'k', name: 'IMG_0128.MOV', pet: true, privacy: { hidden: { share: 0.54, hidden: true } }, used: [], shots: [{ defects: ['нет зверька'] }] };
  const ok = { id: 'p', name: 'IMG_0129.MOV', pet: true, privacy: { hidden: { share: 0, hidden: false } }, used: [], shots: [{ defects: [] }] };
  const notPet = { ...hidden, id: 'x', name: 'IMG_0119.MOV', pet: false };
  assert.deepEqual(reshootText([hidden, ok, notPet]), ['IMG_0128: зверька не видно, переснимите 2–3 с у мордочки — в ролики не взято']);
  assert.deepEqual(reshootText([ok]), []);
  for (const t of reshootText([hidden])) assert.doesNotMatch(t, /повтор|включите свет|вспышк/i);
  const ui = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
  assert.match(ui, /'reshoot'/, 'the window shows the "reshoot" line');
});
