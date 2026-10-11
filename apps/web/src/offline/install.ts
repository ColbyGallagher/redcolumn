/**
 * Help › Install App: redcolumn is installed as the Windows desktop app, a download from the
 * project's GitHub releases. The browser app is not installed as a PWA any more.
 */

import { desktop } from '../desktop/host.ts';
import { PROJECT_URL } from '../help/whatsNew.ts';

/** Always the newest release's installer: electron-builder.yml fixes the file name. */
export const INSTALLER_URL = `${PROJECT_URL}/releases/latest/download/redcolumn-Setup.exe`;
export const RELEASES_URL = `${PROJECT_URL}/releases/latest`;

/** Running as the desktop app, or as an already installed web app, rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (desktop()) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** The installer is built for Windows only. */
export const installerSupported = (ua: string): boolean => /Windows NT/.test(ua);

/** What to do after the download, as the dialog lists it. */
export const INSTALL_STEPS = [
  'Open redcolumn-Setup.exe from your Downloads folder.',
  'Windows may warn that the publisher is unknown, because the installer is not signed. Choose More info, then Run anyway.',
  'Pick where to install it and finish. redcolumn opens from the Start menu and can open PDFs from your file manager.',
];
