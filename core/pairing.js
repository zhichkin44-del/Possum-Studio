// Пара «Монтажёр ↔ напарница» через общую папку (OneDrive / Google Диск / сетевая папка — что синхронизируется у обоих).
// Код из 6 цифр живёт 24 ч, 5 попыток; в общей папке лежит только sha256(соль+код). Полных путей и ключей не храним.
// Ящики: sharedDir/owner/ пишет только монтажёр (готовые ролики), sharedDir/partner/ — только напарница (сырые видео).
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

const H24 = 24 * 3600 * 1000;
export const MAX_TRIES = 5;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 2), 'utf8'); renameSync(`${f}.tmp`, f); };
const other = (role) => (role === 'owner' ? 'partner' : 'owner');
/** Имя файла без пути и без символов, опасных для Windows. */
export const safeName = (n) => basename(String(n)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'file';

export function fileSha(file) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex')));
  });
}

export function createPairing({ sharedDir, role, stateDir, now = () => Date.now() }) {
  if (!['owner', 'partner'].includes(role)) throw new Error('role: owner или partner');
  const pairFile = join(sharedDir, 'pair.json');
  const stateFile = join(stateDir, 'pairing.json');
  mkdirSync(stateDir, { recursive: true });
  const state = () => readJson(stateFile, { paired: false, received: {} });
  const box = (r) => join(sharedDir, r);

  return {
    role,
    status() {
      const s = state();
      const p = readJson(pairFile, null);
      return { paired: Boolean(s.paired && p?.joinedAt && p.pairId === s.pairId), role, waiting: Boolean(p && !p.joinedAt && p.expiresAt > now()) };
    },

    /** монтажёр: новый код. Старый код и пара сбрасываются. */
    create() {
      if (role !== 'owner') throw new Error('Код создаёт монтажёр');
      mkdirSync(sharedDir, { recursive: true });
      const code = String(randomInt(0, 1e6)).padStart(6, '0');
      const salt = randomBytes(16).toString('hex');
      const pairId = randomBytes(8).toString('hex');
      writeJson(pairFile, { v: 1, pairId, salt, hash: sha(salt + code), createdAt: now(), expiresAt: now() + H24, tries: 0, joinedAt: null });
      writeJson(stateFile, { ...state(), paired: true, pairId });
      return { code, expiresAt: now() + H24 };
    },

    /** Напарница: ввод кода. Ошибка — понятным текстом, без подробностей о коде. */
    join(code) {
      if (role !== 'partner') throw new Error('Код вводит напарница');
      const p = readJson(pairFile, null);
      if (!p?.hash) throw new Error('Общая папка не найдена или код ещё не создан');
      if (p.joinedAt) throw new Error('Пара уже создана — попросите новый код');
      if (now() > p.expiresAt) throw new Error('Код устарел — попросите новый');
      if (p.tries >= MAX_TRIES) throw new Error('Слишком много попыток — попросите новый код');
      if (sha(p.salt + String(code).trim()) !== p.hash) {
        p.tries += 1; writeJson(pairFile, p);
        throw new Error(`Код не подходит (осталось попыток: ${MAX_TRIES - p.tries})`);
      }
      p.joinedAt = now(); writeJson(pairFile, p);
      writeJson(stateFile, { ...state(), paired: true, pairId: p.pairId });
      return { paired: true };
    },

    /** Положить файл в свой ящик (name — под каким именем его увидит другая сторона): копия .part → переименование → meta (имя, размер, sha256, время). */
    async send(file, { name: asName = null } = {}) {
      if (!this.status().paired) throw new Error('Сначала соедините приложения кодом');
      const dir = box(role); mkdirSync(dir, { recursive: true });
      const name = safeName(asName ?? file);
      const hash = await fileSha(file);
      const stored = `${hash.slice(0, 10)}_${name}`;
      const dst = join(dir, stored);
      if (!existsSync(join(dir, `${stored}.meta.json`))) {
        copyFileSync(file, `${dst}.part`);
        renameSync(`${dst}.part`, dst);
        writeJson(join(dir, `${stored}.meta.json`), { name, stored, size: statSync(dst).size, sha256: hash, at: now() });
      }
      return { name, stored, sha256: hash };
    },

    /** Забрать из ящика другой стороны всё новое и целое в destDir. Недокачанное (размер/sha не сошлись) ждёт следующего раза. */
    async receive(destDir) {
      if (!this.status().paired) return { got: [], waiting: 0 };
      const dir = box(other(role));
      if (!existsSync(dir)) return { got: [], waiting: 0 };
      mkdirSync(destDir, { recursive: true });
      const s = state(); s.received ??= {};
      const got = []; let waiting = 0;
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.meta.json'))) {
        const m = readJson(join(dir, f), null);
        if (!m?.stored || !m.sha256 || s.received[m.sha256]) continue;
        const src = join(dir, safeName(m.stored));
        if (!existsSync(src) || statSync(src).size !== m.size || (await fileSha(src)) !== m.sha256) { waiting++; continue; }
        let out = join(destDir, safeName(m.name));
        if (existsSync(out)) out = join(destDir, `${m.sha256.slice(0, 6)}_${safeName(m.name)}`);
        copyFileSync(src, `${out}.part`);
        if ((await fileSha(`${out}.part`)) !== m.sha256) { unlinkSync(`${out}.part`); waiting++; continue; }
        renameSync(`${out}.part`, out);
        s.received[m.sha256] = { name: m.name, at: now() };
        got.push(out);
      }
      writeJson(stateFile, s);
      return { got, waiting };
    },
  };
}
