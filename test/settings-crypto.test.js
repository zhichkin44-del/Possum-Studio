// Ключи в settings.json — только зашифрованными через Electron safeStorage (на Windows — DPAPI).
// Открытым текстом не пишем никогда: нет шифрования — ключ не сохраняется, в окне понятная ошибка.
// Только временные папки; настоящий %APPDATA%\PossumStudio не трогается.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, setVault, SCHEMA } from '../core/settings.js';
import { fakeVault } from './vault.js';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'possum-crypt-')), 'settings.json');
const raw = (p) => readFileSync(p, 'utf8');
const KEY = 'sk-ant-REDACTED3456';
const TT = 'test-tiktok-secret-777777';
const RT = 'test-tiktok-refresh-888888';

test.afterEach(() => setVault(null));

test('шифрует: ключ Claude и секреты площадок лежат в файле как {enc:"ss1", v:base64}', () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY, tiktok: { clientKey: 'ck-open', clientSecret: TT, refreshToken: RT }, youtube: { clientId: 'cid', clientSecret: 'test-yt-secret-123456' } });
  const disk = JSON.parse(raw(p));
  for (const v of [disk.claudeKey, disk.tiktok.clientSecret, disk.tiktok.refreshToken, disk.youtube.clientSecret]) {
    assert.equal(v.enc, 'ss1');
    assert.match(v.v, /^[A-Za-z0-9+/]+=*$/);
  }
  assert.equal(disk.tiktok.clientKey, 'ck-open', 'не секретные поля — как были');
  assert.equal(disk.youtube.clientId, 'cid');
});

test('открытого ключа в файле нет', () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT, refreshToken: RT }, telegram: { botToken: 'test-bot-token-555555' } });
  const text = raw(p);
  for (const s of [KEY, TT, RT, 'test-bot-token-555555', 'TESTKEY']) assert.ok(!text.includes(s), `в файле открытым текстом: ${s.slice(0, 8)}…`);
});

test('расшифровывает: loadSettings отдаёт настоящие ключи, повторное сохранение их не портит', () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT } });
  saveSettings(p, { model: 'claude-opus-5-5', tiktok: { clientKey: 'ck' } });
  const s = loadSettings(p);
  assert.equal(s.claudeKey, KEY);
  assert.equal(s.tiktok.clientSecret, TT);
  assert.equal(s.tiktok.clientKey, 'ck');
  assert.equal(JSON.parse(raw(p)).claudeKey.enc, 'ss1', 'после второго сохранения ключ всё ещё зашифрован');
});

test('переносит старый открытый ключ: при первом чтении шифрует и перезаписывает файл', () => {
  const v = fakeVault();
  setVault(v);
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, claudeKey: KEY, model: 'claude-opus-5-5', tiktok: { clientKey: 'ck', clientSecret: TT, refreshToken: RT }, wizardDone: true }));
  const s = loadSettings(p);
  assert.equal(s.claudeKey, KEY);
  assert.equal(s.tiktok.refreshToken, RT);
  assert.equal(s.wizardDone, true);
  const text = raw(p);
  assert.ok(!text.includes(KEY) && !text.includes(TT) && !text.includes(RT), 'после чтения открытого ключа в файле нет');
  assert.equal(JSON.parse(text).claudeKey.enc, 'ss1');
  // второй раз переписывать нечего
  const before = v.calls.enc;
  loadSettings(p);
  assert.equal(v.calls.enc, before);
});

test('старый файл без schema с открытым ключом: миграция формата тоже пишет ключ зашифрованным', () => {
  setVault(fakeVault());
  const p = tmp();
  writeFileSync(p, JSON.stringify({ anthropicKey: KEY, youtube: { clientId: 'yt' } }));
  assert.equal(loadSettings(p).claudeKey, KEY);
  const text = raw(p);
  assert.ok(!text.includes(KEY));
  assert.equal(JSON.parse(text).schema, SCHEMA);
});

test('нет шифрования: ключ на диск не пишется, ошибка понятная', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  assert.throws(() => saveSettings(p, { claudeKey: KEY }), /не сохранён.*шифровани/i);
  assert.ok(!existsSync(p) || !raw(p).includes(KEY), 'ключа на диске нет');
  // обычные поля без ключей сохраняются
  saveSettings(p, { model: 'claude-opus-5-5', folders: { music: 'D:/m' } });
  assert.equal(loadSettings(p).folders.music, 'D:/m');
  assert.ok(!raw(p).includes(KEY));
});

test('без safeStorage вообще (не Electron) — то же: ключ не пишется', () => {
  setVault(null);
  const p = tmp();
  assert.throws(() => saveSettings(p, { tiktok: { refreshToken: RT } }), /шифровани/i);
  assert.ok(!existsSync(p) || !raw(p).includes(RT));
});

test('нет шифрования и в файле старый открытый ключ: файл не переписывается открытым текстом, ключ не теряется', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ claudeKey: KEY }));
  const before = raw(p);
  const s = loadSettings(p);
  assert.equal(s.claudeKey, KEY, 'читать старый ключ можно');
  assert.equal(raw(p), before, 'переписывать открытым текстом нельзя — ждём, когда шифрование появится');
  assert.throws(() => saveSettings(p, { model: 'claude-opus-5-5' }), /шифровани/i);
  assert.equal(raw(p), before);
});

test('ключ, зашифрованный на другом компьютере: не падаем, ключ пустой, шифр в файле не теряется', () => {
  setVault(fakeVault());
  const p = tmp();
  const foreign = { enc: 'ss1', v: Buffer.from('чужой шифр').toString('base64') };
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, claudeKey: foreign, tiktok: { clientKey: 'ck' } }));
  assert.equal(loadSettings(p).claudeKey, '');
  saveSettings(p, { tiktok: { clientKey: 'ck2' } });
  assert.deepEqual(JSON.parse(raw(p)).claudeKey, foreign);
  // новый ключ заменяет нечитаемый
  saveSettings(p, { claudeKey: KEY });
  assert.equal(loadSettings(p).claudeKey, KEY);
});

test('пустой ключ («Позже», «удалить») пишется пустым, без шифра', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  saveSettings(p, { claudeKey: '' });
  assert.equal(JSON.parse(raw(p)).claudeKey, '');
});

test('на Windows файл пишется без ложного mode 0600: защита — шифрование, а не права файла', () => {
  const src = readFileSync(new URL('../core/settings.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /writeFileSync\([^)]*mode: 0o600/, 'режим 0600 не выставляется на Windows-пути');
  assert.match(src, /win32/);
});
