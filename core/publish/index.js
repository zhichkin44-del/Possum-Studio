// Одна точка выкладки для бота и приложения: обновляет токен, выкладывает, пишет в журнал, не выкладывает дважды.
import { google, tiktok } from '../oauth.js';
import { uploadYoutube } from './youtube.js';
import { draftTiktok } from './tiktok.js';
import { manualPackage, publishInstagram } from './instagram.js';
import { redactSecrets } from '../settings.js';

export const PLATFORMS = ['youtube', 'tiktok', 'instagram'];

export async function publishOne(platform, manifest, { settings, log, fetchImpl = fetch, confirm = false, sleep, onRefreshToken } = {}) {
  if (confirm !== true) throw new Error('Выкладка только по кнопке владельца');
  const file = manifest.outputs[platform === 'instagram' ? 'reels' : platform];
  if (!file) throw new Error(`Нет монтажа для ${platform}`);
  if (log?.was(file, platform)) return { platform, skipped: true, note: 'Уже выложено раньше — второй раз не выкладываю' };
  try {
    let res;
    if (platform === 'youtube') {
      const y = settings.youtube ?? {};
      if (!y.refreshToken) throw new Error('YouTube не подключён: Настройки → «Войти в YouTube»');
      const t = await google.refresh({ fetchImpl, clientId: y.clientId, clientSecret: y.clientSecret, refreshToken: y.refreshToken });
      res = await uploadYoutube({ file, meta: manifest.packages.youtube, cover: manifest.cover, accessToken: t.access_token, fetchImpl, confirm });
    } else if (platform === 'tiktok') {
      const k = settings.tiktok ?? {};
      if (!k.refreshToken) throw new Error('TikTok не подключён: Настройки → «Войти в TikTok»');
      const t = await tiktok.refresh({ fetchImpl, clientKey: k.clientKey, clientSecret: k.clientSecret, refreshToken: k.refreshToken });
      // TikTok меняет refresh-токен: старый уже не работает, сохраняем до загрузки
      if (t.refresh_token && t.refresh_token !== k.refreshToken) onRefreshToken?.(t.refresh_token);
      res = await draftTiktok({ file, accessToken: t.access_token, fetchImpl, confirm });
    } else if (platform === 'instagram') {
      const i = settings.instagram ?? {};
      res = i.videoUrl && i.accessToken
        ? await publishInstagram({ videoUrl: i.videoUrl, caption: manifest.packages.instagram.caption, userId: i.userId, accessToken: i.accessToken, fetchImpl, confirm, sleep })
        : manualPackage({ file, caption: manifest.packages.instagram.caption });
    } else throw new Error(`Неизвестная площадка ${platform}`);
    if (res.id && log) log.add({ file, platform, id: res.id, url: res.url });
    return res;
  } catch (e) {
    // в сообщениях об ошибках не должно остаться ни одного ключа
    throw new Error(redactSecrets(e.message, settings));
  }
}
