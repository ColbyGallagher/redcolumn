import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { DesktopAuth } from './auth';
import { PathAllowlist } from './allowlist';
import { NATIVE_OPEN_SAVE, PRINT_MODE } from './capabilities';
import { DEV_ORIGIN, isDev } from './dev';
import { captureEarlyOpens, LaunchQueue } from './launch';
import { fromApp, persistAllowlist, registerPathIpc, restoreAllowlist } from './paths';
import { addImagePage, beginImagePrint, cancelImagePrint, finishImagePrint, printBytes } from './print';
import { registerAppProtocol } from './protocol';
import { harden, installMenu, installPermissions } from './security';
import { runSpike } from './spike';
import { checkForUpdates, installUpdate, startUpdater } from './updater';

const earlyOpens = captureEarlyOpens();
const allowlist = new PathAllowlist();
const launches = new LaunchQueue(allowlist);
let mainWindow: BrowserWindow | null = null;

if (process.argv.includes('--spike')) {
  void app.whenReady().then(() => runSpike().finally(() => app.exit(0)));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    launches.noteArgv(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  void app.whenReady().then(start);
}

async function start() {
  registerAppProtocol();
  installMenu();
  installPermissions(session.defaultSession);
  const allowFile = path.join(app.getPath('userData'), 'path-allowlist.json');
  await restoreAllowlist(allowlist, allowFile);
  let saving = false;
  let dirty = false;
  const flush = () => {
    if (saving || !dirty) return;
    dirty = false;
    saving = true;
    void persistAllowlist(allowlist, allowFile).finally(() => {
      saving = false;
      flush();
    });
  };
  allowlist.onChange = () => {
    dirty = true;
    flush();
  };
  const auth = new DesktopAuth(app.getPath('userData'));

  ipcMain.on('desktop:info', (event) => {
    event.returnValue = { nativeFiles: NATIVE_OPEN_SAVE, printMode: PRINT_MODE };
  });
  registerPathIpc(allowlist, launches, () => mainWindow);
  // Every handler below answers the app's own page only: not help windows, not blob previews.
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== mainWindow?.webContents || !fromApp(event)) throw new Error('Denied');
      return fn(...args);
    });
  };
  handle('print:pdf', async (bytes) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('Nothing to print.');
    await printBytes(bytes, 'verb');
  });
  handle('print:begin', () => beginImagePrint());
  handle('print:page', (job, bytes, type, width, height) => {
    if (typeof job !== 'string' || !(bytes instanceof Uint8Array) || typeof type !== 'string' || typeof width !== 'number' || typeof height !== 'number') throw new Error('That page cannot be printed.');
    return addImagePage(job, bytes, type, width, height);
  });
  handle('print:finish', (job) => {
    if (typeof job !== 'string') throw new Error('That print job has ended.');
    return finishImagePrint(job);
  });
  handle('print:cancel', (job) => {
    if (typeof job === 'string') return cancelImagePrint(job);
  });
  handle('update:check', () => checkForUpdates());
  handle('update:install', () => installUpdate());
  handle('auth:google', (clientId, clientSecret, interactive) => {
    if (typeof clientId !== 'string' || !clientId) throw new Error('Google sign-in for the desktop app needs a desktop OAuth client.');
    return auth.google(clientId, typeof clientSecret === 'string' ? clientSecret : '', interactive === true);
  });
  handle('auth:microsoft', (clientId, tenant, scopes, interactive) => {
    if (typeof clientId !== 'string' || !clientId) throw new Error('Microsoft sign-in is not configured for this app.');
    const list = Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === 'string') : [];
    return auth.microsoft(clientId, typeof tenant === 'string' && tenant ? tenant : 'common', list, interactive === true);
  });
  handle('auth:microsoft-account', (clientId) => {
    if (typeof clientId !== 'string' || !clientId) return null;
    return auth.microsoftAccount(clientId);
  });
  handle('auth:sign-out', (provider) => {
    if (provider === 'google' || provider === 'microsoft') return auth.signOut(provider);
  });

  app.on('web-contents-created', (_event, contents) => harden(contents));
  createWindow();
  for (const filePath of earlyOpens) launches.note(filePath);
  launches.noteArgv(process.argv);
  startUpdater(() => mainWindow?.webContents.send('update-ready'));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'redcolumn',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  launches.attach(win);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  if (isDev()) void win.loadURL(DEV_ORIGIN);
  else void win.loadURL('app://redcolumn/index.html');
  if (process.env.RECOLUMN_SMOKE === '1') smokeTest(win);
}

/**
 * Prints what the packaged page can do, then exits. Fails when the app did not render: a page
 * that loads but throws during startup is the failure this exists to catch.
 */
function smokeTest(win: BrowserWindow) {
  const errors: string[] = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  win.webContents.once('did-finish-load', () => {
    void win.webContents
      .executeJavaScript(`new Promise((resolve) => {
        const started = Date.now();
        const poll = () => {
          const rendered = (document.getElementById('root')?.childElementCount ?? 0) > 0;
          if (rendered || Date.now() - started > 15000) resolve({ rendered, origin: location.origin, title: document.title, secure: isSecureContext, open: typeof showOpenFilePicker, save: typeof showSaveFilePicker, dir: typeof showDirectoryPicker, launch: typeof window.launchQueue?.setConsumer, desktop: !!window.redcolumn, nativeFiles: window.redcolumn?.nativeFiles ?? false, printMode: window.redcolumn?.printMode ?? null });
          else setTimeout(poll, 100);
        };
        poll();
      })`)
      .then((info: { rendered: boolean }) => {
        console.log(JSON.stringify({ ...info, errors }));
        app.exit(info.rendered && !errors.length ? 0 : 1);
      })
      .catch((err) => {
        console.error(err);
        app.exit(1);
      });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
