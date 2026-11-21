// The whole studio for the bot and the app: settings, editing, platform sign-in, publishing by button.
// Keys live only in the owner's settings.json; they go out (to the bot, the window, the log) masked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, saveSettings, maskSettings, redactSecrets, settingsPath, oldKeyWarning, NO_CRYPTO, NO_CRYPTO_SIGNIN } from './settings.js';
import { createMedia } from './media.js';
import { createAi } from './ai.js';
import { findFont, listMusic } from './assets.js';
import { createLibrary } from './library.js';
import { createCalendar } from './calendar.js';
import { createVision } from './vision.js';
import { providerOf } from './openrouter.js';
import { createProducer, applyPick, diskFree, petFate } from './producer.js';
import { createPairing } from './pairing.js';
import { createSpecies, createClipEmbedder } from './species.js';
import { createPrivacy } from './privacy.js';
import { processVideo } from './pipeline.js';
import { pickScenario, aiScenario, coverage, dayKey } from './director.js';
import { catalog } from './ideas.js';
import { ask } from './mentor.js';
import { publishOne, PLATFORMS } from './publish/index.js';
import { createLog } from './publishedlog.js';
import { signIn } from './oauth.js';

export { PLATFORMS };

/** Masks "•••1234" from the settings screen are discarded by saveSettings itself; here — for old calls and tests. */
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

  // The library and the calendar are shared across the whole app; analysis and the producer are created per batch (they pick up a new key).
  let lib = null; let cal = null;
  const library = () => (lib ??= createLibrary({ path: join(dataRoot, '.library.json'), baseDir: dataRoot, now }));
  const calendar = () => (cal ??= createCalendar({ path: join(dataRoot, 'calendar.json'), now }));
  // "Is it your pet" — a local frame model; without the model — species.available false, the person marks everything by hand.
  // One frame model is used both for "is it your pet" and for the face and cigarette filter.
  let emb = null;
  const embedder = () => (emb ??= createClipEmbedder({ modelDir: clipModelDir, ffmpeg: media.tools?.ffmpeg, ffprobe: media.tools?.ffprobe }));
  let sp = speciesOverride;
  const species = () => (sp ??= createSpecies({ dataRoot, embedder: embedder() }));
  // People's faces and cigarettes are not used in videos; without the model — privacy.available false, videos as before.
  let pv = privacyOverride;
  const privacy = () => {
    if (pv) return pv;
    let labels = null;
    try { labels = JSON.parse(readFileSync(new URL('./clip-labels.json', import.meta.url), 'utf8')).privacy ?? null; } catch { labels = null; }
    return (pv = createPrivacy({ embedder: embedder(), labels }));
  };

  // "What to shoot today": the scenario is written once a day (AI — if there is a key) and stored in .today.json; editing uses the latest one.
  const todayPath = join(dataRoot, '.today.json');
  const storedToday = () => { try { return JSON.parse(readFileSync(todayPath, 'utf8')).scenario ?? null; } catch { return null; } };
  async function today({ refresh = false } = {}) {
    let scenario = storedToday();
    if (refresh || !scenario || scenario.date !== dayKey(now())) {
      const s = settings();
      const base = pickScenario({ now: now(), history: calendar().history() });
      scenario = await aiScenario(aiFactory({ apiKey: s.claudeKey, model: s.model, fetchImpl }), base);
      mkdirSync(dataRoot, { recursive: true });
      writeFileSync(todayPath, JSON.stringify({ scenario }, null, 2));
    }
    return { scenario, coverage: coverage(scenario, library().all()) };
  }

  /** "Ideas and advice": the idea catalog and the mentor. The pet's name does not go to the neural network. */
  const ideas = () => catalog();
  async function mentor(question, history = []) {
    const s = settings();
    return ask(question, { ai: aiFactory({ apiKey: s.claudeKey, model: s.model, fetchImpl }), history, petNames: s.petNames ?? [] });
  }

  /** A whole batch of videos: analysis → stories → packages → calendar slots. Publishes nothing. */
  function makeProducer() {
    const s = settings();
    const viaOr = providerOf(s.claudeKey) === 'openrouter'; // OpenRouter: analysis with the same model as the texts; Claude: Haiku through the SDK
    const vision = createVision({ apiKey: s.claudeKey, client: s.claudeKey && !viaOr ? visionClient : null, model: viaOr ? s.model : undefined, fetchImpl, cachePath: join(dataRoot, '.vision-cost.json'), now, petNames: s.petNames ?? [] });
    return createProducer({
      lib: library(), calendar: calendar(), vision, media, outRoot, workRoot: join(dataRoot, '.work'),
      font: findFont(), musicList: listMusic(s.folders?.music ?? join(dataRoot, 'Музыка')), petNames: s.petNames ?? [], now,
      ai: aiFactory({ apiKey: s.claudeKey, model: s.model, fetchImpl }),
      scenario: storedToday(),
      species: species(), privacy: privacy(), privacyPad: privacy().pad ?? 1, speciesName: s.speciesName?.ru ? s.speciesName : null,
    });
  }

  async function runBatch(files, onProgress = () => {}) {
    const s = settings();
    const producer = makeProducer();
    let r;
    try { r = await producer.run(files, onProgress); } catch (e) { throw safe(e); }
    // The producer catches errors per file and per story — we strip keys here too, since the summary goes to the window and to .jobs.json.
    r.errors = r.errors.map((x) => ({ ...x, error: redactSecrets(x.error, s) }));
    return r;
  }

  /**
   * The person marked from the frame sheets where his pet is: { id: true|false }. Then — assembly of videos from the marked ones.
   */
  /** Discarded videos (by the model or by a person) with the reason — for the batch summary and the status in "Inbox". */
  const rejected = () => library().all().filter((c) => c.pet === false).map((c) => ({ id: c.id, name: c.name, why: c.petWhy ?? null }));

  async function confirmPets(marks = {}, onProgress = () => {}) {
    const s = settings();
    const lib = library();
    for (const [id, yes] of Object.entries(marks ?? {})) {
      lib.setPet(id, yes);
      if (yes) try { species().learn(id); } catch { /* learning is not required for assembly */ }
    }
    const out = rejected();
    let r;
    // videos marked "This is my pet" go into assembly first: the person brought them back, so they want to see them in the video
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

  /** The reference "this is my pet": 3–5 photos or videos, once. Then — recalculation of unmarked videos and assembly. */
  async function setReference(files = [], onProgress = () => {}) {
    const list = (files ?? []).filter(Boolean);
    if (!list.length) throw new Error('Выберите 3–5 фото или видео, где хорошо видно вашего зверька');
    const s = settings();
    const ref = await species().addReference(list);
    // too few pet shots — the reference is not saved: we explain in words and leave the batch alone
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

  /** Only the owner confirms the pet's species ("Yes"); null — "Another animal": the texts no longer name the species. */
  function setSpecies(name) {
    if (name != null && !String(name.ru ?? '').trim()) throw new Error('Не указан вид зверька');
    const v = name == null ? null : { ru: String(name.ru).trim(), en: name.en ? String(name.en).trim() : null, tag: name.tag ? String(name.tag).trim() : null };
    return maskSettings(saveSettings(path, { speciesName: v, speciesAsked: true }));
  }

  /** The nearest slots (not published and not skipped) and how many days are free. */
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

  /** "Remove moment" idx from video id: the video is re-edited, post.txt and notes are rebuilt. */
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

  /** The pair with the partner: null until it is set up. */
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

  /** confirm must come only from the owner pressing the button. */
  const inFlight = new Set(); // "file|platform" — while publishing is in progress, we do not start a second time
  async function publish(platform, manifestOrDir, { confirm = false } = {}) {
    const manifest = typeof manifestOrDir === 'string' ? readManifest(manifestOrDir) : manifestOrDir;
    const key = `${manifest.outputs?.[platform === 'instagram' ? 'reels' : platform]}|${platform}`;
    if (inFlight.has(key)) return { platform, skipped: true, note: 'Уже выкладывается — подождите' };
    inFlight.add(key);
    try {
      const s = settings();
      // TikTok changes the refresh token on renewal: we save it right away, even if the upload fails later
      const onRefreshToken = (t) => {
        if (saveSettings(path, { tiktok: { refreshToken: t } }).warnings?.includes(NO_CRYPTO)) log('TikTok: new token not saved — Windows encryption is unavailable; next time sign in to TikTok again');
      };
      const res = await publishOne(platform, manifest, { settings: s, log: published, fetchImpl, confirm, onRefreshToken });
      log(`publish ${platform}: ${res.skipped ? 'already done' : res.manual ? 'manual package' : res.id}`);
      return res;
    } finally { inFlight.delete(key); }
  }

  /** The owner's sign-in: opens the browser, waits for the reply on 127.0.0.1, saves the refresh token. Returns only "connected". */
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
    today, ideas, mentor, runBatch, confirmPets, setReference, setSpecies, upcoming, pickTitle, removeMoment, pairing, pairSetup, library, calendar,
    skip: (id) => calendar().skip(id),
    disk: () => diskFree(dataRoot),
    masked: () => { const m = maskSettings(settings()); const w = oldKeyWarning(path); if (w) m.warning = w; return m; },
    save: (patch) => maskSettings(saveSettings(path, patch)),
    wasPublished: (file, platform) => published.was(file, platform),
    hasManifest: (dir) => existsSync(join(dir, 'manifest.json')),
  };
}
