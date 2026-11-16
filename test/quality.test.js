// 0.3 PR 1: вшитый шрифт и чистая картинка (шумодав, живость цвета, резкость, сжатие с запасом).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findFont, bundledAssetsDir } from '../core/assets.js';
import { gradeChain, ENCODE, NOISY_LUMA, buildRenderArgs } from '../core/render.js';
import { buildStoryArgs, storyInputs, STYLES } from '../core/story-render.js';

const fc = (args) => args[args.indexOf('-filter_complex') + 1];

test('вшитые шрифты лежат в assets/fonts и находятся сами', () => {
  const dir = bundledAssetsDir();
  for (const f of ['Montserrat-Black.ttf', 'Nunito-Black.ttf', 'Rubik-Black.ttf', 'DelaGothicOne-Regular.ttf', 'Caveat-Bold.ttf'])
    assert.ok(existsSync(join(dir, 'fonts', f)), f);
  assert.equal(findFont({}), join(dir, 'fonts', 'Montserrat-Black.ttf'));
});

test('свой шрифт POSSUM_FONT важнее вшитого, без вшитого — системный', () => {
  assert.equal(findFont({ POSSUM_FONT: 'my.ttf' }, () => true), 'my.ttf');
  const noBundled = (f) => !f.includes('Montserrat') && f.endsWith('arialbd.ttf');
  assert.match(findFont({ WINDIR: 'C:/Windows' }, noBundled), /arialbd\.ttf$/);
});

test('картинка: живость, контраст и резкость всегда; шумодав только на тёмном куске', () => {
  const light = gradeChain({ luma: 140 });
  assert.match(light, /vibrance=intensity=0\.15/);
  assert.match(light, /cas=strength=0\.4/);
  assert.doesNotMatch(light, /hqdn3d/);
  assert.match(gradeChain({ luma: NOISY_LUMA - 1 }), /^hqdn3d=/);
  assert.doesNotMatch(gradeChain({}), /hqdn3d/, 'яркость неизвестна — шумодав не включаем');
  assert.match(gradeChain({ luma: 140 }, true), /vibrance=intensity=0\.08.*cas=strength=0\.25/);
});

test('ролик-история: обработка в каждом куске, мягкая для тихого стиля, сжатие medium/18', () => {
  const pieces = [
    { src: 'a.mp4', from: 0, len: 3, hasAudio: true, orient: 'vertical', luma: 60 },
    { src: 'b.mp4', from: 0, len: 3, hasAudio: true, orient: 'horizontal', luma: 150 },
  ];
  const args = buildStoryArgs({ out: 'o.mp4', pieces, style: STYLES.top5 });
  const f = fc(args);
  assert.equal((f.match(/vibrance=intensity=0\.15/g) ?? []).length, 2);
  assert.equal((f.match(/hqdn3d/g) ?? []).length, 1, 'шумодав только на тёмном куске');
  assert.deepEqual(args.slice(args.indexOf('-preset'), args.indexOf('-preset') + 4), ['-preset', 'medium', '-crf', '18']);
  assert.ok(STYLES.calm.soft && STYLES.asmr.soft);
  assert.match(fc(buildStoryArgs({ out: 'o.mp4', pieces, style: STYLES.asmr })), /vibrance=intensity=0\.08/);
});

test('яркость кадра доходит от разбора клипа до сборки', () => {
  const clip = { id: 'c1', rel: 'c1.mp4', orient: 'vertical', hasAudio: true, shots: [{ luma: 42 }] };
  const lib = { get: () => clip, realPath: () => '/lib/c1.mp4' };
  const [inp] = storyInputs({ pieces: [{ clip: 'c1', shot: 0, from: 0, len: 2 }] }, lib);
  assert.equal(inp.luma, 42);
});

test('монтаж по плану тоже сжимается medium/18 и с обработкой', () => {
  const args = buildRenderArgs({ src: 's.mp4', hasAudio: false, out: 'o.mp4', plan: { segments: [{ from: 0, len: 2 }], sfx: [], total: 2 } });
  assert.match(fc(args), /cas=strength=0\.4/);
  assert.ok(args.join(' ').includes(ENCODE.join(' ')));
});

test('монтаж по плану: тёмный исходник получает шумодав', () => {
  const plan = { segments: [{ from: 0, len: 2 }], sfx: [], total: 2 };
  assert.match(fc(buildRenderArgs({ src: 's.mp4', hasAudio: false, out: 'o.mp4', plan, luma: 40 })), /hqdn3d/);
  assert.doesNotMatch(fc(buildRenderArgs({ src: 's.mp4', hasAudio: false, out: 'o.mp4', plan, luma: 150 })), /hqdn3d/);
});

test('бот (src/montage.js) обрабатывает картинку и сжимает medium/18, как приложение', async () => {
  const { segVideoFilter } = await import('../src/montage.js');
  const v = segVideoFilter({ width: 1080, height: 1920, luma: 40 }, 0);
  assert.match(v, /hqdn3d=.*vibrance=intensity=0\.15.*cas=strength=0\.4/);
  const h = segVideoFilter({ width: 1920, height: 1080, luma: 150 }, 1);
  assert.match(h, /overlay=\(W-w\)\/2:\(H-h\)\/2,vibrance=/);
  assert.doesNotMatch(h, /hqdn3d/);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/montage.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /veryfast/);
  assert.match(src, /\.\.\.ENCODE/);
});

test('в установленном приложении шрифты берутся из resources/assets', () => {
  const old = process.resourcesPath;
  try {
    process.resourcesPath = 'C:/App/resources';
    const res = join('C:/App/resources', 'assets');
    assert.equal(bundledAssetsDir((p) => p === res), res);
    assert.equal(findFont({}, (p) => p === res || p === join(res, 'fonts', 'Montserrat-Black.ttf')), join(res, 'fonts', 'Montserrat-Black.ttf'));
    assert.notEqual(bundledAssetsDir(() => false), res, 'нет папки рядом с asar — берём assets/ репо');
  } finally { process.resourcesPath = old; }
});
