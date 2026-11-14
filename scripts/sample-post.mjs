// Собирает образец готового поста настоящим монтажом из синтетического клипа (для проверки заставки, обложки, листа проверки).
//   node scripts/sample-post.mjs <папка-вывода> [заголовок]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createMontage } from '../src/montage.js';
import { buildCaptions, PLATFORMS, qualityIssues } from '../src/post.js';
import { byId } from '../src/tasks.js';

const out = resolve(process.argv[2] ?? 'sample');
const title = process.argv[3] ?? 'Полёт';
mkdirSync(out, { recursive: true });
const m = createMontage({});
const clip = join(out, 'source.mp4');
const gen = spawnSync(m.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=35', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=35', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
if (gen.status !== 0) throw new Error('не удалось создать тестовый клип');
const r = await m.build({ clips: [{ path: clip }], title, outDir: join(out, 'post') });
const pet = { im: 'Пип', ro: 'Пипа', da: 'Пипу', vi: 'Пипа', tv: 'Пипом', en: 'Pip' };
const task = byId('flight');
const caps = buildCaptions({ task, pet, n: 0 });
const text = PLATFORMS.map((p) => `Для ${p.label}\nПодпись: ${caps[p.id].caption}\nХештеги: ${caps[p.id].hashtags.join(' ')}\nПервый комментарий: ${caps[p.id].comment}`).join('\n\n');
writeFileSync(join(out, 'captions.txt'), `${text}\n\nКачество: ${JSON.stringify(r, null, 1)}\nЗамечания проверки: ${JSON.stringify(qualityIssues(r))}\n`);
console.log(JSON.stringify({ video: r.video, cover: r.cover, proof: r.proof, duration: r.duration, issues: qualityIssues(r) }, null, 1));
