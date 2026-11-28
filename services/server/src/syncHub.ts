import { MAX_BATCH_SIZE, type Actor, type Operation, type ProtocolRange } from '@nb/ops';
import type { PresenceUser, ServerFrame, ServerMessage, ServerRejection } from '@nb/sync';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import type { Logger } from 'pino';
import type { Broadcaster } from './broadcaster.ts';
import { resolveDocumentAccess, type DocumentAccess } from './documentAccess.ts';
import type { Database } from './db.ts';
import type { OpPipeline, PipelineRejection } from './pipeline.ts';
import { CursorSealer, ensureReaderRole, readFeed, type FeedUnit } from './syncFeed.ts';

/*
 * The live side of document streams. Each open stream on each connection has its own queue, so
 * everything it is sent goes out in stream order: a committed change only wakes the queue, which
 * then reads what is new through row-level security. A client therefore sees another person's
 * change before the answer to an operation of its own that lost to it.
 */

/** The most document streams one connection may have open. */
const MAX_OPEN_STREAMS = 32;
const MAX_PAGE_INDEX = 1_000_000;

export interface SyncHubOptions {
  db: Kysely<Database>;
  pool: pg.Pool;
  pipeline: OpPipeline;
  broadcaster: Broadcaster;
  logger: Logger;
  cursors?: CursorSealer;
}

export interface SyncConnection {
  id: string;
  user: { id: string; name: string };
  send: (frame: ServerFrame) => void;
}

interface Subscription {
  streamId: string;
  access: DocumentAccess;
  /** The stream position everything up to has been delivered. */
  lastSeq: number;
  delivered: number;
  /** Operations sent on this connection that have not been answered. */
  awaiting: Set<string>;
  queue: Promise<void>;
  pumpQueued: boolean;
  closed: boolean;
  unsubscribe: () => void;
  pageIndex: number | null;
}

function toServerRejection(rejection: PipelineRejection, opId: string): ServerRejection {
  switch (rejection.code) {
    case 'op_id_conflict':
      return { code: 'op_id_reused', opId };
    case 'payload_too_large':
    case 'unsupported_operation':
      return { code: 'invalid', message: rejection.message };
    default:
      return rejection;
  }
}

export class SyncHub {
  private readonly options: SyncHubOptions;
  private readonly cursors: CursorSealer;
  /** Open subscriptions by stream, for presence. */
  private readonly watchers = new Map<string, Map<Subscription, SyncConnection>>();
  private readonly sessions = new Set<SyncSession>();
  private roleReady: Promise<void> | null = null;
  /** Reads and writes still running, so shutdown can wait for them. */
  private readonly running = new Set<Promise<unknown>>();

  constructor(options: SyncHubOptions) {
    this.options = options;
    this.cursors = options.cursors ?? new CursorSealer();
  }

  createSession(connection: SyncConnection): SyncSession {
    const session = new SyncSession(this, connection);
    this.sessions.add(session);
    return session;
  }

  /** Checks every open stream's access now: after a membership or role change, and on a timer. */
  async revalidate(): Promise<void> {
    await this.track(Promise.all([...this.sessions].map((session) => session.revalidate())));
  }

  /** @internal */
  track<T>(work: Promise<T>): Promise<T> {
    this.running.add(work);
    const done = () => void this.running.delete(work);
    work.then(done, done);
    return work;
  }

  /** Ends every session and waits for work already running, so the database can be closed after. */
  async close(): Promise<void> {
    for (const session of [...this.sessions]) session.dispose();
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  /** @internal */
  forget(session: SyncSession): void {
    this.sessions.delete(session);
  }

  /** @internal */
  ready(): Promise<void> {
    this.roleReady ??= ensureReaderRole(this.options.pool).catch((err) => {
      this.roleReady = null;
      throw err;
    });
    return this.roleReady;
  }

  /** @internal */
  get deps(): SyncHubOptions & { cursors: CursorSealer } {
    return { ...this.options, cursors: this.cursors };
  }

  /** @internal */
  watch(sub: Subscription, connection: SyncConnection): void {
    let set = this.watchers.get(sub.streamId);
    if (!set) {
      set = new Map();
      this.watchers.set(sub.streamId, set);
    }
    set.set(sub, connection);
  }

  /** @internal */
  unwatch(sub: Subscription): void {
    const set = this.watchers.get(sub.streamId);
    if (!set?.delete(sub)) return;
    if (!set.size) this.watchers.delete(sub.streamId);
    this.announcePresence(sub.streamId);
  }

  /** Tells everyone on a stream who else has it open. People see only those in their own lane. @internal */
  announcePresence(streamId: string): void {
    const set = this.watchers.get(streamId);
    if (!set) return;
    for (const [viewer, connection] of set) {
      const users: PresenceUser[] = [];
      for (const [other, otherConnection] of set) {
        if (other.access.laneId !== viewer.access.laneId) continue;
        users.push({
          connectionId: otherConnection.id,
          userId: otherConnection.user.id,
          name: otherConnection.user.name,
          pageIndex: other.pageIndex,
        });
      }
      connection.send({ type: 'presence', streamId, users });
    }
  }
}

export class SyncSession {
  private readonly hub: SyncHub;
  private readonly connection: SyncConnection;
  private readonly subscriptions = new Map<string, Subscription>();
  private disposed = false;

  constructor(hub: SyncHub, connection: SyncConnection) {
    this.hub = hub;
    this.connection = connection;
  }

  /** Adds `task` to a stream's queue. A failed task is logged and ends that stream's subscription. */
  private enqueue(sub: Subscription, task: () => Promise<void>): Promise<void> {
    sub.queue = sub.queue.then(async () => {
      if (sub.closed) return;
      try {
        await task();
      } catch (err) {
        this.hub.deps.logger.error({ err, streamId: sub.streamId, userId: this.connection.user.id }, 'Sync stream failed');
        this.drop(sub);
        this.connection.send({ type: 'error', code: 'internal_error', streamId: sub.streamId });
      }
    });
    return this.hub.track(sub.queue);
  }

  private message(sub: Subscription, message: ServerMessage): void {
    this.connection.send({ type: 'sync', streamId: sub.streamId, message });
  }

  private cursor(sub: Subscription, seq: number): string {
    return this.hub.deps.cursors.seal(sub.streamId, this.connection.user.id, seq);
  }

  private drop(sub: Subscription): void {
    if (sub.closed) return;
    sub.closed = true;
    sub.unsubscribe();
    if (this.subscriptions.get(sub.streamId) === sub) this.subscriptions.delete(sub.streamId);
    this.hub.unwatch(sub);
  }

  private revoke(sub: Subscription): void {
    this.message(sub, { type: 'revoked', reason: 'Access removed' });
    this.drop(sub);
  }

  /** Refuses a stream this user may not open. The same answer whether or not it exists. */
  private deny(streamId: string): void {
    this.connection.send({ type: 'sync', streamId, message: { type: 'revoked', reason: 'No access' } });
  }

  async open(streamId: string, cursor: string | null, pendingOpIds: readonly string[], protocol: ProtocolRange & { version: number }): Promise<void> {
    const { db, broadcaster, cursors } = this.hub.deps;
    const userId = this.connection.user.id;
    const previous = this.subscriptions.get(streamId);
    if (previous) this.drop(previous);
    if (this.subscriptions.size >= MAX_OPEN_STREAMS) {
      this.connection.send({ type: 'error', code: 'too_many_streams', streamId });
      return;
    }
    await this.hub.ready();
    const access = await resolveDocumentAccess(db, userId, streamId);
    if (!access || this.disposed) {
      if (!this.disposed) this.deny(streamId);
      return;
    }
    const sub: Subscription = {
      streamId,
      access,
      lastSeq: 0,
      delivered: 0,
      awaiting: new Set(),
      queue: Promise.resolve(),
      pumpQueued: false,
      closed: false,
      unsubscribe: () => undefined,
      pageIndex: null,
    };
    this.subscriptions.set(streamId, sub);
    // Listen before reading, so nothing committed in between is missed.
    sub.unsubscribe = broadcaster.subscribe(streamId, () => this.wake(sub));

    await this.enqueue(sub, async () => {
      const after = cursor === null ? null : cursors.open(cursor, streamId, userId);
      const feed = await readFeed(db, userId, streamId, after, pendingOpIds);
      if (feed.kind === 'denied') {
        this.revoke(sub);
        return;
      }
      sub.access = feed.access;
      sub.lastSeq = feed.head;
      const negotiated = { ok: true, version: protocol.version } as const;
      if (feed.kind === 'snapshot') {
        this.message(sub, {
          type: 'welcome',
          protocol: negotiated,
          snapshot: { state: feed.state, cursor: this.cursor(sub, feed.head), appliedOpIds: feed.appliedOpIds },
        });
      } else {
        const events = feed.units.map((unit) => this.event(sub, unit));
        this.message(sub, { type: 'welcome', protocol: negotiated, events });
      }
      this.connection.send({ type: 'access', streamId, role: sub.access.role });
      this.hub.watch(sub, this.connection);
      this.hub.announcePresence(streamId);
    });
  }

  private actorOf(unit: FeedUnit): Actor {
    return { userId: unit.actorId, partyId: null, groupId: null };
  }

  private event(sub: Subscription, unit: FeedUnit) {
    sub.delivered += 1;
    return {
      ops: unit.ops,
      seq: sub.delivered,
      cursor: this.cursor(sub, unit.seq),
      serverTime: unit.serverTime,
      actor: this.actorOf(unit),
      laneId: sub.access.laneId,
    };
  }

  private wake(sub: Subscription): void {
    if (sub.pumpQueued || sub.closed) return;
    sub.pumpQueued = true;
    void this.enqueue(sub, async () => {
      sub.pumpQueued = false;
      await this.pump(sub);
    });
  }

  /** Delivers what is new on the stream: an `ack` for this connection's own operations, an `event` otherwise. */
  private async pump(sub: Subscription): Promise<void> {
    const { db } = this.hub.deps;
    const feed = await readFeed(db, this.connection.user.id, sub.streamId, sub.lastSeq);
    if (feed.kind === 'denied') {
      this.revoke(sub);
      return;
    }
    sub.access = feed.access;
    if (feed.kind === 'snapshot') {
      sub.lastSeq = feed.head;
      this.message(sub, { type: 'snapshot', state: feed.state, cursor: this.cursor(sub, feed.head) });
      return;
    }
    for (const unit of feed.units) {
      const opIds = unit.ops.map((op) => op.opId);
      const own = unit.actorId === this.connection.user.id && opIds.some((id) => sub.awaiting.has(id));
      const event = this.event(sub, unit);
      if (own) {
        for (const id of opIds) sub.awaiting.delete(id);
        this.message(sub, {
          type: 'ack',
          opIds,
          seq: event.seq,
          cursor: event.cursor,
          serverTime: event.serverTime,
          actor: event.actor,
          laneId: event.laneId,
        });
      } else {
        this.message(sub, { type: 'event', event });
      }
    }
    sub.lastSeq = feed.head;
  }

  /** Applies one operation, or one batch, from this connection and answers it in stream order. */
  async submit(streamId: string, ops: unknown): Promise<void> {
    const sub = this.subscriptions.get(streamId);
    if (!sub) {
      this.connection.send({ type: 'error', code: 'stream_not_open', streamId });
      return;
    }
    const list = Array.isArray(ops) ? (ops as Operation[]) : [];
    const valid =
      list.length > 0 &&
      list.length <= MAX_BATCH_SIZE &&
      list.every((op) => op && typeof op === 'object' && op.streamId === streamId && typeof op.opId === 'string');
    if (!valid) {
      this.connection.send({ type: 'error', code: 'invalid_frame', streamId, message: 'A send frame holds this stream’s operations' });
      return;
    }

    const { db, pipeline } = this.hub.deps;
    const userId = this.connection.user.id;
    const actor: Actor = { userId, partyId: null, groupId: null };
    const opIds = list.map((op) => op.opId);
    for (const id of opIds) sub.awaiting.add(id);
    const options = { documentOnly: true };

    const single = list.length === 1 && list[0]!.batchId === undefined;
    let accepted: { receivedAt: string } | null = null;
    let refused: { failedOpId: string; rejection: PipelineRejection } | null = null;
    try {
      if (single) {
        const result = await pipeline.submitOperation(list[0], actor, undefined, options);
        if (result.ok) accepted = result;
        else refused = { failedOpId: opIds[0]!, rejection: result.rejection };
      } else {
        const result = await pipeline.submitBatch(list, actor, undefined, options);
        if (result.ok) accepted = result.results[0]!;
        else refused = { failedOpId: result.opId ?? opIds[0]!, rejection: result.rejection };
      }
    } catch (err) {
      // Unknown outcome: the client keeps the operations and sends them again after reconnecting.
      for (const id of opIds) sub.awaiting.delete(id);
      throw err;
    }

    await this.enqueue(sub, async () => {
      // A write refused because access went is reported as that, not as a rejected edit.
      if (refused?.rejection.code === 'forbidden' && !(await resolveDocumentAccess(db, userId, streamId))) {
        this.revoke(sub);
        return;
      }
      await this.pump(sub);
      if (sub.closed) return;
      if (refused) {
        for (const id of opIds) sub.awaiting.delete(id);
        this.message(sub, {
          type: 'reject',
          opIds,
          failedOpId: refused.failedOpId,
          reason: toServerRejection(refused.rejection, refused.failedOpId),
        });
        return;
      }
      if (accepted && opIds.some((id) => sub.awaiting.has(id))) {
        // A retry of operations delivered before: the stream will not bring them again.
        for (const id of opIds) sub.awaiting.delete(id);
        sub.delivered += 1;
        this.message(sub, {
          type: 'ack',
          opIds,
          seq: sub.delivered,
          cursor: this.cursor(sub, sub.lastSeq),
          serverTime: Date.parse(accepted.receivedAt),
          actor,
          laneId: sub.access.laneId,
        });
      }
    });
  }

  setPage(streamId: string, pageIndex: unknown): void {
    const sub = this.subscriptions.get(streamId);
    if (!sub) return;
    if (typeof pageIndex !== 'number' || !Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex > MAX_PAGE_INDEX) return;
    if (sub.pageIndex === pageIndex) return;
    sub.pageIndex = pageIndex;
    this.hub.announcePresence(streamId);
  }

  close(streamId: string): void {
    const sub = this.subscriptions.get(streamId);
    if (sub) this.drop(sub);
  }

  async revalidate(): Promise<void> {
    const { db, logger } = this.hub.deps;
    for (const sub of [...this.subscriptions.values()]) {
      try {
        const access = await resolveDocumentAccess(db, this.connection.user.id, sub.streamId);
        if (sub.closed) continue;
        if (!access) {
          this.revoke(sub);
        } else if (access.role !== sub.access.role) {
          sub.access = access;
          this.connection.send({ type: 'access', streamId: sub.streamId, role: access.role });
        }
      } catch (err) {
        logger.warn({ err, streamId: sub.streamId }, 'Failed to re-check document access');
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const sub of [...this.subscriptions.values()]) this.drop(sub);
    this.hub.forget(this);
  }
}
