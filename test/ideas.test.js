// "Ideas and tips" catalog: every idea is safe for the critter and fits a studio story.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDEAS, CATEGORIES, SAFE_TREATS, FORBIDDEN, NO_COSTUME, POSTING, catalog, ideasFor } from '../core/ideas.js';
import { LIGHT } from '../core/director.js';
import { KINDS } from '../core/stories.js';

const BANNED = /вспышк|бел(ый|ого|ом) свет|включ\p{L}* свет|ярк\p{L}* свет|по имени/iu;
const COSTUME = /одежд|костюм|наряд|одеть|одева|надеть|шапочк|шлейк|поводок|свитер|платьиц/i;
const hasForbidden = (t) => FORBIDDEN.some(([root]) => new RegExp(`(?<![\\p{L}])${root}`, 'iu').test(t));

test('every idea is complete: category, story type, shots with studio light, publishing, better/worse, welfare', () => {
  const cats = new Set(CATEGORIES.map(([id]) => id));
  const ids = new Set();
  assert.ok(IDEAS.length >= 12);
  for (const i of IDEAS) {
    assert.ok(!ids.has(i.id), `duplicate id ${i.id}`); ids.add(i.id);
    assert.ok(cats.has(i.cat), `${i.id}: category ${i.cat}`);
    assert.ok(KINDS.includes(i.kind), `${i.id}: type ${i.kind}`);
    assert.ok(i.title && i.hook && i.why && i.welfare, i.id);
    assert.ok(i.shots.length >= (i.cat === 'archive' ? 1 : 3), `${i.id}: too few shots`); // the archive is built from what is already shot
    for (const s of i.shots) { assert.equal(s.light, LIGHT); assert.ok(s.what && s.angle && /\d/.test(s.secs), i.id); }
    assert.ok(i.how.length && i.better.length && i.worse.length, i.id);
    assert.ok(i.post.caption && i.post.format, i.id);
  }
});

test('tips contain no flash, bright light, clothing or forbidden food', () => {
  for (const i of IDEAS) {
    const advice = [i.title, i.hook, ...i.shots.map((s) => s.what), ...i.how, ...i.better, i.post.caption].join('\n');
    assert.ok(!BANNED.test(advice), `${i.id}: light`);
    assert.ok(!COSTUME.test([i.title, i.hook, ...i.shots.map((s) => s.what)].join('\n')), `${i.id}: clothing`);
    // the "how to shoot" section has warnings ("hot tea — keep away"), so we do not search there
    assert.ok(!hasForbidden([i.title, i.hook, ...i.shots.map((s) => s.what)].join('\n')), `${i.id}: forbidden food`);
  }
  for (const t of SAFE_TREATS) assert.ok(!hasForbidden(t), `in the safe list: ${t}`);
});

test('the "do not dress up" card and publishing rules are in place; whole catalog for the window', () => {
  assert.equal(NO_COSTUME.instead.length, 3);
  for (const p of POSTING) assert.ok(p.title && p.better && p.worse);
  const c = catalog();
  assert.equal(c.ideas.length, IDEAS.length);
  assert.ok(c.forbidden.includes('шоколад') || c.forbidden.some((x) => /шоколад/.test(x)));
  assert.ok(ideasFor('day').every((i) => i.kind === 'day'));
});
