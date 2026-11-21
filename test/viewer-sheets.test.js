// Frame sheets for the viewer-reviewers: frames across the whole length of the video, the ending must be visible.
// Before it was 8 frames at a 1.5 s step — the first 10.5 s; the viewers did not see the ending (No. 1 in the top 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerSheetTimes, viewerSheetArgs, videoSeconds, SHEET_FRAMES } from '../scripts/viewer-sheets.mjs';

const LENGTHS = [5, 10.5, 15, 15.3, 19.5, 30, 59.9];

test('a clip sheet of N seconds contains a frame from the last 10% of its length', () => {
  for (const sec of LENGTHS) {
    const t = viewerSheetTimes(sec);
    assert.ok(t.some((x) => x >= sec * 0.9 && x < sec), `${sec} с: нет кадра из последних 10 % (${t.join(', ')})`);
  }
});

test('the last frame is the actual ending: no earlier than 0.3 s before the end', () => {
  for (const sec of [...LENGTHS, 2.5, 3]) {
    const last = viewerSheetTimes(sec).at(-1);
    assert.ok(last >= sec - 0.3 && last < sec, `${sec} s: last frame ${last} — ending is cut off`);
  }
});

test('frames span the whole length: first at the start, even gaps, last 2 seconds covered', () => {
  for (const sec of LENGTHS) {
    const t = viewerSheetTimes(sec);
    assert.equal(t.length, SHEET_FRAMES);
    assert.deepEqual(t, [...t].sort((a, b) => a - b), 'in order');
    assert.equal(new Set(t).size, t.length, 'no repeats');
    assert.ok(t[0] <= 0.5, 'first frame is the start of the clip');
    assert.ok(t.every((x) => x >= 0 && x < sec), 'all frames are inside the clip');
    assert.ok(t.filter((x) => x >= sec - 2).length >= 2, `${sec} s: fewer than two frames in the last 2 s`);
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    assert.ok(Math.max(...gaps) <= Math.max(sec / (SHEET_FRAMES - 3), 1) + 0.01, `${sec} s: gap ${Math.max(...gaps).toFixed(2)} s`);
  }
});

test('clip length is taken from the video track: if the sound is longer than the video, the last frame does not go past the end of the picture', () => {
  const probe = (fmt, vid) => ({ format: { duration: String(fmt) }, streams: [{ codec_type: 'audio', duration: String(fmt) }, { codec_type: 'video', duration: vid === undefined ? undefined : String(vid) }] });
  assert.equal(videoSeconds(probe(15.3, 15.266667)), 15.27);
  assert.equal(videoSeconds(probe(20.1, 19.5)), 19.5);
  assert.equal(videoSeconds(probe(19.5)), 19.5, 'no track duration — use the file length');
});

test('ffmpeg: each frame is taken at its own time, the frame has a time caption, grid 4×3', () => {
  const args = viewerSheetArgs({ src: 'v.mp4', sec: 19.5, out: 's.jpg' });
  const ss = args.flatMap((a, i) => (a === '-ss' ? [Number(args[i + 1])] : []));
  assert.deepEqual(ss, viewerSheetTimes(19.5));
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /xstack=inputs=12/);
  assert.match(fc, /drawtext=[^;]*text='19\.4/, 'last frame caption — its time');
  assert.equal(args.at(-1), 's.jpg');
});
