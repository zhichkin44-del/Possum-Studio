// Логика формы настроек окна (app/ui/form.js) без DOM: что уходит в saveSettings по кнопке «Сохранить».
// Маска «•••abcd» не уходит; очищенное поле, где было значение, уходит пустым — это «удалить ключ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app/ui/form.js', import.meta.url), 'utf8');
const ctx = {};
vm.runInNewContext(src, ctx);
const F = ctx.PossumForm;
const plain = (o) => JSON.parse(JSON.stringify(o));
const field = (name, value, had = '', type = 'text') => ({ name, value, had, type });

test('маска ключа не уходит, даже если поле было заполнено', () => {
  assert.deepEqual(plain(F.formPatch([field('claudeKey', '•••abcd', '•••abcd', 'password')])), {});
  assert.deepEqual(plain(F.formPatch([field('youtube.clientSecret', '  •••9999 ', '•••9999')])), {});
});

test('многоточие «…» (укороченное значение) не уходит', () => {
  assert.deepEqual(plain(F.formPatch([field('folders.music', 'D:/…/m', 'D:/…/m')])), {});
});

test('очищенное поле, где было значение, уходит пустым — «удалить ключ»', () => {
  assert.deepEqual(plain(F.formPatch([field('claudeKey', '', '•••abcd', 'password')])), { claudeKey: '' });
  assert.deepEqual(plain(F.formPatch([field('youtube.refreshToken', '   ', '•••rt12')])), { youtube: { refreshToken: '' } });
});

test('пустое поле без прежнего значения не уходит', () => {
  assert.deepEqual(plain(F.formPatch([field('tiktok.clientKey', '', '')])), {});
  assert.deepEqual(plain(F.formPatch([field('tiktok.clientKey', '')].map(({ had, ...f }) => f))), {}, 'had не задан');
});

test('новое значение уходит обрезанным; вложенные имена собираются в объект', () => {
  assert.deepEqual(plain(F.formPatch([
    field('claudeKey', ' sk-ant-REDACTED ', '•••abcd', 'password'),
    field('youtube.clientId', 'cid', ''),
    field('youtube.clientSecret', 'test-secret-2', '•••0000'),
    field('model', 'claude-sonnet-5-5', 'claude-opus-5-5'),
  ])), { claudeKey: 'sk-ant-REDACTED', youtube: { clientId: 'cid', clientSecret: 'test-secret-2' }, model: 'claude-sonnet-5-5' });
});

test('флажки и поля без имени форма пропускает', () => {
  assert.deepEqual(plain(F.formPatch([field('allowName', 'on', '', 'checkbox'), field('', 'x', '')])), {});
});

test('getPath читает вложенное, отсутствующее — undefined', () => {
  assert.equal(F.getPath({ a: { b: 'c' } }, 'a.b'), 'c');
  assert.equal(F.getPath({}, 'a.b'), undefined);
});

test('окно грузит form.js раньше app.js, а app.js берёт патч из него', () => {
  const html = readFileSync(new URL('../app/ui/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
  const f = html.indexOf('<script src="form.js"></script>');
  assert.ok(f > 0 && f < html.indexOf('<script src="app.js"></script>'));
  assert.match(app, /PossumForm\.formPatch\(/);
  assert.match(app, /dataset\.had/);
});
