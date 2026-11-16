// «Поссум Студия»: папка Документы\Поссум\Входящие → разбор пачкой → ролики в календаре → выкладка только по кнопке.
// Пара: напарница шлёт видео монтажёру через общую папку, он монтирует и шлёт ей готовое.
// Ключи вводит только владелец на экране «Настройки»; в окно они приходят замаскированными, в лог не пишутся.
import { app, BrowserWindow, ipcMain, shell, dialog, clipboard, safeStorage } from 'electron';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { copyVideos, collectVideos } from './intake.js';
import { textCost } from '../core/ai.js';
import { createStudio, PLATFORMS } from '../core/studio.js';
import { setVault } from '../core/settings.js';
import { createInbox } from './inbox.js';
import { createHub } from './hub.js';

const here = dirname(fileURLToPath(import.meta.url));
const NAMES = { youtube: 'YouTube Shorts', tiktok: 'TikTok (в черновики)', instagram: 'Instagram Reels' };
let win = null;
let studio = null;
let inbox = null;
let hub = null;
let startError = null;
let timer = null;

function dataRoot() {
  return process.env.POSSUM_HOME ?? join(app.getPath('documents'), 'Поссум');
}

/** Модель «свой ли зверёк»: в установщике — resources/models/clip, при разработке — models/clip (scripts/fetch-model.mjs). */
function clipModelDir() {
  if (process.env.POSSUM_CLIP_MODEL) return process.env.POSSUM_CLIP_MODEL;
  return app.isPackaged ? join(process.resourcesPath, 'models', 'clip') : join(here, '..', 'models', 'clip');
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function boot() {
  const root = dataRoot();
  const inDir = join(root, 'Входящие');
  try {
    mkdirSync(inDir, { recursive: true });
    studio = createStudio({ dataRoot: root, log: () => {}, clipModelDir: clipModelDir() });
    hub = createHub({ studio, inDir, root, send });
    inbox = createInbox({
      inDir, statePath: join(root, '.очередь.json'), studio,
      onChange: (list) => send('jobs', list),
      batch: hub.batch,
      onBatch: (r) => { send('batch', inbox?.last() ?? null); hub.afterBatch(r).catch(() => {}); },
    });
    inbox.resume();
    inbox.scan();
    let polling = false;
    timer = setInterval(async () => {
      inbox.scan();
      if (polling) return;
      polling = true;
      try { const r = await hub.poll(); if (r.got.length) send('received', r.got.map((f) => basename(f))); } finally { polling = false; }
    }, 3000);
  } catch (e) {
    startError = String(e?.message ?? e);
  }
  return { root, inDir };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 900, minHeight: 620, title: 'Поссум Студия', icon: join(here, 'icon.ico'), backgroundColor: '#f6f1ea', autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(join(here, 'ui', 'index.html'));
  // ссылки — только во внешний браузер, окно никуда не уходит
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

/** Что уже выложено по каждой площадке. */
function doneFor(manifest) {
  return Object.fromEntries(PLATFORMS.map((p) => {
    const file = p === 'instagram' ? manifest.outputs?.reels : manifest.outputs?.[p];
    return [p, Boolean(file && studio.wasPublished(file, p))];
  }));
}

function pairInfo() {
  try {
    const s = studio?.masked()?.pair ?? {};
    const st = studio?.pairing()?.status() ?? null;
    return { role: s.role ?? null, sharedDir: s.sharedDir ?? null, paired: Boolean(st?.paired), waiting: Boolean(st?.waiting) };
  } catch (e) { return { role: null, sharedDir: null, paired: false, waiting: false, error: String(e?.message ?? e) }; }
}

function wire({ root, inDir }) {
  const need = () => { if (!studio) throw new Error(startError ?? 'Студия не запустилась'); return studio; };
  const slotOf = (id) => { const s = need().calendar().get(id); if (!s) throw new Error('Ролик не найден в календаре'); return s; };

  ipcMain.handle('state', () => ({
    root, inDir, error: startError,
    status: studio?.status() ?? null,
    jobs: inbox ? [...inbox.copying(), ...inbox.list()] : [],
    last: inbox?.last() ?? null,
    disk: studio?.disk() ?? null,
    pair: pairInfo(),
    wizardDone: Boolean(studio?.masked()?.wizardDone),
    species: { name: studio?.masked()?.speciesName?.ru ?? null, asked: Boolean(studio?.masked()?.speciesAsked) },
  }));
  ipcMain.handle('redo', (_e, id) => inbox?.redo(id) ?? false);
  ipcMain.handle('scan', () => { inbox?.scan(); return true; });
  ipcMain.handle('open', (_e, what) => {
    const shared = pairInfo().sharedDir;
    const target = what === 'in' ? inDir : what === 'out' ? need().outRoot
      : what === 'from' ? join(root, 'Готово', 'От монтажёра') : what === 'shared' ? shared : what;
    if (typeof target !== 'string' || !target) return false;
    // открываем только папки внутри Документы\Поссум и общую папку пары
    const abs = resolve(target);
    const inside = (base) => base && (abs === resolve(base) || abs.startsWith(resolve(base) + sep));
    if (!inside(root) && !inside(shared)) return false;
    if (!existsSync(abs)) { if (target === what) return false; mkdirSync(abs, { recursive: true }); }
    shell.openPath(abs);
    return true;
  });
  // Копирование во «Входящие» (кнопка и перетаскивание): асинхронно, с прогрессом; второе копирование ждёт первое
  let copying = Promise.resolve();
  const intake = (paths) => (copying = copying.catch(() => {}).then(async () => {
    const files = collectVideos(paths);
    if (!files.length) { send('copy', { done: 0, total: 0, end: true, none: true }); return { copied: 0, same: 0, total: 0 }; }
    try {
      const r = await copyVideos(files, inDir, (p) => send('copy', p));
      send('copy', { ...r, done: r.total, end: true });
      inbox?.scan();
      return r;
    } catch (e) { send('copy', { end: true, error: e.message }); throw e; }
  }));
  ipcMain.handle('pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Добавить видео', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Видео', extensions: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp', 'ogv', 'mpg', 'mpeg', 'wmv'] }] });
    if (r.canceled) return 0;
    return (await intake(r.filePaths)).copied;
  });
  ipcMain.handle('inbox:add', async (_e, paths) => (await intake(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : [])).copied);

  // «Что снять сегодня»: сценарий дня и что из него уже снято
  ipcMain.handle('today', (_e, opts) => need().today({ refresh: Boolean(opts?.refresh) }));
  ipcMain.handle('ideas', () => need().ideas());
  ipcMain.handle('mentor', (_e, opts) => need().mentor(String(opts?.q ?? ''), Array.isArray(opts?.history) ? opts.history.slice(-4) : []));

  // Календарь и решения
  ipcMain.handle('calendar', () => {
    const u = need().upcoming();
    const withCover = (s) => ({ ...s, cover: s.dir && existsSync(join(s.dir, 'cover.jpg')) ? join(s.dir, 'cover.jpg') : null });
    const done = studio.calendar().all().filter((s) => s.status === 'published' || s.status === 'skipped').slice(-30).reverse();
    return { free: u.free, hour: u.hour, slots: u.slots.map(withCover), history: done.map(withCover) };
  });
  ipcMain.handle('slot', (_e, id) => {
    const slot = slotOf(id);
    if (!slot.dir || !studio.hasManifest(slot.dir)) return { slot, manifest: null, done: {} };
    const manifest = studio.readManifest(slot.dir);
    return { slot, manifest, done: doneFor(manifest) };
  });
  ipcMain.handle('calendar:pick', (_e, { id, ab }) => {
    if (!['A', 'B'].includes(ab)) throw new Error('Выберите заголовок A или B');
    return need().pickTitle(id, ab);
  });
  ipcMain.handle('calendar:skip', (_e, id) => need().skip(id));
  // Отметка «где мой зверёк» по листам кадров → сборка роликов из отмеченного
  ipcMain.handle('pets:confirm', async (_e, marks) => {
    const r = await need().confirmPets(marks, (x) => send('progress', x));
    const l = inbox?.setLast(r) ?? null;
    send('batch', l);
    hub?.afterBatch(r).catch(() => {});
    return l;
  });
  // Эталон «вот мой зверёк»: 3–5 фото или видео один раз → пересчёт неуверенных → сборка
  ipcMain.handle('species:reference', async () => {
    const d = await dialog.showOpenDialog(win, { title: 'Фото или видео вашего зверька (3–5)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Фото и видео', extensions: ['jpg', 'jpeg', 'png', 'mp4', 'mov', 'm4v'] }] });
    if (d.canceled || !d.filePaths.length) return null;
    const r = await need().setReference(d.filePaths.slice(0, 8), (x) => send('progress', x));
    if (r.refused) return r;
    const l = inbox?.setLast(r) ?? null;
    send('batch', l);
    hub?.afterBatch(r).catch(() => {});
    return l;
  });
  // Вид зверька в текстах — только после «Да» владельца; null — «Другой зверь»
  ipcMain.handle('species:set', (_e, name) => need().setSpecies(name ?? null));
  ipcMain.handle('moment:remove', (_e, { id, idx }) => need().removeMoment(id, idx));

  // Пара с напарницей
  ipcMain.handle('pair:status', () => pairInfo());
  ipcMain.handle('pair:setup', async (_e, role) => {
    const r = await dialog.showOpenDialog(win, { title: 'Общая папка (Яндекс Диск, Google Диск, OneDrive)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return pairInfo();
    need().pairSetup({ role, sharedDir: join(r.filePaths[0], 'Поссум-пара') });
    studio.save({ wizardDone: true });
    return pairInfo();
  });
  ipcMain.handle('pair:create', () => {
    const p = need().pairing();
    if (!p) throw new Error('Сначала выберите общую папку');
    return p.create();
  });
  ipcMain.handle('pair:join', (_e, code) => {
    const p = need().pairing();
    if (!p) throw new Error('Сначала выберите общую папку');
    p.join(String(code ?? ''));
    studio.save({ wizardDone: true }); // соединились — мастер больше не нужен
    return pairInfo();
  });
  ipcMain.handle('wizard:solo', () => { need().save({ wizardDone: true }); return true; });

  ipcMain.handle('settings:get', () => need().masked());
  ipcMain.handle('ai:price', () => textCost(need().masked().aiModel));
  ipcMain.handle('settings:save', (_e, patch) => need().save(patch));
  ipcMain.handle('connect', async (_e, kind) => {
    if (!['youtube', 'tiktok'].includes(kind)) throw new Error('неизвестная площадка');
    return need().connect(kind, (url) => shell.openExternal(url));
  });

  // Выкладка: только после «Да» в системном окне. confirm:true ставится здесь, не в окне.
  ipcMain.handle('publish', async (_e, { id, platforms }) => {
    const slot = slotOf(id);
    if (!slot.dir || !studio.hasManifest(slot.dir)) throw new Error('Ролик ещё не смонтирован');
    const list = (Array.isArray(platforms) ? platforms : []).filter((p) => PLATFORMS.includes(p));
    if (!list.length) return [];
    const title = studio.readManifest(slot.dir).packages?.youtube?.title ?? slot.titles?.[slot.pick ?? 'A']?.ru ?? slot.id;
    const ok = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Выложить', 'Отмена'], defaultId: 1, cancelId: 1, title: 'Выложить ролик?',
      message: `Выложить «${title}»?`, detail: list.map((p) => `• ${NAMES[p]}`).join('\n'),
    });
    if (ok.response !== 0) return [{ cancelled: true }];
    const out = [];
    for (const p of list) {
      try {
        const res = await studio.publish(p, slot.dir, { confirm: true });
        if (res?.manual && res.caption) clipboard.writeText(res.caption); // подпись Reels — сразу в буфер
        out.push({ platform: p, ...res });
      }
      catch (e) { out.push({ platform: p, error: String(e?.message ?? e).slice(0, 300) }); }
    }
    // В календаре ролик выложен, если хоть одна площадка приняла его (ручной пакет не считается)
    if (out.some((r) => !r.error && !r.manual && (r.id || r.skipped))) studio.calendar().markPublished(id);
    return out;
  });
}

// второе окно не запускаем: две копии делили бы одну очередь
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // ключи в settings.json шифрует Windows (DPAPI) через safeStorage; без шифрования они не сохраняются
  setVault(safeStorage);
  const paths = boot();
  wire(paths);
  createWindow();
});
app.on('window-all-closed', () => { clearInterval(timer); app.quit(); });
