// Установка поверх старой: settings.json прежнего формата переносится сам, руками ничего удалять не нужно.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, migrateSettings, setVault, SCHEMA, DEFAULTS } from '../core/settings.js';
import { fakeVault } from './vault.js';

setVault(fakeVault());

const tmp = () => join(mkdtempSync(join(tmpdir(), 'possum-mig-')), 'settings.json');

test('старый файл без schema: ключ, площадки и папки сохраняются, мастер показывается заново', () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ claudeKey: 'sk-test-123456', model: 'claude-opus-5-5', youtube: { clientId: 'yt' }, folders: { inbox: 'D:/v' }, allowName: false, petNames: ['А'], wizardDone: true }));
  const s = loadSettings(p);
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.claudeKey, 'sk-test-123456');
  assert.equal(s.youtube.clientId, 'yt');
  assert.equal(s.folders.inbox, 'D:/v');
  assert.equal(s.wizardDone, false, 'новый шаг мастера (ключ Claude) должен показаться');
  const disk = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(disk.schema, SCHEMA, 'миграция записана на диск один раз');
  assert.equal(disk.claudeKey.enc, 'ss1', 'ключ на диске зашифрован');
  assert.ok(!readFileSync(p, 'utf8').includes('sk-test-123456'), 'открытого ключа в файле нет');
});

test('после миграции мастер, пройденный заново, больше не сбрасывается', () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ wizardDone: true }));
  loadSettings(p);
  saveSettings(p, { wizardDone: true });
  assert.equal(loadSettings(p).wizardDone, true);
});

test('устаревшая или битая модель заменяется на текущую', () => {
  assert.equal(migrateSettings({ model: 'claude-3-haiku-20240307' }).model, DEFAULTS.model);
  assert.equal(migrateSettings({ model: 42 }).model, DEFAULTS.model);
  assert.equal(migrateSettings({ model: 'claude-sonnet-5-5' }).model, 'claude-sonnet-5-5');
});

test('старые имена полей переносятся: anthropicKey → claudeKey', () => {
  const m = migrateSettings({ anthropicKey: 'sk-old-999999' });
  assert.equal(m.claudeKey, 'sk-old-999999');
  assert.equal('anthropicKey' in m, false);
});

test('битый JSON не роняет приложение и не стирает файл до сохранения', () => {
  const p = tmp();
  writeFileSync(p, '{oops');
  const s = loadSettings(p);
  assert.equal(s.claudeKey, '');
  assert.equal(readFileSync(p, 'utf8'), '{oops');
});

test('новый файл сразу пишется со schema', () => {
  const p = tmp();
  assert.equal(saveSettings(p, { model: DEFAULTS.model }).schema, SCHEMA);
});
