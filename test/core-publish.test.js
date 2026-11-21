// Login, publishing and editing: network stubbed, not a single real key or outgoing request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pkce, googleAuthUrl, tiktokAuthUrl, startLoopback, signIn } from '../core/oauth.js';
import { uploadYoutube } from '../core/publish/youtube.js';
import { chunkPlan, chunkRanges, draftTiktok } from '../core/publish/tiktok.js';
import { publishInstagram, manualPackage } from '../core/publish/instagram.js';
import { publishOne } from '../core/publish/index.js';
import { createLog } from '../core/publishedlog.js';
import { buildRenderArgs, wrapLines } from '../core/render.js';
import { makePlan } from '../core/plan.js';
import { findFont } from '../core/assets.js';
import { createMedia } from '../core/media.js';
import { createAi } from '../core/ai.js';
import { processVideo } from '../core/pipeline.js';

const MB = 1024 * 1024;
const tmp = () => mkdtempSync(join(tmpdir(), 'possum-pub-'));

/** Fake network: answers from a list of rules and remembers all calls. */
function fakeFetch(rules) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method ?? 'GET', headers: opts.headers ?? {}, body: opts.body });
    const rule = rules.find((r) => r.match(String(url), opts));
    if (!rule) throw new Error(`нет правила для ${url}`);
    const { status = 200, json = {}, headers = {} } = typeof rule.reply === 'function' ? rule.reply(String(url), opts) : rule.reply;
    return {
      ok: status >= 200 && status < 300, status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => json, text: async () => JSON.stringify(json),
    };
  };
  fn.calls = calls;
  return fn;
}

function fileOf(bytes) {
  const d = tmp();
  const f = join(d, 'v.mp4');
  writeFileSync(f, Buffer.alloc(bytes, 7));
  return { dir: d, file: f };
}

test('PKCE: Google — base64url, TikTok — hex, both SHA-256 of the verifier', () => {
  const g = pkce('google'), t = pkce('tiktok');
  const sha = (v) => createHash('sha256').update(v).digest();
  assert.equal(g.challenge, sha(g.verifier).toString('base64url'));
  assert.equal(t.challenge, sha(t.verifier).toString('hex'));
  assert.match(t.challenge, /^[0-9a-f]{64}$/);
  assert.ok(g.verifier.length >= 43 && g.verifier.length <= 128);
});

test('sign-in links: Google offline access and TikTok draft permissions', () => {
  const g = new URL(googleAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5/callback/', challenge: 'ch', state: 'st' }));
  assert.equal(g.searchParams.get('access_type'), 'offline');
  assert.equal(g.searchParams.get('prompt'), 'consent');
  assert.equal(g.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.upload');
  assert.equal(g.searchParams.get('code_challenge_method'), 'S256');
  const t = new URL(tiktokAuthUrl({ clientKey: 'ck', redirectUri: 'http://127.0.0.1:17841/callback/', challenge: 'ch', state: 'st' }));
  assert.equal(t.searchParams.get('scope'), 'user.info.basic,video.upload');
  assert.equal(t.searchParams.get('client_key'), 'ck');
});

test('loopback: accepts the code from the browser and closes', async () => {
  const lb = await startLoopback({ port: 0, timeoutMs: 5000 });
  assert.match(lb.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback\/$/);
  const r = await fetch(`${lb.redirectUri}?code=abc&state=xyz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await lb.wait(), { code: 'abc', state: 'xyz' });
});

test('signIn: foreign state is rejected', async () => {
  const openUrl = async (url) => {
    const redirect = new URL(url).searchParams.get('redirect_uri');
    await fetch(`${redirect}?code=c1&state=evil`);
  };
  await assert.rejects(signIn('google', { clientId: 'a', clientSecret: 'b' }, { openUrl, port: 0, fetchImpl: fakeFetch([]) }), /state/);
});

test('signIn: code exchanged for a refresh token', async () => {
  const fetchImpl = fakeFetch([{ match: (u) => u.includes('oauth2.googleapis.com/token'), reply: { json: { access_token: 'AT', refresh_token: 'RT' } } }]);
  const openUrl = async (url) => {
    const q = new URL(url).searchParams;
    await fetch(`${q.get('redirect_uri')}?code=c1&state=${q.get('state')}`);
  };
  const r = await signIn('google', { clientId: 'a', clientSecret: 'b' }, { openUrl, port: 0, fetchImpl });
  assert.deepEqual(r, { refreshToken: 'RT', accessToken: 'AT' });
  const body = new URLSearchParams(fetchImpl.calls[0].body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.ok(body.get('code_verifier'));
});

test('publishing without the owner button is impossible', async () => {
  const { file } = fileOf(10);
  await assert.rejects(uploadYoutube({ file, meta: { title: 't' }, accessToken: 'x', fetchImpl: fakeFetch([]) }), /кнопке владельца/);
  await assert.rejects(draftTiktok({ file, accessToken: 'x', fetchImpl: fakeFetch([]) }), /кнопке владельца/);
  await assert.rejects(publishInstagram({ videoUrl: 'https://x', caption: '', userId: '1', accessToken: 'x', fetchImpl: fakeFetch([]) }), /кнопке владельца/);
  await assert.rejects(publishOne('youtube', { outputs: { youtube: file } }, { settings: {} }), /кнопке владельца/);
});

test('YouTube: resumable → PUT → thumbnail; access is checked', async () => {
  const { dir, file } = fileOf(2048);
  const cover = join(dir, 'c.jpg'); writeFileSync(cover, 'jpg');
  const fetchImpl = fakeFetch([
    { match: (u) => u.includes('uploadType=resumable'), reply: { headers: { location: 'https://up.example/session1' } } },
    { match: (u) => u === 'https://up.example/session1', reply: { json: { id: 'VID1', status: { privacyStatus: 'private' } } } },
    { match: (u) => u.includes('thumbnails/set'), reply: { status: 403 } },
  ]);
  const r = await uploadYoutube({ file, cover, meta: { title: 'Прыжок #Shorts', tags: ['a'], privacyStatus: 'public' }, accessToken: 'AT', fetchImpl, confirm: true });
  assert.equal(r.id, 'VID1');
  assert.equal(r.url, 'https://youtube.com/shorts/VID1');
  const init = JSON.parse(fetchImpl.calls[0].body);
  assert.equal(init.status.privacyStatus, 'public');
  assert.equal(init.snippet.categoryId, '15');
  assert.equal(fetchImpl.calls[0].headers['X-Upload-Content-Length'], '2048');
  assert.equal(fetchImpl.calls[1].method, 'PUT');
  assert.equal(r.warnings.length, 2, 'both about access and the thumbnail');
  assert.match(r.warnings[0], /private/);
});

test('TikTok: chunks by rules (≤64 MB — one, more — 10 MB each, remainder in the last)', () => {
  assert.deepEqual(chunkPlan(5 * MB), { chunkSize: 5 * MB, total: 1 });
  assert.deepEqual(chunkPlan(64 * MB), { chunkSize: 64 * MB, total: 1 });
  const size = 100 * MB + 12345;
  const rs = chunkRanges(size);
  assert.equal(rs.length, 10);
  assert.equal(rs[0].start, 0);
  assert.equal(rs[9].end, size - 1);
  for (let i = 1; i < rs.length; i++) assert.equal(rs[i].start, rs[i - 1].end + 1);
});

test('TikTok: draft is uploaded, hint at 5 unparsed items', async () => {
  const { file } = fileOf(3000);
  const ok = fakeFetch([
    { match: (u) => u.includes('/inbox/video/init/'), reply: { json: { data: { publish_id: 'P1', upload_url: 'https://up.tt/1' }, error: { code: 'ok' } } } },
    { match: (u) => u === 'https://up.tt/1', reply: { status: 201 } },
  ]);
  const r = await draftTiktok({ file, accessToken: 'AT', fetchImpl: ok, confirm: true });
  assert.equal(r.id, 'P1');
  assert.equal(ok.calls[1].headers['Content-Range'], 'bytes 0-2999/3000');
  const busy = fakeFetch([{ match: () => true, reply: { status: 403, json: { error: { code: 'spam_risk_too_many_pending_share' } } } }]);
  await assert.rejects(draftTiktok({ file, accessToken: 'AT', fetchImpl: busy, confirm: true }), /5 неразобранных/);
});

test('Instagram: container → wait for FINISHED → publish; without link — manual package', async () => {
  let polls = 0;
  const fetchImpl = fakeFetch([
    { match: (u) => u.endsWith('/42/media'), reply: { json: { id: 'C1' } } },
    { match: (u) => u.includes('/C1?fields=status_code'), reply: () => ({ json: { status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' } }) },
    { match: (u) => u.endsWith('/42/media_publish'), reply: { json: { id: 'M9' } } },
  ]);
  const r = await publishInstagram({ videoUrl: 'https://cdn/x.mp4', caption: 'c', userId: '42', accessToken: 'IGT', fetchImpl, confirm: true, sleep: async () => {} });
  assert.equal(r.id, 'M9');
  assert.equal(polls, 2);
  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer IGT');
  assert.ok(!fetchImpl.calls[0].url.includes('IGT'), 'token is not in the URL');
  const m = manualPackage({ file: 'reels.mp4', caption: 'c' });
  assert.equal(m.manual, true);
  assert.ok(m.steps.length >= 3);
});

test('publishOne: refreshes the token, writes the log, does not publish a second time, keys do not leak into errors', async () => {
  const { dir, file } = fileOf(100);
  const log = createLog(join(dir, 'log.jsonl'));
  const manifest = { outputs: { youtube: file }, cover: null, packages: { youtube: { title: 't', privacyStatus: 'public' } } };
  const settings = { youtube: { clientId: 'cid', clientSecret: 'SECRET-123456', refreshToken: 'RT-abcdef' } };
  const fetchImpl = fakeFetch([
    { match: (u) => u.includes('oauth2.googleapis.com/token'), reply: { json: { access_token: 'AT' } } },
    { match: (u) => u.includes('uploadType=resumable'), reply: { headers: { location: 'https://up/1' } } },
    { match: (u) => u === 'https://up/1', reply: { json: { id: 'V1', status: { privacyStatus: 'public' } } } },
  ]);
  const r = await publishOne('youtube', manifest, { settings, log, fetchImpl, confirm: true });
  assert.equal(r.id, 'V1');
  const again = await publishOne('youtube', manifest, { settings, log, fetchImpl, confirm: true });
  assert.equal(again.skipped, true);
  assert.equal(log.all().length, 1);

  const leaky = fakeFetch([{ match: () => true, reply: { status: 400, json: { error: 'bad SECRET-123456 RT-abcdef' } } }]);
  const m2 = { ...manifest, outputs: { youtube: join(dir, 'other.mp4') } };
  writeFileSync(m2.outputs.youtube, 'x');
  await assert.rejects(publishOne('youtube', m2, { settings, log, fetchImpl: leaky, confirm: true }), (e) => !e.message.includes('SECRET-123456') && !e.message.includes('RT-abcdef'));
  await assert.rejects(publishOne('tiktok', { outputs: { tiktok: file } }, { settings: {}, confirm: true, fetchImpl }), /не подключён/);
});

test('render: captions wrap, graph built for the platform', () => {
  assert.deepEqual(wrapLines('Прыжок, которого никто не ждал', 20), ['Прыжок, которого', 'никто не ждал']);
  const a = { duration: 16, best: { t: 9 }, peaks: [{ t: 9, kind: 'move' }, { t: 12, kind: 'squeak' }] };
  const yt = makePlan(a, 'youtube', { music: 'm.wav', captions: { ru: 'Привет', en: 'Hi' } });
  const args = buildRenderArgs({ src: 'in.mp4', plan: yt, hasAudio: true, sfxFiles: { pop: 'p.wav', whoosh: 'w.wav', boing: 'b.wav' }, out: 'o.mp4', captionFiles: { ru: ['r0.txt'], en: ['e0.txt'] } });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /scale=1080:1920/);
  assert.match(graph, /loudnorm=I=-14/);
  assert.match(graph, /volume=-20dB/);
  assert.match(graph, /textfile=r0\.txt/);
  assert.ok(args.includes('m.wav'));
  const tt = makePlan(a, 'tiktok', { music: 'm.wav' });
  const ttArgs = buildRenderArgs({ src: 'in.mp4', plan: tt, hasAudio: false, out: 'o.mp4' });
  assert.ok(!ttArgs.includes('m.wav'), 'in TikTok without music — sound is added in the app');
  assert.match(ttArgs[ttArgs.indexOf('-filter_complex') + 1], /aevalsrc=0/);
});

const media = createMedia();
let hasFfmpeg = true;
try { await media.probe('нет-такого-файла.mp4'); } catch (e) { hasFfmpeg = !/Не найден ffmpeg/.test(e.message); }

test('whole pipeline on a synthetic clip (if ffmpeg is present)', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 240_000 }, async () => {
  const d = tmp();
  const src = join(d, 'clip.mp4');
  await media.ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
  const steps = [];
  const m = await processVideo({
    src, outRoot: join(d, 'out'), settings: { petNames: ['Пип'] }, media, ai: createAi({}),
    assetsDir: join(d, 'assets'), musicDir: null, font: findFont(), profiles: ['reels'], onStep: (s) => steps.push(s),
  });
  assert.ok(existsSync(m.outputs.reels));
  assert.ok(existsSync(m.cover));
  const info = await media.probe(m.outputs.reels);
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.ok(info.hasAudio);
  assert.equal(m.texts.source, 'шаблон');
  assert.ok(!existsSync(join(m.dir, '_work')), 'work folder removed');
  const post = readFileSync(join(m.dir, 'пост.txt'), 'utf8');
  assert.match(post, /Instagram Reels/);
  assert.ok(!/Пип/.test(post), 'pet nickname removed');
  assert.equal(steps.at(-1), 'Готово');
});
