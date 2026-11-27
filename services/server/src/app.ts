import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import type { Logger } from 'pino';
import {
  authenticateLocalUser,
  createSession,
  extractSessionToken,
  formatClearSessionCookie,
  formatSessionCookie,
  lookupSession,
  revokeSession,
} from './auth.ts';
import { InProcessBroadcaster, type Broadcaster } from './broadcaster.ts';
import { isOriginAllowed, type ServerConfig } from './config.ts';
import { checkDbConnection, type Database } from './db.ts';
import { createLogger } from './logger.ts';
import { OpPipeline, type OpPipelineHooks } from './pipeline.ts';
import { attachWebSocketServer, type WsHandle } from './ws.ts';

export interface BuildServerOptions {
  config: ServerConfig;
  db: Kysely<Database>;
  pool: pg.Pool;
  logger?: Logger;
  broadcaster?: Broadcaster;
  pipelineHooks?: OpPipelineHooks;
}

export interface ServerInstance {
  app: FastifyInstance<HttpServer, IncomingMessage, ServerResponse, Logger>;
  broadcaster: Broadcaster;
  pipeline: OpPipeline;
  ws: WsHandle;
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function buildServer(options: BuildServerOptions): ServerInstance {
  const { config, db, pool } = options;
  const logger = options.logger ?? createLogger(config.logLevel);
  const broadcaster =
    options.broadcaster ??
    new InProcessBroadcaster({
      onError: (err, event) => logger.error({ err, streamId: event.streamId, seq: event.seq }, 'Broadcast listener failed'),
    });

  const pipeline = new OpPipeline({
    db,
    broadcaster,
    maxOpBytes: config.maxOpBytes,
    hooks: options.pipelineHooks,
  });

  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
  });

  // Origin check for CSRF protection on state-changing HTTP requests.
  app.addHook('onRequest', async (request, reply) => {
    if (!STATE_CHANGING_METHODS.has(request.method)) return;
    const originHeader = request.headers.origin;
    if (originHeader !== undefined) {
      if (!isOriginAllowed(originHeader, config.allowedOrigins, request.headers.host)) {
        return reply.code(403).send({ error: 'origin_not_allowed' });
      }
      return;
    }
    const refererHeader = request.headers.referer;
    if (refererHeader !== undefined) {
      let refererOrigin: string | undefined;
      try {
        refererOrigin = new URL(refererHeader).origin;
      } catch {
        return reply.code(403).send({ error: 'origin_not_allowed' });
      }
      if (!isOriginAllowed(refererOrigin, config.allowedOrigins, request.headers.host)) {
        return reply.code(403).send({ error: 'origin_not_allowed' });
      }
    }
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (_request, reply) => {
    const ok = await checkDbConnection(pool);
    if (!ok) {
      return reply.code(503).send({ ok: false, error: 'database_unavailable' });
    }
    return { ok: true };
  });

  const ws = attachWebSocketServer({
    httpServer: app.server,
    config,
    db,
    pipeline,
    broadcaster,
    logger,
  });

  // Routes opt in to rate limiting with `config.rateLimit`. The limit keys on `request.ip`,
  // which is the socket address unless Fastify's trustProxy is configured.
  app.register(rateLimit, { global: false });

  // Registered as a plugin so it loads after the rate-limit plugin and its routes get the hook.
  app.register(async (auth) => {
    auth.post<{ Body: { email?: unknown; password?: unknown } }>(
      '/auth/login',
      {
        config: {
          rateLimit: {
            max: config.loginRateLimitMax,
            timeWindow: config.loginRateLimitWindowMs,
            keyGenerator: (request) => request.ip,
          },
        },
      },
      async (request, reply) => {
        const email = typeof request.body?.email === 'string' ? request.body.email : '';
        const password = typeof request.body?.password === 'string' ? request.body.password : '';
        if (!email || !password) {
          return reply.code(400).send({ error: 'invalid_request' });
        }

        const user = await authenticateLocalUser(db, email, password);
        if (!user) {
          return reply.code(401).send({ error: 'invalid_credentials' });
        }

        const session = await createSession(db, user.id, config.sessionTtlMs);
        reply.header(
          'Set-Cookie',
          formatSessionCookie(config.sessionCookieName, session.token, {
            secure: config.cookieSecure,
            maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
          }),
        );

        return reply.code(200).send({
          user,
          sessionId: session.sessionId,
          expiresAt: session.expiresAt.toISOString(),
        });
      },
    );

    auth.post('/auth/logout', async (request, reply) => {
      const token = extractSessionToken(request.headers, config.sessionCookieName);
      if (token) {
        const sessionId = await revokeSession(db, token);
        if (sessionId) ws.closeSession(sessionId);
      }
      reply.header(
        'Set-Cookie',
        formatClearSessionCookie(config.sessionCookieName, { secure: config.cookieSecure }),
      );
      return reply.code(200).send({ ok: true });
    });

    auth.get('/auth/me', async (request, reply) => {
      const token = extractSessionToken(request.headers, config.sessionCookieName);
      if (!token) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const session = await lookupSession(db, token);
      if (!session) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      return { user: session.user };
    });
  });

  app.addHook('onClose', async () => {
    await ws.close();
  });

  return { app, broadcaster, pipeline, ws };
}
