/**
 * On-device PDF library backed by the Origin Private File System. File contents are stored by the
 * SHA-256 of their bytes, so re-opening the same file finds its existing entry and markups. Each
 * entry also has a stable `id` that survives edits to the file (page operations change its bytes);
 * markups are kept by that id.
 */

export interface StoredFile {
  /** Stable document id: the hash of the file as first added. */
  id: string;
  /** Hash of the current contents. */
  hash: string;
  name: string;
  size: number;
  addedAt: number;
  lastOpenedAt: number;
  /** Earlier versions kept on the device (Slip Sheet, Restore), newest first. */
  revisions?: FileRevision[];
  /** A template: File › New PDF from Template starts new documents from a copy of it. */
  template?: boolean;
}

/** A kept earlier version of a document's contents. */
export interface FileRevision {
  hash: string;
  size: number;
  savedAt: number;
  /** What replaced it, e.g. "Before Slip Sheet: A-101, A-102". */
  note: string;
}

const INDEX_FILE = 'index.json';
const FILES_DIR = 'files';

async function root() {
  return navigator.storage.getDirectory();
}

async function filesDir() {
  return (await root()).getDirectoryHandle(FILES_DIR, { create: true });
}

async function readIndex(): Promise<StoredFile[]> {
  try {
    const handle = await (await root()).getFileHandle(INDEX_FILE);
    const entries = JSON.parse(await (await handle.getFile()).text()) as (Omit<StoredFile, 'id'> & { id?: string })[];
    // Entries from before ids existed keep their hash as their id, so their markups stay attached.
    return entries.map((e) => ({ ...e, id: e.id ?? e.hash }));
  } catch {
    return [];
  }
}

async function writeIndex(entries: StoredFile[]) {
  const handle = await (await root()).getFileHandle(INDEX_FILE, { create: true });
  const w = await handle.createWritable();
  await w.write(JSON.stringify(entries));
  await w.close();
}

/** Serializes index read-modify-write cycles so concurrent calls do not drop entries. */
let indexLock: Promise<unknown> = Promise.resolve();
function updateIndex<T>(fn: (entries: StoredFile[]) => { entries: StoredFile[]; result: T }): Promise<T> {
  const run = indexLock.then(async () => {
    const { entries, result } = fn(await readIndex());
    await writeIndex(entries);
    return result;
  });
  indexLock = run.catch(() => undefined);
  return run;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Most recently opened first. */
export async function listFiles(): Promise<StoredFile[]> {
  return (await readIndex()).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

async function writeBlob(hash: string, bytes: ArrayBuffer) {
  const dir = await filesDir();
  try {
    await dir.getFileHandle(`${hash}.pdf`);
    return;
  } catch {
    // Not stored yet.
  }
  const handle = await dir.getFileHandle(`${hash}.pdf`, { create: true });
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}

/** Stores `bytes` (no-op if already stored) and marks it as just opened. */
export async function saveFile(name: string, bytes: ArrayBuffer): Promise<StoredFile> {
  const hash = await sha256(bytes);
  await writeBlob(hash, bytes);
  const now = Date.now();
  return updateIndex((entries) => {
    const existing = entries.find((e) => e.hash === hash);
    const entry: StoredFile = existing
      ? { ...existing, name, lastOpenedAt: now }
      : { id: hash, hash, name, size: bytes.byteLength, addedAt: now, lastOpenedAt: now };
    return { entries: [...entries.filter((e) => e.id !== entry.id), entry], result: entry };
  });
}

/**
 * Replaces a document's contents (after page operations), keeping its id and markups. The old
 * contents are deleted unless another entry still uses them.
 */
export async function replaceFileContent(id: string, bytes: ArrayBuffer): Promise<StoredFile> {
  const hash = await sha256(bytes);
  await writeBlob(hash, bytes);
  let oldHash: string | null = null;
  const entry = await updateIndex((entries) => {
    const current = entries.find((e) => e.id === id);
    if (!current) throw new Error('Document not found in the library');
    oldHash = current.hash;
    const next: StoredFile = { ...current, hash, size: bytes.byteLength, lastOpenedAt: Date.now() };
    return { entries: entries.map((e) => (e.id === id ? next : e)), result: next };
  });
  if (oldHash && oldHash !== hash) await dropIfUnused(oldHash);
  return entry;
}

/** Deletes stored contents that no entry or kept revision uses any more. */
async function dropIfUnused(hash: string) {
  const used = (await readIndex()).some((e) => e.hash === hash || e.revisions?.some((r) => r.hash === hash));
  if (used) return;
  try {
    await (await filesDir()).removeEntry(`${hash}.pdf`);
  } catch {
    // Already gone.
  }
}

/**
 * Keeps the document's current contents as a revision (before they are replaced), so they can be
 * opened, compared or restored later.
 */
export async function keepRevision(id: string, note: string): Promise<void> {
  await updateIndex((entries) => ({
    entries: entries.map((e) => (e.id === id ? { ...e, revisions: [{ hash: e.hash, size: e.size, savedAt: Date.now(), note }, ...(e.revisions ?? []).filter((r) => r.hash !== e.hash)] } : e)),
    result: undefined,
  }));
}

/** Marks a document as a template (or not). */
export async function setTemplate(id: string, on: boolean): Promise<void> {
  await updateIndex((entries) => ({ entries: entries.map((e) => (e.id === id ? { ...e, template: on || undefined } : e)), result: undefined }));
}

/** Forgets a kept revision (and deletes its contents unless something else uses them). */
export async function removeRevision(id: string, hash: string): Promise<void> {
  await updateIndex((entries) => ({
    entries: entries.map((e) => (e.id === id ? { ...e, revisions: (e.revisions ?? []).filter((r) => r.hash !== hash) } : e)),
    result: undefined,
  }));
  await dropIfUnused(hash);
}

/**
 * Stores bytes without adding them to the library (a Live Session's documents live in the
 * session, not the library) and returns their hash for `readFile`.
 */
export async function cacheFile(bytes: ArrayBuffer): Promise<string> {
  const hash = await sha256(bytes);
  await writeBlob(hash, bytes);
  return hash;
}

export async function readFile(hash: string): Promise<ArrayBuffer> {
  const handle = await (await filesDir()).getFileHandle(`${hash}.pdf`);
  return (await handle.getFile()).arrayBuffer();
}

export async function touchFile(id: string): Promise<void> {
  await updateIndex((entries) => ({
    entries: entries.map((e) => (e.id === id ? { ...e, lastOpenedAt: Date.now() } : e)),
    result: undefined,
  }));
}

/** Removes the file from the library. Its markups stay in IndexedDB and return if it is re-added. */
export async function removeFile(file: StoredFile): Promise<void> {
  const current = (await readIndex()).find((e) => e.id === file.id);
  await updateIndex((entries) => ({ entries: entries.filter((e) => e.id !== file.id), result: undefined }));
  for (const hash of new Set([file.hash, ...(current?.revisions ?? []).map((r) => r.hash)])) await dropIfUnused(hash);
}
