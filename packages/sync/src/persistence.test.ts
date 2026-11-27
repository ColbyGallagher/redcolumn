import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyState, PROTOCOL_VERSION } from '@nb/ops';
import {
  defaultSyncPersistence,
  IndexedDbSyncPersistence,
  MemorySyncPersistence,
  setSyncPersistence,
  type ByteSealer,
} from './persistence.ts';
import type { PersistedSyncState } from './types.ts';

function sampleState(cursor = 'seq:3'): PersistedSyncState {
  return {
    formatVersion: 1,
    confirmed: emptyState(),
    cursor,
    pending: [
      {
        opId: 'op-1',
        schemaVersion: PROTOCOL_VERSION,
        streamId: 'doc-1',
        type: 'markup.delete',
        entityId: 'm-1',
        payload: {},
        clientTime: 100,
      },
    ],
    inbox: [],
    undoStack: [],
    redoStack: [],
    confirmedOpIds: ['op-0'],
  };
}

/** Tiny XOR sealer with a magic header to test sealing/unsealing without WebCrypto ceremony. */
function testSealer(secret = 0x5a): ByteSealer {
  const MAGIC = [0x53, 0x45, 0x41, 0x4c]; // "SEAL"
  return {
    seal(plain) {
      const out = new Uint8Array(MAGIC.length + plain.length);
      out.set(MAGIC, 0);
      for (let i = 0; i < plain.length; i++) out[MAGIC.length + i] = plain[i]! ^ secret;
      return out;
    },
    open(stored) {
      const isSealed =
        stored.length >= MAGIC.length && MAGIC.every((b, i) => stored[i] === b);
      if (!isSealed) return stored;
      const out = new Uint8Array(stored.length - MAGIC.length);
      for (let i = 0; i < out.length; i++) out[i] = stored[MAGIC.length + i]! ^ secret;
      return out;
    },
  };
}

/** Minimal in-test IndexedDB fake covering the subset `IndexedDbSyncPersistence` uses. */
function fakeIndexedDB() {
  const databases = new Map<string, Map<string, Map<string, unknown>>>();
  const opened: Array<Record<string, unknown> & { closed: boolean }> = [];

  const factory = {
    open(name: string) {
      const req: Record<string, unknown> = {};
      queueMicrotask(() => {
        let stores = databases.get(name);
        const created = !stores;
        if (!stores) {
          stores = new Map();
          databases.set(name, stores);
        }
        const db: Record<string, unknown> & { closed: boolean } = {
          closed: false,
          objectStoreNames: {
            contains: (s: string) => stores!.has(s),
          },
          createObjectStore: (s: string) => {
            if (!stores!.has(s)) stores!.set(s, new Map());
          },
          transaction: (storeName: string) => {
            if (db.closed) throw new Error('InvalidStateError: the database connection is closing');
            const storeMap = stores!.get(storeName);
            if (!storeMap) throw new Error(`Missing object store ${storeName}`);
            const tx: Record<string, unknown> = {
              objectStore: () => ({
                get: (key: string) => {
                  const r: Record<string, unknown> = {};
                  queueMicrotask(() => {
                    r.result = storeMap.get(key);
                    (r.onsuccess as (() => void) | undefined)?.();
                  });
                  return r;
                },
                put: (value: unknown, key: string) => {
                  storeMap.set(key, value);
                  queueMicrotask(() => {
                    (tx.oncomplete as (() => void) | undefined)?.();
                  });
                },
                delete: (key: string) => {
                  storeMap.delete(key);
                  queueMicrotask(() => {
                    (tx.oncomplete as (() => void) | undefined)?.();
                  });
                },
              }),
            };
            return tx;
          },
          close: () => {
            db.closed = true;
          },
        };
        opened.push(db);
        req.result = db;
        if (created) (req.onupgradeneeded as (() => void) | undefined)?.();
        (req.onsuccess as (() => void) | undefined)?.();
      });
      return req;
    },
  };

  return {
    factory: factory as unknown as IDBFactory,
    /** Closes every open connection the way the browser does, firing `onclose`. */
    closeAll(): void {
      for (const db of opened) {
        if (db.closed) continue;
        db.closed = true;
        (db.onclose as (() => void) | undefined)?.();
      }
    },
    openCount: () => opened.length,
    raw(dbName: string, storeName: string, key: string): unknown {
      return databases.get(dbName)?.get(storeName)?.get(key);
    },
  };
}

test('MemorySyncPersistence saves, clones, loads and clears state', async () => {
  const mem = new MemorySyncPersistence();
  assert.equal(await mem.load('doc-1:rev-1'), null);

  const state = sampleState();
  await mem.save('doc-1:rev-1', state);
  // Mutating the caller's object does not affect stored state.
  state.cursor = 'mutated';

  const loaded = await mem.load('doc-1:rev-1');
  assert.ok(loaded);
  assert.equal(loaded.cursor, 'seq:3');
  assert.equal(loaded.pending.length, 1);
  assert.deepEqual(mem.keys(), ['doc-1:rev-1']);

  await mem.clear('doc-1:rev-1');
  assert.equal(await mem.load('doc-1:rev-1'), null);
});

test('MemorySyncPersistence seals bytes through ByteSealer and accepts plain bytes when toggled', async () => {
  const sealer = testSealer();
  const sealed = new MemorySyncPersistence({ sealer });
  await sealed.save('doc-secret', sampleState('seq:42'));

  const raw = sealed.rawBytes('doc-secret')!;
  const asText = new TextDecoder().decode(raw);
  assert.equal(asText.includes('seq:42'), false, 'sealed bytes must not contain plaintext');
  assert.equal(asText.includes('markup.delete'), false);

  const loaded = await sealed.load('doc-secret');
  assert.equal(loaded?.cursor, 'seq:42');

  // Unsealed bytes written before encryption was turned on still load cleanly through sealer.open.
  const plain = new MemorySyncPersistence();
  await plain.save('legacy', sampleState('seq:7'));
  const plainBytes = plain.rawBytes('legacy')!;
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await sealer.open(plainBytes))).cursor, 'seq:7');
});

test('IndexedDbSyncPersistence round-trips state with and without sealing via IDBFactory', async () => {
  const fake = fakeIndexedDB();
  const sealer = testSealer(0x33);
  const idb = new IndexedDbSyncPersistence({ dbName: 'test-sync', storeName: 'docs', sealer, indexedDB: fake.factory });

  assert.equal(await idb.load('k1'), null);
  await idb.save('k1', sampleState('seq:9'));

  const stored = fake.raw('test-sync', 'docs', 'k1');
  assert.ok(stored instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(stored).includes('seq:9'), false, 'stored IDB value must be sealed');

  const loaded = await idb.load('k1');
  assert.equal(loaded?.cursor, 'seq:9');
  assert.equal(loaded?.pending[0]?.opId, 'op-1');

  await idb.clear('k1');
  assert.equal(await idb.load('k1'), null);
  await idb.close();
});

test('IndexedDbSyncPersistence throws a clear error when indexedDB is unavailable', async () => {
  const idb = new IndexedDbSyncPersistence({ sealer: null });
  await assert.rejects(() => idb.load('k1'), /IndexedDB is not available/);
});

test('setSyncPersistence overrides and resets the default factory', () => {
  const custom = new MemorySyncPersistence();
  setSyncPersistence(() => custom);
  try {
    assert.equal(defaultSyncPersistence(), custom);
  } finally {
    setSyncPersistence(null);
  }
  assert.notEqual(defaultSyncPersistence(), custom);
  assert.ok(defaultSyncPersistence() instanceof MemorySyncPersistence);
});

test('IndexedDbSyncPersistence reopens the database after the browser closes the connection', async () => {
  const fake = fakeIndexedDB();
  const idb = new IndexedDbSyncPersistence({ dbName: 'reopen', sealer: null, indexedDB: fake.factory });
  await idb.save('k1', sampleState('seq:1'));
  fake.closeAll();
  await idb.save('k1', sampleState('seq:2'));
  assert.equal((await idb.load('k1'))?.cursor, 'seq:2');
  assert.equal(fake.openCount(), 2);
  await idb.close();
});

test('the default sync persistence never writes document content to IndexedDB', async () => {
  const g = globalThis as { indexedDB?: unknown };
  const before = g.indexedDB;
  const fake = fakeIndexedDB();
  g.indexedDB = fake.factory;
  try {
    const p = defaultSyncPersistence();
    assert.ok(p instanceof MemorySyncPersistence);
    await p.save('k1', sampleState('seq:3'));
    assert.equal(fake.openCount(), 0, 'nothing was opened on disk');
  } finally {
    if (before === undefined) delete g.indexedDB;
    else g.indexedDB = before;
  }
});
