import path from 'node:path';
import { TokenService } from './token';
import { serveTokens } from './token-ipc';

/**
 * The card service: an Electron utility process the main process starts (main.ts, TokenClient).
 * It loads the PKCS#11 drivers and talks to the cards, so a call that blocks (a PIN typed on the
 * reader's own keypad) or a driver that crashes holds up only this process, never the windows.
 *
 * The first message says where the drivers the person picked are kept; every later one is a call.
 */
const parent = process.parentPort;
let begin!: (storeFile: string) => void;
const started = new Promise<TokenService>((resolve, reject) => {
  begin = (storeFile) => {
    const service = new TokenService(storeFile);
    service.restore().then(() => resolve(service), reject);
  };
});
const listeners: ((message: unknown) => void)[] = [];
let first = true;

parent.on('message', ({ data }) => {
  if (first) {
    first = false;
    const storeFile = (data as { storeFile?: unknown })?.storeFile;
    if (typeof storeFile !== 'string' || !path.isAbsolute(storeFile)) process.exit(1);
    begin(storeFile);
    return;
  }
  for (const listener of listeners) listener(data);
});

serveTokens(started, { post: (message) => parent.postMessage(message), onMessage: (listener) => void listeners.push(listener) });
