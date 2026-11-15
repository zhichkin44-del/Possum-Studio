// Студия целиком для бота и приложения: настройки, монтаж, вход в площадки, выкладка по кнопке.
// Ключи живут только в settings.json владельца; наружу (в бот, в окно, в лог) уходят замаскированными.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, saveSettings, maskSettings, redactSecrets, settingsPath } from './settings.js';
import { createMedia } from './media.js';
import { createAi } from './ai.js';
import { findFont } from './assets.js';
import { processVideo } from './pipeline.js';
import { publishOne, PLATFORMS } from './publish/index.js';
import { createLog } from './publishedlog.js';
import { signIn } from './oauth.js';

export { PLATFORMS };

/** С экрана настроек приходят замаскированные «•••1234» и пустые поля: они не должны затирать настоящие ключи. */
export function dropMasked(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string' && (v.startsWith('•••') || (v === '' && SECRET_KEYS.has(k)))) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? dropMasked(v) : v;
  }
  return out;
}
const SECRET_KEYS = new Set(['claudeKey', 'clientSecret', 'refreshToken', 'accessToken', 'botToken']);

export function createStudio({ path = settingsPath(), dataRoot, media = createMedia(), fetchImpl = fetch, aiFactory = createAi, log = () => {} } = {}) {
  if (!dataRoot) throw new Error('createStudio: нужен dataRoot');
  const outRoot = join(dataRoot, 'Готово');
  const assetsDir = join(dataRoot, '.assets');
  mkdirSync(outRoot, { recursive: true });
  const published = createLog(join(dataRoot, 'published.jsonl'));
  const settings = () => loadSettings(path);
  const safe = (e) => new Error(redactSecrets(e?.message ?? e, settings()));

  async function process(src, onStep = () => {}, opts = {}) {
    const s = settings();
    const ai = aiFactory({ apiKey: s.claudeKey, model: s.model, fetchImpl });
    try {
      return await processVideo({
        src, outRoot, settings: s, media, ai, assetsDir, musicDir: s.folders?.music ?? join(dataRoot, 'Музыка'),
        font: findFont(), onStep, ...opts,
      });
    } catch (e) { throw safe(e); }
  }

  const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

  /** confirm должен прийти только из нажатия кнопки владельцем. */
  const inFlight = new Set(); // «файл|площадка» — пока идёт выкладка, второй раз не начинаем
  async function publish(platform, manifestOrDir, { confirm = false } = {}) {
    const manifest = typeof manifestOrDir === 'string' ? readManifest(manifestOrDir) : manifestOrDir;
    const key = `${manifest.outputs?.[platform === 'instagram' ? 'reels' : platform]}|${platform}`;
    if (inFlight.has(key)) return { platform, skipped: true, note: 'Уже выкладывается — подождите' };
    inFlight.add(key);
    try {
      const s = settings();
      // TikTok меняет refresh-токен при обновлении: сохраняем сразу, даже если загрузка потом упадёт
      const onRefreshToken = (t) => saveSettings(path, { tiktok: { refreshToken: t } });
      const res = await publishOne(platform, manifest, { settings: s, log: published, fetchImpl, confirm, onRefreshToken });
      log(`выкладка ${platform}: ${res.skipped ? 'уже было' : res.manual ? 'ручной пакет' : res.id}`);
      return res;
    } finally { inFlight.delete(key); }
  }

  /** Вход владельца: открывает браузер, ждёт ответ на 127.0.0.1, сохраняет refresh-токен. Возвращает только «подключено». */
  async function connect(kind, openUrl) {
    const s = settings();
    const creds = kind === 'youtube' ? s.youtube : s.tiktok;
    try {
      const r = await signIn(kind === 'youtube' ? 'google' : 'tiktok', creds, { openUrl, fetchImpl, port: kind === 'tiktok' ? 17841 : 0 });
      if (!r.refreshToken) throw new Error('площадка не выдала постоянный доступ — повторите вход');
      saveSettings(path, { [kind]: { refreshToken: r.refreshToken } });
      return { connected: true };
    } catch (e) { throw safe(e); }
  }

  function status() {
    const s = settings();
    return {
      claude: Boolean(s.claudeKey), youtube: Boolean(s.youtube?.refreshToken), tiktok: Boolean(s.tiktok?.refreshToken),
      instagram: Boolean(s.instagram?.accessToken && s.instagram?.videoUrl), ffmpeg: Boolean(media.tools?.ffmpeg ?? true),
    };
  }

  return {
    outRoot, settingsPath: path, process, publish, connect, status, readManifest,
    masked: () => maskSettings(settings()),
    save: (patch) => maskSettings(saveSettings(path, dropMasked(patch))),
    wasPublished: (file, platform) => published.was(file, platform),
    hasManifest: (dir) => existsSync(join(dir, 'manifest.json')),
  };
}
