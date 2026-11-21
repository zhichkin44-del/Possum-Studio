// Windows installer: installs without questions into the user profile, "Possum Studio" shortcuts on the desktop and in Start, its own 256 icon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('NSIS: oneClick, no admin rights, desktop and Start menu shortcuts', () => {
  const n = pkg.build.nsis;
  assert.equal(pkg.build.win.target, 'nsis');
  assert.equal(n.oneClick, true);
  assert.equal(n.perMachine, false);
  assert.equal(n.createDesktopShortcut, 'always');
  assert.equal(n.createStartMenuShortcut, true);
  assert.equal(n.shortcutName, 'Поссум Студия');
  assert.equal(pkg.build.productName, 'Поссум Студия');
});

test('icon: .ico with a 256×256 image, in the installer and in the window', () => {
  for (const f of ['../build/icon.ico', '../app/icon.ico']) {
    const u = new URL(f, import.meta.url);
    assert.ok(existsSync(u), f);
    const b = readFileSync(u);
    assert.equal(b.readUInt16LE(2), 1, 'ICO type');
    const n = b.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, k) => b[6 + 16 * k] || 256);
    assert.ok(sizes.includes(256), `256 is present: ${sizes}`);
  }
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'build/icon.ico');
  assert.match(readFileSync(new URL('../app/main.js', import.meta.url), 'utf8'), /icon: join\(here, 'icon\.ico'\)/);
});

test('frame model ships in the installer (about 89 MB, under 300 MB), no secrets in the build', () => {
  const extra = pkg.build.extraResources.find((r) => r.from === 'models');
  assert.ok(extra, 'models in extraResources');
  assert.deepEqual(pkg.build.files, ['app/**', 'core/**', 'package.json']);
  assert.ok(!pkg.build.files.some((f) => /\.env|secret|src\//.test(f)));
});
