import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { OFFLINE } from './message';

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Waiter>();

/** The app page's answer to a tool call. Ignored when the id is not one we sent. */
export function takeAssistantResult(body: unknown) {
  if (!body || typeof body !== 'object') return;
  const rec = body as { id?: unknown; result?: unknown; error?: unknown };
  if (typeof rec.id !== 'string') return;
  const waiter = pending.get(rec.id);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  pending.delete(rec.id);
  if (typeof rec.error === 'string') waiter.reject(new Error(rec.error));
  else waiter.resolve(rec.result);
}

export function cancelAssistantCalls() {
  for (const [id, waiter] of pending) {
    clearTimeout(waiter.timer);
    pending.delete(id);
    waiter.reject(new Error(OFFLINE));
  }
}

/** Asks the open window. The caller already checked the message came from the app page. */
export function askPage(getWindow: () => BrowserWindow | null, method: string, params: unknown, timeoutMs = 10_000): Promise<unknown> {
  const win = getWindow();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.reject(new Error(OFFLINE));
  const id = randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('redcolumn did not answer. Leave the desktop app open and try again.'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      win.webContents.send('assistant:call', { id, method, params });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(OFFLINE));
    }
  });
}
