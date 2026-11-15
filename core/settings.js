// Настройки на компьютере владельца (%APPDATA%\PossumStudio\settings.json). Ключи вводит только он; в логах их нет.
// Ключи (claudeKey и секреты площадок) лежат в файле только зашифрованными через Electron safeStorage
// (на Windows — DPAPI, привязка к учётной записи): {"enc":"ss1","v":"<base64>"}. Открытым текстом — никогда.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULTS = {
  claudeKey: '',
  model: 'claude-opus-5-5',
  youtube: {}, // clientId, clientSecret, refreshToken
  tiktok: {}, // clientKey, clientSecret, refreshToken
  instagram: {}, // userId, accessToken
  telegram: {}, // botToken, ownerId
  allowName: false,
  petNames: ['Владимир Пип', 'Пип', 'Pip'],
  folders: {},
};
/** Версия формата файла. 1 — без поля schema (до шага «Ключ Claude» в мастере). */
export const SCHEMA = 2;
const OLD_MODEL = /^claude-(instant|[123]([-.]|$))/;
const RENAMED = { anthropicKey: 'claudeKey', apiKey: 'claudeKey' };

/** Переносит файл прежнего формата в текущий: ключи, площадки и папки сохраняются. */
export function migrateSettings(saved = {}) {
  const out = { ...saved };
  for (const [from, to] of Object.entries(RENAMED)) {
    if (from in out) { if (!out[to] && typeof out[from] === 'string') out[to] = out[from]; delete out[from]; }
  }
  if (typeof out.model !== 'string' || !out.model.startsWith('claude-') || OLD_MODEL.test(out.model)) out.model = DEFAULTS.model;
  if (!out.schema || out.schema < 2) out.wizardDone = false; // в мастере новый шаг: ключ Claude сейчас или позже
  out.schema = SCHEMA;
  return out;
}

const SECRET_SUB = ['clientSecret', 'refreshToken', 'accessToken', 'botToken'];
const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'telegram'];
const ENC = 'ss1';
export const NO_CRYPTO = 'Ключ не сохранён: шифрование Windows недоступно на этом компьютере. Открытым текстом ключи не храним.';

/** Хранилище ключей: Electron safeStorage (isEncryptionAvailable, encryptString, decryptString). Без него ключи не пишутся. */
let vault = null;
export function setVault(v) { vault = v ?? null; }
const canEncrypt = () => { try { return Boolean(vault?.isEncryptionAvailable?.()); } catch { return false; } };
const isBlob = (v) => Boolean(v && typeof v === 'object' && v.enc === ENC && typeof v.v === 'string');

/** Открытый ключ → {enc, v}. Пустой оставляем пустым; нет шифрования — ошибка, на диск ничего. */
function seal(v) {
  if (typeof v !== 'string' || v === '') return v;
  if (!canEncrypt()) throw new Error(NO_CRYPTO);
  return { enc: ENC, v: Buffer.from(vault.encryptString(v)).toString('base64') };
}
/** {enc, v} → ключ. Не расшифровать (другой компьютер или учётная запись) — пусто, шифр в файле остаётся. */
function unseal(v) {
  if (!isBlob(v)) return v;
  try { return vault ? String(vault.decryptString(Buffer.from(v.v, 'base64'))) : ''; } catch { return ''; }
}
/** Применяет fn к каждому ключу: claudeKey и секретным полям площадок. */
function mapSecrets(s, fn) {
  const out = { ...s };
  if ('claudeKey' in out) out.claudeKey = fn(out.claudeKey);
  for (const k of PLATFORMS) {
    if (!out[k] || typeof out[k] !== 'object') continue;
    out[k] = { ...out[k] };
    for (const f of SECRET_SUB) if (f in out[k]) out[k][f] = fn(out[k][f]);
  }
  return out;
}
const hasPlain = (s) => { let p = false; mapSecrets(s, (v) => { if (typeof v === 'string' && v) p = true; return v; }); return p; };

// На Windows права файла (mode 0600) ключи не закрывают — защита здесь только шифрование DPAPI выше.
const FILE_OPTS = process.platform === 'win32' ? {} : { mode: 0o600 };
/** Единственная запись файла: ключ открытым текстом сюда не пройдёт. */
function writeRaw(path, raw) {
  if (hasPlain(raw)) throw new Error(NO_CRYPTO);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(raw, null, 2), FILE_OPTS);
}
function readRaw(path) {
  if (!existsSync(path)) return {};
  try { const v = JSON.parse(readFileSync(path, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

export function settingsPath(env = process.env) {
  return env.APPDATA ? join(env.APPDATA, 'PossumStudio', 'settings.json') : join(homedir(), '.possumstudio', 'settings.json');
}

function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? { ...base[k], ...v } : v;
  }
  return out;
}

/** Настройки с расшифрованными ключами (в памяти). Старый формат или открытый ключ в файле — файл переписывается, ключи зашифрованы. */
export function loadSettings(path = settingsPath()) {
  const saved = readRaw(path);
  if (!saved) return merge(structuredClone(DEFAULTS), { schema: SCHEMA });
  const raw = migrateSettings(saved);
  if (existsSync(path) && (saved.schema !== SCHEMA || (hasPlain(raw) && canEncrypt()))) {
    // нет шифрования — не переписываем: открытым текстом не пишем, ждём, когда шифрование появится
    try { writeRaw(path, mapSecrets(merge(structuredClone(DEFAULTS), raw), seal)); } catch { /* только чтение или нет шифрования */ }
  }
  return merge(structuredClone(DEFAULTS), mapSecrets(raw, unseal));
}

/** Сохраняет patch: ключи шифруются; нечитаемые шифры в файле не теряются. Нет шифрования и есть ключ — ошибка NO_CRYPTO, файл не меняется. */
export function saveSettings(path, patch) {
  const saved = readRaw(path) ?? {};
  const next = mapSecrets(merge(merge(structuredClone(DEFAULTS), migrateSettings(saved)), patch), seal);
  next.schema = SCHEMA;
  writeRaw(path, next);
  return merge(structuredClone(DEFAULTS), mapSecrets(next, unseal));
}

const mask = (v) => (v ? `•••${String(v).slice(-4)}` : '');

/** Для экрана настроек: секреты видны только последними 4 символами. */
export function maskSettings(s) {
  const out = structuredClone(s);
  out.claudeKey = mask(s.claudeKey);
  for (const k of ['youtube', 'tiktok', 'instagram', 'telegram']) {
    for (const f of SECRET_SUB) if (out[k]?.[f]) out[k][f] = mask(out[k][f]);
  }
  return out;
}

export function secretValues(s = {}) {
  const vals = [s.claudeKey];
  for (const k of ['youtube', 'tiktok', 'instagram', 'telegram']) for (const f of SECRET_SUB) vals.push(s[k]?.[f]);
  return vals.filter((v) => typeof v === 'string' && v.length >= 6);
}

/** Вырезает ключи из текста ошибки перед показом или записью. */
export function redactSecrets(text, s = {}) {
  let out = String(text ?? '');
  for (const v of secretValues(s)) out = out.split(v).join('***');
  return out.replace(/sk-ant-[\w-]+/g, '***').replace(/(Bearer\s+)[\w.\-~+/]+=*/gi, '$1***');
}
