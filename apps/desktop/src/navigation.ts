/** Where a packaged window is allowed to sit. The library is stored against this origin. */
export const APP_ORIGIN = 'app://redcolumn';

const DEV_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** The main window may commit a navigation here. Blob URLs are print and summary previews. */
export function isAppNavigation(url: string, dev: boolean): boolean {
  if (url.startsWith('blob:')) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (dev) return parsed.protocol === 'http:' && DEV_HOSTS.has(parsed.hostname) && parsed.port === '5173';
  return parsed.protocol === 'app:' && parsed.hostname === 'redcolumn';
}

/** Help is part of the app, served from the app origin (or the Vite server in dev). */
export function isHelpUrl(url: string, dev: boolean): boolean {
  if (url.startsWith('blob:') || !isAppNavigation(url, dev)) return false;
  try {
    return /\/help\/index\.html$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** The origin a permission request may come from: the app itself, never a help or remote page. */
export function isAppOrigin(origin: string, dev: boolean): boolean {
  try {
    const url = new URL(origin);
    return isAppNavigation(`${url.protocol}//${url.host}/`, dev);
  } catch {
    return false;
  }
}

/** Protocols the main process may hand to the operating system. */
export function externalProtocol(url: string): 'http:' | 'https:' | 'mailto:' | null {
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return protocol;
    return null;
  } catch {
    return null;
  }
}
