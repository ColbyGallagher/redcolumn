/**
 * Help › Install App: redcolumn is installed as the desktop app for Windows or macOS, a download from
 * the project's GitHub releases. The browser app is not installed as a PWA any more.
 */

import { desktop } from '../desktop/host.ts';
import { PROJECT_URL } from '../help/whatsNew.ts';

/** Always the newest release's installers: electron-builder.yml fixes the file names. */
export const INSTALLER_URL = `${PROJECT_URL}/releases/latest/download/redcolumn-Setup.exe`;
export const MAC_ARM64_URL = `${PROJECT_URL}/releases/latest/download/redcolumn-arm64.dmg`;
export const MAC_X64_URL = `${PROJECT_URL}/releases/latest/download/redcolumn-x64.dmg`;
export const RELEASES_URL = `${PROJECT_URL}/releases/latest`;

/** Running as the desktop app, or as an already installed web app, rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (desktop()) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export type InstallerPlatform = 'windows' | 'mac';

/**
 * Which installer this browser's system takes, or null when there is none. iPads also report
 * "Macintosh", so a touch screen rules macOS out. Safari reports "Intel Mac OS X" on Apple Silicon
 * too, which is why the Mac dialog offers both DMGs.
 */
export function installerPlatform(ua: string, maxTouchPoints = 0): InstallerPlatform | null {
  if (/Windows NT/.test(ua)) return 'windows';
  if (/Macintosh/.test(ua) && maxTouchPoints <= 1) return 'mac';
  return null;
}

/** What to do after the download, as the dialog lists it. */
export const INSTALL_STEPS: Record<InstallerPlatform, string[]> = {
  windows: [
    'Open redcolumn-Setup.exe from your Downloads folder.',
    'Windows may warn that the publisher is unknown, because the installer is not signed. Choose More info, then Run anyway.',
    'Pick where to install it and finish. redcolumn opens from the Start menu and can open PDFs from your file manager.',
  ],
  mac: [
    'Download the Apple Silicon version for an M-series Mac, or the Intel version for an older Mac. Apple menu › About This Mac shows which you have.',
    'Open the downloaded .dmg and drag redcolumn into Applications.',
    'The app is not signed, so macOS blocks the first launch. Open it once, then go to System Settings › Privacy & Security and choose Open Anyway.',
  ],
};
