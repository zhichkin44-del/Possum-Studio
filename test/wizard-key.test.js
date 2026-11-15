// Мастер: шаг «Ключ Claude — ввести сейчас или позже», с расходом по прайсу из кода. Ключ вводит только владелец.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRICES, textCost } from '../core/ai.js';

const html = readFileSync(new URL('../app/ui/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
const pre = readFileSync(new URL('../app/preload.cjs', import.meta.url), 'utf8');

test('расход на тексты считается по прайсу из кода, а не из головы', () => {
  const p = PRICES['claude-opus-5-5'];
  assert.ok(p && p.in > 0 && p.out > 0);
  const c = textCost('claude-opus-5-5');
  assert.equal(c.model, 'claude-opus-5-5');
  assert.ok(c.perClipMax > c.perClip && c.perClip > 0);
  const expectMax = (c.inTokens * p.in + c.maxOut * p.out) / 1e6;
  assert.ok(Math.abs(c.perClipMax - expectMax) < 1e-9);
  assert.equal(textCost('claude-unknown-9'), null, 'неизвестная модель — расход не выдумываем');
});

test('мастер: карточка «Ключ Claude» с выбором «сейчас / позже» и пояснением про черновые тексты', () => {
  assert.match(html, /id="wzKey"/);
  const card = html.slice(html.indexOf('id="wzKey"'), html.indexOf('</div>', html.indexOf('id="wzKeyLater"')));
  assert.match(card, /id="wzKeyIn"[^>]*type="password"/);
  assert.match(card, /id="wzKeySave"/);
  assert.match(card, /id="wzKeyLater"/);
  assert.match(card, /черновы/);
  assert.match(card, /id="wzKeyCost"/);
  assert.match(card, /только владел|только монтажёр/);
});

test('проводка: владелец и «один» видят шаг ключа, напарница — нет; ключ сохраняется через настройки', () => {
  assert.match(main, /ipcMain\.handle\('ai:price'/);
  assert.match(pre, /aiPrice: \(\) => ipcRenderer\.invoke\('ai:price'\)/);
  assert.match(app, /function keyStep\(/);
  assert.match(app, /saveSettings\(\{ claudeKey/);
  const save = app.slice(app.indexOf("$('#wzKeySave').onclick"), app.indexOf("$('#wzKeyIn').onkeydown"));
  assert.match(save, /warning[\s\S]*return/, 'ключ не сохранился (нет шифрования) — мастер не идёт дальше, показывает предупреждение');
  const solo = app.slice(app.indexOf("$('#wzSolo').onclick"), app.indexOf('\n', app.indexOf("$('#wzSolo').onclick")));
  assert.match(solo, /keyStep\(/);
  const fin = app.slice(app.indexOf("$('#wzFinish').onclick"), app.indexOf('\n', app.indexOf("$('#wzFinish').onclick")));
  assert.match(fin, /wzRole === 'partner'/);
});
