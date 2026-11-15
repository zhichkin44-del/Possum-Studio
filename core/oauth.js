// Вход владельца в YouTube и TikTok через браузер (loopback + PKCE). Токены уходят только в settings.json, в логи — никогда.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Google — base64url(SHA256), TikTok — hex(SHA256): у них разные требования. */
export function pkce(kind = 'google') {
  const verifier = b64url(randomBytes(48));
  const digest = createHash('sha256').update(verifier).digest();
  return { verifier, challenge: kind === 'tiktok' ? digest.toString('hex') : b64url(digest), method: 'S256' };
}

export const state = () => b64url(randomBytes(16));

export function googleAuthUrl({ clientId, redirectUri, challenge, state: st }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    code_challenge: challenge, code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent', state: st,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export function tiktokAuthUrl({ clientKey, redirectUri, challenge, state: st }) {
  const q = new URLSearchParams({
    client_key: clientKey, redirect_uri: redirectUri, response_type: 'code',
    scope: 'user.info.basic,video.upload', code_challenge: challenge, code_challenge_method: 'S256', state: st,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

/** Ждёт один редирект на http://127.0.0.1:<port>/callback/ и отдаёт code. */
export function startLoopback({ port = 0, host = '127.0.0.1', timeoutMs = 5 * 60_000 } = {}) {
  return new Promise((resolveStart, rejectStart) => {
    let done;
    const result = new Promise((res, rej) => { done = { res, rej }; });
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://${host}`);
      if (!url.pathname.startsWith('/callback')) { res.writeHead(404).end(); return; }
      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(code ? '<h2>Готово. Можно закрыть вкладку и вернуться в приложение.</h2>' : '<h2>Вход отменён. Закройте вкладку.</h2>');
      clearTimeout(timer); server.close();
      if (code) done.res({ code, state: url.searchParams.get('state') }); else done.rej(new Error(`Вход не выполнен: ${err ?? 'нет кода'}`));
    });
    const timer = setTimeout(() => { server.close(); done.rej(new Error('Вход не завершён за 5 минут')); }, timeoutMs);
    server.on('error', rejectStart);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolveStart({ redirectUri: `http://${host}:${p}/callback/`, port: p, wait: () => result, close: () => { clearTimeout(timer); server.close(); } });
    });
  });
}

async function postForm(fetchImpl, url, body) {
  const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Вход: ${j.error_description ?? j.error?.message ?? j.error ?? r.status}`);
  return j;
}

export const google = {
  exchange: ({ fetchImpl = fetch, clientId, clientSecret, code, verifier, redirectUri }) => postForm(fetchImpl, 'https://oauth2.googleapis.com/token', {
    client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri,
  }),
  refresh: ({ fetchImpl = fetch, clientId, clientSecret, refreshToken }) => postForm(fetchImpl, 'https://oauth2.googleapis.com/token', {
    client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
  }),
};

export const tiktok = {
  exchange: ({ fetchImpl = fetch, clientKey, clientSecret, code, verifier, redirectUri }) => postForm(fetchImpl, 'https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: clientKey, client_secret: clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri,
  }),
  refresh: ({ fetchImpl = fetch, clientKey, clientSecret, refreshToken }) => postForm(fetchImpl, 'https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: clientKey, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
  }),
};

/**
 * Полный вход: поднять loopback, открыть браузер (openUrl), дождаться кода, обменять на токены.
 * Возвращает { refreshToken, accessToken } — вызывающий сам сохраняет в настройки.
 */
export async function signIn(kind, creds, { openUrl, fetchImpl = fetch, port } = {}) {
  const lb = await startLoopback({ port: port ?? (kind === 'tiktok' ? 17841 : 0) });
  try {
    const p = pkce(kind), st = state();
    const url = kind === 'tiktok'
      ? tiktokAuthUrl({ clientKey: creds.clientKey, redirectUri: lb.redirectUri, challenge: p.challenge, state: st })
      : googleAuthUrl({ clientId: creds.clientId, redirectUri: lb.redirectUri, challenge: p.challenge, state: st });
    await openUrl(url);
    const { code, state: back } = await lb.wait();
    if (back !== st) throw new Error('Вход: ответ не от нашего запроса (state не совпал)');
    const api = kind === 'tiktok' ? tiktok : google;
    const t = await api.exchange({ fetchImpl, ...creds, code, verifier: p.verifier, redirectUri: lb.redirectUri });
    return { refreshToken: t.refresh_token, accessToken: t.access_token };
  } finally { lb.close(); }
}
