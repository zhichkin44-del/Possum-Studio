// scripts/set-token: the owner enters the token; the script does not print it, writes it to data/.token, rights for the owner only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/set-token.mjs', import.meta.url));
const run = (stdin, dir) => spawnSync(process.execPath, [script], { input: stdin, encoding: 'utf8', env: { ...process.env, POSSUM_DATA_DIR: dir } });

test('accepts a token from input, writes it to data/.token and does not print it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-tok-'));
  const token = '123456:TEST-TOKEN-NOT-REAL-0000000000000';
  const r = run(`${token}\n`, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, '.token'), 'utf8').trim(), token);
  assert.ok(!r.stdout.includes(token) && !r.stderr.includes(token), 'token is not printed');
  assert.match(r.stdout, /Токен сохранён/);
});

test('refuses if it does not look like a token, and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-tok-'));
  const r = run('привет это не токен\n', dir);
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(join(dir, '.token')));
  assert.ok(!r.stdout.includes('привет это не токен') && !r.stderr.includes('привет это не токен'));
});

test('empty input — refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'possum-tok-'));
  assert.notEqual(run('\n', dir).status, 0);
});
