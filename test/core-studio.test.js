// Ядро студии для бота и приложения: настройки не затираются масками, ключи не утекают, выкладка только с confirm.
// Все ключи здесь выдуманные, сеть подменена.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudio, dropMasked } from '../core/studio.js';
import { loadSettings, setVault } from '../core/settings.js';
import { fakeVault } from './vault.js';

setVault(fakeVault()); // в окне ключи шифрует Electron safeStorage; здесь — его подделка

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

test('dropMasked: маски и пустые секреты выкидываются, обычные поля остаются', () => {
  assert.deepEqual(
    dropMasked({ claudeKey: '•••1234', model: 'm', youtube: { clientId: 'id', clientSecret: '', refreshToken: '•••abcd' }, petNames: ['А'] }),
    { model: 'm', youtube: { clientId: 'id' }, petNames: ['А'] },
  );
});

test('настройки: экран показывает маску, а сохранение маски не затирает ключ', () => {
  const { path, studio } = world();
  studio.save({ claudeKey: 'test-key-000000abcd', youtube: { clientId: 'cid', clientSecret: 'test-secret-9999' } });
  const shown = studio.masked();
  assert.equal(shown.claudeKey, '•••abcd');
  assert.equal(shown.youtube.clientSecret, '•••9999');
  assert.ok(!JSON.stringify(shown).includes('test-key-000000abcd'));

  studio.save({ ...shown, youtube: { ...shown.youtube, clientId: 'cid2' }, claudeKey: '' });
  const real = loadSettings(path);
  assert.equal(real.claudeKey, 'test-key-000000abcd');
  assert.equal(real.youtube.clientSecret, 'test-secret-9999');
  assert.equal(real.youtube.clientId, 'cid2');
});

test('статус: что подключено', () => {
  const { studio } = world();
  assert.deepEqual(studio.status(), { claude: false, youtube: false, tiktok: false, instagram: false, ffmpeg: true, species: { available: false, refs: 0 } });
  studio.save({ claudeKey: 'test-key-123456', youtube: { refreshToken: 'test-rt-123456' } });
  const s = studio.status();
  assert.equal(s.claude, true);
  assert.equal(s.youtube, true);
  assert.equal(s.tiktok, false);
});

test('выкладка: без confirm — отказ; без входа — понятная ошибка; Instagram без ссылки — ручной пакет', async () => {
  const { root, studio } = world();
  const m = manifestIn(root);
  await assert.rejects(studio.publish('youtube', m.dir), /только по кнопке/);
  await assert.rejects(studio.publish('youtube', m.dir, { confirm: true }), /YouTube не подключён/);
  const ig = await studio.publish('instagram', m.dir, { confirm: true });
  assert.equal(ig.manual, true);
  assert.equal(ig.caption, 'рилс');
});

test('TikTok меняет refresh-токен — студия сохраняет новый и не отдаёт его наружу', async () => {
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
  assert.equal(again.skipped, true, 'второй раз не выкладывает');
});

test('ошибка монтажа не содержит ключей', async () => {
  const leaky = { tools: {}, async signals() { throw new Error('сбой с ключом test-key-LEAK-424242'); } };
  const { studio } = world({ media: leaky, aiFactory: () => ({ suggest: async () => ({}) }) });
  studio.save({ claudeKey: 'test-key-LEAK-424242' });
  await assert.rejects(studio.process('x.mp4'), (e) => !e.message.includes('test-key-LEAK-424242') && e.message.includes('***'));
});

test('пачка: файл короче секунды пропущен, ничего не смонтировано, «закиньте ещё»', async () => {
  const shortMedia = { tools: { ffmpeg: 'ffmpeg' }, async probe() { return { duration: 0.4, width: 1080, height: 1920, hasAudio: true }; }, async signals() { throw new Error('не нужен'); } };
  const { studio, root } = world({ media: shortMedia });
  const prog = [];
  const r = await studio.runBatch([join(root, 'a.mp4')], (p) => prog.push(p.stage));
  assert.equal(r.files[0].skipped, 'короче секунды — пропущен');
  assert.equal(r.made.length, 0);
  assert.ok(r.decisions.some((d) => d.type === 'more' || d.type === 'disk'));
  if (r.decisions.some((d) => d.type !== 'disk')) assert.equal(prog.at(-1), 'готово');
});

test('пачка: ошибка media с ключом в тексте — ключ вымаран', async () => {
  const leaky = { tools: { ffmpeg: 'ffmpeg' }, async probe() { throw new Error('ffprobe: test-key-leak-777777'); } };
  const { studio, root } = world({ media: leaky });
  studio.save({ claudeKey: 'test-key-leak-777777' });
  const r = await studio.runBatch([join(root, 'a.mp4')]);
  if (r.decisions.some((d) => d.type === 'disk')) return;
  assert.equal(r.errors.length, 1);
  assert.ok(!JSON.stringify(r).includes('test-key-leak-777777'), 'ключа нет в итоге пачки');
});

test('календарь через студию: upcoming, выбор A/B, «не выкладывать», диск', () => {
  const { studio } = world();
  const cal = studio.calendar();
  assert.equal(cal, studio.calendar(), 'один календарь на приложение');
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

test('пара через студию: null до настройки; ошибки роли и папки понятные; после — статус', () => {
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
  assert.equal(loadSettings(path).pair.sharedDir, join(root, 'Общая'), 'сохранение настроек не стирает пару');
});

test('убрать момент через студию: неизвестный ролик и уже выложенный — понятный отказ', async () => {
  const { studio, root } = world();
  await assert.rejects(studio.removeMoment('нет', 0), /Ролик не найден/);
  const m = manifestIn(root);
  const cal = studio.calendar();
  cal.add({ id: 'p', kind: 'top5', dir: m.dir });
  cal.markPublished('p');
  await assert.rejects(studio.removeMoment('p', 0), /уже выложен/);
});
