// Stage 2, step 4: the "owner ↔ user" pair via a shared folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairing, MAX_TRIES, safeName } from '../core/pairing.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'possum-pair-'));
  let t = 1_000_000;
  const now = () => t;
  const shared = join(root, 'Общая');
  const owner = createPairing({ sharedDir: shared, role: 'owner', stateDir: join(root, 'o'), now });
  const partner = createPairing({ sharedDir: shared, role: 'partner', stateDir: join(root, 's'), now });
  return { root, shared, owner, partner, tick: (ms) => { t += ms; } };
}

test('6-digit code; only a salted hash in the shared folder', () => {
  const { owner, shared } = setup();
  const { code } = owner.create();
  assert.match(code, /^\d{6}$/);
  const raw = readFileSync(join(shared, 'pair.json'), 'utf8');
  assert.ok(!raw.includes(code), 'no code in plain text');
  assert.equal(owner.status().paired, false);
  assert.equal(owner.status().waiting, true);
});

test('partner enters the code → pair; wrong code — clear error and attempt counter', () => {
  const { owner, partner } = setup();
  const { code } = owner.create();
  const wrong = code === '000000' ? '111111' : '000000';
  assert.throws(() => partner.join(wrong), /Код не подходит \(осталось попыток: 4\)/);
  partner.join(` ${code} `);
  assert.equal(partner.status().paired, true);
  assert.equal(owner.status().paired, true);
  assert.throws(() => partner.join(code), /уже создана/);
});

test('five wrong attempts — the code burns out', () => {
  const { owner, partner } = setup();
  const { code } = owner.create();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let k = 0; k < MAX_TRIES; k++) assert.throws(() => partner.join(wrong), /Код не подходит/);
  assert.throws(() => partner.join(code), /Слишком много попыток/);
});

test('code lives 24 hours', () => {
  const { owner, partner, tick } = setup();
  const { code } = owner.create();
  tick(24 * 3600 * 1000 + 1);
  assert.throws(() => partner.join(code), /устарел/);
});

test('roles: only the editor creates the code, only the partner enters it; without a pair send is forbidden', async () => {
  const { owner, partner, root } = setup();
  assert.throws(() => partner.create(), /монтажёр/);
  owner.create();
  assert.throws(() => owner.join('123456'), /напарница/);
  const f = join(root, 'v.mp4'); writeFileSync(f, 'abc');
  await assert.rejects(partner.send(f), /соедините/);
});

test('partner → editor: file arrives whole, not picked up again; each writes only to their own mailbox', async () => {
  const { owner, partner, root, shared } = setup();
  partner.join(owner.create().code);
  const f = join(root, 'видео 1.mp4'.split('\\').pop()); writeFileSync(f, Buffer.alloc(50_000, 7));
  const sent = await partner.send(f);
  assert.equal(sent.name, 'видео 1.mp4');
  assert.deepEqual(readdirSync(shared).sort(), ['pair.json', 'partner']);
  const meta = JSON.parse(readFileSync(join(shared, 'partner', `${sent.stored}.meta.json`), 'utf8'));
  assert.deepEqual(Object.keys(meta).sort(), ['at', 'name', 'sha256', 'size', 'stored']);
  assert.ok(!JSON.stringify(meta).includes(root), 'no full path');
  const dest = join(root, 'Входящие');
  const r = await owner.receive(dest);
  assert.equal(r.got.length, 1);
  assert.equal(readFileSync(r.got[0]).length, 50_000);
  assert.equal((await owner.receive(dest)).got.length, 0, 'does not pick up a second time');
  await partner.send(f);
  assert.equal(readdirSync(join(shared, 'partner')).length, 2, 'the same file is not copied a second time');
});

test('incompletely copied file (size mismatch) waits, then is picked up', async () => {
  const { owner, partner, root, shared } = setup();
  partner.join(owner.create().code);
  const f = join(root, 'a.mp4'); writeFileSync(f, Buffer.alloc(10_000, 1));
  const { stored } = await partner.send(f);
  const boxFile = join(shared, 'partner', stored);
  truncateSync(boxFile, 5000);
  const dest = join(root, 'in');
  const r = await owner.receive(dest);
  assert.deepEqual([r.got.length, r.waiting], [0, 1]);
  writeFileSync(boxFile, Buffer.alloc(10_000, 1));
  assert.equal((await owner.receive(dest)).got.length, 1);
  assert.ok(!readdirSync(dest).some((x) => x.endsWith('.part')));
});

test('Editor → partner: finished clip; identical names do not overwrite each other', async () => {
  const { owner, partner, root } = setup();
  partner.join(owner.create().code);
  const a = join(root, 'x1'); const b = join(root, 'x2');
  writeFileSync(a, 'one'); writeFileSync(b, 'two');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(root, 'd1')); mkdirSync(join(root, 'd2'));
  writeFileSync(join(root, 'd1', 'video.mp4'), 'one'); writeFileSync(join(root, 'd2', 'video.mp4'), 'two');
  await owner.send(join(root, 'd1', 'video.mp4'));
  await owner.send(join(root, 'd2', 'video.mp4'));
  const r = await partner.receive(join(root, 'Готово'));
  assert.equal(r.got.length, 2);
  assert.deepEqual(r.got.map((g) => readFileSync(g, 'utf8')).sort(), ['one', 'two']);
  assert.ok(existsSync(r.got[0]) && existsSync(r.got[1]));
});

test('safeName strips the path and dangerous characters', () => {
  assert.equal(safeName('C:\\a\\b:c?.mp4'.replace(/\\/g, '/')), 'b_c_.mp4');
  assert.equal(safeName('../../x.mp4'), 'x.mp4');
});

test('send with a name: partner gets the clip under a clear name, not video.mp4', async () => {
  const { owner, partner, root } = setup();
  partner.join(owner.create().code);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(root, 'p')); writeFileSync(join(root, 'p', 'video.mp4'), 'ролик');
  const sent = await owner.send(join(root, 'p', 'video.mp4'), { name: '2026-11-16_top5.mp4' });
  assert.equal(sent.name, '2026-11-16_top5.mp4');
  const r = await partner.receive(join(root, 'Готово'));
  assert.ok(r.got[0].endsWith('2026-11-16_top5.mp4'));
  assert.equal((await owner.send(join(root, 'p', 'video.mp4'), { name: '../../evil:.mp4' })).name, 'evil_.mp4');
});
