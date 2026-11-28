import type { InboxEntry, PersistedSyncState, SyncDocument, SyncPersistence } from '@nb/sync';

/*
 * A server document's unsent changes are saved on this device under one key per server, user and
 * revision. Two windows saving there would overwrite each other's, so each takes a slot of its own,
 * held with a Web Lock while it is open; the lock goes when the window does, however it ends. A
 * window takes a free slot that has unsent changes before an empty one, and any open window sends
 * what is left in the slots of windows since closed.
 */

/** The most windows that keep their own unsent changes for one revision. */
export const MAX_WINDOW_SLOTS = 8;

/** How often an open window looks for changes left by one that closed. */
const LEFTOVER_CHECK_MS = 10_000;

/** The part of `navigator.locks` used here. */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<void>): Promise<unknown>;
}

/** Takes the lock when it is free: its release, or null while another holds it. */
function tryLock(locks: LockManagerLike, name: string): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return Promise.resolve();
        }
        // Held until the release handed out is called.
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(reject);
  });
}

/** The first slot keeps the plain key, where a single window has always saved. */
export const slotKey = (key: string, slot: number): string => (slot === 0 ? key : `${key}#window-${slot}`);

const lockName = (storageKey: string): string => `nb-sync:${storageKey}`;

const hasUnsent = (state: PersistedSyncState | null): boolean => !!state && (state.pending.length > 0 || state.inbox.length > 0);

export interface WindowSlot {
  slot: number;
  release: () => void;
  /** `persistence` for this slot, whatever key the document asks for. */
  persistence: SyncPersistence;
}

/** `persistence`, always under `storageKey`. Closing it is left to whoever made `persistence`. */
function underKey(persistence: SyncPersistence, storageKey: string): SyncPersistence {
  return {
    load: () => persistence.load(storageKey),
    save: (_key, state) => persistence.save(storageKey, state),
    clear: () => persistence.clear(storageKey),
  };
}

/**
 * Takes this window's slot: a free one with unsent changes if there is one, so they are sent,
 * otherwise the first free one. Null when every slot is taken. Rejects, holding nothing, when saved
 * changes cannot be read.
 */
export async function claimWindowSlot(key: string, locks: LockManagerLike, persistence: SyncPersistence): Promise<WindowSlot | null> {
  let spare: WindowSlot | null = null;
  for (let slot = 0; slot < MAX_WINDOW_SLOTS; slot++) {
    const storageKey = slotKey(key, slot);
    const release = await tryLock(locks, lockName(storageKey));
    if (!release) continue;
    const claimed: WindowSlot = { slot, release, persistence: underKey(persistence, storageKey) };
    let state: PersistedSyncState | null;
    try {
      state = await persistence.load(storageKey);
    } catch (err) {
      release();
      spare?.release();
      throw err;
    }
    if (hasUnsent(state)) {
      spare?.release();
      return claimed;
    }
    if (spare) release();
    else spare = claimed;
  }
  return spare;
}

export interface LeftoverOptions {
  key: string;
  /** The slot this window holds, which it looks after itself. */
  ownSlot: number;
  locks: LockManagerLike;
  persistence: SyncPersistence;
  /** Opens the document over a left slot and starts it syncing. */
  open: (persistence: SyncPersistence) => Promise<SyncDocument>;
  /** Takes over the changes the server refused. Resolves once they are saved in this window's slot. */
  adopt: (entries: readonly InboxEntry[]) => Promise<void>;
  intervalMs?: number;
}

/**
 * Sends the unsent changes in slots whose window has closed, now and every few seconds: each is
 * opened without being shown, until the server has answered all it held. What the server refused
 * joins this window's list, and the slot is then emptied. Returns how to stop, which leaves
 * anything unfinished saved where it is.
 */
export function sendLeftoverChanges(options: LeftoverOptions): { stop: () => Promise<void> } {
  const { key, ownSlot, locks, persistence } = options;
  const running = new Map<number, Promise<void>>();
  const wake = new Set<() => void>();
  let stopped = false;

  const drain = async (slot: number): Promise<void> => {
    const storageKey = slotKey(key, slot);
    const release = await tryLock(locks, lockName(storageKey));
    if (!release) return;
    let doc: SyncDocument | null = null;
    const close = async () => {
      const open = doc;
      doc = null;
      if (!open) return;
      await open.disconnect();
      await open.destroy();
    };
    try {
      if (stopped) return;
      const saved = await persistence.load(storageKey);
      if (!hasUnsent(saved)) {
        // Only a cached copy: dropped, so it is not read again and again. The first slot's stays,
        // for the next window to open from.
        if (saved && slot !== 0) await persistence.clear(storageKey);
        return;
      }
      doc = await options.open(underKey(persistence, storageKey));
      const left = doc;
      await new Promise<void>((resolve) => {
        const check = () => {
          if (stopped || left.sync.pendingCount === 0) done();
        };
        const done = () => {
          wake.delete(done);
          unsubscribe();
          resolve();
        };
        const unsubscribe = left.sync.subscribe(check);
        wake.add(done);
        check();
      });
      if (stopped) return;
      await options.adopt(left.sync.inbox);
      await close();
      await persistence.clear(storageKey);
    } finally {
      await close().finally(release);
    }
  };

  const look = () => {
    for (let slot = 0; slot < MAX_WINDOW_SLOTS && !stopped; slot++) {
      if (slot === ownSlot || running.has(slot)) continue;
      const work = drain(slot)
        .catch((err: unknown) => console.warn('Could not send changes left by another window:', err))
        .finally(() => running.delete(slot));
      running.set(slot, work);
    }
  };

  look();
  const timer = setInterval(look, options.intervalMs ?? LEFTOVER_CHECK_MS);
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      for (const done of [...wake]) done();
      await Promise.all([...running.values()]);
    },
  };
}
