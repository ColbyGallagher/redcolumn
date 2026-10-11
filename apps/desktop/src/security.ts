import { app, Menu, shell, type BrowserWindowConstructorOptions, type Input, type Session, type WebContents } from 'electron';
import { isDev } from './dev';
import { externalProtocol, isAppNavigation, isAppOrigin, isHelpUrl } from './navigation';

const childWindow = (): BrowserWindowConstructorOptions => ({
  width: 960,
  height: 720,
  autoHideMenuBar: true,
  webPreferences: {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  },
});

function isReload(input: Input): boolean {
  if (input.type !== 'keyDown') return false;
  const key = input.key.toLowerCase();
  if (key === 'f5') return true;
  return key === 'r' && (input.control || input.meta) && !input.alt;
}

/**
 * Windows and Linux get no application menu: its accelerators (reload, close, devtools)
 * fire before the page. macOS keeps the app menu and Edit roles, without reload or close.
 */
export function installMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]));
    return;
  }
  Menu.setApplicationMenu(null);
}

/** Keeps one window on the app origin and sends http(s) and mailto to the system. */
export function harden(contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isHelpUrl(url, isDev()) || url.startsWith('blob:')) return { action: 'allow', overrideBrowserWindowOptions: childWindow() };
    if (externalProtocol(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAppNavigation(url, isDev())) return;
    event.preventDefault();
    if (externalProtocol(url)) void shell.openExternal(url);
  });
  contents.on('before-input-event', (event, input) => {
    if (app.isPackaged && isReload(input)) event.preventDefault();
  });
}

/** Clipboard, camera, fullscreen and the storage the web app already asks for. */
const ALLOWED_PERMISSIONS = new Set(['persistent-storage', 'fileSystem', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'media']);

/** Granted to the app's own origin only. Help windows and anything else get nothing. */
export function installPermissions(session: Session) {
  const allow = (permission: string, origin: string) => ALLOWED_PERMISSIONS.has(permission) && isAppOrigin(origin, isDev());
  session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allow(permission, requestingOrigin));
  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allow(permission, details.requestingUrl || wc.getURL()));
  });
}
