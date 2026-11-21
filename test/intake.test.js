// Drag-and-drop into "Inbox": files and folders, videos only, no overwriting, with copy progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { collectVideos, copyVideos } from '../app/intake.js';

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'possum-intake-'));
  const src = join(root, 'видео'); mkdirSync(join(src, 'ночь'), { recursive: true });
  mkdirSync(join(src, '_proof')); mkdirSync(join(src, 'out'));
  writeFileSync(join(src, 'IMG_0123.MOV'), 'a'.repeat(1000));
  writeFileSync(join(src, 'ночь', 'IMG_0129.mov'), 'b'.repeat(500));
  writeFileSync(join(src, '_kadry.jpg'), 'jpg');
  writeFileSync(join(src, '_proof', 'x.mp4'), 'служебное');
  writeFileSync(join(src, 'out', 'top5.mp4'), 'готовый ролик');
  writeFileSync(join(root, 'single.mp4'), 'c'.repeat(10));
  const inDir = join(root, 'Входящие'); mkdirSync(inDir);
  return { root, src, inDir };
}

test('folder expands into videos, nested ones too; images, service _folders and out are skipped', () => {
  const { root, src } = tree();
  const got = collectVideos([src, join(root, 'single.mp4'), join(root, 'нет-такого.mp4')]).map((f) => basename(f)).sort();
  assert.deepEqual(got, ['IMG_0123.MOV', 'IMG_0129.mov', 'single.mp4']);
});

test('copying: progress by files and bytes, names are not overwritten, repeated drop does not duplicate', async () => {
  const { src, inDir } = tree();
  writeFileSync(join(inDir, 'IMG_0123.MOV'), 'другое видео с тем же именем');
  const seen = [];
  const r = await copyVideos(collectVideos([src]), inDir, (p) => seen.push(p));
  assert.equal(r.copied, 2);
  assert.equal(seen.at(-1).done, 2);
  assert.equal(seen.at(-1).total, 2);
  assert.equal(seen.at(-1).bytesDone, seen.at(-1).bytesTotal);
  const names = readdirSync(inDir).sort();
  assert.equal(names.length, 3, 'old file with the same name is not overwritten');
  assert.ok(names.some((n) => /^IMG_0123 \(2\)\.MOV$/.test(n)));
  assert.equal(readFileSync(join(inDir, 'IMG_0123.MOV'), 'utf8'), 'другое видео с тем же именем');
  const again = await copyVideos(collectVideos([src]), inDir, () => {});
  assert.equal(again.copied, 0, 'same video is not copied a second time');
  assert.equal(again.same, 2);
});

test('file already in Inbox is not copied onto itself', async () => {
  const { inDir } = tree();
  writeFileSync(join(inDir, 'a.mp4'), 'x');
  const r = await copyVideos(collectVideos([inDir]), inDir, () => {});
  assert.equal(r.copied, 0);
  assert.deepEqual(readdirSync(inDir), ['a.mp4']);
});

test('window: drop zone in Inbox, button disabled during copy, path via webUtils', () => {
  const ui = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../app/ui/index.html', import.meta.url), 'utf8');
  const pre = readFileSync(new URL('../app/preload.cjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
  assert.match(ui, /addEventListener\('dragover'/);
  assert.match(ui, /addEventListener\('drop'/);
  assert.match(ui, /#add'\)\.disabled = /);
  assert.match(html, /id="drop"/);
  assert.match(html, /id="copyBox"/);
  assert.match(pre, /webUtils\.getPathForFile/);
  assert.match(main, /ipcMain\.handle\('inbox:add'/);
  assert.match(main, /send\('copy'/);
});
