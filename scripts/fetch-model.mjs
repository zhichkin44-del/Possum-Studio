// Модель кадров для «свой ли это зверёк» (CLIP ViT-B/32, ONNX q8, ~89 МБ) → models/clip/.
// Запускать перед `npm run dist`: установщик кладёт папку models рядом с приложением. В git модель не попадает.
//   node scripts/fetch-model.mjs              — скачать с Hugging Face (Xenova/clip-vit-base-patch32)
//   node scripts/fetch-model.mjs --from <dir> — взять уже скачанный vision_model_quantized.onnx из папки
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, copyFileSync, createWriteStream, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const NAME = 'vision_model_quantized.onnx';
const URL_ = `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/${NAME}`;
const SHA256 = '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299';
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'models', 'clip');
const target = join(dest, NAME);

const sha = (f) => new Promise((res, rej) => {
  const h = createHash('sha256');
  createReadStream(f).on('data', (b) => h.update(b)).on('end', () => res(h.digest('hex'))).on('error', rej);
});

mkdirSync(dest, { recursive: true });
if (existsSync(target) && (await sha(target)) === SHA256) { console.log(`модель уже на месте: ${target}`); process.exit(0); }

const tmp = `${target}.part`;
const i = process.argv.indexOf('--from');
if (i > 0) {
  copyFileSync(join(process.argv[i + 1], NAME), tmp);
} else {
  console.log(`скачиваю ${URL_} …`);
  const r = await fetch(URL_);
  if (!r.ok) { console.error(`не скачалось: HTTP ${r.status}`); process.exit(1); }
  await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
}
const got = await sha(tmp);
if (got !== SHA256) { rmSync(tmp, { force: true }); console.error(`контрольная сумма не совпала (${got}) — файл удалён`); process.exit(1); }
renameSync(tmp, target);
console.log(`готово: ${target}`);
