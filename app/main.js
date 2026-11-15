// Приложение напарницы «Поссум-студия»: папка Документы\Поссум\Входящие → три монтажа + совет → выкладка только по кнопке.
// Ключи вводит только владелец на экране «Настройки»; в окно они приходят замаскированными, в лог не пишутся.
import { app, BrowserWindow, ipcMain, shell, dialog, clipboard } from 'electron';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { createStudio, PLATFORMS } from '../core/studio.js';
import { createInbox } from './inbox.js';

const here = dirname(fileURLToPath(import.meta.url));
const NAMES = { youtube: 'YouTube Shorts', tiktok: 'TikTok (в черновики)', instagram: 'Instagram Reels' };
let win = null;
let studio = null;
let inbox = null;
let startError = null;
let timer = null;

function dataRoot() {
  return process.env.POSSUM_HOME ?? join(app.getPath('documents'), 'Поссум');
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function boot() {
  const root = dataRoot();
  const inDir = join(root, 'Входящие');
  try {
    mkdirSync(inDir, { recursive: true });
    studio = createStudio({ dataRoot: root, log: () => {} });
    inbox = createInbox({ inDir, statePath: join(root, '.очередь.json'), studio, onChange: (list) => send('jobs', list) });
    inbox.resume();
    inbox.scan();
    timer = setInterval(() => inbox.scan(), 3000);
  } catch (e) {
    startError = String(e?.message ?? e);
  }
  return { root, inDir };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 900, minHeight: 620, title: 'Поссум-студия', backgroundColor: '#f6f1ea', autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(join(here, 'ui', 'index.html'));
  // ссылки — только во внешний браузер, окно никуда не уходит
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function wire({ root, inDir }) {
  const need = () => { if (!studio) throw new Error(startError ?? 'Студия не запустилась'); return studio; };

  ipcMain.handle('state', () => ({
    root, inDir, error: startError,
    status: studio?.status() ?? null,
    jobs: inbox?.list() ?? [],
  }));
  ipcMain.handle('job', (_e, id) => {
    const job = inbox?.get(id);
    if (!job?.dir || !need().hasManifest(job.dir)) return { job, manifest: null };
    const manifest = studio.readManifest(job.dir);
    const done = Object.fromEntries(PLATFORMS.map((p) => {
      const file = p === 'youtube' ? manifest.outputs.youtube : p === 'tiktok' ? manifest.outputs.tiktok : manifest.outputs.reels;
      return [p, Boolean(file && studio.wasPublished(file, p))];
    }));
    return { job, manifest, done };
  });
  ipcMain.handle('redo', (_e, id) => inbox?.redo(id) ?? false);
  ipcMain.handle('scan', () => { inbox?.scan(); return true; });
  ipcMain.handle('open', (_e, what) => {
    const target = what === 'in' ? inDir : what === 'out' ? need().outRoot : what;
    // открываем только папки внутри Документы\Поссум
    if (typeof target !== 'string') return false;
    const abs = resolve(target);
    const base = resolve(root);
    if (abs !== base && !abs.startsWith(base + sep)) return false;
    shell.openPath(abs);
    return true;
  });
  ipcMain.handle('pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Добавить видео', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Видео', extensions: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp'] }] });
    if (r.canceled) return 0;
    // копируем асинхронно: большие ролики не подвешивают окно
    for (const f of r.filePaths) await copyFile(f, join(inDir, basename(f)));
    inbox?.scan();
    return r.filePaths.length;
  });

  ipcMain.handle('settings:get', () => need().masked());
  ipcMain.handle('settings:save', (_e, patch) => need().save(patch));
  ipcMain.handle('connect', async (_e, kind) => {
    if (!['youtube', 'tiktok'].includes(kind)) throw new Error('неизвестная площадка');
    return need().connect(kind, (url) => shell.openExternal(url));
  });

  // Выкладка: только после «Да» в системном окне. confirm:true ставится здесь, не в окне.
  ipcMain.handle('publish', async (_e, { id, platforms }) => {
    const job = inbox?.get(id);
    if (!job?.dir) throw new Error('Ролик ещё не смонтирован');
    const list = (Array.isArray(platforms) ? platforms : []).filter((p) => PLATFORMS.includes(p));
    if (!list.length) return [];
    const ok = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Выложить', 'Отмена'], defaultId: 1, cancelId: 1, title: 'Выложить ролик?',
      message: `Выложить «${job.name}»?`, detail: list.map((p) => `• ${NAMES[p]}`).join('\n'),
    });
    if (ok.response !== 0) return [{ cancelled: true }];
    const out = [];
    for (const p of list) {
      try {
        const res = await need().publish(p, job.dir, { confirm: true });
        if (res?.manual && res.caption) clipboard.writeText(res.caption); // подпись Reels — сразу в буфер
        out.push({ platform: p, ...res });
      }
      catch (e) { out.push({ platform: p, error: String(e?.message ?? e).slice(0, 300) }); }
    }
    return out;
  });
}

// второе окно не запускаем: две копии делили бы одну очередь
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  const paths = boot();
  wire(paths);
  createWindow();
});
app.on('window-all-closed', () => { clearInterval(timer); app.quit(); });
