/**
 * Deterministic fault simulation for `SyncDocument` against the in-process server.
 *
 * Everything that can vary is driven by a seed: frame latency, which frames are lost, duplicated or
 * held back, and when a connection breaks. Time is virtual, so a client can be "offline for days"
 * in a few milliseconds. The same seed always replays the same run, so a failure can be reproduced
 * by its seed alone.
 *
 * The model of the network follows what a WebSocket over TCP can and cannot do:
 * - Frames on one live connection arrive in order and are never silently skipped. Losing a frame
 *   (for example an acknowledgement) breaks the connection, and the client notices a little later.
 * - A frame to the server can be duplicated, or held back so later frames overtake it, to check the
 *   server's handling of retries and stale copies.
 * - A frame still on the wire when its connection breaks may still reach the server ("leak"), and
 *   the server's reply to it is lost with the connection.
 */
import { isDeepStrictEqual } from 'node:util';
import type { EditRule, UndoResult } from '@nb/markup';
import { own, type Actor, type Operation, type ProtocolRange } from '@nb/ops';
import { SyncDocument } from './document.ts';
import { FakeSyncServer, type Authorize, type InProcessTransport } from './inProcess.ts';
import { MemorySyncPersistence, type SyncPersistence } from './persistence.ts';
import type {
  PersistedSyncState,
  ServerEvent,
  ServerMessage,
  ServerRejection,
  SyncHandshake,
  SyncTransport,
  TransportState,
} from './types.ts';

// ---- Seeded randomness and virtual time ----------------------------------------------------

/** Small deterministic PRNG (mulberry32). The same seed always gives the same sequence. */
export class SeededRandom {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max], both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. Never draws when `p` is 0, so turning a fault off keeps runs aligned. */
  chance(p: number): boolean {
    return p > 0 && this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new RangeError('pick from an empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks one value, each with the given relative weight. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [value, w] of entries) {
      roll -= w;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1]![0];
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A clock that only moves when told to. Shared by the server, the network and every client. */
export class VirtualClock {
  private t: number;

  constructor(start = Date.UTC(2026, 2, 2, 9, 0, 0)) {
    this.t = start;
  }

  readonly now = (): number => this.t;

  advance(ms: number): void {
    if (ms < 0) throw new RangeError('The clock only moves forward');
    this.t += ms;
  }

  advanceDays(days: number): void {
    this.advance(days * DAY);
  }

  /** Moves to `t` if that is later than now. */
  moveTo(t: number): void {
    if (t > this.t) this.t = t;
  }
}

/** Lets pending promise callbacks (and anything they queue) run to completion. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ---- Network -------------------------------------------------------------------------------

/** Per-frame fault probabilities and latency. */
export interface FaultConfig {
  /** A frame to the server is lost, and its connection breaks. */
  dropToServer: number;
  /** A frame to the client (for example an ack) is lost, and its connection breaks. */
  dropToClient: number;
  /** A frame to the server arrives twice; the copy may arrive late. */
  duplicateToServer: number;
  /** A frame to the client arrives twice in a row. */
  duplicateToClient: number;
  /** A frame to the server is held back, so later frames overtake it. */
  reorderToServer: number;
  /** A frame on the wire when its connection breaks reaches the server anyway. */
  leakOnCut: number;
  minLatency: number;
  maxLatency: number;
}

/** No faults, fixed latency. */
export const CALM: Readonly<FaultConfig> = Object.freeze({
  dropToServer: 0,
  dropToClient: 0,
  duplicateToServer: 0,
  duplicateToClient: 0,
  reorderToServer: 0,
  leakOnCut: 0,
  minLatency: 5,
  maxLatency: 5,
});

interface Frame {
  order: number;
  at: number;
  run: () => void;
}

/** Holds every frame (and delayed disk write) in flight, and delivers them in virtual-time order. */
export class SimNetwork {
  faults: FaultConfig = { ...CALM };
  /** Frames delivered so far. */
  delivered = 0;
  private frames: Frame[] = [];
  private order = 0;
  readonly clock: VirtualClock;
  readonly random: SeededRandom;

  constructor(clock: VirtualClock, random: SeededRandom) {
    this.clock = clock;
    this.random = random;
  }

  latency(): number {
    return this.random.int(this.faults.minLatency, this.faults.maxLatency);
  }

  /** Runs `run` at virtual time `at` (or as soon as possible if that has passed). */
  schedule(at: number, run: () => void): void {
    this.frames.push({ order: ++this.order, at, run });
  }

  get inFlight(): number {
    return this.frames.length;
  }

  /** Delivers the earliest frame, moving the clock to its time. Returns false when nothing is in flight. */
  async step(): Promise<boolean> {
    if (!this.frames.length) return false;
    let best = 0;
    for (let i = 1; i < this.frames.length; i++) {
      const f = this.frames[i]!;
      const b = this.frames[best]!;
      if (f.at < b.at || (f.at === b.at && f.order < b.order)) best = i;
    }
    const [frame] = this.frames.splice(best, 1);
    this.clock.moveTo(frame!.at);
    frame!.run();
    this.delivered += 1;
    await settle();
    return true;
  }

  /** Delivers frames until none are left. */
  async drain(limit = 50_000): Promise<number> {
    let n = 0;
    await settle();
    while (await this.step()) {
      if (++n > limit) throw new Error('The network did not settle');
    }
    return n;
  }

  /** Delivers frames until `done()` holds (checked after each one). Returns whether it did. */
  async until(done: () => boolean, limit = 50_000): Promise<boolean> {
    await settle();
    for (let n = 0; n < limit; n++) {
      if (done()) return true;
      if (!(await this.step())) return done();
    }
    return done();
  }
}

interface Link {
  id: number;
  endpoint: InProcessTransport;
  /** The server still treats the connection as open. */
  serverOpen: boolean;
  /** The client has not yet seen the connection close. */
  clientOpen: boolean;
  lastUp: number;
  lastDown: number;
}

/**
 * A client device's network connection to the in-process server, with faults. Implements
 * {@link SyncTransport}, so a `SyncDocument` uses it unchanged; a test can also drive it directly as
 * a modified client sending whatever frames it likes.
 */
export class FaultyTransport implements SyncTransport {
  /** Every unit put on the wire, in order. */
  readonly sent: Operation[][] = [];
  /** Every server message handed to the client, in order. */
  readonly received: ServerMessage[] = [];
  readonly actor: Actor;
  readonly laneId: string;

  private _state: TransportState = 'disconnected';
  private link: Link | null = null;
  private online = true;
  private links = 0;
  private attempts = 0;
  private holdMs = 100;
  private readonly messageListeners = new Set<(message: ServerMessage) => void>();
  private readonly stateListeners = new Set<(state: TransportState) => void>();
  private readonly script = { dropAcks: 0, dropToServer: 0, duplicateToServer: 0, duplicateToClient: 0, holdToServer: 0 };
  private readonly net: SimNetwork;
  private readonly server: FakeSyncServer;

  constructor(net: SimNetwork, server: FakeSyncServer, actor: Actor, laneId = 'lane-1') {
    this.net = net;
    this.server = server;
    this.actor = actor;
    this.laneId = laneId;
  }

  get state(): TransportState {
    return this._state;
  }

  /** Whether the device has a network (see {@link cut} and {@link restore}). */
  get isOnline(): boolean {
    return this.online;
  }

  // -- Scripted faults: exact, for named tests --

  /** Loses the next `n` acknowledgements; each one breaks its connection. */
  dropNextAck(n = 1): void {
    this.script.dropAcks += n;
  }

  /** Loses the next `n` frames to the server; each one breaks its connection. */
  dropNextToServer(n = 1): void {
    this.script.dropToServer += n;
  }

  /** Sends a second, late copy of each of the next `n` frames to the server. */
  duplicateNextToServer(n = 1): void {
    this.script.duplicateToServer += n;
  }

  /** Delivers each of the next `n` frames to the client twice. */
  duplicateNextToClient(n = 1): void {
    this.script.duplicateToClient += n;
  }

  /** Holds back the next `n` frames to the server by `ms`, so frames sent after them arrive first. */
  holdNextToServer(n = 1, ms = 100): void {
    this.script.holdToServer += n;
    this.holdMs = ms;
  }

  /** Takes the device off the network. An open connection breaks; the client notices shortly. */
  cut(): void {
    this.online = false;
    if (this.link) this.breakLink(this.link, true);
  }

  /** Puts the device back on the network. The client still has to connect. */
  restore(): void {
    this.online = true;
  }

  // -- SyncTransport --

  connect(handshake: SyncHandshake): void {
    const attempt = ++this.attempts;
    if (this.link) this.breakLink(this.link, false);
    this.setState('connecting');
    if (!this.online) {
      this.net.schedule(this.net.clock.now() + this.net.latency(), () => {
        if (this.attempts === attempt && !this.link) this.setState('disconnected');
      });
      return;
    }
    const endpoint = this.server.createTransport(this.actor, this.laneId);
    const link: Link = { id: ++this.links, endpoint, serverOpen: true, clientOpen: true, lastUp: 0, lastDown: 0 };
    endpoint.onMessage((message) => this.fromServer(link, message));
    endpoint.onStateChange((state) => {
      if (state === 'disconnected' && link.serverOpen) {
        // The server closed the connection (access removed, protocol refused).
        link.serverOpen = false;
        this.closeLater(link);
      }
    });
    this.link = link;
    this.setState('connected');
    const hello = structuredClone(handshake);
    this.up(link, 0, () => {
      if (link.serverOpen) endpoint.connect(hello);
    });
  }

  disconnect(): void {
    if (this.link) this.breakLink(this.link, false);
    this.setState('disconnected');
  }

  send(ops: readonly Operation[]): void {
    const link = this.link;
    if (this._state !== 'connected' || !link || !link.clientOpen || !link.serverOpen) return;
    const frame = structuredClone([...ops]);
    this.sent.push(frame);
    const { faults, random } = this.net;

    if (this.take('dropToServer') || random.chance(faults.dropToServer)) {
      this.breakLink(link, true);
      return;
    }
    const hold = this.take('holdToServer') ? this.holdMs : random.chance(faults.reorderToServer) ? 3 * this.net.latency() + 1 : 0;
    this.up(link, hold, () => this.deliverToServer(link, frame));
    if (this.take('duplicateToServer') || random.chance(faults.duplicateToServer)) {
      const copy = structuredClone(frame);
      this.up(link, 3 * this.net.latency() + 1, () => this.deliverToServer(link, copy));
    }
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(listener: (state: TransportState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  // -- Internals --

  private take(key: keyof FaultyTransport['script']): boolean {
    if (this.script[key] <= 0) return false;
    this.script[key] -= 1;
    return true;
  }

  private deliverToServer(link: Link, ops: Operation[]): void {
    if (link.serverOpen) {
      link.endpoint.send(ops);
      return;
    }
    // The connection broke with this frame on the wire. Sometimes the server had already read it;
    // it then processes it, and its reply is lost with the connection.
    if (this.net.random.chance(this.net.faults.leakOnCut)) this.server._receive(link.endpoint, ops);
  }

  private fromServer(link: Link, message: ServerMessage): void {
    if (!link.serverOpen) return;
    const { faults, random } = this.net;
    const lostAck = message.type === 'ack' && this.take('dropAcks');
    if (lostAck || random.chance(faults.dropToClient)) {
      this.breakLink(link, true);
      return;
    }
    this.down(link, message);
    if (this.take('duplicateToClient') || random.chance(faults.duplicateToClient)) {
      this.down(link, structuredClone(message));
    }
  }

  /** Schedules a frame to the server: in order after earlier frames, or held back by `holdMs`. */
  private up(link: Link, holdMs: number, run: () => void): void {
    let at = this.net.clock.now() + this.net.latency();
    if (holdMs > 0) {
      at += holdMs;
    } else {
      at = Math.max(at, link.lastUp);
      link.lastUp = at;
    }
    this.net.schedule(at, run);
  }

  private down(link: Link, message: ServerMessage): void {
    const at = Math.max(this.net.clock.now() + this.net.latency(), link.lastDown);
    link.lastDown = at;
    this.net.schedule(at, () => {
      if (this.link !== link || !link.clientOpen) return;
      this.received.push(message);
      for (const listener of [...this.messageListeners]) listener(structuredClone(message));
    });
  }

  /**
   * Ends a connection. With `notify`, the client finds out after the frames already on their way to
   * it; without, the client itself closed it and frames still on their way to it are lost.
   */
  private breakLink(link: Link, notify: boolean): void {
    if (link.serverOpen) {
      link.serverOpen = false;
      link.endpoint.disconnect();
    }
    if (notify) {
      this.closeLater(link);
    } else {
      link.clientOpen = false;
      if (this.link === link) this.link = null;
    }
  }

  private closeLater(link: Link): void {
    const at = Math.max(this.net.clock.now() + this.net.latency(), link.lastDown);
    link.lastDown = at;
    this.net.schedule(at, () => {
      if (this.link !== link) return;
      link.clientOpen = false;
      this.link = null;
      this.setState('disconnected');
    });
  }

  private setState(next: TransportState): void {
    if (this._state === next) return;
    this._state = next;
    for (const listener of [...this.stateListeners]) listener(next);
  }
}

// ---- Server rules --------------------------------------------------------------------------

/** What a user may do in the simulated review. */
export type Role = 'editor' | 'author' | 'viewer';

function markupOf(op: Operation, sim: { state: FakeSyncServer['state'] }): string | null {
  switch (op.type) {
    case 'markup.create':
    case 'markup.patch':
    case 'markup.delete':
    case 'markup.restore':
      return op.entityId;
    case 'placement.create':
      return op.payload.markupId;
    case 'placement.patch':
    case 'placement.delete':
    case 'placement.restore':
      return own(sim.state.placements, op.entityId)?.markupId ?? null;
    default:
      return null;
  }
}

/**
 * Permission rules the simulated server enforces when it applies each operation, using the rules
 * in force at that moment:
 * - `editor` may change any markup, `author` only markups they made, `viewer` nothing;
 * - nothing is accepted while the stage is closed;
 * - `deny` adds scenario-specific refusals the client cannot predict.
 */
export class ReviewPolicy {
  readonly roles = new Map<string, Role>();
  stageClosed = false;
  deny: ((actor: Actor, op: Operation) => ServerRejection | null) | null = null;

  readonly authorize: Authorize = (actor, op, state, unit) => {
    if (this.stageClosed) return { code: 'forbidden', message: 'The review stage is closed' };
    const denied = this.deny?.(actor, op) ?? null;
    if (denied) return denied;
    const role = this.roles.get(actor.userId) ?? 'viewer';
    if (role === 'viewer') return false;
    if (role === 'editor') return true;
    const markupId = markupOf(op, { state });
    if (markupId === null) return false;
    const record = own(state.markups, markupId);
    if (record) return record.owner.userId === actor.userId;
    // A markup made earlier in the same batch belongs to its sender.
    return unit.some((o) => o.type === 'markup.create' && o.entityId === markupId);
  };
}

// ---- Clients -------------------------------------------------------------------------------

/**
 * A client device's disk. Writes land after a short delay, so a crash can lose the most recent
 * ones, as a power cut would. Records every opId that actually reached the disk in the pending
 * queue or the inbox: those are the edits that must never be lost.
 */
class DeviceDisk implements SyncPersistence {
  private dead = false;
  private buffered: { key: string; state: PersistedSyncState } | null = null;
  private scheduled = false;
  private readonly store: MemorySyncPersistence;
  private readonly net: SimNetwork;
  private readonly saved: Set<string>;

  constructor(store: MemorySyncPersistence, net: SimNetwork, saved: Set<string>) {
    this.store = store;
    this.net = net;
    this.saved = saved;
  }

  load(key: string): Promise<PersistedSyncState | null> {
    return this.store.load(key);
  }

  async save(key: string, state: PersistedSyncState): Promise<void> {
    if (this.dead) return;
    // `SyncDocument` hands over a fresh copy it never touches again, so no need to copy it here.
    this.buffered = { key, state };
    if (this.scheduled) return;
    this.scheduled = true;
    this.net.schedule(this.net.clock.now() + 2, () => {
      this.scheduled = false;
      void this.writeBuffered();
    });
  }

  clear(key: string): Promise<void> {
    return this.store.clear(key);
  }

  /** Writes anything still buffered (a clean shutdown). */
  async writeBuffered(): Promise<void> {
    const write = this.buffered;
    this.buffered = null;
    if (!write || this.dead) return;
    const historyOps = new Set((write.state.history ?? []).flatMap((h) => h.emittedOps.map((o) => o.opId)));
    for (const op of write.state.pending) {
      if (!historyOps.has(op.opId)) this.saved.add(op.opId);
    }
    for (const entry of write.state.inbox) for (const op of entry.ops) this.saved.add(op.opId);
    await this.store.save(write.key, write.state);
  }

  /** The process dies: buffered writes are lost and later writes from it are ignored. */
  crash(): void {
    this.dead = true;
    this.buffered = null;
  }
}

export interface ClientOptions {
  role?: Role;
  /** Client-side hint of what the user may edit (a well-behaved client respects it). */
  editRule?: EditRule | null;
  protocol?: ProtocolRange;
  laneId?: string;
}

export const STREAM_ID = 'doc-sim';
export const SCOPE_ID = 'review-sim';
export const REVISION_ID = 'rev-sim';
export const PAGES = ['page-s101', 'page-s102'] as const;

/** One user's device: a `SyncDocument`, its disk, and its network connection. */
export class SimClient {
  doc!: SyncDocument;
  readonly transport: FaultyTransport;
  /** Every opId that reached this device's disk as pending work or inbox work. */
  readonly savedOpIds = new Set<string>();
  /** For each op sent by an undo or redo: whether the caller was told it was done or failed. */
  readonly historyOutcome = new Map<string, 'done' | Exclude<UndoResult, { ok: true }>['reason']>();
  /** Undo/redo calls not yet settled. */
  unsettledHistory = 0;
  /** OpIds of inbox work the user chose to retry as new or discard: no longer owed to the server. */
  readonly resolvedOpIds = new Set<string>();
  readonly name: string;
  readonly actor: Actor;
  restarts = 0;
  crashes = 0;
  /** Ops sent by an undo or redo that a crash may have brought back from older disk state. */
  readonly replayedHistory = new Set<string>();
  private readonly closed = new WeakSet<SyncDocument>();
  /** Serialises undo/redo calls so queued steps capture their emitted opIds when they actually run. */
  private historyQueue: Promise<unknown> | null = null;
  private releaseRestoredHistory: (() => void) | null = null;

  private readonly store = new MemorySyncPersistence();
  private disk!: DeviceDisk;
  private ids = 0;
  private readonly sim: SyncSim;
  private readonly options: ClientOptions;

  constructor(sim: SyncSim, name: string, options: ClientOptions) {
    this.sim = sim;
    this.name = name;
    this.options = options;
    this.actor = { userId: name, partyId: 'party-sim', groupId: null };
    this.transport = new FaultyTransport(sim.net, sim.server, this.actor, options.laneId ?? 'lane-1');
  }

  /** Opens the document from whatever is on this device's disk. */
  async open(): Promise<SyncDocument> {
    this.disk = new DeviceDisk(this.store, this.sim.net, this.savedOpIds);
    this.doc = await SyncDocument.open({
      key: `${STREAM_ID}:${this.name}`,
      streamId: STREAM_ID,
      scopeId: SCOPE_ID,
      revisionId: REVISION_ID,
      pages: PAGES,
      actor: this.actor,
      ...(this.options.laneId ? { laneId: this.options.laneId } : {}),
      context: { actor: { id: this.name, name: this.name } },
      transport: this.transport,
      persistence: this.disk,
      editRule: this.options.editRule ?? null,
      ...(this.options.protocol ? { protocol: this.options.protocol } : {}),
      clock: this.sim.clock.now,
      // Ids never repeat on a device, across restarts too (as random UUIDs would not).
      newId: () => `${this.name}-${(++this.ids).toString(36)}`,
    });
    const saved = await this.saved();
    const restoredIds = new Set((saved?.history ?? []).flatMap((h) => h.emittedOps.map((o) => o.opId)));
    if (restoredIds.size && this.doc.pendingOperations().some((o) => restoredIds.has(o.opId))) {
      const doc = this.doc;
      const wait = new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          unsub();
          if (this.releaseRestoredHistory === finish) this.releaseRestoredHistory = null;
          resolve();
        };
        const unsub = doc.sync.subscribe(() => {
          if (this.closed.has(doc) || !doc.pendingOperations().some((o) => restoredIds.has(o.opId))) {
            finish();
          }
        });
        this.releaseRestoredHistory = finish;
      });
      this.historyQueue = wait;
      void wait.then(() => {
        if (this.historyQueue === wait) this.historyQueue = null;
      });
    }
    return this.doc;
  }

  /**
   * Runs undo or redo, and records what the caller was told about the operations it sent: an
   * undo reported as done must be applied on the server, one reported as failed must not be.
   * A result that arrives because the app is closing tells the user nothing and is not recorded.
   */
  history(kind: 'undo' | 'redo'): Promise<UndoResult> {
    const doc = this.doc;
    if (this.historyQueue && doc.sync.connection !== 'connected') {
      return kind === 'undo' ? doc.undo() : doc.redo();
    }
    const runStep = (): Promise<UndoResult> => {
      if (this.closed.has(doc)) return Promise.resolve({ ok: false, reason: 'offline' });
      const before = new Set(doc.pendingOperations().map((o) => o.opId));
      const result = kind === 'undo' ? doc.undo() : doc.redo();
      const sent = doc.pendingOperations().filter((o) => !before.has(o.opId)).map((o) => o.opId);
      return result.then((res) => {
        if (!this.closed.has(doc)) for (const id of sent) this.historyOutcome.set(id, res.ok ? 'done' : res.reason);
        return res;
      });
    };
    this.unsettledHistory += 1;
    const prev = this.historyQueue;
    const run = prev ? prev.then(runStep) : runStep();
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.historyQueue = tail;
    void tail.then(() => {
      if (this.historyQueue === tail) this.historyQueue = null;
    });
    return run.finally(() => {
      this.unsettledHistory -= 1;
    });
  }

  /** Retries an inbox entry as new work (as the user would from the inbox). */
  retryInbox(id: string): boolean {
    const entry = this.doc.sync.inbox.find((e) => e.id === id);
    const ok = this.doc.sync.retryInboxAsNew(id);
    if (ok && entry) for (const op of entry.ops) this.resolvedOpIds.add(op.opId);
    return ok;
  }

  /** Discards an inbox entry (as the user would from the inbox). */
  discardInbox(id: string): void {
    const entry = this.doc.sync.inbox.find((e) => e.id === id);
    this.doc.sync.discardInbox(id);
    if (entry) for (const op of entry.ops) this.resolvedOpIds.add(op.opId);
  }

  /** Connects and waits for the network to go quiet. */
  async connect(): Promise<void> {
    await this.doc.connect();
    await this.sim.net.drain();
  }

  /**
   * Closes the app and opens it again from disk. A clean restart writes everything first; a crash
   * loses writes still buffered. Either way the open connection ends with the process.
   */
  async restart(options: { crash?: boolean } = {}): Promise<SyncDocument> {
    this.restarts += 1;
    const old = this.doc;
    const disk = this.disk;
    this.closed.add(old);
    this.releaseRestoredHistory?.();
    this.historyQueue = null;
    if (options.crash) {
      this.crashes += 1;
      disk.crash();
      for (const id of this.historyOutcome.keys()) this.replayedHistory.add(id);
    }
    this.transport.disconnect();
    await settle();
    if (options.crash) {
      void old.destroy();
    } else {
      await old.destroy();
      await disk.writeBuffered();
    }
    return this.open();
  }

  /** What is on this device's disk right now. */
  saved(): Promise<PersistedSyncState | null> {
    return this.store.load(`${STREAM_ID}:${this.name}`);
  }
}

// ---- The simulation ------------------------------------------------------------------------

export interface SimOptions {
  seed?: number;
  /** Server protocol range. */
  protocol?: ProtocolRange;
  /** Events the server keeps before catch-up falls back to a snapshot. */
  maxLogLength?: number;
}

/** A server, a network, and some clients, all on one virtual clock and one seed. */
export class SyncSim {
  readonly seed: number;
  readonly random: SeededRandom;
  readonly clock = new VirtualClock();
  readonly net: SimNetwork;
  readonly policy = new ReviewPolicy();
  readonly server: FakeSyncServer;
  readonly clients = new Map<string, SimClient>();
  /** Users whose access is currently removed. */
  readonly revoked = new Set<string>();
  /** Every event the server committed, in order (the server itself keeps only a recent window). */
  readonly commits: ServerEvent[] = [];

  constructor(options: SimOptions = {}) {
    this.seed = options.seed ?? 1;
    this.random = new SeededRandom(this.seed);
    this.net = new SimNetwork(this.clock, this.random);
    this.server = new FakeSyncServer({
      clock: this.clock.now,
      authorize: this.policy.authorize,
      onCommit: (event) => this.commits.push(event),
      ...(options.protocol ? { protocol: options.protocol } : {}),
      ...(options.maxLogLength ? { maxLogLength: options.maxLogLength } : {}),
    });
  }

  /** Adds a user's device and opens its document (not yet connected). */
  async addClient(name: string, options: ClientOptions = {}): Promise<SimClient> {
    this.policy.roles.set(name, options.role ?? 'editor');
    const client = new SimClient(this, name, options);
    await client.open();
    this.clients.set(name, client);
    return client;
  }

  /** A modified client that speaks the wire protocol directly, for sending forged frames. */
  rawClient(name: string, role: Role = 'viewer'): FaultyTransport {
    this.policy.roles.set(name, role);
    return new FaultyTransport(this.net, this.server, { userId: name, partyId: 'party-sim', groupId: null });
  }

  revoke(name: string, reason = 'Removed from the review'): void {
    this.revoked.add(name);
    this.server.revokeAccess(name, reason);
  }

  restoreAccess(name: string): void {
    this.revoked.delete(name);
    this.server.restoreAccess(name);
  }

  /** opIds of every event the server committed, in order (a retry must never add one twice). */
  acceptedOpIds(): string[] {
    return this.commits.flatMap((e) => e.ops.map((o) => o.opId));
  }

  /**
   * Ends all faults and brings every device back: network restored, everyone reconnected, all
   * queued work sent, until nothing is in flight.
   */
  async heal(): Promise<void> {
    this.net.faults = { ...CALM };
    for (const c of this.clients.values()) c.transport.restore();
    for (let round = 0; round < 25; round++) {
      await this.net.drain();
      let quiet = true;
      for (const c of this.clients.values()) {
        const connection = c.doc.sync.connection;
        if (connection === 'connected') {
          if (c.doc.sync.pendingCount > 0) {
            quiet = false;
            await c.doc.flush();
          }
          continue;
        }
        if (connection === 'revoked' && this.revoked.has(c.name)) continue;
        if (connection === 'update_required') continue;
        quiet = false;
        await c.doc.connect();
      }
      await this.net.drain();
      if (quiet && this.net.inFlight === 0) return;
    }
  }

  /** Everything wrong with the current state; empty when all is well. Call after {@link heal}. */
  problems(): string[] {
    const out: string[] = [];
    const accepted = this.acceptedOpIds();
    const acceptedSet = new Set(accepted);
    if (acceptedSet.size !== accepted.length) {
      const seen = new Set<string>();
      const twice = accepted.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
      out.push(`server applied an op more than once: ${[...new Set(twice)].join(', ')}`);
    }
    const server = this.server.state;

    for (const c of this.clients.values()) {
      const doc = c.doc;
      const who = c.name;
      const inboxOps = new Set(doc.sync.inbox.flatMap((e) => e.ops.map((o) => o.opId)));
      // Work held back when access is removed: the client cannot know what the server applied.
      const conflictInboxOps = new Set(doc.sync.inbox.filter((e) => e.reason.code !== 'forbidden').flatMap((e) => e.ops.map((o) => o.opId)));
      for (const id of c.savedOpIds) {
        const told = c.historyOutcome.get(id);
        if (told && told !== 'done') continue;
        if (c.resolvedOpIds.has(id)) continue;
        if (!acceptedSet.has(id) && !inboxOps.has(id)) out.push(`${who}: saved op ${id} was lost (neither applied nor in the inbox)`);
      }
      for (const [id, outcome] of c.historyOutcome) {
        // `forbidden` can come from access being removed while the ops were on the wire, when the
        // client cannot know whether they were applied; `done` and `changed` are definite.
        if (outcome === 'changed' && acceptedSet.has(id)) out.push(`${who}: undo/redo op ${id} was reported failed but the server applied it`);
        if (outcome === 'done' && !acceptedSet.has(id)) out.push(`${who}: undo/redo op ${id} was reported done but the server never applied it`);
        if ((outcome === 'done' || outcome === 'changed') && conflictInboxOps.has(id) && !c.replayedHistory.has(id)) out.push(`${who}: undo/redo op ${id} was put in the inbox`);
      }
      if (c.unsettledHistory) out.push(`${who}: ${c.unsettledHistory} undo/redo calls never settled`);

      if (this.revoked.has(who)) {
        if (doc.sync.connection !== 'revoked') out.push(`${who}: access removed but connection is ${doc.sync.connection}`);
        if (!doc.readOnly) out.push(`${who}: access removed but the document is editable`);
        if (doc.all().length) out.push(`${who}: access removed but ${doc.all().length} markups are still cached`);
        if (doc.sync.pendingCount) out.push(`${who}: access removed but ${doc.sync.pendingCount} ops are still pending`);
        continue;
      }
      if (doc.sync.connection === 'update_required') continue;

      for (const id of inboxOps) {
        if (acceptedSet.has(id)) out.push(`${who}: op ${id} is in the inbox but the server applied it`);
      }
      if (doc.sync.connection !== 'connected') out.push(`${who}: not connected after healing (${doc.sync.connection})`);
      if (doc.sync.pendingCount) out.push(`${who}: ${doc.sync.pendingCount} ops still pending after healing`);
      if (!isDeepStrictEqual(doc.confirmedState(), server)) out.push(`${who}: confirmed state differs from the server`);
      if (!isDeepStrictEqual(doc.viewState(), doc.confirmedState())) out.push(`${who}: view differs from confirmed state`);
      const ids = doc.all().map((m) => m.id);
      if (new Set(ids).size !== ids.length) out.push(`${who}: duplicate markups in view`);
      const live = Object.values(server.placements)
        .filter((p) => !p.deleted && p.revisionId === REVISION_ID && !server.markups[p.markupId]?.deleted)
        .map((p) => p.markupId)
        .sort();
      if (!isDeepStrictEqual([...ids].sort(), live)) out.push(`${who}: visible markups differ from the server's`);
    }
    return out;
  }
}
