// Settings on the owner's computer (%APPDATA%\PossumStudio\settings.json). Only the owner enters keys; they are not in the logs.
// Keys (claudeKey and platform secrets) are stored in the file only encrypted via Electron safeStorage
// (on Windows — DPAPI, bound to the user account): {"enc":"ss1","v":"<base64>"}. Never as plain text.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { OR_PRICES, providerOf, modelFor } from './openrouter.js';

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
/** File format version. 1 — without the schema field (before the "Claude key" step in the wizard). */
export const SCHEMA = 2;
const OLD_MODEL = /^claude-(instant|[123]([-.]|$))/;
const RENAMED = { anthropicKey: 'claudeKey', apiKey: 'claudeKey' };

/** Migrates a file of the previous format to the current one: keys, platforms and folders are kept. */
export function migrateSettings(saved = {}) {
  const out = { ...saved };
  for (const [from, to] of Object.entries(RENAMED)) {
    if (from in out) { if (!out[to] && typeof out[from] === 'string') out[to] = out[from]; delete out[from]; }
  }
  if (typeof out.model !== 'string' || (!OR_PRICES[out.model] && (!out.model.startsWith('claude-') || OLD_MODEL.test(out.model)))) out.model = DEFAULTS.model;
  if (!out.schema || out.schema < 2) out.wizardDone = false; // the wizard has a new step: the Claude key now or later
  out.schema = SCHEMA;
  return out;
}

const SECRET_SUB = ['clientSecret', 'refreshToken', 'accessToken', 'botToken'];
const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'telegram'];
const ENC = 'ss1';
export const NO_CRYPTO = 'Ключ не сохранён: шифрование Windows недоступно на этом компьютере. Открытым текстом ключи не храним.';
export const NO_CRYPTO_SIGNIN = 'Вход не сохранён: шифрование Windows недоступно на этом компьютере. Открытым текстом ключи не храним.';
export const OLD_KEY = 'Ключ в файле старый, введите заново: шифрование Windows недоступно, открытым текстом ключи не храним.';

/** Key storage: Electron safeStorage (isEncryptionAvailable, encryptString, decryptString). Without it keys are not written. */
let vault = null;
export function setVault(v) { vault = v ?? null; }
const canEncrypt = () => { try { return Boolean(vault?.isEncryptionAvailable?.()); } catch { return false; } };
const isBlob = (v) => Boolean(v && typeof v === 'object' && v.enc === ENC && typeof v.v === 'string');

/** Plain key → {enc, v}. An empty one stays empty; no encryption — an error, nothing goes to disk. */
function seal(v) {
  if (typeof v !== 'string' || v === '') return v;
  if (!canEncrypt()) throw new Error(NO_CRYPTO);
  return { enc: ENC, v: Buffer.from(vault.encryptString(v)).toString('base64') };
}
/** {enc, v} → key. Cannot be decrypted (another computer or account) — empty, the cipher stays in the file. */
function unseal(v) {
  if (!isBlob(v)) return v;
  try { return vault ? String(vault.decryptString(Buffer.from(v.v, 'base64'))) : ''; } catch { return ''; }
}
/** Applies fn to each key: claudeKey and the secret fields of the platforms. */
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

// On Windows the file mode (0600) does not protect keys — the only protection here is the DPAPI encryption above.
const FILE_OPTS = process.platform === 'win32' ? {} : { mode: 0o600 };
/** The only file write: a plain-text key cannot get through here. */
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

/** Settings with decrypted keys (in memory). An old format or a plain key in the file — the file is rewritten, the keys are encrypted. */
export function loadSettings(path = settingsPath()) {
  const saved = readRaw(path);
  if (!saved) return merge(structuredClone(DEFAULTS), { schema: SCHEMA });
  const raw = migrateSettings(saved);
  if (existsSync(path) && (saved.schema !== SCHEMA || (hasPlain(raw) && canEncrypt()))) {
    // no encryption — we do not rewrite: we do not write in plain text, we wait until encryption becomes available
    try { writeRaw(path, mapSecrets(merge(structuredClone(DEFAULTS), raw), seal)); } catch { /* read-only or no encryption */ }
  }
  return merge(structuredClone(DEFAULTS), mapSecrets(raw, unseal));
}

/** Without encryption the old plain keys in the file are not rewritten and do not hold the other settings: they are removed. */
const dropPlain = (s) => mapSecrets(s, (v) => (typeof v === 'string' && v ? '' : v));
/** Removes new keys (non-empty strings) from the patch: without encryption we do not write them. Empty ones ("delete") are kept. */
function stripPlain(s) {
  const plain = (v) => typeof v === 'string' && v !== '';
  const out = { ...s };
  if (plain(out.claudeKey)) delete out.claudeKey;
  for (const k of PLATFORMS) {
    if (!out[k] || typeof out[k] !== 'object') continue;
    out[k] = { ...out[k] };
    for (const f of SECRET_SUB) if (plain(out[k][f])) delete out[k][f];
  }
  return out;
}

/** Warning for the settings window: the file has an old plain key, and there is nothing to encrypt it with. */
export function oldKeyWarning(path = settingsPath()) {
  return !canEncrypt() && hasPlain(migrateSettings(readRaw(path) ?? {})) ? OLD_KEY : undefined;
}

const SECRET_PATH = new RegExp(`^(claudeKey|(${PLATFORMS.join('|')})\\.(${SECRET_SUB.join('|')}))$`);
const CUT = /^[^\s\/\\]{0,24}…[^\s\/\\]{0,8}$/; // "sk-ant…3456": one short string without spaces and slashes

/**
 * Not a real value of the name field: the mask "•••1234" — in any field; the shortened "sk-ant…3456" — only in a key field
 * (claudeKey, <platform>.clientSecret/refreshToken/accessToken/botToken). In a path, name or model "…" is part of the value.
 * A copy is in app/ui/form.js (the window cannot import this module); a test checks that they match.
 */
export function isShown(v, name = '') {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return t.startsWith('•••') || (SECRET_PATH.test(String(name ?? '')) && CUT.test(t));
}

/** The mask "•••1234" and the shortened key "sk-ant…3456" do not overwrite the real key (isShown by the field path). An empty field — "delete the key" — passes through. */
export function dropMasked(patch, base = '') {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    const path = base ? `${base}.${k}` : k;
    if (isShown(v, path)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? dropMasked(v, path) : v;
  }
  return out;
}

/**
 * Saves the patch: keys are encrypted; unreadable ciphers in the file are not lost; an empty key — delete the key; the mask "•••1234" and the shortened key "sk-ant…3456" — do not touch.
 * No encryption: the old plain key is removed from the file (OLD_KEY), new keys from the patch are dropped (NO_CRYPTO),
 * other fields are kept. In the reply, warnings — all the warnings, warning — they in one line for the window. They are not written to the file.
 */
export function saveSettings(path, patch) {
  let saved = migrateSettings(readRaw(path) ?? {});
  const warnings = [];
  if (!canEncrypt() && hasPlain(saved)) { saved = dropPlain(saved); warnings.push(OLD_KEY); }
  let { warning: _w, warnings: _ws, ...clean } = dropMasked(patch ?? {}); // the window's warnings do not go back into the file
  delete saved.warning; delete saved.warnings;
  if (!canEncrypt() && hasPlain(clean)) { clean = stripPlain(clean); warnings.push(NO_CRYPTO); }
  const next = mapSecrets(merge(merge(structuredClone(DEFAULTS), saved), clean), seal);
  next.schema = SCHEMA;
  writeRaw(path, next);
  const out = merge(structuredClone(DEFAULTS), mapSecrets(next, unseal));
  if (warnings.length) { out.warnings = warnings; out.warning = warnings.join(' '); }
  return out;
}

const mask = (v) => (v ? `•••${String(v).slice(-4)}` : '');

/** For the settings screen: secrets are shown only with their last 4 characters. */
export function maskSettings(s) {
  const out = structuredClone(s);
  out.claudeKey = mask(s.claudeKey);
  out.provider = providerOf(s.claudeKey);       // 'anthropic' | 'openrouter' | ''
  out.aiModel = modelFor(s.claudeKey, s.model); // which model the texts will use — the window calculates the spend by it
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

/** Cuts keys out of an error text before showing or writing it. */
export function redactSecrets(text, s = {}) {
  let out = String(text ?? '');
  for (const v of secretValues(s)) out = out.split(v).join('***');
  return out.replace(/sk-(?:ant|or)-[\w-]+/g, '***').replace(/(Bearer\s+)[\w.\-~+/]+=*/gi, '$1***');
}
