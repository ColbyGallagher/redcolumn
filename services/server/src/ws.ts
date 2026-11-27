import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { negotiateProtocol, type Actor, type ProtocolRange } from '@nb/ops';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { extractSessionToken, lookupSession, type SessionInfo } from './auth.ts';
import type { Broadcaster } from './broadcaster.ts';
import { isOriginAllowed, type ServerConfig } from './config.ts';
import type { Database } from './db.ts';
import type { OpPipeline } from './pipeline.ts';
import type { ReviewEvent, ReviewStore } from './reviewStore.ts';

export interface WsServerOptions {
  httpServer: HttpServer;
  config: ServerConfig;
  db: Kysely<Database>;
  pipeline: OpPipeline;
  broadcaster: Broadcaster;
  logger: Logger;
  reviewStore?: ReviewStore;
}

export interface WsHandle {
  wss: WebSocketServer;
  /** Closes every socket opened with this session. Call it when the session is revoked. */
  closeSession: (sessionId: string) => void;
  /** Re-checks every open socket's session now and closes those that are no longer valid. */
  revalidateSessions: () => Promise<void>;
  /** Fans out review events only to subscribed connections allowed by Postgres RLS. */
  publishReviewEvents: (events: readonly ReviewEvent[]) => Promise<void>;
  close: () => Promise<void>;
}

/** Close code sent when the socket's session is revoked, expired, or its user disabled. */
export const WS_CLOSE_SESSION_ENDED = 4401;

const STREAM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export type StreamAccess = 'read' | 'write';

/**
 * The one place stream access is decided. Stream-level access control is not enforced yet:
 * any signed-in user may read and write any stream. Deny here once stream permissions exist.
 */
export function authorizeStream(_actor: Actor, _streamId: string, _access: StreamAccess): boolean {
  return true;
}

interface Connection {
  session: SessionInfo;
  token: string;
  ended: boolean;
  subscribedStreams: Set<string>;
}

function writeHttpError(socket: Duplex, statusCode: number, reason: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function rawStreamId(op: unknown): string | null {
  if (op && typeof op === 'object' && typeof (op as { streamId?: unknown }).streamId === 'string') {
    return (op as { streamId: string }).streamId;
  }
  return null;
}

export function attachWebSocketServer(options: WsServerOptions): WsHandle {
  const { httpServer, config, db, pipeline, broadcaster, logger, reviewStore } = options;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxOpBytes + 16_384,
  });

  const alive = new WeakMap<WebSocket, boolean>();
  const connections = new Map<WebSocket, Connection>();

  const publishReviewEvents = async (events: readonly ReviewEvent[]): Promise<void> => {
    if (!reviewStore || events.length === 0) return;
    for (const ev of events) {
      for (const [ws, conn] of connections) {
        if (conn.ended || ws.readyState !== WebSocket.OPEN) continue;
        if (!conn.subscribedStreams.has(ev.streamId)) continue;
        try {
          const visible = await reviewStore.canUserSeeEvent(conn.session.user.id, ev.streamId, ev.seq);
          if (!visible || conn.ended || ws.readyState !== WebSocket.OPEN) continue;
          const cursor = reviewStore.sealStreamCursor(conn.session.user.id, ev.streamId, ev.seq);
          sendJson(ws, {
            type: 'event',
            event: {
              opId: ev.opId,
              opType: ev.opType,
              itemKind: ev.itemKind,
              entityId: ev.entityId,
              versionRev: ev.versionRev,
              payload: ev.payload,
              receivedAt: ev.receivedAt,
            },
            cursor,
          });
        } catch (err) {
          logger.warn({ err, userId: conn.session.user.id }, 'Failed to evaluate review event visibility');
        }
      }
    }
  };

  const endSession = (ws: WebSocket, conn: Connection) => {
    if (conn.ended) return;
    conn.ended = true;
    ws.close(WS_CLOSE_SESSION_ENDED, 'session_ended');
  };

  const revalidateSessions = async () => {
    await Promise.all(
      [...connections].map(async ([ws, conn]) => {
        if (conn.ended) return;
        try {
          const current = await lookupSession(db, conn.token);
          if (!current || current.sessionId !== conn.session.sessionId) endSession(ws, conn);
        } catch (err) {
          logger.warn({ err, userId: conn.session.user.id }, 'Failed to re-check WebSocket session');
        }
      }),
    );
  };

  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
    // Logout on this server closes sockets at once (closeSession). This catches sessions that
    // expired, were revoked elsewhere, or whose user was disabled.
    void revalidateSessions();
  }, config.wsHeartbeatMs);
  heartbeatTimer.unref();

  const handleConnection = (ws: WebSocket, session: SessionInfo, token: string) => {
    alive.set(ws, true);
    ws.on('pong', () => {
      alive.set(ws, true);
    });

    const conn: Connection = { session, token, ended: false, subscribedStreams: new Set() };
    connections.set(ws, conn);

    const actor: Actor = { userId: session.user.id, partyId: null, groupId: null };
    const subscriptions = new Map<string, () => void>();
    let negotiatedVersion: number | null = null;

    const cleanup = () => {
      connections.delete(ws);
      conn.subscribedStreams.clear();
      for (const unsubscribe of subscriptions.values()) {
        unsubscribe();
      }
      subscriptions.clear();
    };

    ws.on('close', cleanup);
    ws.on('error', (err) => {
      logger.warn({ err, userId: session.user.id }, 'WebSocket connection error');
      cleanup();
    });

    const handleMessage = async (raw: RawData) => {
      if (conn.ended || ws.readyState !== WebSocket.OPEN) return;
      if (conn.session.expiresAt.getTime() <= Date.now()) {
        endSession(ws, conn);
        return;
      }

      const buf = rawDataToBuffer(raw);
      let frame: unknown;
      try {
        frame = JSON.parse(buf.toString('utf8'));
      } catch {
        sendJson(ws, { type: 'error', code: 'invalid_json', message: 'Frame must be valid JSON' });
        return;
      }

      if (!frame || typeof frame !== 'object' || !('type' in frame) || typeof (frame as { type: unknown }).type !== 'string') {
        sendJson(ws, { type: 'error', code: 'invalid_frame', message: 'Frame must have a string type' });
        return;
      }

      const typed = frame as Record<string, unknown>;

      if (typed.type === 'ping') {
        sendJson(ws, { type: 'pong' });
        return;
      }

      if (typed.type === 'hello') {
        const result = negotiateProtocol(typed.protocol as ProtocolRange);
        if (!result.ok) {
          sendJson(ws, { type: 'error', code: result.reason, server: result.server });
          ws.close(1008, result.reason);
          return;
        }
        negotiatedVersion = result.version;
        sendJson(ws, {
          type: 'welcome',
          protocolVersion: result.version,
          user: session.user,
        });
        return;
      }

      if (negotiatedVersion === null) {
        sendJson(ws, { type: 'error', code: 'handshake_required', message: 'Send a hello frame before other messages' });
        return;
      }

      const forbidden = (streamId: string) =>
        sendJson(ws, { type: 'error', code: 'forbidden', streamId, message: 'Not allowed on this stream' });

      if (typed.type === 'subscribe') {
        const streamId = typeof typed.streamId === 'string' ? typed.streamId : '';
        if (!STREAM_ID_RE.test(streamId)) {
          sendJson(ws, { type: 'error', code: 'invalid_stream_id', message: 'Invalid streamId' });
          return;
        }
        if (!authorizeStream(actor, streamId, 'read')) {
          forbidden(streamId);
          return;
        }
        conn.subscribedStreams.add(streamId);
        if (!subscriptions.has(streamId) && !reviewStore?.resolveStreamScope(streamId)) {
          const unsubscribe = broadcaster.subscribe(streamId, (event) => {
            if (!conn.ended) sendJson(ws, { type: 'event', event });
          });
          subscriptions.set(streamId, unsubscribe);
        }
        sendJson(ws, { type: 'subscribed', streamId });
        return;
      }

      if (typed.type === 'unsubscribe') {
        const streamId = typeof typed.streamId === 'string' ? typed.streamId : '';
        conn.subscribedStreams.delete(streamId);
        const unsubscribe = subscriptions.get(streamId);
        if (unsubscribe) {
          unsubscribe();
          subscriptions.delete(streamId);
        }
        sendJson(ws, { type: 'unsubscribed', streamId });
        return;
      }

      if (typed.type === 'sync') {
        if (!reviewStore) {
          sendJson(ws, { type: 'error', code: 'unsupported', message: 'Sync feed is not configured' });
          return;
        }
        const streamId = typeof typed.streamId === 'string' ? typed.streamId : '';
        if (!STREAM_ID_RE.test(streamId)) {
          sendJson(ws, { type: 'error', code: 'invalid_stream_id', message: 'Invalid streamId' });
          return;
        }
        const cursor = typeof typed.cursor === 'string' ? typed.cursor : null;
        try {
          const feed = await reviewStore.readSyncFeed(streamId, session.user.id, cursor);
          if (!feed.ok) {
            sendJson(ws, { type: 'error', code: 'invalid_cursor', message: 'Invalid cursor' });
            return;
          }
          sendJson(ws, { type: 'sync_result', streamId, events: feed.events, cursor: feed.cursor });
        } catch (err) {
          logger.error({ err, userId: session.user.id }, 'Failed to read sync feed');
          sendJson(ws, { type: 'error', code: 'internal_error', message: 'Failed to read sync feed' });
        }
        return;
      }

      if (typed.type === 'op') {
        const streamId = rawStreamId(typed.op);
        if (streamId !== null && !authorizeStream(actor, streamId, 'write')) {
          forbidden(streamId);
          return;
        }
        const reviewScope = streamId !== null ? reviewStore?.resolveStreamScope(streamId) : null;
        if (reviewStore && reviewScope) {
          const opId =
            typed.op && typeof typed.op === 'object' && typeof (typed.op as { opId?: unknown }).opId === 'string'
              ? (typed.op as { opId: string }).opId
              : null;
          try {
            const outcome = await reviewStore.submitOperation(reviewScope.scopeId, session.user.id, typed.op);
            if (!outcome.ok) {
              const rejection =
                outcome.code === 'not_found'
                  ? { code: 'not_found', message: 'Not found' }
                  : { code: outcome.code, message: outcome.error };
              sendJson(ws, { type: 'ack', result: { ok: false, opId, rejection } });
              return;
            }
            sendJson(ws, { type: 'ack', result: { ok: true, opId, streamId } });
            if (outcome.events.length > 0) {
              await publishReviewEvents(outcome.events);
            }
          } catch (err) {
            logger.error({ err, userId: session.user.id }, 'Failed to process review operation');
            sendJson(ws, { type: 'error', code: 'internal_error', message: 'Failed to process operation' });
          }
          return;
        }
        try {
          const result = await pipeline.submitOperation(typed.op, actor, buf.byteLength);
          sendJson(ws, { type: 'ack', result });
        } catch (err) {
          logger.error({ err, userId: session.user.id }, 'Failed to process operation');
          sendJson(ws, { type: 'error', code: 'internal_error', message: 'Failed to process operation' });
        }
        return;
      }

      if (typed.type === 'batch') {
        const ops = Array.isArray(typed.ops) ? typed.ops : [];
        for (const op of ops) {
          const streamId = rawStreamId(op);
          if (streamId !== null && !authorizeStream(actor, streamId, 'write')) {
            forbidden(streamId);
            return;
          }
        }
        try {
          const result = await pipeline.submitBatch(ops, actor, buf.byteLength);
          sendJson(ws, { type: 'batch_ack', result });
        } catch (err) {
          logger.error({ err, userId: session.user.id }, 'Failed to process operation batch');
          sendJson(ws, { type: 'error', code: 'internal_error', message: 'Failed to process operation batch' });
        }
        return;
      }

      sendJson(ws, { type: 'error', code: 'unknown_frame_type', message: `Unknown frame type "${typed.type}"` });
    };

    // Frames on one connection are handled strictly in arrival order, so an op sent right after
    // another (a patch after its create) never overtakes it, and acks come back in order.
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (raw) => {
      queue = queue
        .then(() => handleMessage(raw))
        .catch((err) => {
          logger.error({ err, userId: session.user.id }, 'Failed to handle WebSocket frame');
        });
    });
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname: string;
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      pathname = url.pathname;
    } catch {
      writeHttpError(socket, 400, 'Bad Request');
      return;
    }

    if (pathname !== '/ws') {
      writeHttpError(socket, 404, 'Not Found');
      return;
    }

    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, config.allowedOrigins, req.headers.host, { allowMissingOrigin: true })) {
      logger.warn({ origin, host: req.headers.host }, 'Rejected WebSocket upgrade with disallowed origin');
      writeHttpError(socket, 403, 'Forbidden');
      return;
    }

    const token = extractSessionToken(req.headers, config.sessionCookieName);
    if (!token) {
      writeHttpError(socket, 401, 'Unauthorized');
      return;
    }

    lookupSession(db, token)
      .then((session) => {
        if (!session) {
          writeHttpError(socket, 401, 'Unauthorized');
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          handleConnection(ws, session, token);
        });
      })
      .catch((err) => {
        logger.error({ err }, 'Error authenticating WebSocket upgrade');
        writeHttpError(socket, 500, 'Internal Server Error');
      });
  };

  httpServer.on('upgrade', onUpgrade);

  return {
    wss,
    closeSession: (sessionId) => {
      for (const [ws, conn] of connections) {
        if (conn.session.sessionId === sessionId) endSession(ws, conn);
      }
    },
    revalidateSessions,
    publishReviewEvents,
    close: async () => {
      clearInterval(heartbeatTimer);
      httpServer.off('upgrade', onUpgrade);
      for (const client of wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
