import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assistantNodePath, mcpLaunch } from './assistant/argv';
import { endpointFile } from './assistant/endpoint';
import { askPage, cancelAssistantCalls, takeAssistantResult } from './assistant/page';
import { AssistantService } from './assistant/service';
import { DesktopAuth } from './auth';
import { GraphBroker, type GraphRequest } from './graph';
import { FolderStore } from './folderDrive';
import { checkTable, loadExcelLinks, writeWorkbook } from './excel';
import { PathAllowlist } from './allowlist';
import { NATIVE_OPEN_SAVE, PRINT_MODE } from './capabilities';
import { DEV_ORIGIN, isDev } from './dev';
import { captureEarlyOpens, LaunchQueue } from './launch';
import { fromApp, persistAllowlist, registerPathIpc, restoreAllowlist } from './paths';
import { addImagePage, beginImagePrint, cancelImagePrint, finishImagePrint, printBytes } from './print';
import { registerAppProtocol } from './protocol';
import { harden, installMenu, installPermissions } from './security';
import { isSmokeRun, lockHeldMessage, smokeUserData } from './smoke';
import { createUpdater } from './updater';

const earlyOpens = captureEarlyOpens();
const allowlist = new PathAllowlist();
const launches = new LaunchQueue(allowlist);
let mainWindow: BrowserWindow | null = null;
/** The page has documents with unsaved changes (it reports this as they change). */
let unsavedChanges = false;
/** The page dealt with its unsaved changes, so the next close goes ahead. */
let closeConfirmed = false;
/** A quit is under way, so confirming the close quits rather than only closing the window. */
let quitting = false;

const smoke = isSmokeRun();
// Before the lock: the lock belongs to the user-data folder, and a smoke run must not share the person's.
if (smoke) app.setPath('userData', smokeUserData());

if (!app.requestSingleInstanceLock()) {
  if (smoke) {
    console.error(lockHeldMessage(app.getPath('userData')));
    app.exit(1);
  } else app.quit();
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
  // Updates: checked at every launch, and the page shows the state in its header bar.
  const updater = createUpdater(() => unsavedChanges);
  updater.onChange = (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:state', state);
  };
  handle('update:check', () => updater.check());
  handle('update:get', () => updater.state);
  handle('update:install', () => updater.install());
  // Signs in, or checks a sign-in covers these scopes. The page learns who signed in, never the token.
  handle('auth:microsoft', async (clientId, tenant, scopes, interactive) => {
    if (typeof clientId !== 'string' || !clientId) throw new Error('Microsoft sign-in is not configured for this app.');
    const list = Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === 'string') : [];
    const result = await auth.microsoft(clientId, typeof tenant === 'string' && tenant ? tenant : 'common', list, interactive === true);
    return result ? { email: result.email, name: result.name, expiresAt: result.expiresAt } : null;
  });
  // Every OneDrive call from the page goes through the broker, which holds the token (docs/SECURITY-HARDENING.md, E2).
  const brokers = new Map<string, GraphBroker>();
  handle('graph:request', (clientId, tenant, request) => {
    if (typeof clientId !== 'string' || !clientId || !request || typeof request !== 'object') throw new Error('That request is not allowed.');
    const t = typeof tenant === 'string' && tenant ? tenant : 'common';
    const key = `${clientId} ${t}`;
    let broker = brokers.get(key);
    if (!broker) {
      broker = new GraphBroker((scopes) => auth.microsoft(clientId, t, scopes, false).then((r) => r?.accessToken ?? null, () => null));
      brokers.set(key, broker);
    }
    return broker.request(request as GraphRequest);
  });
  handle('auth:microsoft-account', (clientId) => {
    if (typeof clientId !== 'string' || !clientId) return null;
    return auth.microsoftAccount(clientId);
  });
  // Projects on a folder this computer syncs (docs/SECURITY-HARDENING.md, E3). The page gets IDs, never paths.
  const foldersFile = path.join(app.getPath('userData'), 'project-folders.json');
  const savedFolders = await fs
    .readFile(foldersFile, 'utf8')
    .then((t) => JSON.parse(t) as { owner?: string; roots?: Record<string, string> })
    .catch(() => ({}) as { owner?: string; roots?: Record<string, string> });
  const folders = new FolderStore(savedFolders.roots ?? {}, savedFolders.owner);
  const saveFolders = () => fs.writeFile(foldersFile, JSON.stringify({ owner: folders.owner, roots: folders.saved() }));
  if (!savedFolders.owner) await saveFolders().catch(() => undefined);
  const str = (v: unknown) => {
    if (typeof v !== 'string') throw new Error('That request is not allowed.');
    return v;
  };
  const bytes = (v: unknown) => {
    if (!(v instanceof Uint8Array)) throw new Error('That request is not allowed.');
    return v;
  };
  const props = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter((e): e is [string, string] => typeof e[1] === 'string'));
  handle('folder:pick', async (purpose) => {
    const win = mainWindow;
    const titles: Record<string, string> = {
      open: 'Open a Project folder',
      create: 'Choose where the Project folder goes',
      'session-open': 'Open a Live Session folder',
      'session-create': 'Choose a shared folder for the Live Session',
    };
    const options = { title: titles[String(purpose)] ?? titles.create!, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const id = await folders.addRoot(result.filePaths[0]);
    await saveFolders();
    return { id, name: path.basename(result.filePaths[0]) };
  });
  handle('folder:list', (id) => folders.list(str(id)));
  handle('folder:download', (id) => folders.download(str(id)));
  handle('folder:create-folder', (parent, name) => folders.createFolder(str(parent), str(name)));
  handle('folder:create-file', (folder, name, body, p) => folders.createFile(str(folder), str(name), bytes(body), props(p)));
  handle('folder:update', (id, body) => folders.updateContent(str(id), bytes(body)));
  handle('folder:props', (id, p) => folders.updateProperties(str(id), props(p)));
  handle('folder:remove', (id) => folders.remove(str(id)));
  handle('folder:owned', (id) => folders.ownedByMe(str(id)));
  handle('folder:show', async (id) => void shell.openPath(await folders.folderPath(str(id))));
  // Ending a Live Session in a folder on this computer: only a session folder this install made, to the recycle bin.
  handle('folder:remove-session', async (id) => {
    await shell.trashItem(await folders.sessionFolderToRemove(str(id)));
    await saveFolders();
  });

  // Sync to Excel on this computer: Windows only, since it drives Excel through COM. The page gets IDs, never paths.
  if (process.platform === 'win32') {
    const excelFile = path.join(app.getPath('userData'), 'excel-links.json');
    const excel = await loadExcelLinks(excelFile);
    handle('excel:pick', async (suggestedName) => {
      const win = mainWindow;
      const name = `${str(suggestedName).replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Markups'}.xlsx`;
      const options = { title: 'Choose where the Excel workbook goes', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }] };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      const filePath = /\.xlsx$/i.test(result.filePath) ? result.filePath : `${result.filePath}.xlsx`;
      const id = excel.add(filePath);
      await fs.writeFile(excelFile, JSON.stringify(excel.saved()));
      return { id, name: path.basename(filePath) };
    });
    handle('excel:write', (id, xlsx, table) => writeWorkbook(excel.path(id), bytes(xlsx), checkTable(table)));
    handle('excel:open', async (id) => {
      const failed = await shell.openPath(excel.path(id));
      if (failed) throw new Error(failed);
    });
    handle('excel:show', (id) => shell.showItemInFolder(excel.path(id)));
  }

  // "Encrypt local data" (docs/SECURITY-HARDENING.md, E4): one key per install, stored only
  // encrypted by the system key store, handed to the app's own page.
  const keyFile = path.join(app.getPath('userData'), 'local-data-key.bin');
  handle('local:key', async () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no system key store, so local data cannot be encrypted.');
    const saved = await fs.readFile(keyFile).catch(() => null);
    if (saved) return Buffer.from(safeStorage.decryptString(saved), 'base64');
    const key = randomBytes(32);
    await fs.writeFile(keyFile, safeStorage.encryptString(key.toString('base64')), { mode: 0o600, flag: 'wx' }).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err;
    });
    const stored = await fs.readFile(keyFile);
    return Buffer.from(safeStorage.decryptString(stored), 'base64');
  });

  handle('auth:sign-out', (provider) => {
    if (provider === 'microsoft') for (const broker of brokers.values()) broker.reset();
    if (provider === 'microsoft') return auth.signOut(provider);
  });

  // The endpoint file is shared with the person's running app, so a smoke run keeps its own.
  const assistantFile = smoke ? path.join(app.getPath('userData'), 'assistant.json') : endpointFile();
  const assistant = new AssistantService(assistantFile, (method, params) => askPage(() => mainWindow, method, params));
  ipcMain.on('assistant:result', (event, body) => {
    if (event.sender !== mainWindow?.webContents || !fromApp(event)) return;
    takeAssistantResult(body);
  });
  const assistantDir = app.isPackaged ? path.join(process.resourcesPath, 'assistant') : path.join(__dirname, 'assistant');
  const script = path.join(assistantDir, 'mcp-cli.js');
  const launch = () => mcpLaunch(process.execPath, script, app.isPackaged ? assistantNodePath(assistantDir) : undefined);
  handle('assistant:get', () => {
    const current = assistant.current();
    return { enabled: current.enabled, ...launch() };
  });
  handle('assistant:set', async (on) => {
    const current = await assistant.setEnabled(on === true);
    return { enabled: current.enabled, ...launch() };
  });
  await assistant.restore();
  // will-quit, not before-quit: a quit stopped by the unsaved-changes question must leave the assistant running.
  app.on('will-quit', () => {
    cancelAssistantCalls();
    assistant.suspend();
  });
  app.on('before-quit', () => {
    quitting = true;
  });

  // Unsaved changes: the page says whether it has any; closing the window then asks the page first.
  ipcMain.on('window:unsaved', (event, on) => {
    if (event.sender !== mainWindow?.webContents || !fromApp(event)) return;
    unsavedChanges = on === true;
  });
  ipcMain.on('window:close', (event) => {
    const win = mainWindow;
    if (!win || event.sender !== win.webContents || !fromApp(event)) return;
    closeConfirmed = true;
    if (quitting) app.quit();
    else win.close();
  });

  app.on('web-contents-created', (_event, contents) => harden(contents));
  createWindow();
  for (const filePath of earlyOpens) launches.note(filePath);
  launches.noteArgv(process.argv);
  // A moment after launch, so the check never competes with the page loading.
  if (app.isPackaged && !smoke) setTimeout(() => void updater.check(), 5000);
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
    // Windows: no native title bar. The page's menu bar fills that strip and the system window
    // buttons are drawn over its right end (see the .titlebar-overlay rules in styles.css). The overlay
    // is transparent so the menu bar's gradient shows behind the buttons.
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#e7ecf5', height: 36 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  mainWindow = win;
  unsavedChanges = false;
  closeConfirmed = false;
  launches.attach(win);
  win.once('ready-to-show', () => win.show());
  // With unsaved changes the page asks Save, Don't Save or Cancel for each document, and closes the
  // window itself when done. A page that crashed or hung cannot answer, so it does not hold the window open.
  let hung = false;
  win.on('unresponsive', () => (hung = true));
  win.on('responsive', () => (hung = false));
  win.webContents.on('render-process-gone', () => (unsavedChanges = false));
  win.on('close', (event) => {
    if (closeConfirmed || !unsavedChanges || hung || win.webContents.isCrashed()) return;
    event.preventDefault();
    win.webContents.send('window:close-request');
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  if (isDev()) void win.loadURL(DEV_ORIGIN);
  else void win.loadURL('app://redcolumn/index.html');
  if (smoke) smokeTest(win);
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
