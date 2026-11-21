#!/usr/bin/env node
// The bot token is entered by the owner: the script asks for it with hidden input (characters not shown), checks its shape and writes it to data/.token.
// The token is never printed and never gets into the command history or chat. Agents do not need to read the data/.token file.
//   npm run set-token            — enter in the terminal
//   npm run set-token -- --verify — after writing, ask Telegram what the bot is called (needs internet)
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.POSSUM_DATA_DIR ?? join(root, 'data');
const file = join(dataDir, '.token');
const looksLikeToken = (t) => /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t);

function readHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const { stdin } = process;
    let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(buf); }
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\nОтменено.\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}
async function readAllStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = process.stdin.isTTY ? await readHidden('Вставь токен от BotFather (символы не видны) и нажми Enter: ') : await readAllStdin();
const token = raw.split(/\r?\n/)[0].trim();
if (!token) { console.error('Пусто. Токен не сохранён.'); process.exit(1); }
if (!looksLikeToken(token)) {
  console.error('Это не похоже на токен. Он выглядит как 1234567890:AA… (цифры, двоеточие, длинный набор символов). Ничего не сохранено.');
  process.exit(1);
}
mkdirSync(dataDir, { recursive: true });
writeFileSync(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
try { chmodSync(file, 0o600); } catch { /* Windows: rights are inherited from the folder */ }
console.log(`Токен сохранён: ${file}. Сам токен не показан и никуда не отправлен.`);

if (process.argv.includes('--verify')) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${readFileSync(file, 'utf8').trim()}/getMe`);
    const j = await r.json();
    console.log(j.ok ? `Telegram ответил: бот @${j.result.username} на связи.` : 'Telegram не принял этот токен. Проверь, что скопировал его целиком.');
    process.exit(j.ok ? 0 : 2);
  } catch { console.log('Не удалось связаться с Telegram (нет интернета?). Токен сохранён, проверим при запуске.'); }
}
