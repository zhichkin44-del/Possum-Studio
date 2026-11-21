// Wizard: the "Claude key — enter now or later" step, with the cost from the price list in the code. Only the owner enters the key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PRICES, textCost } from '../core/ai.js';

const html = readFileSync(new URL('../app/ui/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
const pre = readFileSync(new URL('../app/preload.cjs', import.meta.url), 'utf8');

test('text spend is computed from the price table in code, not from memory', () => {
  const p = PRICES['claude-opus-5-5'];
  assert.ok(p && p.in > 0 && p.out > 0);
  const c = textCost('claude-opus-5-5');
  assert.equal(c.model, 'claude-opus-5-5');
  assert.ok(c.perClipMax > c.perClip && c.perClip > 0);
  const expectMax = (c.inTokens * p.in + c.maxOut * p.out) / 1e6;
  assert.ok(Math.abs(c.perClipMax - expectMax) < 1e-9);
  assert.equal(textCost('claude-unknown-9'), null, 'unknown model — we do not invent the spend');
});

test('wizard: "AI key" card with "now / later" choice and a note about draft texts', () => {
  assert.match(html, /id="wzKey"/);
  const card = html.slice(html.indexOf('id="wzKey"'), html.indexOf('</div>', html.indexOf('id="wzKeyLater"')));
  assert.match(card, /id="wzKeyIn"[^>]*type="password"/);
  assert.match(card, /id="wzKeySave"/);
  assert.match(card, /id="wzKeyLater"/);
  assert.match(card, /черновы/);
  assert.match(card, /id="wzKeyCost"/);
  assert.match(card, /только владел|только монтажёр/);
});

test('wiring: owner and "solo" see the key step, partner does not; key is saved via settings', () => {
  assert.match(main, /ipcMain\.handle\('ai:price'/);
  assert.match(pre, /aiPrice: \(\) => ipcRenderer\.invoke\('ai:price'\)/);
  assert.match(app, /function keyStep\(/);
  assert.match(app, /saveSettings\(\{ claudeKey/);
  const save = app.slice(app.indexOf("$('#wzKeySave').onclick"), app.indexOf("$('#wzKeyIn').onkeydown"));
  assert.match(save, /warning[\s\S]*return/, 'key was not saved (no encryption) — wizard does not proceed, shows a warning');
  assert.match(save, /finally\s*\{[^}]*\$\('#wzKeyIn'\)\.value = ''/, 'key field is cleared in finally: after saving, on NO_CRYPTO and on error');
  assert.ok(save.indexOf('finally') > save.indexOf('catch'), 'finally comes after catch');
  const solo = app.slice(app.indexOf("$('#wzSolo').onclick"), app.indexOf('\n', app.indexOf("$('#wzSolo').onclick")));
  assert.match(solo, /keyStep\(/);
  const fin = app.slice(app.indexOf("$('#wzFinish').onclick"), app.indexOf('\n', app.indexOf("$('#wzFinish').onclick")));
  assert.match(fin, /wzRole === 'partner'/);
});

// Behaviour, not just text: app.js runs in node:vm on window stubs; api.saveSettings throws an error.
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
  const never = () => new Promise(noop); // the other window calls are not needed by this test
  const api = new Proxy({ saveSettings }, { get: (t, k) => (k in t ? t[k] : never) });
  const window = { possum: api, addEventListener: noop };
  const PossumForm = { getPath: noop, setPath: noop, formPatch: () => ({}), isShown: () => false }; // form.js is checked by form.test.js
  vm.runInNewContext(src, { document, window, PossumForm, setInterval: noop, setTimeout: noop, console });
  return (s) => document.querySelector(s);
}

for (const [why, saveSettings] of [
  ['saveSettings бросает исключение', async () => { throw new Error('сбой записи'); }],
  ['saveSettings вернул «не сохранён» (NO_CRYPTO)', async () => ({ warning: 'Ключ не сохранён' })],
  ['ключ сохранён', async () => ({})],
]) {
  test(`wizard: after "Save" the key field is empty — ${why}`, async () => {
    const $ = runWizard(app, saveSettings);
    $('#wzKeyIn').value = 'sk-ant-REDACTED';
    await $('#wzKeySave').onclick();
    assert.equal($('#wzKeyIn').value, '', 'key does not remain in the field');
    if (why.includes('исключение')) assert.match($('#wzKeyMsg').innerHTML, /сбой записи/, 'error is shown');
  });
}

test('wizard: behaviour check catches old code — without finally, on exception the key stays in the field', async () => {
  const fin = "finally { $('#wzKeyIn').value = ''; }";
  assert.ok(app.includes(fin));
  const old = app.replace(fin, ''); // as it was before PR #16: clearing only after a successful await
  assert.doesNotThrow(() => new vm.Script(old));
  const $ = runWizard(old, async () => { throw new Error('сбой записи'); });
  $('#wzKeyIn').value = 'sk-ant-REDACTED';
  await $('#wzKeySave').onclick();
  assert.equal($('#wzKeyIn').value, 'sk-ant-REDACTED');
});
