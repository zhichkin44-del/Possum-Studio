// Настройки на компьютере владельца (%APPDATA%\PossumStudio\settings.json). Ключи вводит только он; в логах их нет.
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
const SECRET_SUB = ['clientSecret', 'refreshToken', 'accessToken', 'botToken'];

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

export function loadSettings(path = settingsPath()) {
  let saved = {};
  if (existsSync(path)) { try { saved = JSON.parse(readFileSync(path, 'utf8')); } catch { saved = {}; } }
  return merge(structuredClone(DEFAULTS), saved);
}

export function saveSettings(path, patch) {
  const next = merge(loadSettings(path), patch);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
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
