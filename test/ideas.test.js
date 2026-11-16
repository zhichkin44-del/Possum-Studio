// Каталог «Идеи и советы»: каждая идея безопасна для зверька и годится для сюжета студии.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDEAS, CATEGORIES, SAFE_TREATS, FORBIDDEN, NO_COSTUME, POSTING, catalog, ideasFor } from '../core/ideas.js';
import { LIGHT } from '../core/director.js';
import { KINDS } from '../core/stories.js';

const BANNED = /вспышк|бел(ый|ого|ом) свет|включ\p{L}* свет|ярк\p{L}* свет|по имени/iu;
const COSTUME = /одежд|костюм|наряд|одеть|одева|надеть|шапочк|шлейк|поводок|свитер|платьиц/i;
const hasForbidden = (t) => FORBIDDEN.some(([root]) => new RegExp(`(?<![\\p{L}])${root}`, 'iu').test(t));

test('каждая идея полная: категория, тип сюжета, кадры со светом студии, выкладка, лучше/хуже, благополучие', () => {
  const cats = new Set(CATEGORIES.map(([id]) => id));
  const ids = new Set();
  assert.ok(IDEAS.length >= 12);
  for (const i of IDEAS) {
    assert.ok(!ids.has(i.id), `повтор id ${i.id}`); ids.add(i.id);
    assert.ok(cats.has(i.cat), `${i.id}: категория ${i.cat}`);
    assert.ok(KINDS.includes(i.kind), `${i.id}: тип ${i.kind}`);
    assert.ok(i.title && i.hook && i.why && i.welfare, i.id);
    assert.ok(i.shots.length >= (i.cat === 'archive' ? 1 : 3), `${i.id}: мало кадров`); // архив собирается из уже снятого
    for (const s of i.shots) { assert.equal(s.light, LIGHT); assert.ok(s.what && s.angle && /\d/.test(s.secs), i.id); }
    assert.ok(i.how.length && i.better.length && i.worse.length, i.id);
    assert.ok(i.post.caption && i.post.format, i.id);
  }
});

test('в советах нет вспышки, яркого света, одежды и запретной еды', () => {
  for (const i of IDEAS) {
    const advice = [i.title, i.hook, ...i.shots.map((s) => s.what), ...i.how, ...i.better, i.post.caption].join('\n');
    assert.ok(!BANNED.test(advice), `${i.id}: свет`);
    assert.ok(!COSTUME.test([i.title, i.hook, ...i.shots.map((s) => s.what)].join('\n')), `${i.id}: одежда`);
    // в «как снимать» бывают предупреждения («горячий чай — далеко»), поэтому там не ищем
    assert.ok(!hasForbidden([i.title, i.hook, ...i.shots.map((s) => s.what)].join('\n')), `${i.id}: запретная еда`);
  }
  for (const t of SAFE_TREATS) assert.ok(!hasForbidden(t), `в безопасном списке: ${t}`);
});

test('карточка «нельзя наряжать» и правила выкладки на месте; каталог для окна целиком', () => {
  assert.equal(NO_COSTUME.instead.length, 3);
  for (const p of POSTING) assert.ok(p.title && p.better && p.worse);
  const c = catalog();
  assert.equal(c.ideas.length, IDEAS.length);
  assert.ok(c.forbidden.includes('шоколад') || c.forbidden.some((x) => /шоколад/.test(x)));
  assert.ok(ideasFor('day').every((i) => i.kind === 'day'));
});
