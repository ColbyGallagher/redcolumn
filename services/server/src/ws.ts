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

export interface WsServerOptions {
  httpServer: HttpServer;
  config: ServerConfig;
  db: Kysely<Database>;
  pipeline: OpPipeline;
  broadcaster: Broadcaster;
  logger: Logger;
}

export interface WsHandle {
  wss: WebSocketServer;
  close: () => Promise<void>;
}

const STREAM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

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
  const { httpServer, config, db, pipeline, broadcaster, logger } = options;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxOpBytes + 16_384,
  });

  const alive = new WeakMap<WebSocket, boolean>();

  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, config.wsHeartbeatMs);
  heartbeatTimer.unref();

  const handleConnection = (ws: WebSocket, session: SessionInfo) => {
    alive.set(ws, true);
    ws.on('pong', () => {
      alive.set(ws, true);
    });

    const actor: Actor = { userId: session.user.id, partyId: null, groupId: null };
    const subscriptions = new Map<string, () => void>();
    let negotiatedVersion: number | null = null;

    const cleanup = () => {
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

    ws.on('message', async (raw) => {
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

      if (typed.type === 'subscribe') {
        const streamId = typeof typed.streamId === 'string' ? typed.streamId : '';
        if (!STREAM_ID_RE.test(streamId)) {
          sendJson(ws, { type: 'error', code: 'invalid_stream_id', message: 'Invalid streamId' });
          return;
        }
        if (!subscriptions.has(streamId)) {
          const unsubscribe = broadcaster.subscribe(streamId, (event) => {
            sendJson(ws, { type: 'event', event });
          });
          subscriptions.set(streamId, unsubscribe);
        }
        sendJson(ws, { type: 'subscribed', streamId });
        return;
      }

      if (typed.type === 'unsubscribe') {
        const streamId = typeof typed.streamId === 'string' ? typed.streamId : '';
        const unsubscribe = subscriptions.get(streamId);
        if (unsubscribe) {
          unsubscribe();
          subscriptions.delete(streamId);
        }
        sendJson(ws, { type: 'unsubscribed', streamId });
        return;
      }

      if (typed.type === 'op') {
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
        try {
          const ops = Array.isArray(typed.ops) ? typed.ops : [];
          const result = await pipeline.submitBatch(ops, actor, buf.byteLength);
          sendJson(ws, { type: 'batch_ack', result });
        } catch (err) {
          logger.error({ err, userId: session.user.id }, 'Failed to process operation batch');
          sendJson(ws, { type: 'error', code: 'internal_error', message: 'Failed to process operation batch' });
        }
        return;
      }

      sendJson(ws, { type: 'error', code: 'unknown_frame_type', message: `Unknown frame type "${typed.type}"` });
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
          handleConnection(ws, session);
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
