// Показывает, как бот говорит с напарницей: прогон «день 1», «неделя 1», «день 100» в поддельном Telegram. Для проверок и отладки.
//   node scripts/transcript.mjs > transcript.txt
import { makeWorld } from '../test/helpers.js';
import { seedLongHistory } from '../test/seed.js';

const out = [];
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '');
function dump(w, from = 0, chat = 222) {
  const rows = w.tg.to(chat);
  for (const r of rows.slice(from)) {
    if (r.kind === 'text') out.push(`БОТ: ${strip(r.text).replace(/\n/g, '\n     ')}`);
    else out.push(`БОТ: [${r.kind === 'video' ? 'ВИДЕО готовый ролик' : 'ФОТО'}]`);
    if (r.buttons) out.push(`     кнопки: ${r.buttons.map((row) => row.map((b) => `[${strip(b.text)}]`).join(' ')).join(' / ')}`);
  }
  return rows.length;
}
const at = (d, hm) => `${d}T${hm}:00+07:00`;

async function dayOne() {
  out.push('===== ДЕНЬ 1 =====');
  const w = makeWorld();
  await w.register(); let n = dump(w);
  out.push('СЕСТРА: [нажала «Поняла»]'); await w.partner.press('Поняла'); n = dump(w, n);
  out.push('--- 19:30 ---'); await w.at(at('2026-11-15', '19:30')); n = dump(w, n);
  out.push('СЕСТРА: [нажала «Снимаю»]'); await w.partner.press('Снимаю'); n = dump(w, n);
  out.push('СЕСТРА: [прислала видео 14 с]'); await w.partner.video(); n = dump(w, n);
  await w.afterQuiet(); n = dump(w, n);
  out.push('СЕСТРА: [нажала «Всё хорошо»]'); await w.partner.press('Всё хорошо'); n = dump(w, n);
  out.push('СЕСТРА: [нажала «Выложила везде»]'); await w.partner.press('Выложила везде'); n = dump(w, n);
  out.push('--- воскресенье 19:00, цифр нет ---'); await w.at(at('2026-11-22', '19:00')); dump(w, n);
}
async function weekOne() {
  out.push('\n===== НЕДЕЛЯ 1: «Потом» и молчание =====');
  const w = makeWorld();
  await w.register(); await w.partner.press('Поняла'); let n = dump(w);
  out.push('--- день 1, 19:30 ---'); await w.at(at('2026-11-15', '19:30')); await w.partner.press('Потом'); n = dump(w, n);
  out.push('--- день 2, 19:30 (перенос) ---'); await w.at(at('2026-11-16', '19:30')); n = dump(w, n);
  out.push('СЕСТРА: [молчит до вечера]'); await w.at(at('2026-11-16', '21:30')); n = dump(w, n);
  out.push('--- день 3, 21:30 (опять молчит) ---'); await w.at(at('2026-11-17', '21:30')); n = dump(w, n);
  out.push('--- день 4 и 5: молчит ---'); await w.at(at('2026-11-18', '19:30')); await w.at(at('2026-11-19', '21:30')); n = dump(w, n);
  out.push('СЕСТРА: «пауза»'); await w.partner.say('пауза'); await w.partner.press('На неделю'); dump(w, n);
}
async function dayHundred() {
  out.push('\n===== ДЕНЬ 100 =====');
  const w = makeWorld({ start: '2027-02-22T09:00:00+07:00' });
  await w.register(); seedLongHistory(w, 99); const n0 = dump(w);
  out.push('--- 19:30 ---'); await w.at('2027-02-22T19:30:00+07:00'); let n = dump(w, n0);
  out.push('СЕСТРА: [нажала «Беру 2»]'); await w.partner.press('Беру 2'); n = dump(w, n);
  out.push('--- воскресенье 19:00 ---'); await w.at('2027-02-28T19:00:00+07:00'); dump(w, n);
}
await dayOne(); await weekOne(); await dayHundred();
console.log(out.join('\n'));
