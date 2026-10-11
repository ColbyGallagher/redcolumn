import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isOpenable, OPENABLE_EXTENSIONS, PathAllowlist } from './allowlist';
import { saveError, writeAtomic } from './atomic';
import { isDev } from './dev';
import type { LaunchQueue } from './launch';
import { isAppNavigation } from './navigation';

export interface TokenName {
  token: string;
  name: string;
}

const FILE_FILTERS = [{ name: 'PDF and pictures', extensions: OPENABLE_EXTENSIONS }];

/** True when the message came from the app's own page, not a help window or a blob preview. */
export function fromApp(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  return isAppNavigation(url, isDev()) && !url.startsWith('blob:');
}

function bytesOf(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/** Dialogs, drops and launch paths. The renderer receives tokens, never paths. */
export function registerPathIpc(allowlist: PathAllowlist, launches: LaunchQueue, parent: () => BrowserWindow | null) {
  ipcMain.handle('paths:pick-open', async (event): Promise<TokenName[] | null> => {
    if (!fromApp(event)) return null;
    const window = parent();
    const options = { title: 'Open', properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[], filters: FILE_FILTERS };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    return result.filePaths.map((filePath) => ({ token: allowlist.add(filePath), name: path.basename(filePath) }));
  });

  ipcMain.handle('paths:pick-save', async (event, suggestedName: unknown): Promise<TokenName | null> => {
    if (!fromApp(event)) return null;
    const name = typeof suggestedName === 'string' && suggestedName.trim() ? path.basename(suggestedName.trim()) : 'document.pdf';
    const ext = path.extname(name).replace(/^\./, '') || 'pdf';
    const window = parent();
    const options = { title: 'Save', defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    return { token: allowlist.add(result.filePath), name: path.basename(result.filePath) };
  });

  ipcMain.handle('paths:read', async (event, token: unknown): Promise<Uint8Array> => {
    if (!fromApp(event) || typeof token !== 'string') throw new Error('Denied');
    const filePath = allowlist.get(token);
    if (!filePath) throw new Error('That file is not open from this app.');
    try {
      return await fs.readFile(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new Error(`${path.basename(filePath)} is no longer in its folder. It may have been moved, renamed or deleted.`);
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') throw new Error(`${path.basename(filePath)} could not be read. Another program may have it locked.`);
      throw err;
    }
  });

  ipcMain.handle('paths:write', async (event, token: unknown, data: unknown): Promise<boolean> => {
    if (!fromApp(event) || typeof token !== 'string') return false;
    const filePath = allowlist.get(token);
    const bytes = bytesOf(data);
    if (!filePath || !bytes) return false;
    try {
      await writeAtomic(filePath, bytes);
    } catch (err) {
      throw saveError(err, filePath);
    }
    return true;
  });

  ipcMain.handle('paths:show', async (event, token: unknown): Promise<boolean> => {
    if (!fromApp(event) || typeof token !== 'string') return false;
    const filePath = allowlist.get(token);
    if (!filePath) return false;
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle('paths:forget', (event, token: unknown): boolean => {
    if (!fromApp(event) || typeof token !== 'string') return false;
    return allowlist.remove(token);
  });

  // The path comes from webUtils.getPathForFile in the preload. Only an existing file of a kind
  // the app opens is accepted, so this cannot hand out a token for an arbitrary path.
  ipcMain.handle('paths:register-dropped', async (event, filePath: unknown): Promise<string | null> => {
    if (!fromApp(event) || typeof filePath !== 'string' || !path.isAbsolute(filePath) || !isOpenable(filePath)) return null;
    try {
      if (!(await fs.stat(filePath)).isFile()) return null;
    } catch {
      return null;
    }
    return allowlist.add(filePath);
  });

  ipcMain.handle('launch:take', (event) => {
    if (!fromApp(event)) return [];
    return launches.take();
  });
}

export async function persistAllowlist(allowlist: PathAllowlist, filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(filePath, JSON.stringify({ version: 1, entries: allowlist.toJSON() }));
}

export async function restoreAllowlist(allowlist: PathAllowlist, filePath: string) {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return; // First run.
  }
  try {
    const raw = JSON.parse(text) as { entries?: Record<string, string> };
    if (raw.entries) allowlist.load(raw.entries);
  } catch {
    // Keep the unreadable file for inspection instead of overwriting it on the next save.
    await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined);
  }
}
