import {
  applyBatch,
  applyOp,
  emptyState,
  negotiateProtocol,
  parseOperation,
  SUPPORTED_PROTOCOL,
  type Actor as OpsActor,
  type ApplyContext,
  type Operation,
  type OpsState,
  type ProtocolRange,
  type StatusDef,
} from '@nb/ops';
import type {
  ServerEvent,
  ServerMessage,
  ServerRejection,
  SyncHandshake,
  SyncTransport,
  TransportState,
} from './types.ts';

/** Canonical JSON fingerprint for idempotency checks (detecting reused `opId` with altered content). */
function canonicalString(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalString(v)}`).join(',')}}`;
}

function opFingerprint(op: Operation): string {
  return canonicalString({
    schemaVersion: op.schemaVersion,
    streamId: op.streamId,
    type: op.type,
    entityId: op.entityId,
    basedOn: op.basedOn,
    payload: op.payload,
    batchId: op.batchId,
    batchSize: op.batchSize,
  });
}

function formatCursor(seq: number): string {
  return `seq:${seq}`;
}

function parseCursor(cursor: string | null): number | null {
  if (!cursor) return null;
  const match = /^seq:(\d+)$/.exec(cursor);
  if (!match) return null;
  return Number(match[1]);
}

/**
 * Permission check run on each operation of a unit, with the rules in force when the server applies
 * it. `state` is the committed state before the unit; `unit` is the whole single op or batch, so a
 * check can see records created earlier in the same batch. Return `true` to allow, `false` for a
 * plain `forbidden`, or a rejection to send back as the reason.
 */
export type Authorize = (
  actor: OpsActor,
  op: Operation,
  state: OpsState,
  unit: readonly Operation[],
) => boolean | ServerRejection;

interface StoredOpResult {
  userId: string;
  fingerprint: string;
  message: Extract<ServerMessage, { type: 'ack' | 'reject' }>;
}

export interface FakeSyncServerOptions {
  initialState?: OpsState;
  protocol?: ProtocolRange;
  statuses?: readonly StatusDef[];
  /** Authoritative server clock. Defaults to a monotonic counter starting at 1_000_000. */
  clock?: () => number;
  /** Optional permission check run before applying each op (see {@link Authorize}). */
  authorize?: Authorize;
  /** Maximum retained event history before catch-up falls back to a full snapshot. Defaults to 10_000. */
  maxLogLength?: number;
  /** When true, broadcasts committed events to the sender as well as peers (tests duplicate/echo handling). */
  echoToSender?: boolean;
  /** Called with every committed event, before it is acknowledged or broadcast. */
  onCommit?: (event: ServerEvent) => void;
}

/**
 * Tiny authoritative in-process sync server for tests.
 * Validates ops with `@nb/ops` `parseOperation`, enforces idempotency per `opId`, runs optional
 * authorization, applies with `applyOp`/`applyBatch`, assigns stream `seq`, acks and broadcasts.
 */
export class FakeSyncServer {
  private _state: OpsState;
  private _seq = 0;
  private readonly log: ServerEvent[] = [];
  private readonly opResults = new Map<string, StoredOpResult>();
  private readonly clients = new Set<InProcessTransport>();
  private readonly revokedUsers = new Set<string>();
  private protocol: ProtocolRange;
  private readonly statuses?: readonly StatusDef[];
  private readonly clock: () => number;
  private authorize?: Authorize;
  private readonly maxLogLength: number;
  private readonly echoToSender: boolean;
  private readonly onCommit?: (event: ServerEvent) => void;
  private tick = 1_000_000;

  constructor(options: FakeSyncServerOptions = {}) {
    this._state = options.initialState ? structuredClone(options.initialState) : emptyState();
    this.protocol = options.protocol ?? SUPPORTED_PROTOCOL;
    this.statuses = options.statuses;
    this.clock = options.clock ?? (() => ++this.tick);
    this.authorize = options.authorize;
    this.maxLogLength = options.maxLogLength ?? 10_000;
    this.echoToSender = options.echoToSender ?? false;
    this.onCommit = options.onCommit;
  }

  get state(): OpsState {
    return this._state;
  }

  get seq(): number {
    return this._seq;
  }

  get cursor(): string {
    return formatCursor(this._seq);
  }

  /** Committed events still in the retained log, oldest first. */
  get history(): readonly ServerEvent[] {
    return this.log;
  }

  /** Updates the authorization callback (useful for testing permission changes over time). */
  setAuthorize(fn: Authorize | undefined): void {
    this.authorize = fn;
  }

  /** Changes the protocol versions accepted from new connections (simulates a server upgrade). */
  setProtocol(range: ProtocolRange): void {
    this.protocol = range;
  }

  /** Revokes a user's access immediately, notifying all of their active connections. */
  revokeAccess(userId: string, reason = 'Access removed'): void {
    this.revokedUsers.add(userId);
    for (const client of [...this.clients]) {
      if (client.actor.userId === userId) {
        client._deliver({ type: 'revoked', reason });
        client._forceDisconnect();
      }
    }
  }

  /** Restores a previously revoked user's access. */
  restoreAccess(userId: string): void {
    this.revokedUsers.delete(userId);
  }

  /** Creates an {@link InProcessTransport} bound to this server for `actor` in `laneId`. */
  createTransport(actor: OpsActor, laneId = 'lane-1'): InProcessTransport {
    return new InProcessTransport(this, actor, laneId);
  }

  /** @internal */
  _connect(client: InProcessTransport, handshake: SyncHandshake): void {
    if (this.revokedUsers.has(client.actor.userId)) {
      client._deliver({ type: 'revoked', reason: 'Access removed' });
      client._forceDisconnect();
      return;
    }
    const neg = negotiateProtocol(handshake.protocol, this.protocol);
    if (!neg.ok) {
      // Nothing can be exchanged without an agreed version: say why, then close the connection.
      client._deliver({ type: 'welcome', protocol: neg });
      client._forceDisconnect();
      return;
    }
    this.clients.add(client);
    const afterSeq = parseCursor(handshake.cursor);
    const earliestLogSeq = this.log[0]?.seq ?? this._seq + 1;
    if (afterSeq === null || (afterSeq < this._seq && afterSeq + 1 < earliestLogSeq)) {
      const appliedOpIds = [...this.opResults.entries()]
        .filter(([, v]) => v.message.type === 'ack')
        .map(([id]) => id);
      client._deliver({
        type: 'welcome',
        protocol: neg,
        snapshot: {
          state: structuredClone(this._state),
          cursor: formatCursor(this._seq),
          appliedOpIds,
        },
      });
      return;
    }
    const events = this.log.filter((e) => e.seq > afterSeq).map((e) => structuredClone(e));
    client._deliver({ type: 'welcome', protocol: neg, events });
  }

  /** @internal */
  _disconnect(client: InProcessTransport): void {
    this.clients.delete(client);
  }

  /** @internal */
  _receive(client: InProcessTransport, ops: readonly Operation[]): void {
    if (!ops.length) return;
    if (this.revokedUsers.has(client.actor.userId)) {
      client._deliver({ type: 'revoked', reason: 'Access removed' });
      client._forceDisconnect();
      return;
    }

    const opIds = ops.map((o) => o.opId);

    // 1. Idempotency check: if any opId was seen before, return the stored result (or refuse if the
    //    content changed, the sender differs, or the unit only partly matches the one first sent).
    const seen = ops.map((op) => this.opResults.get(op.opId));
    const first = seen.find((prev) => prev !== undefined);
    if (first) {
      const sameUnit = first.message.opIds.length === opIds.length && first.message.opIds.every((id, i) => id === opIds[i]);
      const reused = !sameUnit
        ? seen.findIndex((prev) => prev !== undefined)
        : ops.findIndex(
            (op, i) => seen[i]?.userId !== client.actor.userId || seen[i]?.fingerprint !== opFingerprint(op),
          );
      if (reused >= 0) {
        client._deliver({
          type: 'reject',
          opIds,
          failedOpId: ops[reused]!.opId,
          reason: { code: 'op_id_reused', opId: ops[reused]!.opId },
        });
        return;
      }
      client._deliver(structuredClone(first.message));
      return;
    }

    // 2. Validate shape with `@nb/ops`.
    const validated: Operation[] = [];
    for (const op of ops) {
      const parsed = parseOperation(op);
      if (!parsed.ok) {
        const msg: Extract<ServerMessage, { type: 'reject' }> = {
          type: 'reject',
          opIds,
          failedOpId: op.opId,
          reason: parsed.rejection,
        };
        this.recordResults(client.actor.userId, ops, msg);
        client._deliver(msg);
        return;
      }
      validated.push(parsed.op);
    }

    // 3. Authorization check (rules in force now).
    if (this.authorize) {
      for (const op of validated) {
        const verdict = this.authorize(client.actor, op, this._state, validated);
        if (verdict !== true) {
          const msg: Extract<ServerMessage, { type: 'reject' }> = {
            type: 'reject',
            opIds,
            failedOpId: op.opId,
            reason: verdict === false ? { code: 'forbidden' } : verdict,
          };
          this.recordResults(client.actor.userId, validated, msg);
          client._deliver(msg);
          return;
        }
      }
    }

    // 4. Apply with `@nb/ops` reducers.
    const serverTime = this.clock();
    const ctx: ApplyContext = {
      actor: client.actor,
      laneId: client.laneId,
      now: serverTime,
      ...(this.statuses ? { statuses: this.statuses } : {}),
    };

    let nextState: OpsState;
    if (validated.length === 1 && validated[0]!.batchId === undefined) {
      const result = applyOp(this._state, validated[0]!, ctx);
      if (!result.ok) {
        const msg: Extract<ServerMessage, { type: 'reject' }> = {
          type: 'reject',
          opIds,
          failedOpId: validated[0]!.opId,
          reason: result.rejection,
        };
        this.recordResults(client.actor.userId, validated, msg);
        client._deliver(msg);
        return;
      }
      nextState = result.state;
    } else {
      const result = applyBatch(this._state, validated, ctx);
      if (!result.ok) {
        const failed = validated[result.index] ?? validated[0]!;
        const reason: ServerRejection = result.rejection;
        const msg: Extract<ServerMessage, { type: 'reject' }> = {
          type: 'reject',
          opIds,
          failedOpId: failed.opId,
          reason,
        };
        this.recordResults(client.actor.userId, validated, msg);
        client._deliver(msg);
        return;
      }
      nextState = result.state;
    }

    // 5. Commit, assign seq, record idempotency result, ack sender, broadcast peers.
    this._state = nextState;
    this._seq += 1;
    const cursor = formatCursor(this._seq);
    const event: ServerEvent = {
      ops: structuredClone(validated),
      seq: this._seq,
      cursor,
      serverTime,
      actor: { ...client.actor },
      laneId: client.laneId,
    };
    this.log.push(event);
    this.onCommit?.(structuredClone(event));
    if (this.log.length > this.maxLogLength) {
      this.log.splice(0, this.log.length - this.maxLogLength);
    }

    const ackMsg: Extract<ServerMessage, { type: 'ack' }> = {
      type: 'ack',
      opIds,
      seq: this._seq,
      cursor,
      serverTime,
      actor: { ...client.actor },
      laneId: client.laneId,
    };
    this.recordResults(client.actor.userId, validated, ackMsg);
    client._deliver(structuredClone(ackMsg));

    for (const peer of [...this.clients]) {
      if (peer === client && !this.echoToSender) continue;
      peer._deliver({ type: 'event', event: structuredClone(event) });
    }
  }

  private recordResults(
    userId: string,
    ops: readonly Operation[],
    message: Extract<ServerMessage, { type: 'ack' | 'reject' }>,
  ): void {
    for (const op of ops) {
      this.opResults.set(op.opId, { userId, fingerprint: opFingerprint(op), message });
    }
  }
}

/**
 * In-process {@link SyncTransport} connected to a {@link FakeSyncServer}.
 * Includes fault hooks (`dropNextAck`, `duplicateNextMessage`) so tests can verify idempotency.
 */
export class InProcessTransport implements SyncTransport {
  private _state: TransportState = 'disconnected';
  private readonly messageListeners = new Set<(message: ServerMessage) => void>();
  private readonly stateListeners = new Set<(state: TransportState) => void>();
  private dropAcks = 0;
  private duplicateMessages = 0;
  private readonly server: FakeSyncServer;
  readonly actor: OpsActor;
  readonly laneId: string;

  constructor(server: FakeSyncServer, actor: OpsActor, laneId = 'lane-1') {
    this.server = server;
    this.actor = actor;
    this.laneId = laneId;
  }

  get state(): TransportState {
    return this._state;
  }

  /** Fault hook: drops the next `count` ack messages from the server before this client sees them. */
  dropNextAck(count = 1): void {
    this.dropAcks += count;
  }

  /** Fault hook: delivers the next `count` incoming server messages twice to this client. */
  duplicateNextMessage(count = 1): void {
    this.duplicateMessages += count;
  }

  connect(handshake: SyncHandshake): void {
    if (this._state === 'connected') return;
    this.setState('connecting');
    this.setState('connected');
    this.server._connect(this, handshake);
  }

  disconnect(): void {
    if (this._state === 'disconnected') return;
    this.server._disconnect(this);
    this.setState('disconnected');
  }

  send(ops: readonly Operation[]): void {
    if (this._state !== 'connected') return;
    this.server._receive(this, structuredClone(ops));
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(listener: (state: TransportState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** @internal */
  _deliver(message: ServerMessage): void {
    if (message.type === 'ack' && this.dropAcks > 0) {
      this.dropAcks -= 1;
      return;
    }
    const copies = this.duplicateMessages > 0 ? 2 : 1;
    if (this.duplicateMessages > 0) this.duplicateMessages -= 1;
    for (let i = 0; i < copies; i++) {
      for (const listener of [...this.messageListeners]) {
        listener(structuredClone(message));
      }
    }
  }

  /** @internal */
  _forceDisconnect(): void {
    this.server._disconnect(this);
    this.setState('disconnected');
  }

  private setState(next: TransportState): void {
    if (this._state === next) return;
    this._state = next;
    for (const listener of [...this.stateListeners]) listener(next);
  }
}
