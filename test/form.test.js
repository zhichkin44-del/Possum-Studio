// Логика формы настроек окна (app/ui/form.js) без DOM: что уходит в saveSettings по кнопке «Сохранить».
// Маска «•••abcd» не уходит; очищенное поле, где было значение, уходит пустым — это «удалить ключ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isShown } from '../core/settings.js';

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

test('укороченный ключ «sk-ant…3456» не уходит; «…» в пути или имени — часть значения и уходит', () => {
  assert.deepEqual(plain(F.formPatch([field('claudeKey', 'sk-ant…3456', '•••3456', 'password'), field('tiktok.clientSecret', 'abc…', '')])), {});
  assert.deepEqual(plain(F.formPatch([field('folders.music', 'D:\\Музыка…\\x', ''), field('folders.out', 'Видео…', '')])),
    { folders: { music: 'D:\\Музыка…\\x', out: 'Видео…' } });
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

test('окно и сохранение одинаково узнают маску: isShown в form.js — копия isShown из core/settings.js', () => {
  // окно — классический скрипт под CSP 'self', модуль core/settings.js ему не подключить; поэтому копия и этот тест
  const samples = ['•••1234', '  •••1234 ', 'sk-ant…3456', 'abc…', '…', '', 'sk-ant-REDACTED', 'claude-opus-5-5', '••1234', 'C:\\Видео',
    'D:\\Музыка…\\x', 'Зверёк…', 'Видео…', 'a/…/b', 'два слова…', 'x'.repeat(30) + '…', 42, undefined, null];
  const names = ['claudeKey', 'tiktok.clientSecret', 'youtube.refreshToken', 'instagram.accessToken', 'telegram.botToken',
    'folders.music', 'petNames', 'model', 'tiktok.clientKey', 'claudeKeyX', '', undefined];
  for (const v of samples) for (const n of names) assert.equal(F.isShown(v, n), isShown(v, n), `${String(v)} ${n}`);
  // «…» в обычных полях — часть значения, в обеих копиях
  for (const v of ['D:\\Музыка…\\x', 'Зверёк…', 'Видео…']) assert.equal(F.isShown(v, 'folders.music'), false, v);
});
