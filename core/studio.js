// Студия целиком для бота и приложения: настройки, монтаж, вход в площадки, выкладка по кнопке.
// Ключи живут только в settings.json владельца; наружу (в бот, в окно, в лог) уходят замаскированными.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, saveSettings, maskSettings, redactSecrets, settingsPath, oldKeyWarning, NO_CRYPTO, NO_CRYPTO_SIGNIN } from './settings.js';
import { createMedia } from './media.js';
import { createAi } from './ai.js';
import { findFont, listMusic } from './assets.js';
import { createLibrary } from './library.js';
import { createCalendar } from './calendar.js';
import { createVision } from './vision.js';
import { createProducer, applyPick, diskFree, petFate } from './producer.js';
import { createPairing } from './pairing.js';
import { createSpecies, createClipEmbedder } from './species.js';
import { createPrivacy } from './privacy.js';
import { processVideo } from './pipeline.js';
import { publishOne, PLATFORMS } from './publish/index.js';
import { createLog } from './publishedlog.js';
import { signIn } from './oauth.js';

export { PLATFORMS };

/** Маски «•••1234» с экрана настроек отбрасывает сам saveSettings; здесь — для старых вызовов и тестов. */
export { dropMasked } from './settings.js';

export function createStudio({ path = settingsPath(), dataRoot, media = createMedia(), fetchImpl = fetch, aiFactory = createAi, log = () => {}, visionClient = null, now = () => Date.now(), clipModelDir = process.env.POSSUM_CLIP_MODEL ?? null, species: speciesOverride = null, privacy: privacyOverride = null } = {}) {
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

  // Библиотека и календарь — одни на всё приложение; разбор и продюсер создаются на каждую пачку (подхватывают новый ключ).
  let lib = null; let cal = null;
  const library = () => (lib ??= createLibrary({ path: join(dataRoot, '.library.json'), baseDir: dataRoot, now }));
  const calendar = () => (cal ??= createCalendar({ path: join(dataRoot, 'calendar.json'), now }));
  // «Свой ли зверёк» — локальная модель кадров; модели нет — species.available false, человек отмечает всё сам.
  // Одна модель кадров на «свой ли зверёк» и на фильтр лиц и сигарет.
  let emb = null;
  const embedder = () => (emb ??= createClipEmbedder({ modelDir: clipModelDir, ffmpeg: media.tools?.ffmpeg, ffprobe: media.tools?.ffprobe }));
  let sp = speciesOverride;
  const species = () => (sp ??= createSpecies({ dataRoot, embedder: embedder() }));
  // Лица людей и сигареты в ролики не берём; модели нет — privacy.available false, ролики как раньше.
  let pv = privacyOverride;
  const privacy = () => {
    if (pv) return pv;
    let labels = null;
    try { labels = JSON.parse(readFileSync(new URL('./clip-labels.json', import.meta.url), 'utf8')).privacy ?? null; } catch { labels = null; }
    return (pv = createPrivacy({ embedder: embedder(), labels }));
  };

  /** Пачка видео целиком: разбор → сюжеты → пакеты → слоты календаря. Ничего не выкладывает. */
  function makeProducer() {
    const s = settings();
    const vision = createVision({ apiKey: s.claudeKey, client: s.claudeKey ? visionClient : null, cachePath: join(dataRoot, '.vision-cost.json'), now, petNames: s.petNames ?? [] });
    return createProducer({
      lib: library(), calendar: calendar(), vision, media, outRoot, workRoot: join(dataRoot, '.work'),
      font: findFont(), musicList: listMusic(s.folders?.music ?? join(dataRoot, 'Музыка')), petNames: s.petNames ?? [], now,
      ai: aiFactory({ apiKey: s.claudeKey, model: s.model, fetchImpl }),
      species: species(), privacy: privacy(), privacyPad: privacy().pad ?? 1, speciesName: s.speciesName?.ru ? s.speciesName : null,
    });
  }

  async function runBatch(files, onProgress = () => {}) {
    const s = settings();
    const producer = makeProducer();
    let r;
    try { r = await producer.run(files, onProgress); } catch (e) { throw safe(e); }
    // Ошибки по файлам и сюжетам ловит продюсер — вымарываем ключи и тут, итог уходит в окно и в .jobs.json.
    r.errors = r.errors.map((x) => ({ ...x, error: redactSecrets(x.error, s) }));
    return r;
  }

  /**
   * Человек отметил по листам кадров, где его зверёк: { id: true|false }. Потом — сборка роликов из отмеченного.
   */
  /** Отброшенные видео (моделью или человеком) с причиной — для итога пачки и статуса во «Входящих». */
  const rejected = () => library().all().filter((c) => c.pet === false).map((c) => ({ id: c.id, name: c.name, why: c.petWhy ?? null }));

  async function confirmPets(marks = {}, onProgress = () => {}) {
    const s = settings();
    const lib = library();
    for (const [id, yes] of Object.entries(marks ?? {})) {
      lib.setPet(id, yes);
      if (yes) try { species().learn(id); } catch { /* учёба не обязательна для сборки */ }
    }
    const out = rejected();
    let r;
    // отмеченные «Это мой зверёк» идут в сборку первыми: человек их вернул — значит, хочет видеть в ролике
    const focus = new Set(Object.entries(marks ?? {}).filter(([, y]) => y).map(([id]) => id));
    try { r = await makeProducer().build(onProgress, { focus }); } catch (e) { throw safe(e); }
    r.rejected = out; r.notPet = out.length;
    const ids = (r.made ?? []).map((m) => m.id);
    const gated = (r.decisions ?? []).filter((d) => d.type === 'missing' && d.gated).map((d) => d.text.match(/^«([^»]+)»/)?.[1]).filter(Boolean);
    const why = gated.length ? `${gated.map((n) => `«${n}»`).join(', ')} уже были на этой неделе, другие виды из него не собираются` : null;
    r.confirmed = [...focus].map((id) => petFate(library().get(id), ids, why)).filter(Boolean);
    try { r.queued = upcoming().slots.length; } catch { r.queued = null; }
    r.errors = r.errors.map((x) => ({ ...x, error: redactSecrets(x.error, s) }));
    return r;
  }

  /** Эталон «вот мой зверёк»: 3–5 фото или видео один раз. Потом — пересчёт неотмеченных видео и сборка. */
  async function setReference(files = [], onProgress = () => {}) {
    const list = (files ?? []).filter(Boolean);
    if (!list.length) throw new Error('Выберите 3–5 фото или видео, где хорошо видно вашего зверька');
    const s = settings();
    const ref = await species().addReference(list);
    // зверька на снимках мало — эталон не сохранён: объясняем словами, пачку не трогаем
    if (!ref.added) {
      const name = (f) => String(f?.file ?? f).split(/[\\/]/).pop();
      const bad = ref.failed?.length ? ` Не прочитались: ${ref.failed.map(name).join(', ')}.` : '';
      const why = !ref.found
        ? 'На снимках не видно зверька — дайте другие фото или видео, где его хорошо видно.'
        : `Зверька видно только на ${ref.found} снимках — нужно хотя бы 3. Добавьте ещё фото или видео.`;
      return { added: 0, failed: ref.failed ?? [], refused: why + bad };
    }
    let r; let out;
    try {
      const producer = makeProducer();
      if (ref.added) await producer.rejudge();
      out = rejected();
      r = await producer.build(onProgress);
    } catch (e) { throw safe(e); }
    r.errors = r.errors.map((x) => ({ ...x, error: redactSecrets(x.error, s) }));
    return { added: ref.added, failed: ref.failed, ...r, rejected: out, notPet: out.length };
  }

  /** Вид зверька подтверждает только владелец («Да»); null — «Другой зверь»: тексты снова не называют вид. */
  function setSpecies(name) {
    if (name != null && !String(name.ru ?? '').trim()) throw new Error('Не указан вид зверька');
    const v = name == null ? null : { ru: String(name.ru).trim(), en: name.en ? String(name.en).trim() : null, tag: name.tag ? String(name.tag).trim() : null };
    return maskSettings(saveSettings(path, { speciesName: v, speciesAsked: true }));
  }

  /** Ближайшие слоты (не выложенные и не пропущенные) и сколько дней свободно. */
  function upcoming() {
    const c = calendar();
    return { slots: c.all().filter((x) => x.status !== 'published' && x.status !== 'skipped'), free: c.free(), hour: c.hour, history: c.history() };
  }
  function pickTitle(id, ab) {
    const slot = calendar().pickTitle(id, ab);
    if (!slot) return null;
    if (slot.dir && existsSync(join(slot.dir, 'manifest.json'))) applyPick(slot.dir, ab);
    return slot;
  }

  /** «Убрать момент» idx из ролика id: ролик перемонтируется, пост.txt и заметки — заново. */
  async function removeMoment(id, idx) {
    const slot = calendar().get(id);
    if (!slot?.dir || !existsSync(join(slot.dir, 'manifest.json'))) throw new Error('Ролик не найден');
    if (slot.status === 'published') throw new Error('Ролик уже выложен — его не перемонтировать');
    try {
      const r = await makeProducer().removePiece(slot.dir, idx);
      if (slot.pick) applyPick(slot.dir, slot.pick);
      return r;
    } catch (e) { throw safe(e); }
  }

  /** Пара с напарницей: null, пока не настроена. */
  function pairing() {
    const p = settings().pair;
    if (!p?.role || !p?.sharedDir) return null;
    return createPairing({ sharedDir: p.sharedDir, role: p.role, stateDir: dataRoot, now });
  }
  function pairSetup({ role, sharedDir }) {
    if (!['owner', 'partner'].includes(role)) throw new Error('Выберите: я монтажёр или я напарница');
    if (!sharedDir) throw new Error('Выберите общую папку (Яндекс Диск, Google Диск, OneDrive)');
    saveSettings(path, { pair: { role, sharedDir } });
    return pairing().status();
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
      const onRefreshToken = (t) => {
        if (saveSettings(path, { tiktok: { refreshToken: t } }).warnings?.includes(NO_CRYPTO)) log('TikTok: новый токен не сохранён — шифрование Windows недоступно; в следующий раз войдите в TikTok заново');
      };
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
      if (saveSettings(path, { [kind]: { refreshToken: r.refreshToken } }).warnings?.includes(NO_CRYPTO)) throw new Error(NO_CRYPTO_SIGNIN);
      return { connected: true };
    } catch (e) { throw safe(e); }
  }

  function status() {
    const s = settings();
    return {
      claude: Boolean(s.claudeKey), youtube: Boolean(s.youtube?.refreshToken), tiktok: Boolean(s.tiktok?.refreshToken),
      instagram: Boolean(s.instagram?.accessToken && s.instagram?.videoUrl), ffmpeg: Boolean(media.tools?.ffmpeg ?? true),
      species: { available: Boolean(species().available), refs: species().refCount?.() ?? 0 },
    };
  }

  return {
    outRoot, settingsPath: path, process, publish, connect, status, readManifest,
    runBatch, confirmPets, setReference, setSpecies, upcoming, pickTitle, removeMoment, pairing, pairSetup, library, calendar,
    skip: (id) => calendar().skip(id),
    disk: () => diskFree(dataRoot),
    masked: () => { const m = maskSettings(settings()); const w = oldKeyWarning(path); if (w) m.warning = w; return m; },
    save: (patch) => maskSettings(saveSettings(path, patch)),
    wasPublished: (file, platform) => published.was(file, platform),
    hasManifest: (dir) => existsSync(join(dir, 'manifest.json')),
  };
}
