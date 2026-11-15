// Демо без ключа и без сети: делает 9 тестовых клипов (генераторы ffmpeg), прогоняет их пачкой через студию
// и печатает, что смонтировано и какие решения ждут человека. Ничего не выкладывает, токены не читает.
// Запуск: npm run demo  (папка с результатом печатается в конце)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMedia } from '../core/media.js';
import { createStudio } from '../core/studio.js';

const media = createMedia();
if (!media.tools.ffmpeg) { console.error('Нет ffmpeg — поставьте зависимости: npm install'); process.exit(1); }

const root = mkdtempSync(join(tmpdir(), 'possum-demo-'));
const inbox = join(root, 'Входящие'); mkdirSync(inbox, { recursive: true });

function clip(name, sec, w, h, { sound = true, pattern = 'testsrc2', extra = '' } = {}) {
  const out = join(inbox, name);
  const args = ['-y', '-f', 'lavfi', '-t', String(sec), '-i', `${pattern}=size=${w}x${h}:rate=30${extra}`];
  if (sound) args.push('-f', 'lavfi', '-i', `sine=frequency=${300 + name.length * 10}:duration=${sec}`);
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...(sound ? ['-c:a', 'aac', '-shortest'] : []), out);
  const r = spawnSync(media.tools.ffmpeg, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr?.slice(-300)}`);
  return out;
}

console.log('Делаю тестовые клипы…');
// Генераторы разные по виду: одинаковые клипы библиотека честно отсеет как дубли.
const files = [
  clip('план 1.mp4', 6, 1080, 1920),
  clip('план 2.mp4', 6, 720, 1280, { pattern: 'mandelbrot' }),
  clip('план 3.mp4', 6, 720, 1280, { pattern: 'life', extra: ':seed=1:mold=10' }),
  clip('план 4.mp4', 5, 1280, 720, { pattern: 'cellauto', extra: ':rule=30' }),
  clip('план 5 тихий.mp4', 5, 1280, 720, { pattern: 'cellauto', extra: ':rule=110', sound: false }),
  clip('план 6.mp4', 6, 720, 1280, { pattern: 'gradients', extra: ':seed=3' }),
  clip('план 7.mp4', 6, 720, 720, { pattern: 'zoneplate' }),
  clip('план 8.mp4', 6, 720, 1280, { pattern: 'smptehdbars' }),
  clip('короткий.mp4', 0.5, 720, 1280),
];

const studio = createStudio({ path: join(root, 'settings.json'), dataRoot: join(root, 'Поссум'), media });
const t0 = Date.now();
const r = await studio.runBatch(files, (p) => {
  const eta = p.eta == null ? '' : ` · осталось ~${p.eta} с`;
  console.log(`  ${p.stage} ${Math.min(p.i + 1, p.n)}/${p.n} ${p.name}${eta}`);
});

console.log(`\nРазобрано файлов: ${r.files.filter((f) => f.id).length}, пропущено: ${r.files.filter((f) => f.skipped).length}, ошибок: ${r.errors.length}`);
for (const e of r.errors) console.log(`  ошибка: ${e.file ?? e.story} — ${e.error}`);
console.log(`Смонтировано роликов: ${r.made.length}`);
for (const m of r.made) console.log(`  ${m.day} · ${m.kind} · «${m.titles.A.ru}» / «${m.titles.B.ru}»\n    почему: ${m.why}\n    ${m.dir}`);
console.log('Решения:');
for (const d of r.decisions) console.log(`  [${d.type}] ${d.text}`);
const free = r.disk == null ? 'не узнать' : `${(r.disk / 1e9).toFixed(1)} ГБ`;
console.log(`\nСвободно на диске: ${free}. Время: ${Math.round((Date.now() - t0) / 1000)} с. Папка: ${root}`);
process.exit(r.made.length ? 0 : 2);
