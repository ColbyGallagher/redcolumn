/**
 * Links library documents to the file they were opened from, so Save can write over that file
 * (the File System Access API: Chromium browsers and installed PWAs). Handles are kept in
 * IndexedDB by library document id; where the API is missing everything here is a no-op and the
 * app falls back to downloading.
 */

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
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction('files', 'readwrite');
      if (handle) tx.objectStore('files').put(handle, id);
      else tx.objectStore('files').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    d.close();
  } catch {
    // Not remembered: Save asks where to put the file instead.
  }
}

export async function recallHandle(id: string): Promise<FileSystemFileHandle | null> {
  try {
    const d = await db();
    const handle = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const req = d.transaction('files').objectStore('files').get(id);
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    d.close();
    return handle;
  } catch {
    return null;
  }
}

const PDF_TYPES: PickerOptions['types'] = [{ description: 'PDF and pictures', accept: { 'application/pdf': ['.pdf'], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'] } }];

/** Shows the system Open dialog; null if the browser has none (use the file input) or it was cancelled. */
export async function pickFilesToOpen(): Promise<File[] | null> {
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
  const asked = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? null);
  const fallback = [...dt.files];
  if (!asked.length || asked.every((p) => !p)) return fallback.filter(isPdf);
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
  return files.length ? files : fallback.filter(isPdf);
}
