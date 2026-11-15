// Связка окна, студии и пары «Монтажёр ↔ напарница». Без Electron: тестируется обычным node --test.
// Напарница с готовой парой ничего не монтирует — отправляет видео монтажёру; монтажёр монтирует и шлёт ей готовые ролики.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function createHub({ studio, inDir, root, send = () => {} }) {
  const pair = () => {
    try { const p = studio.pairing(); return p && p.status().paired ? p : null; } catch { return null; }
  };
  const role = () => { try { return studio.pairing()?.status().role ?? null; } catch { return null; } };

  /** Пачка из «Входящих». */
  async function batch(files, onProgress = () => {}) {
    const p = pair();
    if (p && role() === 'partner') {
      const res = { files: [], errors: [], made: [], decisions: [], disk: studio.disk?.() ?? null, sent: true };
      for (const [i, f] of files.entries()) {
        const name = f.split(/[\\/]/).pop();
        onProgress({ stage: 'разбор', i, n: files.length, name, eta: null });
        try { await p.send(f); res.files.push({ file: f, id: name }); }
        catch (e) { res.errors.push({ file: name, error: String(e?.message ?? e) }); }
      }
      return res;
    }
    return studio.runBatch(files, (x) => { onProgress(x); send('progress', x); });
  }

  /** После пачки у монтажёра: готовые ролики и тексты уходят напарнице. */
  async function afterBatch(res) {
    const p = pair();
    if (!p || role() !== 'owner' || res?.sent) return [];
    const out = [];
    for (const m of res?.made ?? []) {
      const base = `${m.day ?? 'ролик'}_${m.kind}`;
      try {
        out.push(await p.send(join(m.dir, 'video.mp4'), { name: `${base}.mp4` }));
        if (existsSync(join(m.dir, 'пост.txt'))) out.push(await p.send(join(m.dir, 'пост.txt'), { name: `${base}.txt` }));
      } catch (e) { send('error', `Не отправил напарнице ${base}: ${e?.message ?? e}`); }
    }
    return out;
  }

  /** При каждом скане: забрать, что прислала другая сторона. */
  async function poll() {
    const p = pair();
    if (!p) return { got: [], waiting: 0 };
    const dest = role() === 'owner' ? inDir : join(root, 'Готово', 'От монтажёра');
    try { return await p.receive(dest); } catch { return { got: [], waiting: 0 }; }
  }

  return { batch, afterBatch, poll, role };
}
