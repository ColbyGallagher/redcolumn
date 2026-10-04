import * as Y from 'yjs';
import type { MarkupStore } from '@nb/markup';
import { DriveAuthError, DriveForbiddenError, type DriveApi, type DriveFile } from './DriveApi';

/**
 * Shared Yjs rooms kept as files in a drive folder, the way a Live Session keeps its markups:
 *
 *   <seat>.<room>.nbsnap     that seat's full Yjs state of one room, now and then
 *   <seat>.<room>.nbdelta    that seat's own edits to the room since its snapshot
 *
 * Each browser writes only its own seat's files, so nobody's writes collide. Reading everyone
 * else's room files and merging them gives everyone the same state; an edit uploads only the small
 * delta of the room it touched, and the delta is folded into a new snapshot once it grows.
 * Projects use this for each file's markups (the room is the Project file's ID).
 */

export const SNAPSHOT = 'nbsnap';
export const DELTA = 'nbdelta';
/** `<seat>.<room>.<kind>`; OneDrive may add " 1" before the extension when a name is taken. */
export const ROOM_FILE = /^([^.]+)\.([^.]+?)(?: \d+)?\.(nbsnap|nbdelta)$/;
const BINARY = 'application/octet-stream';
/** A delta past this size, or a quarter of its snapshot if larger, is folded into a new snapshot. */
const DELTA_MAX = 64 * 1024;
/** Downloads at once while reading the folder. */
const READ_CONCURRENCY = 4;
const FLUSH_DELAY_MS = 1200;
/** Transaction origin for state merged in from other seats. */
const REMOTE = Symbol('remote');

const binary = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: BINARY });

/** Runs `fn` over `items`, `limit` at a time; rejects with the first error once all have settled. */
export async function inPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { err: unknown } | null = null;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (err) {
        failure ??= { err };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { err: unknown }).err;
}

/**
 * Claims a seat for this tab until `release` is called, or null when another tab of this browser
 * has it: two tabs writing one seat's files would overwrite each other's edits.
 */
export function claimSeat(folderId: string, seatId: string): Promise<(() => void) | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    locks
      .request(`nb-seat:${folderId}:${seatId}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        return new Promise<void>((release) => resolve(release));
      })
      // Locks refused (a sandboxed frame): go on unguarded rather than never joining.
      .catch(() => resolve(() => {}));
  });
}

/** What this browser has saved of one room, and what it has not yet. */
interface Outbox {
  /** Our own updates to the room since our last snapshot of it. */
  pending: Uint8Array[];
  /** How many of `pending` (from the start) our delta file holds. */
  saved: number;
  snapshotId?: string;
  deltaId?: string;
  snapshotSize: number;
}

interface RoomWrite {
  room: string;
  o: Outbox;
  kind: typeof SNAPSHOT | typeof DELTA;
  bytes: Uint8Array;
  /** How many pending updates `bytes` covers. */
  taken: number;
}

export type RoomStatus = 'connecting' | 'online' | 'offline' | 'needsAuth' | 'viewOnly';

export interface RoomFilesOptions {
  /** Poll interval while visible and something is attached; 0 disables the timers (tests drive `poll`/`flush`). */
  pollMs?: number;
  /** Called when the status changes. */
  onStatus?: (status: RoomStatus) => void;
}

export class RoomFiles {
  private readonly api: DriveApi;
  private readonly folderId: string;
  /** Null: read only (no seat of our own to write). */
  private seatId: string | null;
  private readonly opts: RoomFilesOptions;
  private rooms = new Map<string, Y.Doc>();
  private outboxes = new Map<string, Outbox>();
  /** Versions we wrote ourselves, as `<file id>@<version>`. */
  private ownVersions = new Set<string>();
  /** The version of each room file last read (or written by us). */
  private seen = new Map<string, string>();
  /** Rooms someone (anyone) has saved state for. */
  private known = new Set<string>();
  private attached = new Map<string, { store: MarkupStore; detach: () => void }>();
  /** The folder has been read once, so our own room files are known before we write any. */
  private synced = false;
  private dirty = false;
  private flushing: Promise<void> | null = null;
  private polling: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private wake: (() => void) | null = null;
  private loaded: Promise<void>;
  private markLoaded!: () => void;
  private destroyed = false;
  status: RoomStatus = 'connecting';

  constructor(api: DriveApi, folderId: string, seatId: string | null, opts: RoomFilesOptions = {}) {
    this.api = api;
    this.folderId = folderId;
    this.seatId = seatId;
    this.opts = opts;
    this.loaded = new Promise((r) => (this.markLoaded = r));
    if (opts.pollMs !== 0) {
      void this.pollLoop();
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    }
  }

  private setStatus(status: RoomStatus) {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus?.(status);
  }

  /** The shared doc for a room, created on first use; local edits to it are saved to our room files. */
  private room(name: string): Y.Doc {
    let doc = this.rooms.get(name);
    if (!doc) {
      doc = new Y.Doc();
      doc.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin === REMOTE) return;
        this.outbox(name).pending.push(u);
        this.markDirty();
      });
      this.rooms.set(name, doc);
    }
    return doc;
  }

  private outbox(room: string): Outbox {
    let o = this.outboxes.get(room);
    if (!o) {
      o = { pending: [], saved: 0, snapshotSize: 0 };
      this.outboxes.set(room, o);
    }
    return o;
  }

  /** Whether anyone has saved state for this room (known once the folder has been read). */
  hasState(room: string): boolean {
    return this.known.has(room);
  }

  /** Resolves once the folder has been read (or failed to be) for the first time. */
  ready(): Promise<void> {
    if (!this.synced) void this.poll();
    return this.loaded;
  }

  // ---- Reading: poll the folder and merge what changed ----

  private onVisible = () => {
    if (!document.hidden) this.wake?.();
  };

  private async pollLoop() {
    while (!this.destroyed) {
      if (this.attached.size) await this.poll();
      const visible = typeof document === 'undefined' || !document.hidden;
      await new Promise<void>((r) => {
        const t = setTimeout(() => {
          this.wake = null;
          r();
        }, visible ? (this.opts.pollMs ?? 3000) : 15_000);
        this.wake = () => {
          clearTimeout(t);
          this.wake = null;
          r();
        };
      });
    }
  }

  /** Reads the folder once and merges any changed room files. */
  poll(prefetched?: DriveFile[]): Promise<void> {
    this.polling ??= this.readFolder(prefetched).finally(() => (this.polling = null));
    return this.polling;
  }

  private async readFolder(prefetched?: DriveFile[]) {
    if (this.destroyed) return;
    try {
      const files = prefetched ?? (await this.api.list(this.folderId));
      for (const f of files) {
        const room = ROOM_FILE.exec(f.name);
        if (!room) continue;
        this.known.add(room[2]!);
        if (room[1] !== this.seatId) continue;
        const o = this.outbox(room[2]!);
        if (room[3] === SNAPSHOT) o.snapshotId ??= f.id;
        else o.deltaId ??= f.id;
      }
      const changed = files.filter((f) => ROOM_FILE.test(f.name) && this.seen.get(f.id) !== f.version);
      await inPool(changed, READ_CONCURRENCY, (f) => this.readFile(f));
      if (this.status !== 'viewOnly' && this.status !== 'needsAuth') this.setStatus('online');
      if (!this.synced) {
        this.synced = true;
        if (this.dirty) this.markDirty();
      }
    } catch (err) {
      if (this.destroyed) return;
      if (!(err instanceof TypeError)) console.warn('Project markups:', err);
      this.setStatus(err instanceof DriveAuthError ? 'needsAuth' : 'offline');
    } finally {
      this.markLoaded();
    }
  }

  /** Merges one changed room file. Our own writes are skipped. */
  private async readFile(f: DriveFile) {
    const room = ROOM_FILE.exec(f.name)!;
    if (!this.ownVersions.has(`${f.id}@${f.version}`)) {
      let data: ArrayBuffer | null = null;
      try {
        data = await this.api.download(f.id);
      } catch (err) {
        // Offline or signed out: the whole read is retried. A file removed meanwhile is skipped.
        if (err instanceof TypeError || err instanceof DriveAuthError) throw err;
        console.warn(`Project markups: could not read ${f.name}:`, err);
      }
      if (data) {
        try {
          const bytes = new Uint8Array(data);
          Y.applyUpdate(this.room(room[2]!), bytes, REMOTE);
          if (room[1] === this.seatId) this.adoptOwn(room[2]!, room[3]!, bytes);
        } catch (err) {
          // A damaged file is skipped rather than stopping the room for everyone.
          console.warn(`Project markups: skipped ${f.name}:`, err);
        }
      }
    }
    this.seen.set(f.id, f.version);
  }

  /**
   * Our own room file, written on an earlier visit. A delta's edits are not in our snapshot, so
   * they stay pending: the next save writes them again rather than over them.
   */
  private adoptOwn(room: string, kind: string, bytes: Uint8Array) {
    // Once read, our files change only by our own writes (one tab per seat).
    if (this.synced) return;
    const o = this.outbox(room);
    if (kind === SNAPSHOT) o.snapshotSize = bytes.byteLength;
    else if (o.saved === 0) {
      o.pending.unshift(bytes);
      o.saved = 1;
    }
  }

  // ---- Writing: our own room files ----

  private get writable() {
    return !!this.seatId && this.status !== 'viewOnly';
  }

  private markDirty() {
    this.dirty = true;
    if (this.opts.pollMs === 0 || this.destroyed) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  /** Saves our edits (debounced after edits): each changed room's delta, or a new snapshot of it. */
  flush(): Promise<void> {
    if (this.flushing) {
      // Save again once the current write finishes, so the last edit is never left behind.
      return this.flushing.then(() => (this.dirty ? this.flush() : undefined));
    }
    // Until the folder has been read, our own room files are unknown and must not be written over.
    if (!this.dirty || !this.writable || this.status === 'needsAuth' || !this.synced) return Promise.resolve();
    this.dirty = false;
    // Encoded now, synchronously, so a flush started just before leaving still has everything.
    const writes = [...this.outboxes].filter(([, o]) => o.pending.length > o.saved).map(([room, o]) => this.planWrite(room, o));
    this.flushing = inPool(writes, READ_CONCURRENCY, (w) => this.saveRoom(w))
      .then(() => {
        if (this.status === 'offline' || this.status === 'connecting') this.setStatus('online');
      })
      .catch((err: unknown) => this.writeFailed(err))
      .finally(() => (this.flushing = null));
    return this.flushing;
  }

  /** What to write for a room: its delta, or a full snapshot once the delta has grown too big. */
  private planWrite(room: string, o: Outbox): RoomWrite {
    const taken = o.pending.length;
    const delta = Y.mergeUpdates(o.pending);
    if (delta.byteLength > Math.max(DELTA_MAX, o.snapshotSize / 4)) {
      return { room, o, kind: SNAPSHOT, bytes: Y.encodeStateAsUpdate(this.room(room)), taken };
    }
    return { room, o, kind: DELTA, bytes: delta, taken };
  }

  private async saveRoom({ room, o, kind, bytes, taken }: RoomWrite) {
    await this.writeRoomFile(room, o, kind, bytes);
    this.known.add(room);
    if (kind === DELTA) {
      // Keep what was saved as one update; edits made during the upload follow it.
      o.pending.splice(0, taken, bytes);
      o.saved = 1;
      return;
    }
    o.snapshotSize = bytes.byteLength;
    o.pending.splice(0, taken);
    o.saved = 0;
    if (!o.deltaId && !o.pending.length) return;
    // The delta's edits are in the snapshot now: reset it to the edits made since.
    const n = o.pending.length;
    const rest = Y.mergeUpdates(o.pending);
    await this.writeRoomFile(room, o, DELTA, rest);
    if (n) {
      o.pending.splice(0, n, rest);
      o.saved = 1;
    }
  }

  private async writeRoomFile(room: string, o: Outbox, kind: RoomWrite['kind'], bytes: Uint8Array) {
    const id = kind === SNAPSHOT ? o.snapshotId : o.deltaId;
    if (id) {
      this.ownVersions.add(`${id}@${await this.api.updateContent(id, binary(bytes))}`);
      return;
    }
    const f = await this.api.createFile(this.folderId, `${this.seatId!}.${room}.${kind}`, BINARY, binary(bytes), {});
    if (kind === SNAPSHOT) o.snapshotId = f.id;
    else o.deltaId = f.id;
    this.ownVersions.add(`${f.id}@${f.version}`);
  }

  private writeFailed(err: unknown) {
    this.dirty = true;
    if (err instanceof DriveAuthError) this.setStatus('needsAuth');
    else if (err instanceof DriveForbiddenError) this.setStatus('viewOnly');
    else {
      if (!(err instanceof TypeError)) console.warn('Project markups:', err);
      this.setStatus('offline');
      // Try again shortly.
      if (this.opts.pollMs !== 0 && !this.destroyed) this.flushTimer = setTimeout(() => void this.flush(), 5000);
    }
  }

  /** After signing in again: read and save what was waiting. */
  async resume() {
    if (this.status === 'needsAuth') this.setStatus('connecting');
    await this.poll();
    await this.flush();
  }

  // ---- Linking a markup store to its room ----

  /** Links a store to its room: edits flow both ways. Returns a function that unlinks it. */
  async attach(room: string, store: MarkupStore): Promise<() => void> {
    const current = this.attached.get(room);
    if (current?.store === store) return current.detach;
    current?.detach();
    // Read the folder first (bounded), so a store opened offline still links straight away.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!this.synced) void this.poll();
    await Promise.race([this.loaded, new Promise((r) => (timer = setTimeout(r, 4000)))]);
    clearTimeout(timer);
    const doc = this.room(room);
    const fromStore = Symbol('store');
    const fromRoom = Symbol('room');
    Y.applyUpdate(store.doc, Y.encodeStateAsUpdate(doc), fromRoom);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(store.doc), fromStore);
    const toRoom = (u: Uint8Array, origin: unknown) => {
      if (origin !== fromRoom) Y.applyUpdate(doc, u, fromStore);
    };
    const toStore = (u: Uint8Array, origin: unknown) => {
      if (origin !== fromStore) Y.applyUpdate(store.doc, u, fromRoom);
    };
    store.doc.on('update', toRoom);
    doc.on('update', toStore);
    const detach = () => {
      store.doc.off('update', toRoom);
      doc.off('update', toStore);
      store.doc.off('destroy', detach);
      if (this.attached.get(room)?.store === store) this.attached.delete(room);
      // Save what is left before the store goes.
      void this.flush();
    };
    store.doc.on('destroy', detach);
    this.attached.set(room, { store, detach });
    this.wake?.();
    return detach;
  }

  destroy() {
    if (this.destroyed) return;
    void this.flush();
    this.destroyed = true;
    clearTimeout(this.flushTimer);
    this.wake?.();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    for (const a of [...this.attached.values()]) a.detach();
  }
}
