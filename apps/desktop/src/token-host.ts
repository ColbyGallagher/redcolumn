import path from 'node:path';
import { TokenService } from './token';
import { serveTokens } from './token-ipc';

/**
 * The card service: an Electron utility process the main process starts (main.ts, TokenClient).
 * It loads the PKCS#11 drivers and talks to the cards, so a call that blocks (a PIN typed on the
 * reader's own keypad) or a driver that crashes holds up only this process, never the windows.
 */
const parent = process.parentPort;

serveTokens(
  async (hello) => {
    const storeFile = (hello as { storeFile?: unknown })?.storeFile;
    if (typeof storeFile !== 'string' || !path.isAbsolute(storeFile)) throw new Error('The card service was not told where its drivers are kept.');
    const service = new TokenService(storeFile);
    await service.restore();
    return service;
  },
  { post: (message) => parent.postMessage(message), onMessage: (listener) => void parent.on('message', ({ data }) => listener(data)) },
);
