import { readLocal, writeLocal } from '../local';
import { newIdentity, type Identity, type SessionSecret } from './keys';

/**
 * Where encryption keys are kept in this browser:
 *
 * - this person's identity, in IndexedDB as non-extractable keys: page scripts can use them while
 *   the app is open but cannot copy them out;
 * - each encrypted session's link secret and the later keys unwrapped for this person, in local
 *   storage beside the rest of what the browser remembers about the session;
 * - a host's own keys for a session, in the host's app folder (not the shared session folder), so
 *   the host can manage the session from another browser too.
 */

const DB = 'nb-keys';
const STORE = 'identity';

let mine: Promise<Identity> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** This browser's identity, made on first use. Kept in memory where IndexedDB is not available. */
export function myIdentity(): Promise<Identity> {
  mine ??= (async () => {
    if (typeof indexedDB === 'undefined') return newIdentity();
    try {
      const db = await openDb();
      const saved = await new Promise<Identity | undefined>((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).get('me');
        req.onsuccess = () => resolve(req.result as Identity | undefined);
        req.onerror = () => reject(req.error);
      });
      if (saved?.sign && saved.dh && saved.pub && saved.fp) return saved;
      const id = await newIdentity();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(id, 'me');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return id;
    } catch {
      return newIdentity();
    }
  })();
  return mine;
}

const SECRETS_KEY = 'nb.drive.secrets';

/** An encrypted session's keys as this browser knows them. */
export interface KnownKeys extends SessionSecret {
  /** Later session keys, by epoch, as base64url. */
  epochs?: Record<string, string>;
}

export function sessionKeys(sessionId: string): KnownKeys | null {
  return readLocal<Record<string, KnownKeys>>(SECRETS_KEY, {})[sessionId] ?? null;
}

export function rememberSessionKeys(sessionId: string, keys: KnownKeys) {
  const all = readLocal<Record<string, KnownKeys>>(SECRETS_KEY, {});
  const before = all[sessionId];
  // A different link secret for the same folder replaces what was known, epochs included.
  const epochs = before && before.key === keys.key && before.host === keys.host ? { ...before.epochs, ...keys.epochs } : keys.epochs;
  writeLocal(SECRETS_KEY, { ...all, [sessionId]: { key: keys.key, host: keys.host, ...(epochs ? { epochs } : {}) } });
}

export function forgetSessionKeys(sessionId: string) {
  const all = readLocal<Record<string, KnownKeys>>(SECRETS_KEY, {});
  delete all[sessionId];
  writeLocal(SECRETS_KEY, all);
}

/** A host's keys for one session: its identity (private keys) and every session key it made. */
export interface HostKeys {
  sign: JsonWebKey;
  dh: JsonWebKey;
  epochs: Record<string, string>;
}

/** Where a host's keys are kept; the default is the host's app folder, then this browser. */
export interface HostKeyStore {
  load(sessionId: string): Promise<HostKeys | null>;
  save(sessionId: string, keys: HostKeys): Promise<void>;
}

const HOST_FILE = 'session-host-keys.json';
const HOST_LOCAL = 'nb.drive.hostKeys';

/** Keeps host keys in a file in the host's own app folder (and in this browser, for when that cannot be read). */
export function appFolderHostKeys(api: { readAppFile?(name: string): Promise<string | null>; writeAppFile?(name: string, text: string): Promise<void> }): HostKeyStore {
  const local = () => readLocal<Record<string, HostKeys>>(HOST_LOCAL, {});
  return {
    async load(sessionId) {
      const here = local()[sessionId];
      if (here) return here;
      if (!api.readAppFile) return null;
      const text = await api.readAppFile(HOST_FILE).catch(() => null);
      const all = text ? (JSON.parse(text) as Record<string, HostKeys>) : {};
      return all[sessionId] ?? null;
    },
    async save(sessionId, keys) {
      writeLocal(HOST_LOCAL, { ...local(), [sessionId]: keys });
      if (!api.readAppFile || !api.writeAppFile) return;
      const text = await api.readAppFile(HOST_FILE).catch(() => null);
      const all = text ? (JSON.parse(text) as Record<string, HostKeys>) : {};
      await api.writeAppFile(HOST_FILE, JSON.stringify({ ...all, [sessionId]: keys }));
    },
  };
}
