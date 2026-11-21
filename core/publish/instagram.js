// Instagram Reels. The official API takes a video only by a public link, so by default — a manual package:
// a ready file + the caption in the clipboard; the partner/owner publishes from the Instagram app themselves.
const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

export function manualPackage({ file, caption }) {
  return {
    platform: 'instagram', id: null, url: null, manual: true,
    steps: ['Откройте Instagram → «+» → Reels', `Выберите файл ${file}`, 'Вставьте подпись (она уже скопирована)', 'Добавьте популярный звук в самом Instagram и опубликуйте'],
    caption, warnings: [],
  };
}

/** Publishing via the API — only if the owner gave a public link to the video (videoUrl). */
export async function publishInstagram({ videoUrl, caption, userId, accessToken, fetchImpl = fetch, confirm = false, sleep = sleepDefault, base = 'https://graph.instagram.com', pollMs = 60_000, maxPolls = 5 }) {
  if (confirm !== true) throw new Error('Выкладка только по кнопке владельца');
  if (!accessToken || !userId) throw new Error('Instagram не подключён: укажите ID и токен в Настройках');
  if (!videoUrl) throw new Error('Для API Instagram нужна публичная ссылка на видео; без неё — выкладка вручную');
  const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  const create = await fetchImpl(`${base}/${userId}/media`, { method: 'POST', headers: auth, body: new URLSearchParams({ media_type: 'REELS', video_url: videoUrl, caption }).toString() });
  const c = await create.json().catch(() => ({}));
  if (!create.ok || !c.id) throw new Error(`Instagram не принял видео: ${c.error?.message ?? create.status}`);

  // container status: once a minute, no longer than 5 minutes
  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollMs);
    const s = await fetchImpl(`${base}/${c.id}?fields=status_code`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const st = (await s.json().catch(() => ({}))).status_code;
    if (st === 'FINISHED') {
      const pub = await fetchImpl(`${base}/${userId}/media_publish`, { method: 'POST', headers: auth, body: new URLSearchParams({ creation_id: c.id }).toString() });
      const p = await pub.json().catch(() => ({}));
      if (!pub.ok || !p.id) throw new Error(`Instagram: публикация не прошла (${p.error?.message ?? pub.status})`);
      return { platform: 'instagram', id: p.id, url: null, warnings: [] };
    }
    if (st === 'ERROR' || st === 'EXPIRED') throw new Error(`Instagram: обработка видео — ${st}`);
  }
  throw new Error('Instagram обрабатывает видео дольше 5 минут — попробуйте позже');
}
