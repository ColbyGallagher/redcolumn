/**
 * Links library documents to the file they were opened from, so Save can write over that file
 * (the File System Access API: Chromium browsers and installed PWAs). Handles are kept in
 * IndexedDB by library document id; where the API is missing everything here is a no-op and the
 * app falls back to downloading. The desktop app stores a token instead of a browser handle.
 */

import { desktop } from '../desktop/host';
import { isTokenRecord } from '../desktop/record';
import { hasFileLocation, mimeFor, noteLocation, ownedBytes, revealFileLocation, subscribeFileLocations, toBytes, tokenHandle, tokenOf } from '../desktop/tokens';

export { hasFileLocation, revealFileLocation, subscribeFileLocations };

type Mode = 'read' | 'readwrite';
interface PermissionHandle extends FileSystemFileHandle {
  queryPermission(o: { mode: Mode }): Promise<PermissionState>;
  requestPermission(o: { mode: Mode }): Promise<PermissionState>;
}
interface PickerOptions {
  suggestedName?: string;
  id?: string;
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
}
type W = {
  showOpenFilePicker?: (o?: PickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (o?: PickerOptions) => Promise<FileSystemFileHandle>;
};
const win = () => window as unknown as W;

export const canPickFiles = () => typeof window !== 'undefined' && !!win().showOpenFilePicker && !!win().showSaveFilePicker;

/** The handle each File came from, for Files that came from a picker, the file manager or a folder. */
const handleOfFile = new WeakMap<File, FileSystemFileHandle>();
export const bindHandle = (file: File, handle: FileSystemFileHandle) => void handleOfFile.set(file, handle);
export const handleOf = (file: File) => handleOfFile.get(file);

const DB = 'redcolumn-disk-handles';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberHandle(id: string, handle: FileSystemFileHandle | null): Promise<void> {
  const token = tokenOf(handle);
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction('files', 'readwrite');
      if (token && handle) tx.objectStore('files').put({ v: 1, token, name: handle.name }, id);
      else if (handle) tx.objectStore('files').put(handle, id);
      else tx.objectStore('files').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    d.close();
    noteLocation(id, token);
  } catch {
    // Not remembered: Save asks where to put the file instead.
  }
}

export async function recallHandle(id: string): Promise<FileSystemFileHandle | null> {
  try {
    const d = await db();
    const handle = await new Promise<unknown>((resolve, reject) => {
      const req = d.transaction('files').objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    d.close();
    if (isTokenRecord(handle)) {
      noteLocation(id, handle.token);
      return tokenHandle(handle.token, handle.name);
    }
    return (handle as FileSystemFileHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Forgets the file a document was opened from, for Remove from Device. The desktop app also drops
 * the path, unless another document still points at the same file.
 */
export async function forgetHandle(id: string): Promise<void> {
  try {
    const d = await db();
    const { previous, stillUsed } = await new Promise<{ previous: unknown; stillUsed: boolean }>((resolve, reject) => {
      const tx = d.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      let previous: unknown;
      let stillUsed = false;
      const get = store.get(id);
      get.onsuccess = () => {
        previous = get.result;
        store.delete(id);
        if (!isTokenRecord(previous)) return;
        const token = previous.token;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (String(c.key) !== id && isTokenRecord(c.value) && c.value.token === token) stillUsed = true;
          else c.continue();
        };
      };
      tx.oncomplete = () => resolve({ previous, stillUsed });
      tx.onerror = () => reject(tx.error);
    });
    d.close();
    noteLocation(id, null);
    const host = desktop();
    if (host && isTokenRecord(previous) && !stillUsed) await host.forgetToken(previous.token);
  } catch {
    // Nothing remembered.
  }
}

/** Loads remembered desktop paths so Open file location can enable before a file is opened. */
export async function primeFileLocations(): Promise<void> {
  if (!desktop()) return;
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const req = d.transaction('files').objectStore('files').openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        if (isTokenRecord(cursor.value)) noteLocation(String(cursor.key), cursor.value.token);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    d.close();
  } catch {
    // Locations stay disabled until a file is opened.
  }
}

const PDF_TYPES: PickerOptions['types'] = [{ description: 'PDF and pictures', accept: { 'application/pdf': ['.pdf'], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'] } }];

/** Shows the system Open dialog; null if the browser has none (use the file input) or it was cancelled. */
export async function pickFilesToOpen(): Promise<File[] | null> {
  const host = desktop();
  if (host?.nativeFiles) {
    try {
      const picked = await host.pickOpen();
      if (!picked) return [];
      const files: File[] = [];
      for (const item of picked) {
        const bytes = ownedBytes(await host.readToken(item.token));
        const file = new File([bytes], item.name, { type: mimeFor(item.name) });
        bindHandle(file, tokenHandle(item.token, item.name));
        files.push(file);
      }
      return files;
    } catch {
      return null;
    }
  }
  const pick = win().showOpenFilePicker;
  if (!pick) return null;
  try {
    const handles = await pick({ multiple: true, id: 'redcolumn-open', types: PDF_TYPES });
    const files: File[] = [];
    for (const h of handles) {
      const f = await h.getFile();
      bindHandle(f, h);
      files.push(f);
    }
    return files;
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return [];
    return null;
  }
}

/** Writes bytes over the file; false when the user would not allow writing to it. */
export async function writeToHandle(handle: FileSystemFileHandle, data: Blob | BufferSource): Promise<boolean> {
  const h = handle as PermissionHandle;
  if ((await h.queryPermission?.({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission?.({ mode: 'readwrite' })) !== 'granted') return false;
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
  return true;
}

/** Shows the system Save As dialog and writes `data` there. Returns the chosen file, or null if cancelled. */
export async function saveAsWithPicker(name: string, mime: string, data: Blob | BufferSource): Promise<FileSystemFileHandle | null | 'unsupported'> {
  const host = desktop();
  if (host?.nativeFiles) {
    // A file that could not be written (open in another program, read-only, disk full) is an
    // error the person needs to see, not a reason to fall back to a download.
    const picked = await host.pickSave(name);
    if (!picked) return null;
    if (!(await host.writeToken(picked.token, await toBytes(data)))) throw new Error(`${picked.name} could not be written.`);
    return tokenHandle(picked.token, picked.name);
  }
  const pick = win().showSaveFilePicker;
  if (!pick) return 'unsupported';
  const ext = /\.[a-z0-9]+$/i.exec(name)?.[0];
  try {
    const handle = await pick({
      suggestedName: name,
      id: 'redcolumn-save',
      ...(ext && mime ? { types: [{ description: `${ext.slice(1).toUpperCase()} file`, accept: { [mime]: [ext] } }] } : {}),
    });
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
    return handle;
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return null;
    return 'unsupported';
  }
}

/**
 * The PDFs in a drop, each linked to its file on disk where the browser allows (so Save can write
 * back to it). The handles must be requested before the drop event ends, hence no awaiting first.
 */
export async function droppedPdfs(dt: DataTransfer): Promise<File[]> {
  const isPdf = (f: { name: string; type: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  // Electron's drop files carry a path. A File System Access handle from the same drop does not.
  if (desktop()) return bindDesktopPaths([...dt.files].filter(isPdf));
  const asked = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? null);
  const fallback = [...dt.files];
  if (!asked.length || asked.every((p) => !p)) return bindDesktopPaths(fallback.filter(isPdf));
  const files: File[] = [];
  for (const p of asked) {
    try {
      const h = await p;
      if (h?.kind !== 'file') continue;
      const file = await (h as FileSystemFileHandle).getFile();
      if (!isPdf(file)) continue;
      bindHandle(file, h as FileSystemFileHandle);
      files.push(file);
    } catch {
      // Not readable through a handle: the plain files below still open.
    }
  }
  return bindDesktopPaths(files.length ? files : fallback.filter(isPdf));
}

async function bindDesktopPaths(files: File[]): Promise<File[]> {
  const host = desktop();
  if (!host) return files;
  for (const file of files) {
    const token = await host.tokenForFile(file);
    if (token) bindHandle(file, tokenHandle(token, file.name));
  }
  return files;
}

