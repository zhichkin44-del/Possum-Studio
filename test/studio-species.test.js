// Studio and "my critter": reference once → recount of unmarked; "mine" teaches the model; the species in texts — only after "Yes".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudio } from '../core/studio.js';

const noMedia = { tools: { ffmpeg: 'ffmpeg' }, async signals() { throw new Error('не нужен'); } };

function fakeSpecies() {
  const s = {
    available: true, refsN: 0, learned: [], added: [],
    hasReference: () => s.refsN > 0,
    refCount: () => s.refsN,
    refs: () => [],
    async addReference(files) { s.added.push(...files); s.refsN += files.length; return { added: files.length, failed: [] }; },
    async judge() { return { verdict: 'unsure', score: null, animal: null }; },
    learn(id) { s.learned.push(id); return true; },
  };
  return s;
}

function world(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'possum-sp-'));
  const studio = createStudio({ path: join(root, 'cfg', 'settings.json'), dataRoot: join(root, 'data'), media: noMedia, ...over });
  return { root, studio };
}

test('without a model: status honestly says "recognition unavailable", no reference', () => {
  const { studio } = world({ clipModelDir: null });
  assert.deepEqual(studio.status().species, { available: false, refs: 0 });
});

test('without a reference the batch asks for pet photos; reference given — recount and assembly', async () => {
  const species = fakeSpecies();
  const { studio } = world({ species });
  assert.deepEqual(studio.status().species, { available: true, refs: 0 });
  const r0 = await studio.confirmPets({});
  assert.equal(r0.decisions[0]?.type, 'reference');
  const r = await studio.setReference(['a.jpg', 'b.jpg', 'c.mp4']);
  assert.equal(r.added, 3);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(species.added, ['a.jpg', 'b.jpg', 'c.mp4']);
  assert.ok(Array.isArray(r.decisions));
  assert.ok(!r.decisions.some((d) => d.type === 'reference'));
  assert.equal(studio.status().species.refs, 3);
});

test('empty reference — clear refusal', async () => {
  const { studio } = world({ species: fakeSpecies() });
  await assert.rejects(studio.setReference([]), /фото или видео/);
});

test('pet not visible in the photos — refusal in words, no reassembly and no error', async () => {
  const species = fakeSpecies();
  species.addReference = async () => ({ added: 0, found: 0, needMore: true, failed: [], noAnimal: 3 });
  let built = 0;
  const { studio } = world({ species });
  const r = await studio.setReference(['a.jpg', 'b.jpg', 'c.jpg'], () => { built++; });
  assert.equal(r.added, 0);
  assert.match(r.refused, /не видно зверька/);
  assert.equal(built, 0);
  assert.equal(r.decisions, undefined, 'batch was not reassembled');
});

test('pet visible in 2 of the 3 needed photos — asks for more and names the unreadable ones', async () => {
  const species = fakeSpecies();
  species.addReference = async () => ({ added: 0, found: 2, needMore: true, failed: [{ file: 'x.mp4', error: 'битый' }], noAnimal: 1 });
  const { studio } = world({ species });
  const r = await studio.setReference(['a.jpg', 'b.jpg', 'x.mp4']);
  assert.match(r.refused, /только на 2 снимках — нужно хотя бы 3/);
  assert.match(r.refused, /Не прочитались: x.mp4/);
});

test('"mine" in marks teaches the model, "not mine" does not', async () => {
  const species = fakeSpecies(); species.refsN = 1;
  const { studio } = world({ species });
  await studio.confirmPets({ v1: true, v2: false, v3: true });
  assert.deepEqual(species.learned, ['v1', 'v3']);
});

test('species: until confirmed — none; "Yes" saves, "Another animal" erases', () => {
  const { studio } = world({ species: fakeSpecies() });
  assert.equal(studio.masked().speciesName ?? null, null);
  studio.setSpecies({ ru: 'сахарный поссум', en: 'sugar glider', tag: 'сахарныйпоссум' });
  assert.equal(studio.masked().speciesName.ru, 'сахарный поссум');
  studio.setSpecies(null);
  assert.equal(studio.masked().speciesName, null);
  assert.throws(() => studio.setSpecies({ en: 'x' }), /вид/);
});

test('reference and marks result lists discarded videos with a reason', async () => {
  const species = fakeSpecies(); species.refsN = 1;
  const { studio } = world({ species });
  const lib = studio.library();
  lib.all = () => [{ id: 'x', name: 'x.mp4', pet: false, petWhy: 'зверька в кадре почти нет', shots: [] }, { id: 'y', name: 'y.mp4', pet: true, shots: [] }];
  const r = await studio.confirmPets({});
  assert.deepEqual(r.rejected, [{ id: 'x', name: 'x.mp4', why: 'зверька в кадре почти нет' }]);
  assert.equal(r.notPet, 1);
});
