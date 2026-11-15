// Установщик Windows: ставится без вопросов в профиль пользователя, ярлыки «Поссум Студия» на рабочем столе и в «Пуске», своя иконка 256.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('NSIS: oneClick, без прав администратора, ярлыки на рабочем столе и в «Пуске»', () => {
  const n = pkg.build.nsis;
  assert.equal(pkg.build.win.target, 'nsis');
  assert.equal(n.oneClick, true);
  assert.equal(n.perMachine, false);
  assert.equal(n.createDesktopShortcut, 'always');
  assert.equal(n.createStartMenuShortcut, true);
  assert.equal(n.shortcutName, 'Поссум Студия');
  assert.equal(pkg.build.productName, 'Поссум Студия');
});

test('иконка: .ico с картинкой 256×256, в установщике и в окне', () => {
  for (const f of ['../build/icon.ico', '../app/icon.ico']) {
    const u = new URL(f, import.meta.url);
    assert.ok(existsSync(u), f);
    const b = readFileSync(u);
    assert.equal(b.readUInt16LE(2), 1, 'тип ICO');
    const n = b.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, k) => b[6 + 16 * k] || 256);
    assert.ok(sizes.includes(256), `есть 256: ${sizes}`);
  }
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'build/icon.ico');
  assert.match(readFileSync(new URL('../app/main.js', import.meta.url), 'utf8'), /icon: join\(here, 'icon\.ico'\)/);
});

test('модель кадров едет в установщике (она ~89 МБ, меньше 300 МБ), секретов в сборке нет', () => {
  const extra = pkg.build.extraResources.find((r) => r.from === 'models');
  assert.ok(extra, 'models в extraResources');
  assert.deepEqual(pkg.build.files, ['app/**', 'core/**', 'package.json']);
  assert.ok(!pkg.build.files.some((f) => /\.env|secret|src\//.test(f)));
});
