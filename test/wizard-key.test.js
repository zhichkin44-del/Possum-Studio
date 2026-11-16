// Мастер: шаг «Ключ Claude — ввести сейчас или позже», с расходом по прайсу из кода. Ключ вводит только владелец.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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

test('мастер: карточка «Ключ ИИ» с выбором «сейчас / позже» и пояснением про черновые тексты', () => {
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
  assert.match(save, /finally\s*\{[^}]*\$\('#wzKeyIn'\)\.value = ''/, 'поле ключа очищается в finally: после сохранения, при NO_CRYPTO и при ошибке');
  assert.ok(save.indexOf('finally') > save.indexOf('catch'), 'finally — после catch');
  const solo = app.slice(app.indexOf("$('#wzSolo').onclick"), app.indexOf('\n', app.indexOf("$('#wzSolo').onclick")));
  assert.match(solo, /keyStep\(/);
  const fin = app.slice(app.indexOf("$('#wzFinish').onclick"), app.indexOf('\n', app.indexOf("$('#wzFinish').onclick")));
  assert.match(fin, /wzRole === 'partner'/);
});

// Поведение, а не только текст: app.js запускается в node:vm на заглушках окна; api.saveSettings бросает ошибку.
function runWizard(src, saveSettings) {
  const els = new Map();
  const noop = () => {};
  const el = () => new Proxy({ value: '', textContent: '', innerHTML: '', hidden: false, dataset: {}, style: {},
    classList: { toggle: noop, add: noop, remove: noop, contains: () => false } }, {
    get: (t, k) => (k in t ? t[k] : noop),
  });
  const document = {
    querySelector: (s) => { if (!els.has(s)) els.set(s, el()); return els.get(s); },
    querySelectorAll: () => [],
    body: el(),
  };
  const never = () => new Promise(noop); // остальные вызовы окна не нужны этому тесту
  const api = new Proxy({ saveSettings }, { get: (t, k) => (k in t ? t[k] : never) });
  const window = { possum: api, addEventListener: noop };
  const PossumForm = { getPath: noop, setPath: noop, formPatch: () => ({}), isShown: () => false }; // form.js проверяет form.test.js
  vm.runInNewContext(src, { document, window, PossumForm, setInterval: noop, setTimeout: noop, console });
  return (s) => document.querySelector(s);
}

for (const [why, saveSettings] of [
  ['saveSettings бросает исключение', async () => { throw new Error('сбой записи'); }],
  ['saveSettings вернул «не сохранён» (NO_CRYPTO)', async () => ({ warning: 'Ключ не сохранён' })],
  ['ключ сохранён', async () => ({})],
]) {
  test(`мастер: после «Сохранить» поле ключа пустое — ${why}`, async () => {
    const $ = runWizard(app, saveSettings);
    $('#wzKeyIn').value = 'sk-ant-REDACTED';
    await $('#wzKeySave').onclick();
    assert.equal($('#wzKeyIn').value, '', 'ключ не остаётся в поле');
    if (why.includes('исключение')) assert.match($('#wzKeyMsg').innerHTML, /сбой записи/, 'ошибка показана');
  });
}

test('мастер: проверка поведения ловит старый код — без finally при исключении ключ остаётся в поле', async () => {
  const fin = "finally { $('#wzKeyIn').value = ''; }";
  assert.ok(app.includes(fin));
  const old = app.replace(fin, ''); // как было до PR #16: очистка только после успешного await
  assert.doesNotThrow(() => new vm.Script(old));
  const $ = runWizard(old, async () => { throw new Error('сбой записи'); });
  $('#wzKeyIn').value = 'sk-ant-REDACTED';
  await $('#wzKeySave').onclick();
  assert.equal($('#wzKeyIn').value, 'sk-ant-REDACTED');
});
