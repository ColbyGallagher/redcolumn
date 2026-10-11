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
  return app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '../../web/dist');
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
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'redcolumn') return new Response('Not found', { status: 404 });
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = fileFor(webRoot(), pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
}
