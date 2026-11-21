// YouTube Shorts: resumable upload, privacyStatus set explicitly and verified, cover. Only by the owner's button.
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';

export async function uploadYoutube({ file, meta, cover, accessToken, fetchImpl = fetch, confirm = false }) {
  if (confirm !== true) throw new Error('Выкладка только по кнопке владельца');
  if (!accessToken) throw new Error('YouTube не подключён: войдите в Настройках');
  const size = statSync(file).size;
  const auth = { Authorization: `Bearer ${accessToken}` };
  const want = meta.privacyStatus ?? 'public';
  const init = await fetchImpl('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({
      snippet: { title: meta.title, description: meta.description ?? '', tags: meta.tags ?? [], categoryId: '15' },
      status: { privacyStatus: want, selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) throw new Error(`YouTube отклонил загрузку: ${init.status} ${(await init.text().catch(() => '')).slice(0, 300)}`);
  const location = init.headers.get('location');
  if (!location) throw new Error('YouTube не дал адрес загрузки');

  const put = await fetchImpl(location, { method: 'PUT', headers: { ...auth, 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body: Readable.toWeb(createReadStream(file)), duplex: 'half' }); // stream: the video is not loaded into memory as a whole
  if (!put.ok) throw new Error(`YouTube: загрузка оборвалась (${put.status})`);
  const video = await put.json();
  const warnings = [];
  const got = video.status?.privacyStatus;
  if (got && got !== want) warnings.push(`YouTube поставил доступ «${got}» вместо «${want}» — проверьте в Студии YouTube`);

  if (cover) {
    const t = await fetchImpl(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(video.id)}`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: readFileSync(cover),
    });
    if (!t.ok) warnings.push('Обложку YouTube не принял (нужен подтверждённый канал) — видео выложено');
  }
  return { platform: 'youtube', id: video.id, url: `https://youtube.com/shorts/${video.id}`, privacyStatus: got ?? want, warnings };
}
