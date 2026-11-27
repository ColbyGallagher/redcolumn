import type { PersistedSyncState } from './types.ts';

/**
 * Optional sealing seam for local storage (e.g. AES-GCM encryption backed by the desktop app's
 * system key store). `open` may also receive unsealed bytes when encryption is toggled between runs.
 */
export interface ByteSealer {
  seal(plain: Uint8Array): Promise<Uint8Array> | Uint8Array;
  open(stored: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

/** Durable local storage for a synced document's confirmed state, pending queue, inbox, and undo stack. */
export interface SyncPersistence {
  load(key: string): Promise<PersistedSyncState | null>;
  save(key: string, state: PersistedSyncState): Promise<void>;
  clear(key: string): Promise<void>;
  close?(): Promise<void> | void;
}

export type SyncPersistenceFactory = () => SyncPersistence;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function encodeState(state: PersistedSyncState, sealer?: ByteSealer): Promise<Uint8Array> {
  const plain = encoder.encode(JSON.stringify(state));
  return sealer ? await sealer.seal(plain) : plain;
}

async function decodeState(raw: Uint8Array, sealer?: ByteSealer): Promise<PersistedSyncState> {
  const plain = sealer ? await sealer.open(raw) : raw;
  const parsed = JSON.parse(decoder.decode(plain)) as PersistedSyncState;
  if (!parsed || parsed.formatVersion !== 1) {
    throw new Error(`Unsupported persisted sync state format: ${String((parsed as { formatVersion?: unknown })?.formatVersion)}`);
  }
  return parsed;
}

/**
 * In-memory persistence adapter for tests and ephemeral sessions. Serializes (and optionally seals)
 * state on every write so restarts from persisted state behave the same as on disk.
 */
export class MemorySyncPersistence implements SyncPersistence {
  private readonly store = new Map<string, Uint8Array>();
  private readonly sealer?: ByteSealer;

  constructor(options: { sealer?: ByteSealer } = {}) {
    this.sealer = options.sealer;
  }

  async load(key: string): Promise<PersistedSyncState | null> {
    const raw = this.store.get(key);
    if (!raw) return null;
    return decodeState(raw, this.sealer);
  }

  async save(key: string, state: PersistedSyncState): Promise<void> {
    const bytes = await encodeState(state, this.sealer);
    this.store.set(key, new Uint8Array(bytes));
  }

  async clear(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Raw stored bytes for a key (useful for verifying sealing in tests). */
  rawBytes(key: string): Uint8Array | undefined {
    const bytes = this.store.get(key);
    return bytes ? new Uint8Array(bytes) : undefined;
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}

export interface IndexedDbSyncPersistenceOptions {
  /** IndexedDB database name. Defaults to `'nb-sync'`. */
  dbName?: string;
  /** Object store name inside the database. Defaults to `'docs'`. */
  storeName?: string;
  /** Optional sealing layer (e.g. `{ seal: sealLocal, open: openLocal }`). */
  sealer?: ByteSealer;
  /** Optional IndexedDB factory override (defaults to `globalThis.indexedDB`). */
  indexedDB?: IDBFactory;
}

function getIdbFactory(override?: IDBFactory): IDBFactory {
  const factory = override ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) {
    throw new Error('IndexedDB is not available in this environment');
  }
  return factory;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Browser/desktop IndexedDB persistence adapter for synced documents.
 * Writes each document's state as UTF-8 bytes, optionally passed through a {@link ByteSealer}
 * before hitting disk so local encryption covers confirmed state, pending ops, inbox and undo stack.
 */
export class IndexedDbSyncPersistence implements SyncPersistence {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly sealer?: ByteSealer;
  private readonly idbOverride?: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbSyncPersistenceOptions = {}) {
    this.dbName = options.dbName ?? 'nb-sync';
    this.storeName = options.storeName ?? 'docs';
    this.sealer = options.sealer;
    this.idbOverride = options.indexedDB;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      const factory = getIdbFactory(this.idbOverride);
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          this.dbPromise = null;
          reject(req.error ?? new Error('Failed to open IndexedDB database'));
        };
      });
    }
    return this.dbPromise;
  }

  async load(key: string): Promise<PersistedSyncState | null> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, 'readonly');
    const raw = await reqResult(tx.objectStore(this.storeName).get(key));
    if (raw === undefined || raw === null) return null;
    const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
    if (!bytes) throw new Error('Unexpected value stored in IndexedDB sync store');
    return decodeState(bytes, this.sealer);
  }

  async save(key: string, state: PersistedSyncState): Promise<void> {
    const bytes = await encodeState(state, this.sealer);
    const db = await this.open();
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).put(bytes, key);
    await txDone(tx);
  }

  async clear(key: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).delete(key);
    await txDone(tx);
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    this.dbPromise = null;
    db.close();
  }
}

const defaultFactory: SyncPersistenceFactory = () =>
  typeof (globalThis as { indexedDB?: unknown }).indexedDB !== 'undefined'
    ? new IndexedDbSyncPersistence()
    : new MemorySyncPersistence();

let persistenceFactory: SyncPersistenceFactory = defaultFactory;

/**
 * Sets how synced documents persist locally (e.g. installing a sealed IndexedDB adapter when local
 * encryption is turned on). Pass `null` to restore the default.
 */
export function setSyncPersistence(factory: SyncPersistenceFactory | null): void {
  persistenceFactory = factory ?? defaultFactory;
}

/** Creates a persistence adapter using the currently configured factory. */
export function defaultSyncPersistence(): SyncPersistence {
  return persistenceFactory();
}
