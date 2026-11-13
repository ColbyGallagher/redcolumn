/** Only unacknowledged Yjs operations; replaying their original IDs is idempotent. */
export interface PendingRoom {
  room: string;
  bytes: Uint8Array;
  sealed: boolean;
}

export interface SessionJournal {
  read(scope: string): Promise<PendingRoom[]>;
  write(scope: string, rooms: PendingRoom[]): Promise<void>;
}

const DB = 'redcolumn-session-pending';
const STORE = 'seats';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** A transaction completion, not a request success, is our local save receipt. */
export const sessionJournal: SessionJournal = {
  async read(scope) {
    // Node unit tests can inject a journal; production browsers must have durable storage.
    if (typeof indexedDB === 'undefined' && typeof window === 'undefined') return [];
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(scope);
      tx.oncomplete = () => { db.close(); resolve((request.result as PendingRoom[] | undefined) ?? []); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not read pending session changes.')); };
    });
  },
  async write(scope, rooms) {
    if (typeof indexedDB === 'undefined' && typeof window === 'undefined') return;
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
      const store = tx.objectStore(STORE);
      if (rooms.length) store.put(rooms, scope);
      else store.delete(scope);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not save pending session changes.')); };
    });
  },
};
