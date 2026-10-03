/**
 * Help › Install App: installing redcolumn as an app (desktop, dock or home screen). Chromium
 * browsers offer an install prompt through `beforeinstallprompt`, which must be caught as soon as
 * the page loads (main.tsx calls `captureInstallPrompt`) and shown later from a click. Safari and
 * Firefox have no prompt, so the dialog explains their own steps instead.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's own mini-infobar from appearing; Help › Install App shows it instead.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    changed();
  });
}

export const onInstallChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const canPromptInstall = () => !!deferred;

/** Shows the browser's install prompt; true when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  changed();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

/** Running as the installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export type InstallPlatform = 'ios' | 'android' | 'safari-mac' | 'firefox' | 'chromium' | 'other';

/** Which install steps apply, from the user agent (and touch points, since iPadOS reports a Mac). */
export function installPlatform(ua: string, maxTouchPoints = 0): InstallPlatform {
  const ipadAsMac = /Macintosh/.test(ua) && maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || ipadAsMac) return 'ios';
  if (/Firefox\//.test(ua) && !/Seamonkey/.test(ua)) return /Android/.test(ua) ? 'android' : 'firefox';
  if (/Android/.test(ua)) return 'android';
  if (/Edg\/|Chrome\/|Chromium\//.test(ua)) return 'chromium';
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return 'safari-mac';
  return 'other';
}

/** The steps to install by hand on each platform, for when there is no prompt to show. */
export const INSTALL_STEPS: Record<InstallPlatform, string[]> = {
  ios: ['Tap the Share button (the square with an arrow) in Safari’s toolbar.', 'Scroll down and tap Add to Home Screen.', 'Tap Add. redcolumn opens from its icon, full screen, and works offline.'],
  android: ['Open the browser’s menu (⋮).', 'Tap Install app (or Add to Home screen).', 'Confirm. redcolumn opens from its icon and works offline.'],
  'safari-mac': ['In Safari, choose File › Add to Dock.', 'Click Add. redcolumn opens from the Dock in its own window.'],
  firefox: ['Firefox on the desktop does not install web apps yet.', 'Open redcolumn in Chrome, Edge or Safari to install it; in Firefox it still works offline once loaded.'],
  chromium: ['Click the install icon at the right of the address bar (a screen with an arrow), or open the browser menu and choose Install redcolumn.', 'Click Install.'],
  other: ['Look in the browser’s menu for Install, Add to Home Screen or Add to Dock.'],
};
