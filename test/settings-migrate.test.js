// Install over an old one: settings.json in the previous format is migrated automatically, nothing needs to be deleted by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, migrateSettings, setVault, SCHEMA, DEFAULTS } from '../core/settings.js';
import { fakeVault } from './vault.js';

setVault(fakeVault());

const tmp = () => join(mkdtempSync(join(tmpdir(), 'possum-mig-')), 'settings.json');

test('old file without schema: key, platforms and folders are kept, wizard is shown again', () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ claudeKey: 'sk-test-123456', model: 'claude-opus-5-5', youtube: { clientId: 'yt' }, folders: { inbox: 'D:/v' }, allowName: false, petNames: ['А'], wizardDone: true }));
  const s = loadSettings(p);
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.claudeKey, 'sk-test-123456');
  assert.equal(s.youtube.clientId, 'yt');
  assert.equal(s.folders.inbox, 'D:/v');
  assert.equal(s.wizardDone, false, 'the new wizard step (Claude key) must be shown');
  const disk = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(disk.schema, SCHEMA, 'migration is written to disk once');
  assert.equal(disk.claudeKey.enc, 'ss1', 'key on disk is encrypted');
  assert.ok(!readFileSync(p, 'utf8').includes('sk-test-123456'), 'no plain key in the file');
});

test('after migration the wizard, completed again, is no longer reset', () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ wizardDone: true }));
  loadSettings(p);
  saveSettings(p, { wizardDone: true });
  assert.equal(loadSettings(p).wizardDone, true);
});

test('an outdated or broken model is replaced with the current one', () => {
  assert.equal(migrateSettings({ model: 'claude-3-haiku-20240307' }).model, DEFAULTS.model);
  assert.equal(migrateSettings({ model: 42 }).model, DEFAULTS.model);
  assert.equal(migrateSettings({ model: 'claude-sonnet-5-5' }).model, 'claude-sonnet-5-5');
});

test('old field names are carried over: anthropicKey → claudeKey', () => {
  const m = migrateSettings({ anthropicKey: 'sk-old-999999' });
  assert.equal(m.claudeKey, 'sk-old-999999');
  assert.equal('anthropicKey' in m, false);
});

test('broken JSON does not crash the app and does not erase the file before saving', () => {
  const p = tmp();
  writeFileSync(p, '{oops');
  const s = loadSettings(p);
  assert.equal(s.claudeKey, '');
  assert.equal(readFileSync(p, 'utf8'), '{oops');
});

test('a new file is written with schema right away', () => {
  const p = tmp();
  assert.equal(saveSettings(p, { model: DEFAULTS.model }).schema, SCHEMA);
});
