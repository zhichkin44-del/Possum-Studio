// Studio core for the bot and the app: settings are not overwritten by masks, keys do not leak, publishing only with confirm.
// All keys here are made up, network stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudio, dropMasked } from '../core/studio.js';
import { loadSettings, setVault, OLD_KEY, NO_CRYPTO, NO_CRYPTO_SIGNIN } from '../core/settings.js';
import { fakeVault } from './vault.js';

setVault(fakeVault()); // in the window, keys are encrypted by Electron safeStorage; here — its fake

const tmp = () => mkdtempSync(join(tmpdir(), 'possum-studio-'));
const noMedia = { tools: { ffmpeg: 'ffmpeg' }, async signals() { throw new Error('не нужен'); } };

function world(over = {}) {
  const root = tmp();
  const path = join(root, 'cfg', 'settings.json');
  const studio = createStudio({ path, dataRoot: join(root, 'data'), media: noMedia, ...over });
  return { root, path, studio };
}

function fakeFetch(rules) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method ?? 'GET' });
    const rule = rules.find((r) => r.match(String(url)));
    if (!rule) throw new Error(`нет правила для ${url}`);
    const { status = 200, json = {}, headers = {} } = rule.reply;
    return { ok: status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => json, text: async () => JSON.stringify(json) };
  };
  fn.calls = calls;
  return fn;
}

function manifestIn(root) {
  const dir = join(root, 'job');
  mkdirSync(dir, { recursive: true });
  const outputs = { youtube: join(dir, 'youtube.mp4'), tiktok: join(dir, 'tiktok.mp4'), reels: join(dir, 'reels.mp4') };
  for (const f of Object.values(outputs)) writeFileSync(f, Buffer.alloc(500, 1));
  const m = { dir, outputs, cover: null, packages: { youtube: { title: 't', description: 'd', tags: [] }, tiktok: { caption: 'tt' }, instagram: { caption: 'рилс' } } };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  return m;
}

test('dropMasked: masks are dropped, an empty secret stays (this is "delete key"), ordinary fields stay', () => {
  assert.deepEqual(
    dropMasked({ claudeKey: '•••1234', model: 'm', youtube: { clientId: 'id', clientSecret: '', refreshToken: '•••abcd' }, petNames: ['А'] }),
    { model: 'm', youtube: { clientId: 'id', clientSecret: '' }, petNames: ['А'] },
  );
});

test('settings: the screen shows the mask, and saving the mask does not overwrite the key', () => {
  const { path, studio } = world();
  studio.save({ claudeKey: 'test-key-000000abcd', youtube: { clientId: 'cid', clientSecret: 'test-secret-9999' } });
  const shown = studio.masked();
  assert.equal(shown.claudeKey, '•••abcd');
  assert.equal(shown.youtube.clientSecret, '•••9999');
  assert.ok(!JSON.stringify(shown).includes('test-key-000000abcd'));

  studio.save({ ...shown, youtube: { ...shown.youtube, clientId: 'cid2' } });
  const real = loadSettings(path);
  assert.equal(real.claudeKey, 'test-key-000000abcd');
  assert.equal(real.youtube.clientSecret, 'test-secret-9999');
  assert.equal(real.youtube.clientId, 'cid2');
});

test('settings: an empty key field via studio.save deletes the key, other keys stay in place', () => {
  const { path, studio } = world();
  studio.save({ claudeKey: 'test-key-000000abcd', youtube: { clientId: 'cid', clientSecret: 'test-secret-9999' } });
  const shown = studio.save({ ...studio.masked(), claudeKey: '' });
  assert.equal(shown.claudeKey, '', 'the window sees an empty key after "Saved"');
  assert.equal(shown.warning, undefined);
  const real = loadSettings(path);
  assert.equal(real.claudeKey, '', 'key is really deleted');
  assert.equal(real.youtube.clientSecret, 'test-secret-9999', 'the mask of another key did not overwrite it');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).claudeKey, '', 'no key or cipher in the file');
  assert.equal(studio.status().claude, false);
});

test('no encryption, old plain key in the file: other settings are saved, the window asks to enter the key again', () => {
  const { path, studio } = world();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ claudeKey: 'sk-ant-REDACTED1234', tiktok: { clientKey: 'ck' } }));
  setVault(fakeVault({ available: false }));
  try {
    assert.equal(studio.masked().warning, OLD_KEY, 'the warning is visible already when settings are opened');
    const shown = studio.save({ ...studio.masked(), model: 'claude-sonnet-5-5', folders: { music: 'D:/m' } });
    assert.equal(shown.warning, OLD_KEY);
    assert.match(OLD_KEY, /ключ в файле старый, введите заново/i);
    const real = loadSettings(path);
    assert.equal(real.model, 'claude-sonnet-5-5');
    assert.equal(real.folders.music, 'D:/m');
    assert.equal(real.tiktok.clientKey, 'ck');
    assert.ok(!readFileSync(path, 'utf8').includes('old-plain'), 'plain key is no longer in the file');
    assert.ok(!readFileSync(path, 'utf8').includes('warning'), 'warning from the window did not get into the file');
    assert.equal(studio.masked().warning, undefined, 'after saving there is nothing to warn about');
  } finally { setVault(fakeVault()); }
});

test('status: what is connected', () => {
  const { studio } = world();
  assert.deepEqual(studio.status(), { claude: false, youtube: false, tiktok: false, instagram: false, ffmpeg: true, species: { available: false, refs: 0 } });
  studio.save({ claudeKey: 'test-key-123456', youtube: { refreshToken: 'test-rt-123456' } });
  const s = studio.status();
  assert.equal(s.claude, true);
  assert.equal(s.youtube, true);
  assert.equal(s.tiktok, false);
});

test('publishing: without confirm — refusal; without sign-in — clear error; Instagram without link — manual package', async () => {
  const { root, studio } = world();
  const m = manifestIn(root);
  await assert.rejects(studio.publish('youtube', m.dir), /только по кнопке/);
  await assert.rejects(studio.publish('youtube', m.dir, { confirm: true }), /YouTube не подключён/);
  const ig = await studio.publish('instagram', m.dir, { confirm: true });
  assert.equal(ig.manual, true);
  assert.equal(ig.caption, 'рилс');
});

test('TikTok changes the refresh token — the studio saves the new one and does not expose it', async () => {
  const fetchImpl = fakeFetch([
    { match: (u) => u.includes('open.tiktokapis.com/v2/oauth/token/'), reply: { json: { access_token: 'AT', refresh_token: 'test-rt-NEW-777777' } } },
    { match: (u) => u.includes('/inbox/video/init/'), reply: { json: { data: { publish_id: 'P1', upload_url: 'https://up.tt/1' }, error: { code: 'ok' } } } },
    { match: (u) => u === 'https://up.tt/1', reply: { status: 201 } },
  ]);
  const { root, path, studio } = world({ fetchImpl });
  studio.save({ tiktok: { clientKey: 'ck', clientSecret: 'test-cs-111111', refreshToken: 'test-rt-OLD-555555' } });
  const r = await studio.publish('tiktok', manifestIn(root).dir, { confirm: true });
  assert.equal(r.id, 'P1');
  assert.equal(r.newRefreshToken, undefined);
  assert.equal(loadSettings(path).tiktok.refreshToken, 'test-rt-NEW-777777');
  assert.equal(loadSettings(path).tiktok.clientSecret, 'test-cs-111111');
  const again = await studio.publish('tiktok', join(root, 'job'), { confirm: true });
  assert.equal(again.skipped, true, 'does not publish a second time');
});

test('editing error contains no keys', async () => {
  const leaky = { tools: {}, async signals() { throw new Error('сбой с ключом test-key-LEAK-424242'); } };
  const { studio } = world({ media: leaky, aiFactory: () => ({ suggest: async () => ({}) }) });
  studio.save({ claudeKey: 'test-key-LEAK-424242' });
  await assert.rejects(studio.process('x.mp4'), (e) => !e.message.includes('test-key-LEAK-424242') && e.message.includes('***'));
});

test('batch: file shorter than a second is skipped, nothing edited, "add more"', async () => {
  const shortMedia = { tools: { ffmpeg: 'ffmpeg' }, async probe() { return { duration: 0.4, width: 1080, height: 1920, hasAudio: true }; }, async signals() { throw new Error('не нужен'); } };
  const { studio, root } = world({ media: shortMedia });
  const prog = [];
  const r = await studio.runBatch([join(root, 'a.mp4')], (p) => prog.push(p.stage));
  assert.equal(r.files[0].skipped, 'короче секунды — пропущен');
  assert.equal(r.made.length, 0);
  assert.ok(r.decisions.some((d) => d.type === 'more' || d.type === 'disk'));
  if (r.decisions.some((d) => d.type !== 'disk')) assert.equal(prog.at(-1), 'готово');
});

test('batch: media error with a key in the text — key is erased', async () => {
  const leaky = { tools: { ffmpeg: 'ffmpeg' }, async probe() { throw new Error('ffprobe: test-key-leak-777777'); } };
  const { studio, root } = world({ media: leaky });
  studio.save({ claudeKey: 'test-key-leak-777777' });
  const r = await studio.runBatch([join(root, 'a.mp4')]);
  if (r.decisions.some((d) => d.type === 'disk')) return;
  assert.equal(r.errors.length, 1);
  assert.ok(!JSON.stringify(r).includes('test-key-leak-777777'), 'no key in the batch result');
});

test('calendar via the studio: upcoming, A/B choice, "do not publish", disk', () => {
  const { studio } = world();
  const cal = studio.calendar();
  assert.equal(cal, studio.calendar(), 'one calendar per app');
  cal.add({ id: 'a', kind: 'top5', titles: { A: { ru: 'а' }, B: { ru: 'б' } } });
  cal.add({ id: 'b', kind: 'day' });
  let u = studio.upcoming();
  assert.deepEqual(u.slots.map((s) => s.id), ['a', 'b']);
  assert.equal(u.free, 12);
  assert.equal(u.hour, 18);
  assert.equal(studio.pickTitle('a', 'B').pick, 'B');
  assert.equal(studio.pickTitle('a', 'Q'), null);
  assert.equal(studio.pickTitle('нет', 'A'), null);
  studio.skip('a');
  u = studio.upcoming();
  assert.deepEqual(u.slots.map((s) => s.id), ['b']);
  assert.equal(u.free, 13);
  const d = studio.disk();
  assert.ok(d === null || d > 0);
});

test('pair via the studio: null before setup; role and folder errors are clear; status afterwards', () => {
  const { studio, root, path } = world();
  assert.equal(studio.pairing(), null);
  assert.throws(() => studio.pairSetup({ role: 'брат', sharedDir: root }), /монтажёр или я напарница/);
  assert.throws(() => studio.pairSetup({ role: 'owner', sharedDir: '' }), /общую папку/);
  const st = studio.pairSetup({ role: 'owner', sharedDir: join(root, 'Общая') });
  assert.deepEqual([st.role, st.paired], ['owner', false]);
  const { code } = studio.pairing().create();
  assert.match(code, /^\d{6}$/);
  assert.equal(loadSettings(path).pair.role, 'owner');
  studio.save({ claudeKey: 'test-key-x' });
  assert.equal(loadSettings(path).pair.sharedDir, join(root, 'Общая'), 'saving settings does not erase the pair');
});

test('remove a moment via the studio: unknown clip and already published — clear refusal', async () => {
  const { studio, root } = world();
  await assert.rejects(studio.removeMoment('нет', 0), /Ролик не найден/);
  const m = manifestIn(root);
  const cal = studio.calendar();
  cal.add({ id: 'p', kind: 'top5', dir: m.dir });
  cal.markPublished('p');
  await assert.rejects(studio.removeMoment('p', 0), /уже выложен/);
});

test('no encryption: YouTube sign-in does not say "connected", error is clear, no token on disk', async () => {
  const { path, studio } = world({
    fetchImpl: fakeFetch([{ match: (u) => u.includes('oauth2.googleapis.com/token'), reply: { json: { access_token: 'AT', refresh_token: 'test-refresh-RT-424242' } } }]),
  });
  studio.save({ youtube: { clientId: 'cid', clientSecret: 'test-secret-9999' } });
  const openUrl = async (url) => {
    const q = new URL(url).searchParams;
    await fetch(`${q.get('redirect_uri')}?code=c1&state=${q.get('state')}`);
  };
  setVault(fakeVault({ available: false }));
  try {
    await assert.rejects(studio.connect('youtube', openUrl), (e) => e.message === NO_CRYPTO_SIGNIN);
    assert.match(NO_CRYPTO_SIGNIN, /вход не сохранён.*шифровани/i);
    assert.ok(!readFileSync(path, 'utf8').includes('test-refresh-RT-424242'));
  } finally { setVault(fakeVault()); }
  assert.equal(studio.status().youtube, false);
});

test('no encryption: studio.save with a new key gives the window NO_CRYPTO, and the model saves', () => {
  const { path, studio } = world();
  setVault(fakeVault({ available: false }));
  try {
    const shown = studio.save({ model: 'claude-sonnet-5-5', claudeKey: 'sk-ant-REDACTED5555' });
    assert.equal(shown.warning, NO_CRYPTO);
    assert.equal(loadSettings(path).model, 'claude-sonnet-5-5');
    assert.ok(!readFileSync(path, 'utf8').includes('new-5555'));
    assert.equal(studio.masked().warning, undefined, 'after saving, "key in file is old" does not surface');
  } finally { setVault(fakeVault()); }
});
