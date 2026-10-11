import * as Y from 'yjs';
import { plainMarkupPersistence, setMarkupPersistence, type MarkupPersistence } from '@nb/markup';
import { desktop } from '../desktop/host';
import { aesKey, isSealed, seal, unseal } from '../studio/crypto/keys';

/**
 * "Encrypt local data" in the desktop app (docs/SECURITY-HARDENING.md, E4), for shared computers:
 * the library's PDFs, its index and every document's markups are sealed with AES-GCM before they
 * reach this device's storage. The key is made once by the main process and kept encrypted by the
 * system key store (DPAPI on Windows, Keychain on macOS), so the files alone, copied off the disk or
 * read by another account, are unreadable. Reading always accepts unsealed data too, so turning it
 * on or off part-way never loses anything.
 */

const FLAG = 'nb.local.encrypt';
const MARKUPS = 'nb-markups-';
const SEALED_SUFFIX = '-enc';

export const localEncryptionAvailable = () => !!desktop()?.localDataKey;

export function localEncryptionOn(): boolean {
  try {
    return localEncryptionAvailable() && localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

let key: Promise<CryptoKey> | null = null;
function localKey(): Promise<CryptoKey> {
  key ??= (async () => {
    const raw = await desktop()?.localDataKey?.();
    if (!raw) throw new Error('This computer cannot keep an encryption key (no system key store).');
    return aesKey(raw);
  })();
  return key;
}

/** Seals bytes for this device's storage when local encryption is on; otherwise returns them. */
export async function sealLocal(bytes: Uint8Array): Promise<Uint8Array> {
  return localEncryptionOn() ? seal(await localKey(), 0, bytes) : bytes;
}

/** Opens sealed bytes; unsealed bytes come back as they are. */
export async function openLocal(bytes: Uint8Array): Promise<Uint8Array> {
  return isSealed(bytes) ? unseal(await localKey(), bytes) : bytes;
}

// ---- Markups: a document's Yjs updates, each sealed, in IndexedDB ----

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('u', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Writes a document's whole state as the only sealed update in `name`. */
async function writeSealedState(name: string, doc: Y.Doc) {
  const db = await openDb(name);
  const sealed = await seal(await localKey(), 0, Y.encodeStateAsUpdate(doc));
  const tx = db.transaction('u', 'readwrite');
  tx.objectStore('u').clear();
  tx.objectStore('u').add(sealed);
  await done(tx);
  db.close();
}

async function readSealed(name: string): Promise<Uint8Array[]> {
  const db = await openDb(name);
  const rows = await new Promise<Uint8Array[]>((resolve, reject) => {
    const req = db.transaction('u').objectStore('u').getAll();
    req.onsuccess = () => resolve(req.result as Uint8Array[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  const k = await localKey();
  return Promise.all(rows.map((r) => unseal(k, r)));
}

const deleteDb = (name: string) =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

/** Loads a document from plain y-indexeddb storage. */
async function loadPlain(name: string, doc: Y.Doc) {
  const p = plainMarkupPersistence(name, doc);
  await p.whenSynced;
  await p.destroy();
}

/** Keeps one document's markups sealed in IndexedDB; folds in (and removes) any plain copy. */
class SealedMarkupPersistence implements MarkupPersistence {
  readonly whenSynced: Promise<unknown>;
  private db: Promise<IDBDatabase>;
  private writes: Promise<unknown> = Promise.resolve();
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.writes = this.writes.then(async () => {
      const sealed = await seal(await localKey(), 0, update);
      const tx = (await this.db).transaction('u', 'readwrite');
      tx.objectStore('u').add(sealed);
      await done(tx);
    });
  };

  constructor(
    private name: string,
    private doc: Y.Doc,
  ) {
    this.db = openDb(name + SEALED_SUFFIX);
    this.whenSynced = this.load();
    doc.on('update', this.onUpdate);
  }

  private async load() {
    const updates = await readSealed(this.name + SEALED_SUFFIX);
    Y.transact(this.doc, () => updates.forEach((u) => Y.applyUpdate(this.doc, u, this)), this);
    // Markups kept before encryption was on (opening a database that is not there would make an empty one).
    const plainLeft = ((await indexedDB.databases?.()) ?? []).some((d) => d.name === this.name);
    if (plainLeft) {
      const plain = new Y.Doc();
      await loadPlain(this.name, plain);
      Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(plain), this);
      await deleteDb(this.name);
    }
    // Many small updates are folded into one now and then.
    if (updates.length > 200 || plainLeft) await writeSealedState(this.name + SEALED_SUFFIX, this.doc);
  }

  async destroy() {
    this.doc.off('update', this.onUpdate);
    await this.writes.catch(() => undefined);
    (await this.db).close();
  }
}

const PENDING = 'nb.local.encrypt.pending';

async function markupDatabases(): Promise<string[]> {
  const all = (await indexedDB.databases?.()) ?? [];
  return all.map((d) => d.name ?? '').filter((n) => n.startsWith(MARKUPS));
}

/** Moves every document's markups into sealed storage (`on`) or back to plain y-indexeddb storage. */
async function migrateMarkups(on: boolean) {
  const names = await markupDatabases();
  if (on) {
    for (const name of names.filter((n) => !n.endsWith(SEALED_SUFFIX))) {
      const doc = new Y.Doc();
      await loadPlain(name, doc);
      if (names.includes(name + SEALED_SUFFIX)) for (const u of await readSealed(name + SEALED_SUFFIX)) Y.applyUpdate(doc, u);
      await writeSealedState(name + SEALED_SUFFIX, doc);
      await deleteDb(name);
    }
    return;
  }
  for (const sealedName of names.filter((n) => n.endsWith(SEALED_SUFFIX))) {
    const name = sealedName.slice(0, -SEALED_SUFFIX.length);
    const doc = new Y.Doc();
    const p = plainMarkupPersistence(name, doc);
    await p.whenSynced;
    // Applied once attached, so y-indexeddb stores them as updates.
    for (const u of await readSealed(sealedName)) Y.applyUpdate(doc, u);
    await new Promise((r) => setTimeout(r, 50));
    await p.destroy();
    await deleteDb(sealedName);
  }
}

/**
 * Call once at start-up and wait for it before anything opens a document: finishes a change asked
 * for with `requestLocalEncryption` (nothing else has storage open yet, so old copies can be
 * deleted), converts any markups still stored the other way, then sets how markups are kept.
 */
export async function installLocalEncryption(rewriteLibrary: () => Promise<void>): Promise<void> {
  if (!localEncryptionAvailable()) return;
  let pending: string | null = null;
  try {
    pending = localStorage.getItem(PENDING);
    if (pending === 'on') localStorage.setItem(FLAG, '1');
    if (pending === 'off') localStorage.removeItem(FLAG);
  } catch {
    // Storage blocked: nothing to do.
  }
  const on = localEncryptionOn();
  try {
    await migrateMarkups(on);
    if (pending) await rewriteLibrary();
    localStorage.removeItem(PENDING);
  } catch (err) {
    console.error('Local encryption: could not convert stored data:', err);
  }
  if (on) setMarkupPersistence((name, doc) => new SealedMarkupPersistence(name, doc));
}

/** Turns "Encrypt local data" on or off: the change is made as the app restarts, before anything opens. */
export function requestLocalEncryption(on: boolean) {
  localStorage.setItem(PENDING, on ? 'on' : 'off');
  window.location.reload();
}

/** Makes sure the key can be had before turning encryption on (no system key store, no encryption). */
export async function checkLocalKey(): Promise<void> {
  await localKey();
}
