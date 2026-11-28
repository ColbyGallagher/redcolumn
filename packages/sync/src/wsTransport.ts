import type { Operation } from '@nb/ops';
import type { ServerMessage, SyncHandshake, SyncTransport, TransportState } from './types.ts';
import { MAX_OPEN_PENDING_IDS, WS_SESSION_ENDED, type ClientFrame, type PresenceUser, type ServerFrame, type StatusRules } from './wsProtocol.ts';

/** The parts of the browser's `WebSocket` the transport uses. */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface WsSyncTransportOptions {
  /** The server's WebSocket endpoint, such as `wss://host/ws`. */
  url: string;
  /**
   * Makes the socket. Defaults to the global `WebSocket`, which sends the session cookie to the
   * page's own server; a client outside a browser supplies one that adds it.
   */
  createSocket?: (url: string) => WebSocketLike;
  /** The first and longest wait before reconnecting. Waits double, with jitter. */
  backoff?: { minMs: number; maxMs: number };
  /** How often to check the connection is alive. */
  pingIntervalMs?: number;
  random?: () => number;
}

const DEFAULT_BACKOFF = { minMs: 500, maxMs: 15_000 };
const DEFAULT_PING_MS = 25_000;

/**
 * A {@link SyncTransport} for one document stream over the server's WebSocket. It reconnects with
 * backoff after an unexpected close, asking its owner to connect again (see
 * {@link WsSyncTransport.onReconnectDue}) so the handshake carries the newest cursor and pending
 * operations. `SyncDocument` then sends anything unanswered again with the same operation ids,
 * which the server applies at most once.
 *
 * It stops reconnecting when the protocol versions do not match, access is removed, or the
 * session ends.
 */
export class WsSyncTransport implements SyncTransport {
  private readonly options: WsSyncTransportOptions;
  private _state: TransportState = 'disconnected';
  private socket: WebSocketLike | null = null;
  /** The server accepted our protocol version on the current socket. */
  private greeted = false;
  private handshake: SyncHandshake | null = null;
  private wanted = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private heard = false;
  private silentPings = 0;
  private maxOpBytes = Number.POSITIVE_INFINITY;
  private pageIndex: number | null = null;
  private reconnect: (() => void) | null = null;
  private _connectionId: string | null = null;

  private readonly messageListeners = new Set<(message: ServerMessage) => void>();
  private readonly stateListeners = new Set<(state: TransportState) => void>();
  private readonly presenceListeners = new Set<(users: PresenceUser[]) => void>();
  private readonly accessListeners = new Set<(role: string, rules?: StatusRules) => void>();
  private readonly sessionEndedListeners = new Set<() => void>();

  constructor(options: WsSyncTransportOptions) {
    this.options = options;
  }

  get state(): TransportState {
    return this._state;
  }

  /** This connection's id in presence lists, while connected. */
  get connectionId(): string | null {
    return this._connectionId;
  }

  /** What to do when it is time to reconnect: normally `() => document.connect()`. */
  onReconnectDue(reconnect: () => void): void {
    this.reconnect = reconnect;
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(listener: (state: TransportState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Who else has the document open, this connection included. Empty while disconnected. */
  onPresence(listener: (users: PresenceUser[]) => void): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  /** The user's project role and what it lets them do, sent when the document opens and when it changes. */
  onAccess(listener: (role: string, rules?: StatusRules) => void): () => void {
    this.accessListeners.add(listener);
    return () => this.accessListeners.delete(listener);
  }

  /** The server ended the session: the user has to sign in again. */
  onSessionEnded(listener: () => void): () => void {
    this.sessionEndedListeners.add(listener);
    return () => this.sessionEndedListeners.delete(listener);
  }

  connect(handshake: SyncHandshake): void {
    this.handshake = handshake;
    this.wanted = true;
    this.clearRetry();
    if (!this.socket) this.openSocket();
    else if (this.greeted) this.sendOpen();
  }

  disconnect(): void {
    this.wanted = false;
    this.clearRetry();
    this.dropSocket();
  }

  /** Reconnects now instead of waiting, such as when the browser says it is online again. */
  retryNow(): void {
    if (!this.wanted || this.socket) return;
    this.clearRetry();
    this.attempts = 0;
    this.runReconnect();
  }

  /** Says which page this user is looking at, now and after every reconnect. */
  setPage(pageIndex: number): void {
    if (this.pageIndex === pageIndex) return;
    this.pageIndex = pageIndex;
    this.sendPage();
  }

  send(ops: readonly Operation[]): void {
    const first = ops[0];
    if (!first || !this.greeted || !this.handshake) return;
    const body = ops.length === 1 && first.batchId === undefined ? first : ops;
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > this.maxOpBytes) {
      // Sending it would only be refused again and again: it goes to the inbox instead.
      const opIds = ops.map((op) => op.opId);
      queueMicrotask(() =>
        this.deliver({
          type: 'reject',
          opIds,
          failedOpId: first.opId,
          reason: { code: 'invalid', message: 'Too large to send' },
        }),
      );
      return;
    }
    this.sendFrame({ type: 'send', streamId: this.handshake.streamId, ops });
  }

  private openSocket(): void {
    const create =
      this.options.createSocket ??
      ((url: string) => new (globalThis as unknown as { WebSocket: new (url: string) => WebSocketLike }).WebSocket(url));
    this.setState('connecting');
    let socket: WebSocketLike;
    try {
      socket = create(this.options.url);
    } catch {
      this.handleClose(1006);
      return;
    }
    this.socket = socket;
    this.greeted = false;
    socket.onopen = () => {
      if (this.socket !== socket || !this.handshake) return;
      this.sendFrame({ type: 'hello', protocol: this.handshake.protocol });
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.handleFrame(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.handleClose(event.code);
    };
    // A close event always follows an error.
    socket.onerror = () => undefined;
    this.startPing(socket);
  }

  private handleFrame(data: unknown): void {
    this.heard = true;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(String(data)) as ServerFrame;
    } catch {
      return;
    }
    switch (frame.type) {
      case 'welcome':
        this.greeted = true;
        this._connectionId = frame.connectionId;
        this.maxOpBytes = frame.maxOpBytes;
        this.setState('connected');
        this.sendOpen();
        return;
      case 'error':
        if (frame.code === 'client_too_old' || frame.code === 'client_too_new' || (frame.code === 'invalid' && frame.server)) {
          this.wanted = false;
          this.deliver({
            type: 'welcome',
            protocol: { ok: false, reason: frame.code, server: frame.server ?? { min: 0, max: 0 } },
          });
          this.dropSocket();
        }
        return;
      case 'sync':
        if (frame.streamId !== this.handshake?.streamId) return;
        if (frame.message.type === 'welcome') this.attempts = 0;
        if (frame.message.type === 'revoked') this.wanted = false;
        this.deliver(frame.message);
        if (frame.message.type === 'welcome') this.sendPage();
        if (frame.message.type === 'revoked') this.dropSocket();
        return;
      case 'presence':
        if (frame.streamId !== this.handshake?.streamId) return;
        for (const listener of [...this.presenceListeners]) listener(frame.users);
        return;
      case 'access':
        if (frame.streamId !== this.handshake?.streamId) return;
        for (const listener of [...this.accessListeners]) listener(frame.role, frame.rules);
        return;
    }
  }

  private sendOpen(): void {
    const handshake = this.handshake;
    if (!handshake) return;
    this.sendFrame({
      type: 'open',
      streamId: handshake.streamId,
      cursor: handshake.cursor,
      pendingOpIds: (handshake.pendingOpIds ?? []).slice(0, MAX_OPEN_PENDING_IDS),
    });
  }

  private sendPage(): void {
    if (this.greeted && this.handshake && this.pageIndex !== null) {
      this.sendFrame({ type: 'presence', streamId: this.handshake.streamId, pageIndex: this.pageIndex });
    }
  }

  private sendFrame(frame: ClientFrame): void {
    try {
      this.socket?.send(JSON.stringify(frame));
    } catch {
      // The socket is closing; what matters is resent after reconnecting.
    }
  }

  private deliver(message: ServerMessage): void {
    for (const listener of [...this.messageListeners]) listener(message);
  }

  private handleClose(code: number): void {
    this.releaseSocket();
    this.setState('disconnected');
    if (code === WS_SESSION_ENDED) {
      this.wanted = false;
      for (const listener of [...this.sessionEndedListeners]) listener();
      return;
    }
    if (this.wanted) this.scheduleRetry();
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.releaseSocket();
    try {
      socket?.close(1000);
    } catch {
      // Already closed.
    }
    this.setState('disconnected');
  }

  /** Forgets the socket, so nothing more it reports is acted on. */
  private releaseSocket(): void {
    const socket = this.socket;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = () => undefined;
    }
    this.socket = null;
    this.greeted = false;
    this._connectionId = null;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const listener of [...this.presenceListeners]) listener([]);
  }

  private startPing(socket: WebSocketLike): void {
    this.heard = false;
    this.silentPings = 0;
    this.pingTimer = setInterval(() => {
      if (this.socket !== socket) return;
      this.silentPings = this.heard ? 0 : this.silentPings + 1;
      this.heard = false;
      if (this.silentPings >= 2) {
        // A connection that has gone quiet may never report that it closed.
        this.dropSocket();
        if (this.wanted) this.scheduleRetry();
        return;
      }
      if (this.greeted) this.sendFrame({ type: 'ping' });
    }, this.options.pingIntervalMs ?? DEFAULT_PING_MS);
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const { minMs, maxMs } = this.options.backoff ?? DEFAULT_BACKOFF;
    const full = Math.min(maxMs, minMs * 2 ** Math.min(this.attempts, 20));
    const delay = full * (0.5 + (this.options.random ?? Math.random)() / 2);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted && !this.socket) this.runReconnect();
    }, delay);
  }

  private runReconnect(): void {
    if (this.reconnect) this.reconnect();
    else this.openSocket();
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setState(next: TransportState): void {
    if (this._state === next) return;
    this._state = next;
    for (const listener of [...this.stateListeners]) listener(next);
  }
}
