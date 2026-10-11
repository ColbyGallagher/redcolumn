import { createServer, type Server } from 'node:http';

/** A tenant is a GUID, a domain, or one of the named audiences. Nothing else goes in the URL. */
export function validTenant(tenant: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,252}$/i.test(tenant);
}

export class SignInClosed extends Error {
  constructor() {
    super('Sign-in was closed.');
  }
}

interface CodeListener {
  code: Promise<string>;
  redirectUri: string;
  close: (reason?: Error) => void;
}

/**
 * Listens on a loopback port for the provider's redirect (RFC 8252). Only a request that carries
 * the expected `state` ends the wait; anything else is answered 404 and ignored.
 */
export function listenForCode(state: string, timeoutMs = 180_000): Promise<CodeListener> {
  const codePromise = promiseWithResolvers<string>();
  let settled = false;
  return new Promise((resolve, reject) => {
    const finish = (err: Error | null, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (err) codePromise.reject(err);
      else codePromise.resolve(code ?? '');
    };
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
        res.writeHead(404);
        res.end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>redcolumn</title><p>${error || !code ? 'Sign-in did not finish.' : 'Sign-in complete.'} You can close this window and return to redcolumn.</p>`);
      if (error || !code) finish(error === 'access_denied' ? new SignInClosed() : new Error('Sign-in did not finish.'));
      else finish(null, code);
    });
    const timer = setTimeout(() => finish(new SignInClosed()), timeoutMs);
    server.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        code: codePromise.promise,
        // No path: Entra matches the registered http://127.0.0.1 with any port, and Google
        // accepts any loopback port for a Desktop client.
        redirectUri: `http://127.0.0.1:${port}`,
        close: (reason) => finish(reason ?? new SignInClosed()),
      });
    });
  });
}

function promiseWithResolvers<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A listener that is closed before anyone awaits the code must not crash the main process.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}
