// Keys in settings.json — only encrypted via Electron safeStorage (on Windows — DPAPI).
// Never written in plain text: no encryption — the key is not saved, the rest is saved, the window shows a NO_CRYPTO warning.
// Temporary folders only; the real %APPDATA%\PossumStudio is not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, setVault, isShown, SCHEMA, NO_CRYPTO, OLD_KEY } from '../core/settings.js';
import { fakeVault } from './vault.js';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'possum-crypt-')), 'settings.json');
const raw = (p) => readFileSync(p, 'utf8');
const KEY = 'sk-ant-REDACTED3456';
const TT = 'test-tiktok-secret-777777';
const RT = 'test-tiktok-refresh-888888';

test.afterEach(() => setVault(null));

test('encrypts: Claude key and platform secrets are in the file as {enc:"ss1", v:base64}, the decoded base64 contains no key', () => {
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
    assert.ok(!decoded.toString('utf8').includes(secret), 'base64 is not a wrapper over the plain key');
    assert.ok(!decoded.toString('latin1').includes(secret));
    assert.ok(!decoded.includes(Buffer.from(secret, 'utf16le')), 'and not UTF-16');
    assert.equal(vault.decryptString(decoded), secret, 'base64 is the cipher of exactly this key');
  }
  assert.equal(disk.tiktok.clientKey, 'ck-open', 'non-secret fields are as they were');
  assert.equal(disk.youtube.clientId, 'cid');
});

test('no plain key in the file', () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT, refreshToken: RT }, telegram: { botToken: 'test-bot-token-555555' } });
  const text = raw(p);
  for (const s of [KEY, TT, RT, 'test-bot-token-555555', 'TESTKEY']) assert.ok(!text.includes(s), `in the file as plain text: ${s.slice(0, 8)}…`);
});

test('decrypts: loadSettings returns the real keys, a repeated save does not spoil them', () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT } });
  saveSettings(p, { model: 'claude-opus-5-5', tiktok: { clientKey: 'ck' } });
  const s = loadSettings(p);
  assert.equal(s.claudeKey, KEY);
  assert.equal(s.tiktok.clientSecret, TT);
  assert.equal(s.tiktok.clientKey, 'ck');
  assert.equal(JSON.parse(raw(p)).claudeKey.enc, 'ss1', 'after the second save the key is still encrypted');
});

test('migrates an old plain key: on first read encrypts and rewrites the file', () => {
  const v = fakeVault();
  setVault(v);
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, claudeKey: KEY, model: 'claude-opus-5-5', tiktok: { clientKey: 'ck', clientSecret: TT, refreshToken: RT }, wizardDone: true }));
  const s = loadSettings(p);
  assert.equal(s.claudeKey, KEY);
  assert.equal(s.tiktok.refreshToken, RT);
  assert.equal(s.wizardDone, true);
  const text = raw(p);
  assert.ok(!text.includes(KEY) && !text.includes(TT) && !text.includes(RT), 'after reading, no plain key in the file');
  assert.equal(JSON.parse(text).claudeKey.enc, 'ss1');
  // nothing to rewrite the second time
  const before = v.calls.enc;
  loadSettings(p);
  assert.equal(v.calls.enc, before);
});

test('old file without schema with a plain key: format migration also writes the key encrypted', () => {
  setVault(fakeVault());
  const p = tmp();
  writeFileSync(p, JSON.stringify({ anthropicKey: KEY, youtube: { clientId: 'yt' } }));
  assert.equal(loadSettings(p).claudeKey, KEY);
  const text = raw(p);
  assert.ok(!text.includes(KEY));
  assert.equal(JSON.parse(text).schema, SCHEMA);
});

test('no encryption: key is not written to disk, other fields are saved, the response carries the NO_CRYPTO warning', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, model: 'old-model' }));
  const s = saveSettings(p, { model: 'new-model', claudeKey: KEY });
  assert.equal(s.warning, NO_CRYPTO, 'a warning, not an exception');
  assert.match(NO_CRYPTO, /не сохранён.*шифровани/i);
  assert.equal(s.claudeKey, '', 'the window does not think a key exists');
  const disk = JSON.parse(raw(p));
  assert.equal(disk.model, 'new-model', 'model was saved');
  assert.equal(disk.claudeKey, '', 'no key on disk');
  assert.ok(!raw(p).includes(KEY) && !raw(p).includes('warning'));
  // ordinary fields without keys — no warning
  assert.equal(saveSettings(p, { folders: { music: 'D:/m' } }).warning, undefined);
  assert.equal(loadSettings(p).folders.music, 'D:/m');
});

test('no encryption: platform secret is not written, clientId next to it is saved', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, model: 'old-model' }));
  const s = saveSettings(p, { model: 'new-model', youtube: { clientId: 'cid-new', clientSecret: 'test-yt-secret-123456' } });
  assert.equal(s.warning, NO_CRYPTO);
  const disk = JSON.parse(raw(p));
  assert.equal(disk.model, 'new-model');
  assert.equal(disk.youtube.clientId, 'cid-new');
  assert.ok(!disk.youtube.clientSecret, 'no secret on disk');
  assert.ok(!raw(p).includes('test-yt-secret-123456'));
});

test('no encryption: an empty key field ("delete") still deletes the encrypted key, without a warning', () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT } });
  setVault(fakeVault({ available: false }));
  const s = saveSettings(p, { claudeKey: '' });
  assert.equal(s.warning, undefined);
  const disk = JSON.parse(raw(p));
  assert.equal(disk.claudeKey, '');
  assert.equal(disk.tiktok.clientSecret.enc, 'ss1', 'foreign encrypted key is untouched');
});

test('without safeStorage at all (not Electron) — same: key is not written, warning', () => {
  setVault(null);
  const p = tmp();
  const s = saveSettings(p, { tiktok: { clientKey: 'ck', refreshToken: RT } });
  assert.equal(s.warning, NO_CRYPTO);
  assert.ok(!raw(p).includes(RT));
  assert.equal(JSON.parse(raw(p)).tiktok.clientKey, 'ck');
});

test('no encryption and an old plain key in the file: reading does not touch the file', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ claudeKey: KEY }));
  const before = raw(p);
  const s = loadSettings(p);
  assert.equal(s.claudeKey, KEY, 'reading the old key is allowed');
  assert.equal(raw(p), before, 'rewriting as plain text is not allowed — we wait until encryption appears');
});

test('no encryption and old plain keys in the file: other settings are saved, keys are removed, the answer is "enter again"', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, claudeKey: KEY, tiktok: { clientKey: 'ck', refreshToken: RT }, wizardDone: true }));
  const s = saveSettings(p, { model: 'claude-sonnet-5-5', folders: { music: 'D:/m' } });
  assert.equal(s.warning, OLD_KEY);
  assert.match(OLD_KEY, /ключ в файле старый, введите заново/i);
  assert.equal(s.claudeKey, '');
  const text = raw(p);
  assert.ok(!text.includes(KEY) && !text.includes(RT), 'nothing as plain text in the file');
  assert.ok(!text.includes('warning'), 'warning is not written to the file');
  const back = loadSettings(p);
  assert.equal(back.model, 'claude-sonnet-5-5');
  assert.equal(back.folders.music, 'D:/m');
  assert.equal(back.tiktok.clientKey, 'ck');
  assert.equal(back.wizardDone, true);
  // a new key without encryption is still not saved
  assert.equal(saveSettings(p, { claudeKey: KEY }).warning, NO_CRYPTO);
  assert.ok(!raw(p).includes(KEY));
  // a repeated save — no warning
  assert.equal(saveSettings(p, { model: 'claude-opus-5-5' }).warning, undefined);
});

test('key encrypted on another computer: we do not crash, key is empty, the cipher in the file is not lost', () => {
  setVault(fakeVault());
  const p = tmp();
  const foreign = { enc: 'ss1', v: Buffer.from('чужой шифр').toString('base64') };
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, claudeKey: foreign, tiktok: { clientKey: 'ck' } }));
  assert.equal(loadSettings(p).claudeKey, '');
  saveSettings(p, { tiktok: { clientKey: 'ck2' } });
  assert.deepEqual(JSON.parse(raw(p)).claudeKey, foreign);
  // a new key replaces the unreadable one
  saveSettings(p, { claudeKey: KEY });
  assert.equal(loadSettings(p).claudeKey, KEY);
});

test('empty key ("Later", "delete") is written empty, without cipher', () => {
  setVault(fakeVault({ available: false }));
  const p = tmp();
  saveSettings(p, { claudeKey: '' });
  assert.equal(JSON.parse(raw(p)).claudeKey, '');
});

test('outside Windows the settings file is for the owner only (0600)', { skip: process.platform === 'win32' && 'on Windows file permissions do not protect keys — there only encryption protects them' }, () => {
  setVault(fakeVault());
  const p = tmp();
  saveSettings(p, { claudeKey: KEY });
  assert.equal(statSync(p).mode & 0o777, 0o600);
});

test('no encryption, old plain key in the file and new key in patch: the window sees both warnings', () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ schema: SCHEMA, claudeKey: 'sk-ant-REDACTED4321', model: 'claude-opus-5-5' }));
  setVault(fakeVault({ available: false }));
  const s = saveSettings(p, { claudeKey: 'sk-ant-REDACTED9876', model: 'claude-sonnet-5-5' });
  assert.deepEqual(s.warnings, [OLD_KEY, NO_CRYPTO]);
  assert.ok(s.warning.includes(OLD_KEY) && s.warning.includes(NO_CRYPTO), 'one line for the window contains both texts');
  assert.equal(s.claudeKey, '');
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.ok(!raw(p).includes('old-plain') && !raw(p).includes('new-plain'), 'neither the old nor the new key in the file');
  assert.ok(!raw(p).includes('warning'), 'warnings did not get into the file');
});

test('one warning — warnings made of one text, warning equals it', () => {
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

test('saveSettings itself drops the mask "•••1111": the encrypted key is not overwritten', () => {
  const p = tmp();
  setVault(fakeVault());
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT } });
  const s = saveSettings(p, { claudeKey: '•••3456', tiktok: { clientSecret: '•••7777', clientKey: 'ck2' }, model: 'claude-sonnet-5-5' });
  assert.equal(s.claudeKey, KEY);
  assert.equal(s.tiktok.clientSecret, TT);
  assert.equal(s.tiktok.clientKey, 'ck2');
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.ok(!raw(p).includes('•••'), 'mask did not get into the file');
});

test('a mask without encryption is not counted as a new key: no false NO_CRYPTO', () => {
  const p = tmp();
  setVault(fakeVault({ available: false }));
  const s = saveSettings(p, { claudeKey: '•••1111', model: 'claude-sonnet-5-5' });
  assert.equal(s.warning, undefined);
  assert.equal(s.model, 'claude-sonnet-5-5');
});

test('warnings from the window (warning, warnings) are not written back to the file', () => {
  const p = tmp();
  setVault(fakeVault());
  saveSettings(p, { model: 'claude-sonnet-5-5', warning: 'x', warnings: ['x'] });
  assert.ok(!raw(p).includes('warning'));
});

test('a shortened "…" does not overwrite the key even on a direct saveSettings call (not only from the form)', () => {
  const p = tmp();
  setVault(fakeVault());
  saveSettings(p, { claudeKey: KEY, tiktok: { clientSecret: TT } });
  const s = saveSettings(p, { claudeKey: 'sk-ant…3456', tiktok: { clientSecret: 'abc…' }, model: 'claude-sonnet-5-5' });
  assert.equal(s.claudeKey, KEY);
  assert.equal(s.tiktok.clientSecret, TT);
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.ok(!raw(p).includes('…'), '"…" did not get into the file');
});

test('isShown: "•••" — a mask in any field; "…" — only the short shortened form in the key field', () => {
  for (const v of ['•••1234', '  •••1234 ']) for (const n of ['claudeKey', 'folders.music', '']) assert.equal(isShown(v, n), true, `${v} ${n}`);
  for (const n of ['claudeKey', 'tiktok.clientSecret', 'youtube.refreshToken', 'instagram.accessToken', 'telegram.botToken']) {
    for (const v of ['sk-ant…3456', 'abc…', '…', ' sk-ant…3456 ']) assert.equal(isShown(v, n), true, `${v} ${n}`);
    for (const v of ['D:\\Музыка…\\x', 'a/…/b', 'два слова…', 'x'.repeat(30) + '…', 'sk-ant-REDACTED', '••1234']) assert.equal(isShown(v, n), false, `${v} ${n}`);
  }
  for (const n of ['folders.music', 'petNames', 'model', 'tiktok.clientKey', 'youtube.clientId', 'claudeKeyX', 'x.claudeKey', '']) {
    for (const v of ['sk-ant…3456', 'Зверёк…', 'Видео…', 'D:\\Музыка…\\x', '…']) assert.equal(isShown(v, n), false, `${v} ${n}`);
  }
  for (const v of ['', 'claude-opus-5-5', 42, undefined, null]) assert.equal(isShown(v, 'claudeKey'), false, String(v));
});

test('"…" in ordinary fields is part of the value: the music path and names are saved as they are', () => {
  const p = tmp();
  setVault(fakeVault());
  saveSettings(p, { claudeKey: KEY });
  const music = 'D:\\Музыка…\\x';
  const s = saveSettings(p, { folders: { music, out: 'Видео…' }, petNames: ['Зверёк…', 'Видео…'], model: 'claude-sonnet-5-5' });
  assert.equal(s.folders.music, music);
  assert.equal(s.folders.out, 'Видео…');
  assert.deepEqual(s.petNames, ['Зверёк…', 'Видео…']);
  assert.equal(s.claudeKey, KEY, 'key is in place');
  const back = loadSettings(p);
  assert.equal(back.folders.music, music);
  assert.deepEqual(back.petNames, ['Зверёк…', 'Видео…']);
});
