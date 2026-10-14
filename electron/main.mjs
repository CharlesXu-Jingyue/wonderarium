// Main process: owns the window, the app:// file server and the save file.
// The renderer never touches Node; it talks to this file only through the
// small bridge in preload.cjs.

import { app, BrowserWindow, ipcMain, net, protocol, screen, session, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RENDERER_DIR = path.join(ROOT, 'dist', 'renderer');
const DEV = !app.isPackaged;

// Where state lives. .env.local names the folder on this machine; without it
// we fall back to the usual per-user location.
try {
  process.loadEnvFile(path.join(ROOT, '.env.local'));
} catch {
  // no local env file, which is fine
}
const DATA_DIR = process.env.BITS_DATA_DIR || path.join(app.getPath('appData'), 'World in a Box');
const ELECTRON_DIR = path.join(DATA_DIR, 'electron');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const WINDOW_FILE = path.join(DATA_DIR, 'window.json');
const SHOTS_DIR = path.join(DATA_DIR, 'screenshots');

fs.mkdirSync(ELECTRON_DIR, { recursive: true });
app.setName('World in a Box');
// Chromium's own caches, logs and crash dumps follow the data folder too, so
// nothing is left behind in ~/Library.
app.setPath('userData', ELECTRON_DIR);
app.setPath('sessionData', ELECTRON_DIR);
app.setPath('crashDumps', path.join(ELECTRON_DIR, 'crashes'));
app.setAppLogsPath(path.join(ELECTRON_DIR, 'logs'));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Landscape, so the controls have room beside the cube instead of over it.
const ASPECT = 3 / 2;
const DEFAULT_WIDTH = 690;
const MIN_WIDTH = 360;

/** @type {BrowserWindow | null} */
let win = null;

// ---------- small file helpers ----------

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// Write to a temp file, then rename, so a crash mid-write never corrupts state.
// Writes to the same file queue up behind each other, so two saves landing
// together cannot trip over one temp file.
const writeQueues = new Map();
function writeJson(file, value) {
  const body = JSON.stringify(value, null, 2);
  const next = (writeQueues.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, body);
      await fsp.rename(tmp, file);
    });
  writeQueues.set(file, next);
  return next;
}

// ---------- window ----------

function restoredBounds(saved) {
  const width = Math.max(MIN_WIDTH, Math.round(saved?.width ?? DEFAULT_WIDTH));
  const height = Math.round(width / ASPECT);
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    // Only reuse the old spot if it is still on a connected display.
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      saved.x + width / 2 > a.x && saved.x + width / 2 < a.x + a.width &&
      saved.y + height / 2 > a.y && saved.y + height / 2 < a.y + a.height);
    if (visible) return { x: saved.x, y: saved.y, width, height };
  }
  const { workArea: a } = screen.getPrimaryDisplay();
  return { x: a.x + a.width - width - 48, y: a.y + 48, width, height };
}

function flags() {
  return {
    fullscreen: !!win && (process.platform === 'darwin' ? win.isSimpleFullScreen() : win.isFullScreen()),
    pinned: !!win && win.isAlwaysOnTop(),
  };
}

function sendFlags() {
  win?.webContents.send('window:flags', flags());
}

let saveBoundsTimer;
function saveWindowSoon() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!win || flags().fullscreen) return;
    const { x, y, width } = win.getBounds();
    writeJson(WINDOW_FILE, { x, y, width, pinned: win.isAlwaysOnTop() }).catch(() => {});
  }, 400);
}

async function createWindow() {
  const saved = await readJson(WINDOW_FILE);
  win = new BrowserWindow({
    ...restoredBounds(saved),
    minWidth: MIN_WIDTH,
    minHeight: Math.round(MIN_WIDTH / ASPECT),
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'World in a Box',
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.setAspectRatio(ASPECT);
  if (saved?.pinned) win.setAlwaysOnTop(true, 'floating');

  // The page may never leave app:// or open new windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('move', saveWindowSoon);
  win.on('resize', saveWindowSoon);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });

  await win.loadURL('app://bits/index.html');
  if (DEV) watchRenderer();
}

// In development, reload the page whenever Vite finishes a rebuild.
function watchRenderer() {
  let timer;
  fs.watch(RENDERER_DIR, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => win?.webContents.reloadIgnoringCache(), 250);
  });
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('state:load', () => readJson(STATE_FILE));
  ipcMain.handle('state:save', async (_e, state) => {
    if (state && typeof state === 'object') await writeJson(STATE_FILE, state);
  });

  ipcMain.handle('window:flags', () => flags());

  ipcMain.on('window:set-width', (_e, width) => {
    if (!win || flags().fullscreen || !Number.isFinite(width)) return;
    const b = win.getBounds();
    const { workArea: a } = screen.getDisplayMatching(b);
    const w = Math.round(Math.min(Math.max(width, MIN_WIDTH), a.width, a.height * ASPECT));
    win.setBounds({ x: b.x, y: b.y, width: w, height: Math.round(w / ASPECT) });
  });

  ipcMain.on('window:toggle-fullscreen', () => {
    if (!win) return;
    const next = !flags().fullscreen;
    win.setAspectRatio(next ? 0 : ASPECT);
    if (process.platform === 'darwin') win.setSimpleFullScreen(next);
    else win.setFullScreen(next);
    sendFlags();
  });

  ipcMain.on('window:set-pinned', (_e, pinned) => {
    win?.setAlwaysOnTop(!!pinned, 'floating');
    saveWindowSoon();
    sendFlags();
  });

  ipcMain.on('window:minimize', () => win?.minimize());
  ipcMain.on('window:close', () => win?.close());

  // Screenshots are PNG bytes from the renderer, written into the data folder.
  ipcMain.handle('screenshot:save', async (_e, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 50_000_000) return null;
    await fsp.mkdir(SHOTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const file = path.join(SHOTS_DIR, `world-${stamp}.png`);
    await fsp.writeFile(file, bytes);
    return path.basename(file);
  });
  ipcMain.on('screenshot:open-folder', async () => {
    await fsp.mkdir(SHOTS_DIR, { recursive: true });
    shell.openPath(SHOTS_DIR);
  });
}

// ---------- app ----------

app.whenReady().then(async () => {
  // Serve the built renderer from app://bits/, refusing anything outside it.
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  // No camera, microphone, notifications or anything else, ever.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, done) => done(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerIpc();
  await createWindow();
});

app.on('window-all-closed', () => app.quit());
