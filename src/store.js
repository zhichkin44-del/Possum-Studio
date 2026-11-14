// Состояние бота — один JSON-файл. Запись атомарная (tmp → rename). Битый файл не теряется: уходит в .corrupt.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

function fresh() {
  const code = () => randomBytes(4).toString('hex');
  return {
    v: 1, invites: { owner: `o-${code()}`, partner: `s-${code()}` }, ownerId: null, partnerId: null, offset: 0, seen: [],
    partner: null, clips: [], posts: [], stats: [],
  };
}

export function createStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const tryRead = (p) => {
    try { const j = JSON.parse(readFileSync(p, 'utf8')); return typeof j === 'object' && j !== null ? j : null; } catch { return null; }
  };
  let data = existsSync(path) ? tryRead(path) : null;
  if (!data && existsSync(path)) {
    try { copyFileSync(path, `${path}.corrupt`); } catch { /* ignore */ }
    data = existsSync(`${path}.bak`) ? tryRead(`${path}.bak`) : null; // последняя хорошая копия: напарница и Саша остаются подключены
  }
  if (!data) data = fresh();
  const base = fresh();
  for (const k of Object.keys(base)) if (data[k] === undefined) data[k] = base[k];

  const store = {
    path,
    data,
    save() {
      const tmp = `${path}.tmp`;
      const body = JSON.stringify(store.data, null, 1);
      const fd = openSync(tmp, 'w');
      try { writeFileSync(fd, body, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
      if (existsSync(path) && tryRead(path)) { try { copyFileSync(path, `${path}.bak`); } catch { /* ignore */ } } // .bak — только из целого файла
      for (let i = 0; i < 4; i++) {
        try { renameSync(tmp, path); return; } catch (e) {
          if (i === 3) { writeFileSync(path, body, 'utf8'); return; } // файл занят (антивирус, OneDrive): пишем напрямую
          const end = Date.now() + 40 * (i + 1); while (Date.now() < end) { /* короткая пауза */ }
        }
      }
    },
  };
  store.save();
  return store;
}
