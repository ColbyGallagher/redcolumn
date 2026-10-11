import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdateStatus = 'latest' | 'downloading' | 'ready' | 'unavailable';

let status: UpdateStatus = 'unavailable';

/** How often a long-running app looks for a new release. */
const CHECK_EVERY_MS = 4 * 60 * 60_000;

/** Checks GitHub Releases. Unpackaged runs report unavailable; an unsigned local build does not phone home. */
export function startUpdater(onReady: () => void) {
  if (!app.isPackaged) return;
  status = 'latest';
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', () => {
    status = 'downloading';
  });
  autoUpdater.on('update-not-available', () => {
    if (status !== 'ready') status = 'latest';
  });
  autoUpdater.on('update-downloaded', () => {
    status = 'ready';
    onReady();
  });
  // Offline, a missing release or a failed download. Without a listener the error is thrown in
  // the main process. A finished download stays ready.
  autoUpdater.on('error', (err) => {
    if (status !== 'ready') status = 'unavailable';
    console.warn('Update check failed:', err instanceof Error ? err.message : err);
  });
  const check = () => {
    if (status === 'ready' || status === 'downloading') return;
    void autoUpdater.checkForUpdates().catch(() => {
      if (status !== 'ready') status = 'unavailable';
    });
  };
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return 'unavailable';
  if (status === 'ready' || status === 'downloading') return status;
  try {
    const result = await autoUpdater.checkForUpdates();
    if ((status as UpdateStatus) === 'ready') return 'ready';
    if (result?.isUpdateAvailable) {
      status = 'downloading';
      return 'downloading';
    }
    status = 'latest';
    return 'latest';
  } catch {
    return 'unavailable';
  }
}

export function installUpdate() {
  if (status !== 'ready') return;
  autoUpdater.quitAndInstall(false, true);
}
