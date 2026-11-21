// TikTok: "to drafts" (inbox, scope video.upload). The owner opens the notification in TikTok, adds the trending sound and publishes it himself.
import { openSync, readSync, closeSync, statSync } from 'node:fs';

const MB = 1024 * 1024;
/** Up to 64 MB — in one piece; larger — in 10 MB chunks, the last chunk takes the remainder. */
export function chunkPlan(size) {
  if (size <= 64 * MB) return { chunkSize: size, total: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, total: Math.floor(size / chunkSize) };
}

export function chunkRanges(size) {
  const { chunkSize, total } = chunkPlan(size);
  const out = [];
  for (let i = 0; i < total; i++) {
    const start = i * chunkSize;
    const end = i === total - 1 ? size - 1 : start + chunkSize - 1;
    out.push({ start, end });
  }
  return out;
}

export async function draftTiktok({ file, accessToken, fetchImpl = fetch, confirm = false }) {
  if (confirm !== true) throw new Error('Выкладка только по кнопке владельца');
  if (!accessToken) throw new Error('TikTok не подключён: войдите в Настройках');
  const size = statSync(file).size;
  const { chunkSize, total } = chunkPlan(size);
  const init = await fetchImpl('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: total } }),
  });
  const j = await init.json().catch(() => ({}));
  if (!init.ok || (j.error?.code && j.error.code !== 'ok')) {
    const code = j.error?.code ?? init.status;
    const hint = code === 'spam_risk_too_many_pending_share' ? ' — в TikTok уже 5 неразобранных черновиков, опубликуйте их' : '';
    throw new Error(`TikTok отклонил: ${code}${hint}`);
  }
  const { publish_id: publishId, upload_url: uploadUrl } = j.data ?? {};
  const fd = openSync(file, 'r');
  try {
    for (const { start, end } of chunkRanges(size)) {
      const buf = Buffer.alloc(end - start + 1);
      readSync(fd, buf, 0, buf.length, start);
      const r = await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}` },
        body: buf,
      });
      if (!r.ok) throw new Error(`TikTok: кусок ${start}-${end} не принят (${r.status})`);
    }
  } finally { closeSync(fd); }
  return { platform: 'tiktok', id: publishId, url: null, note: 'Видео во входящих TikTok: откройте уведомление, добавьте звук и опубликуйте', warnings: [] };
}
