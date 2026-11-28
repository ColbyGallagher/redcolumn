import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { negotiateProtocol, SUPPORTED_PROTOCOL, type ProtocolRange } from '@nb/ops';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { extractSessionToken, lookupSession, type SessionInfo } from './auth.ts';
import { isOriginAllowed, type ServerConfig } from './config.ts';
import type { Database } from './db.ts';
import type { SyncHub } from './syncHub.ts';

export interface WsServerOptions {
  httpServer: HttpServer;
  config: ServerConfig;
  db: Kysely<Database>;
  hub: SyncHub;
  logger: Logger;
}

export interface WsHandle {
  wss: WebSocketServer;
  /** Closes every socket opened with this session. Call it when the session is revoked. */
  closeSession: (sessionId: string) => void;
  /** Re-checks every open socket's session now and closes those that are no longer valid. */
  revalidateSessions: () => Promise<void>;
  /** Re-checks every open document stream now. Call it when memberships or roles change. */
  revalidateAccess: () => Promise<void>;
  close: () => Promise<void>;
}

/** Close code sent when the socket's session is revoked, expired, or its user disabled. */
export const WS_CLOSE_SESSION_ENDED = 4401;

const STREAM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** The most pending operation ids an open frame may list; clients send no more. */
const MAX_OPEN_PENDING_IDS = 4000;

interface Connection {
  session: SessionInfo;
  token: string;
  ended: boolean;
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

export function attachWebSocketServer(options: WsServerOptions): WsHandle {
  const { httpServer, config, db, hub, logger } = options;

  const wss = new WebSocketServer({
    noServer: true,
    // Room for the largest operation or batch with its frame, and always for a full open frame.
    maxPayload: Math.max(config.maxOpBytes + 16_384, config.maxBatchBytes + 16_384, MAX_OPEN_PENDING_IDS * 64),
  });

  const alive = new WeakMap<WebSocket, boolean>();
  const connections = new Map<WebSocket, Connection>();

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
    void hub.revalidate();
  }, config.wsHeartbeatMs);
  heartbeatTimer.unref();

  const handleConnection = (ws: WebSocket, session: SessionInfo, token: string) => {
    alive.set(ws, true);
    ws.on('pong', () => {
      alive.set(ws, true);
    });

    const conn: Connection = { session, token, ended: false };
    connections.set(ws, conn);

    const connectionId = randomUUID();
    const sync = hub.createSession({
      id: connectionId,
      user: { id: session.user.id, name: session.user.name },
      send: (frame) => {
        if (!conn.ended) sendJson(ws, frame);
      },
      close: () => ws.close(1011, 'internal_error'),
    });
    let negotiatedVersion: number | null = null;

    const cleanup = () => {
      connections.delete(ws);
      sync.dispose();
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
          connectionId,
          maxOpBytes: config.maxOpBytes,
          maxBatchBytes: config.maxBatchBytes,
        });
        return;
      }

      if (negotiatedVersion === null) {
        sendJson(ws, { type: 'error', code: 'handshake_required', message: 'Send a hello frame before other messages' });
        return;
      }

      if (typed.type === 'open' || typed.type === 'send' || typed.type === 'presence' || typed.type === 'close') {
        const streamId = typeof typed.streamId === 'string' ? typed.streamId : '';
        if (!STREAM_ID_RE.test(streamId)) {
          sendJson(ws, { type: 'error', code: 'invalid_stream_id', message: 'Invalid streamId' });
          return;
        }
        try {
          if (typed.type === 'open') {
            const cursor = typeof typed.cursor === 'string' ? typed.cursor : null;
            const pending = Array.isArray(typed.pendingOpIds)
              ? typed.pendingOpIds.filter((id): id is string => typeof id === 'string' && STREAM_ID_RE.test(id))
              : [];
            await sync.open(streamId, cursor, pending.slice(0, MAX_OPEN_PENDING_IDS), {
              ...SUPPORTED_PROTOCOL,
              version: negotiatedVersion,
            });
          } else if (typed.type === 'send') {
            await sync.submit(streamId, typed.ops);
          } else if (typed.type === 'presence') {
            sync.setPage(streamId, typed.pageIndex);
          } else {
            sync.close(streamId);
          }
        } catch (err) {
          logger.error({ err, userId: session.user.id, frame: typed.type }, 'Failed to handle sync frame');
          // The client reconnects and sends anything unanswered again.
          sendJson(ws, { type: 'error', code: 'internal_error', streamId, message: 'Failed to process the message' });
          ws.close(1011, 'internal_error');
        }
        return;
      }

      sendJson(ws, { type: 'error', code: 'unknown_frame_type', message: `Unknown frame type "${typed.type}"` });
    };

    // Frames on one connection are handled strictly in arrival order, so an op sent right after
    // another (a patch after its create) never overtakes it, and acks come back in order.
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (raw) => {
      queue = hub.track(
        queue
          .then(() => handleMessage(raw))
          .catch((err) => {
            logger.error({ err, userId: session.user.id }, 'Failed to handle WebSocket frame');
          }),
      );
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
    revalidateAccess: () => hub.revalidate(),
    close: async () => {
      clearInterval(heartbeatTimer);
      httpServer.off('upgrade', onUpgrade);
      for (const client of wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await hub.close();
    },
  };
}
