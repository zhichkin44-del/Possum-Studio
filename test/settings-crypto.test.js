// Ключи в settings.json — только зашифрованными через Electron safeStorage (на Windows — DPAPI).
// Открытым текстом не пишем никогда: нет шифрования — ключ не сохраняется, остальное сохраняется, в окне предупреждение NO_CRYPTO.
// Только временные папки; настоящий %APPDATA%\PossumStudio не трогается.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, setVault, SCHEMA, NO_CRYPTO, OLD_KEY } from '../core/settings.js';
import { fakeVault } from './vault.js';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'possum-crypt-')), 'settings.json');
const raw = (p) => readFileSync(p, 'utf8');
const KEY = 'sk-ant-REDACTED3456';
const TT = 'test-tiktok-secret-777777';
const RT = 'test-tiktok-refresh-888888';

test.afterEach(() => setVault(null));

test('шифрует: ключ Claude и секреты площадок лежат в файле как {enc:"ss1", v:base64}, в раскодированном base64 ключа нет', () => {
  const vault = fakeVault();
  setVault(vault);
  const p = tmp();
  const YT = 'test-yt-secret-123456';
  saveSettings(p, { claudeKey: KEY, tiktok: { clientKey: 'ck-open', clientSecret: TT, refreshToken: RT }, youtube: { clientId: 'cid', clientSecret: YT } });
  const disk = JSON.parse(raw(p));
  const pairs = [[disk.claudeKey, KEY], [disk.tiktok.clientSecret, TT], [disk.tiktok.refreshToken, RT], [disk.youtube.clientSecret, YT]];
  for (const [v, secret] of pairs) {
    assert.equal(v.enc, 'ss1');
    assert.match(v.v, /^[A-Za-z0-9+/]+=*$/);
    const decoded = Buffer.from(v.v, 'base64');
    assert.ok(decoded.length > 0);
    assert.ok(!decoded.toString('utf8').includes(secret), 'base64 — не обёртка над открытым ключом');
    assert.ok(!decoded.toString('latin1').includes(secret));
    assert.ok(!decoded.includes(Buffer.from(secret, 'utf16le')), 'и не UTF-16');
    assert.equal(vault.decryptString(decoded), secret, 'base64 — это шифр именно этого ключа');
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

test('нет шифрования: ключ на диск не пишется, остальные поля сохраняются, в ответе предупреждение NO_CRYPTO', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, model: 'old-model' }));
  const s = saveSettings(p, { model: 'new-model', claudeKey: KEY });
  assert.equal(s.warning, NO_CRYPTO, 'предупреждение, а не исключение');
  assert.match(NO_CRYPTO, /не сохранён.*шифровани/i);
  assert.equal(s.claudeKey, '', 'окно не думает, что ключ есть');
  const disk = JSON.parse(raw(p));
  assert.equal(disk.model, 'new-model', 'модель сохранилась');
  assert.equal(disk.claudeKey, '', 'ключа на диске нет');
  assert.ok(!raw(p).includes(KEY) && !raw(p).includes('warning'));
  // обычные поля без ключей — без предупреждения
  assert.equal(saveSettings(p, { folders: { music: 'D:/m' } }).warning, undefined);
  assert.equal(loadSettings(p).folders.music, 'D:/m');
});

test('нет шифрования: секрет площадки не пишется, clientId рядом с ним сохраняется', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, model: 'old-model' }));
  const s = saveSettings(p, { model: 'new-model', youtube: { clientId: 'cid-new', clientSecret: 'test-yt-secret-123456' } });
  assert.equal(s.warning, NO_CRYPTO);
  const disk = JSON.parse(raw(p));
  assert.equal(disk.model, 'new-model');
  assert.equal(disk.youtube.clientId, 'cid-new');
  assert.ok(!disk.youtube.clientSecret, 'секрета на диске нет');
  assert.ok(!raw(p).includes('test-yt-secret-123456'));
});

test('нет шифрования: пустое поле ключа («удалить») по-прежнему удаляет зашифрованный ключ, без предупреждения', () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT } });
  setVault(fakeVault({ available: false }));
  const s = saveSettings(p, { claudeKey: '' });
  assert.equal(s.warning, undefined);
  const disk = JSON.parse(raw(p));
  assert.equal(disk.claudeKey, '');
  assert.equal(disk.tiktok.clientSecret.enc, 'ss1', 'чужой зашифрованный ключ не тронут');
});

test('без safeStorage вообще (не Electron) — то же: ключ не пишется, предупреждение', () => {
  setVault(null);
  const p = tmp();
  const s = saveSettings(p, { tiktok: { clientKey: 'ck', refreshToken: RT } });
  assert.equal(s.warning, NO_CRYPTO);
  assert.ok(!raw(p).includes(RT));
  assert.equal(JSON.parse(raw(p)).tiktok.clientKey, 'ck');
});

test('нет шифрования и в файле старый открытый ключ: чтение файл не трогает', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ claudeKey: KEY }));
  const before = raw(p);
  const s = loadSettings(p);
  assert.equal(s.claudeKey, KEY, 'читать старый ключ можно');
  assert.equal(raw(p), before, 'переписывать открытым текстом нельзя — ждём, когда шифрование появится');
});

test('нет шифрования и в файле старые открытые ключи: остальные настройки сохраняются, ключи убираются, ответ — «введите заново»', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, claudeKey: KEY, tiktok: { clientKey: 'ck', refreshToken: RT }, wizardDone: true }));
  const s = saveSettings(p, { model: 'claude-sonnet-5-5', folders: { music: 'D:/m' } });
  assert.equal(s.warning, OLD_KEY);
  assert.match(OLD_KEY, /ключ в файле старый, введите заново/i);
  assert.equal(s.claudeKey, '');
  const text = raw(p);
  assert.ok(!text.includes(KEY) && !text.includes(RT), 'открытым текстом в файле ничего');
  assert.ok(!text.includes('warning'), 'предупреждение в файл не пишется');
  const back = loadSettings(p);
  assert.equal(back.model, 'claude-sonnet-5-5');
  assert.equal(back.folders.music, 'D:/m');
  assert.equal(back.tiktok.clientKey, 'ck');
  assert.equal(back.wizardDone, true);
  // новый ключ без шифрования по-прежнему не сохраняется
  assert.equal(saveSettings(p, { claudeKey: KEY }).warning, NO_CRYPTO);
  assert.ok(!raw(p).includes(KEY));
  // повторное сохранение — без предупреждения
  assert.equal(saveSettings(p, { model: 'claude-opus-5-5' }).warning, undefined);
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

test('вне Windows файл настроек — только для владельца (0600)', { skip: process.platform === 'win32' && 'на Windows права файла ключи не закрывают — там защита только шифрование' }, () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY });
  assert.equal(statSync(p).mode & 0o777, 0o600);
});

test('нет шифрования, в файле старый открытый ключ и в patch новый ключ: окно видит оба предупреждения', () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, claudeKey: 'sk-ant-REDACTED4321', model: 'claude-opus-5-5' }));
  setVault(fakeVault({ available: false }));
  const s = saveSettings(p, { claudeKey: 'sk-ant-REDACTED9876', model: 'claude-sonnet-5-5' });
  assert.deepEqual(s.warnings, [OLD_KEY, NO_CRYPTO]);
  assert.ok(s.warning.includes(OLD_KEY) && s.warning.includes(NO_CRYPTO), 'одна строка для окна содержит оба текста');
  assert.equal(s.claudeKey, '');
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.ok(!raw(p).includes('old-plain') && !raw(p).includes('new-plain'), 'ни старого, ни нового ключа в файле');
  assert.ok(!raw(p).includes('warning'), 'предупреждения в файл не попали');
});

test('одно предупреждение — warnings из одного текста, warning равен ему', () => {
  const p = tmp();
  setVault(fakeVault({ available: false }));
  const s = saveSettings(p, { claudeKey: KEY });
  assert.deepEqual(s.warnings, [NO_CRYPTO]);
  assert.equal(s.warning, NO_CRYPTO);
  setVault(fakeVault());
  const ok = saveSettings(p, { claudeKey: KEY });
  assert.equal(ok.warning, undefined);
  assert.equal(ok.warnings, undefined);
});

test('saveSettings сам отбрасывает маску «•••1111»: зашифрованный ключ не затирается', () => {
  const p = tmp();
  setVault(fakeVault());
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT } });
  const s = saveSettings(p, { claudeKey: '•••3456', tiktok: { clientSecret: '•••7777', clientKey: 'ck2' }, model: 'claude-sonnet-5-5' });
  assert.equal(s.claudeKey, KEY);
  assert.equal(s.tiktok.clientSecret, TT);
  assert.equal(s.tiktok.clientKey, 'ck2');
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.ok(!raw(p).includes('•••'), 'маска в файл не попала');
});

test('маска без шифрования не считается новым ключом: нет ложного NO_CRYPTO', () => {
  const p = tmp();
  setVault(fakeVault({ available: false }));
  const s = saveSettings(p, { claudeKey: '•••1111', model: 'claude-sonnet-5-5' });
  assert.equal(s.warning, undefined);
  assert.equal(s.model, 'claude-sonnet-5-5');
});

test('предупреждения из окна (warning, warnings) обратно в файл не пишутся', () => {
  const p = tmp();
  setVault(fakeVault());
  saveSettings(p, { model: 'claude-sonnet-5-5', warning: 'x', warnings: ['x'] });
  assert.ok(!raw(p).includes('warning'));
});
