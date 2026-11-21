// Window and pair: the user sends a video, the owner edits it and sends the finished one back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairing } from '../core/pairing.js';
import { createHub } from '../app/hub.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'possum-hub-'));
  const shared = join(root, 'Общая');
  const ownerPair = createPairing({ sharedDir: shared, role: 'owner', stateDir: join(root, 'o') });
  const partnerPair = createPairing({ sharedDir: shared, role: 'partner', stateDir: join(root, 's') });
  const studio = (p, ran) => ({
    pairing: () => p,
    disk: () => 1e10,
    async runBatch(files, onProgress) {
      ran.push(files);
      onProgress({ stage: 'монтаж', i: 0, n: 1, name: 'День', eta: 1 });
      const dir = join(root, 'Готово', 'day-1'); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'video.mp4'), 'ролик'); writeFileSync(join(dir, 'пост.txt'), 'текст');
      return { files: files.map((f) => ({ file: f, id: 'x' })), errors: [], made: [{ id: 'day-1', kind: 'day', day: '2026-11-16', dir }], decisions: [], disk: 1e10 };
    },
  });
  return { root, shared, ownerPair, partnerPair, studio };
}

test('without a pair — normal editing, progress goes to the window', async () => {
  const { root, studio } = setup();
  const ran = []; const sent = [];
  const hub = createHub({ studio: studio(null, ran), inDir: join(root, 'in'), root, send: (k, v) => sent.push(k) });
  const r = await hub.batch(['a.mp4']);
  assert.equal(ran.length, 1);
  assert.equal(r.made.length, 1);
  assert.ok(sent.includes('progress'));
  assert.deepEqual(await hub.afterBatch(r), [], 'without a pair, sends to nobody');
  assert.deepEqual((await hub.poll()).got, []);
});

test('pair not completed (code not entered) — edits by itself, sends nothing', async () => {
  const { root, ownerPair, studio } = setup();
  ownerPair.create();
  const ran = [];
  const hub = createHub({ studio: studio(ownerPair, ran), inDir: join(root, 'in'), root });
  const r = await hub.batch(['a.mp4']);
  assert.equal(ran.length, 1);
  assert.deepEqual(await hub.afterBatch(r), []);
});

test('partner → editor → partner: video goes out, clip and text come back under clear names', async () => {
  const { root, ownerPair, partnerPair, studio } = setup();
  partnerPair.join(ownerPair.create().code);
  const ranPartner = []; const ranOwner = [];
  const partnerRoot = join(root, 'напарница'); const ownerIn = join(root, 'Монтажёр', 'Входящие');
  const partner = createHub({ studio: studio(partnerPair, ranPartner), inDir: join(partnerRoot, 'Входящие'), root: partnerRoot });
  const owner = createHub({ studio: studio(ownerPair, ranOwner), inDir: ownerIn, root: join(root, 'Монтажёр') });

  const src = join(root, 'поссум ночью.mp4'); writeFileSync(src, Buffer.alloc(2000, 3));
  const r = await partner.batch([src]);
  assert.equal(r.sent, true);
  assert.equal(ranPartner.length, 0, 'partner does not edit by itself');
  assert.deepEqual(r.made, []);

  const got = await owner.poll();
  assert.equal(got.got.length, 1);
  assert.deepEqual(readdirSync(ownerIn), ['поссум ночью.mp4']);

  const res = await owner.batch(got.got);
  assert.equal(ranOwner.length, 1);
  const out = await owner.afterBatch(res);
  assert.deepEqual(out.map((x) => x.name), ['2026-11-16_day.mp4', '2026-11-16_day.txt']);

  const back = await partner.poll();
  assert.equal(back.got.length, 2);
  const dest = join(partnerRoot, 'Готово', 'От монтажёра');
  assert.deepEqual(readdirSync(dest).sort(), ['2026-11-16_day.mp4', '2026-11-16_day.txt']);
  assert.equal(readFileSync(join(dest, '2026-11-16_day.txt'), 'utf8'), 'текст');
  assert.deepEqual(await partner.afterBatch(r), [], 'partner does not send finished items back');
});

test('broken pair setting does not crash the window', async () => {
  const { root, studio } = setup();
  const s = studio(null, []); s.pairing = () => { throw new Error('нет папки'); };
  const hub = createHub({ studio: s, inDir: join(root, 'in'), root });
  assert.deepEqual(await hub.poll(), { got: [], waiting: 0 });
  assert.equal(hub.role(), null);
});
