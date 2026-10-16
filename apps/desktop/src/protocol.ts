import { app, net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Registered before the app is ready. standard + secure makes app://redcolumn a real origin,
 * so the OPFS library and IndexedDB stay put for as long as this host does not change.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

export function webRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'web');
  // The end-to-end tests (e2e/) load a separate build with their test hook, so it never lands in dist.
  return path.join(__dirname, process.env.RECOLUMN_E2E === '1' ? '../../web/dist-e2e' : '../../web/dist');
}

function fileFor(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  const full = path.resolve(root, relative);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

/** Serves the built web app at app://redcolumn/. Missing files 404; there is no silent fallback. */
export function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'redcolumn') return new Response('Not found', { status: 404 });
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = fileFor(webRoot(), pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
    return withSecurityHeaders(await net.fetch(pathToFileURL(file).href));
  });
}

/**
 * Headers a <meta> cannot set, on every app:// response: nothing may frame the app, and nothing is
 * sniffed. Each page's full Content Security Policy is in the page itself (apps/web/src/security/csp.ts).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
