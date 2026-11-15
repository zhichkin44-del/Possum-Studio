// Листы кадров для зрителей-проверяльщиков: кадры по всей длине ролика, концовка обязательно видна.
// Раньше было 8 кадров с шагом 1,5 с — первые 10,5 с, концовку (в топ-5 там №1) зрители не видели.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerSheetTimes, viewerSheetArgs, videoSeconds, SHEET_FRAMES } from '../scripts/viewer-sheets.mjs';

const LENGTHS = [5, 10.5, 15, 15.3, 19.5, 30, 59.9];

test('лист ролика длиной N секунд содержит кадр из последних 10 % длины', () => {
  for (const sec of LENGTHS) {
    const t = viewerSheetTimes(sec);
    assert.ok(t.some((x) => x >= sec * 0.9 && x < sec), `${sec} с: нет кадра из последних 10 % (${t.join(', ')})`);
  }
});

test('последний кадр — сама концовка: не раньше чем за 0,3 с до конца', () => {
  for (const sec of [...LENGTHS, 2.5, 3]) {
    const last = viewerSheetTimes(sec).at(-1);
    assert.ok(last >= sec - 0.3 && last < sec, `${sec} с: последний кадр ${last} — концовка обрезана`);
  }
});

test('кадры идут по всей длине: первый в начале, промежутки ровные, последние 2 секунды покрыты', () => {
  for (const sec of LENGTHS) {
    const t = viewerSheetTimes(sec);
    assert.equal(t.length, SHEET_FRAMES);
    assert.deepEqual(t, [...t].sort((a, b) => a - b), 'по порядку');
    assert.equal(new Set(t).size, t.length, 'без повторов');
    assert.ok(t[0] <= 0.5, 'первый кадр — начало ролика');
    assert.ok(t.every((x) => x >= 0 && x < sec), 'все кадры внутри ролика');
    assert.ok(t.filter((x) => x >= sec - 2).length >= 2, `${sec} с: в последних 2 с меньше двух кадров`);
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    assert.ok(Math.max(...gaps) <= Math.max(sec / (SHEET_FRAMES - 3), 1) + 0.01, `${sec} с: дыра ${Math.max(...gaps).toFixed(2)} с`);
  }
});

test('длина ролика — по видеодорожке: если звук длиннее видео, последний кадр не уходит за конец картинки', () => {
  const probe = (fmt, vid) => ({ format: { duration: String(fmt) }, streams: [{ codec_type: 'audio', duration: String(fmt) }, { codec_type: 'video', duration: vid === undefined ? undefined : String(vid) }] });
  assert.equal(videoSeconds(probe(15.3, 15.266667)), 15.27);
  assert.equal(videoSeconds(probe(20.1, 19.5)), 19.5);
  assert.equal(videoSeconds(probe(19.5)), 19.5, 'нет длины у дорожки — берём длину файла');
});

test('ffmpeg: каждый кадр берётся по своему времени, на кадре подпись времени, сетка 4×3', () => {
  const args = viewerSheetArgs({ src: 'v.mp4', sec: 19.5, out: 's.jpg' });
  const ss = args.flatMap((a, i) => (a === '-ss' ? [Number(args[i + 1])] : []));
  assert.deepEqual(ss, viewerSheetTimes(19.5));
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /xstack=inputs=12/);
  assert.match(fc, /drawtext=[^;]*text='19\.4/, 'подпись последнего кадра — его время');
  assert.equal(args.at(-1), 's.jpg');
});
