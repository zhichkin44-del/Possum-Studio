// Этап 2, шаг 4: календарь выкладки — 1 ролик в день в 18:00, окно 14 дней.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalendar, dayKey } from '../core/calendar.js';

const at = (d, h) => new Date(2026, 10, d, h, 0, 0).getTime();

test('до 18:00 первый слот сегодня, после — завтра', () => {
  let t = at(15, 12);
  const cal = createCalendar({ now: () => t });
  assert.equal(cal.add({ id: 'a', kind: 'top5' }).day, '2026-11-15');
  t = at(15, 19);
  const cal2 = createCalendar({ now: () => t });
  assert.equal(cal2.add({ id: 'a', kind: 'top5' }).day, '2026-11-16');
  assert.equal(new Date(cal2.get('a').at).getHours(), 18);
});

test('один ролик в день, 14 дней; 15-й — null; повторный id не занимает второй день', () => {
  const cal = createCalendar({ now: () => at(15, 12) });
  assert.equal(cal.free(), 14);
  const days = new Set();
  for (let k = 0; k < 14; k++) days.add(cal.add({ id: `s${k}`, kind: 'day' }).day);
  assert.equal(days.size, 14);
  assert.equal(cal.free(), 0);
  assert.equal(cal.add({ id: 'extra', kind: 'day' }), null);
  assert.equal(cal.add({ id: 's3', kind: 'day' }).id, 's3');
  assert.equal(cal.all().length, 14);
});

test('«не выкладывать» освобождает день; выложено — уходит из due', () => {
  let t = at(15, 12);
  const cal = createCalendar({ now: () => t });
  cal.add({ id: 'a', kind: 'top5' }); cal.add({ id: 'b', kind: 'day' });
  cal.skip('a');
  assert.equal(cal.free(), 13);
  assert.equal(cal.add({ id: 'c', kind: 'asmr' }).day, '2026-11-15', 'занял освободившийся день');
  t = at(16, 19);
  assert.deepEqual(cal.due().map((s) => s.id).sort(), ['b', 'c']);
  cal.markPublished('c');
  assert.deepEqual(cal.due().map((s) => s.id), ['b']);
  assert.deepEqual(cal.history().map((h) => h.id), ['c', 'b']);
});

test('выбор заголовка A/B, чужие значения игнорируются', () => {
  const cal = createCalendar({ now: () => at(15, 12) });
  cal.add({ id: 'a', kind: 'top5' });
  assert.equal(cal.pickTitle('a', 'B').pick, 'B');
  assert.equal(cal.pickTitle('a', 'C'), null);
  assert.equal(cal.pickTitle('нет', 'A'), null);
});

test('сохраняется на диск и переживает перезапуск; битый файл — копия .bak, пустой календарь', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-cal-'));
  const path = join(dir, 'calendar.json');
  const now = () => at(15, 12);
  createCalendar({ path, now }).add({ id: 'a', kind: 'top5', dir: 'x' });
  assert.equal(createCalendar({ path, now }).get('a').kind, 'top5');
  writeFileSync(path, '{ сломано');
  const cal = createCalendar({ path, now });
  assert.equal(cal.all().length, 0);
  assert.ok(existsSync(`${path}.bak`));
});

test('dayKey по местному времени', () => {
  assert.equal(dayKey(at(5, 23)), '2026-11-05');
});

test('nextFree: первый свободный день до add; занятое окно — null', () => {
  const cal = createCalendar({ now: () => at(15, 12) });
  assert.equal(cal.nextFree(), '2026-11-15');
  assert.equal(cal.add({ id: 'a', kind: 'top5' }).day, '2026-11-15');
  assert.equal(cal.nextFree(), '2026-11-16');
  for (let k = 0; k < 13; k++) cal.add({ id: `s${k}`, kind: 'day' });
  assert.equal(cal.nextFree(), null);
});
