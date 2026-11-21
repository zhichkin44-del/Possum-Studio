// Settings-window form logic (app/ui/form.js) without DOM: what goes to saveSettings on the "Save" button.
// The mask "•••abcd" is not sent; a cleared field that had a value is sent empty — that means "delete the key".
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

test('key mask is not sent, even if the field was filled in', () => {
  assert.deepEqual(plain(F.formPatch([field('claudeKey', '•••abcd', '•••abcd', 'password')])), {});
  assert.deepEqual(plain(F.formPatch([field('youtube.clientSecret', '  •••9999 ', '•••9999')])), {});
});

test('shortened key "sk-ant…3456" is not sent; "…" in a path or name is part of the value and is sent', () => {
  assert.deepEqual(plain(F.formPatch([field('claudeKey', 'sk-ant…3456', '•••3456', 'password'), field('tiktok.clientSecret', 'abc…', '')])), {});
  assert.deepEqual(plain(F.formPatch([field('folders.music', 'D:\\Музыка…\\x', ''), field('folders.out', 'Видео…', '')])),
    { folders: { music: 'D:\\Музыка…\\x', out: 'Видео…' } });
});

test('a cleared field that had a value is sent empty — "delete key"', () => {
  assert.deepEqual(plain(F.formPatch([field('claudeKey', '', '•••abcd', 'password')])), { claudeKey: '' });
  assert.deepEqual(plain(F.formPatch([field('youtube.refreshToken', '   ', '•••rt12')])), { youtube: { refreshToken: '' } });
});

test('an empty field without a previous value is not sent', () => {
  assert.deepEqual(plain(F.formPatch([field('tiktok.clientKey', '', '')])), {});
  assert.deepEqual(plain(F.formPatch([field('tiktok.clientKey', '')].map(({ had, ...f }) => f))), {}, 'had is not set');
});

test('a new value is sent trimmed; nested names are built into an object', () => {
  assert.deepEqual(plain(F.formPatch([
    field('claudeKey', ' sk-ant-REDACTED ', '•••abcd', 'password'),
    field('youtube.clientId', 'cid', ''),
    field('youtube.clientSecret', 'test-secret-2', '•••0000'),
    field('model', 'claude-sonnet-5-5', 'claude-opus-5-5'),
  ])), { claudeKey: 'sk-ant-REDACTED', youtube: { clientId: 'cid', clientSecret: 'test-secret-2' }, model: 'claude-sonnet-5-5' });
});

test('the form skips checkboxes and fields without a name', () => {
  assert.deepEqual(plain(F.formPatch([field('allowName', 'on', '', 'checkbox'), field('', 'x', '')])), {});
});

test('getPath reads nested values; missing ones are undefined', () => {
  assert.equal(F.getPath({ a: { b: 'c' } }, 'a.b'), 'c');
  assert.equal(F.getPath({}, 'a.b'), undefined);
});

test('the window loads form.js before app.js, and app.js takes the patch from it', () => {
  const html = readFileSync(new URL('../app/ui/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app/ui/app.js', import.meta.url), 'utf8');
  const f = html.indexOf('<script src="form.js"></script>');
  assert.ok(f > 0 && f < html.indexOf('<script src="app.js"></script>'));
  assert.match(app, /PossumForm\.formPatch\(/);
  assert.match(app, /dataset\.had/);
});

test('the window and save recognize the mask the same way: isShown in form.js is a copy of isShown from core/settings.js', () => {
  // the window is a classic script under CSP 'self', the core/settings.js module cannot be attached to it; hence a copy and this test
  const samples = ['•••1234', '  •••1234 ', 'sk-ant…3456', 'abc…', '…', '', 'sk-ant-REDACTED', 'claude-opus-5-5', '••1234', 'C:\\Видео',
    'D:\\Музыка…\\x', 'Зверёк…', 'Видео…', 'a/…/b', 'два слова…', 'x'.repeat(30) + '…', 42, undefined, null];
  const names = ['claudeKey', 'tiktok.clientSecret', 'youtube.refreshToken', 'instagram.accessToken', 'telegram.botToken',
    'folders.music', 'petNames', 'model', 'tiktok.clientKey', 'claudeKeyX', '', undefined];
  for (const v of samples) for (const n of names) assert.equal(F.isShown(v, n), isShown(v, n), `${String(v)} ${n}`);
  // "…" in ordinary fields is part of the value, in both copies
  for (const v of ['D:\\Музыка…\\x', 'Зверёк…', 'Видео…']) assert.equal(F.isShown(v, 'folders.music'), false, v);
});
