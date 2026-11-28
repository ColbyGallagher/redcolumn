import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
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
import { LocalDiskBlobStore, type BlobStore } from './blobStore.ts';
import { InProcessBroadcaster, type Broadcaster } from './broadcaster.ts';
import { isOriginAllowed, type ServerConfig } from './config.ts';
import { checkDbConnection, type Database } from './db.ts';
import { registerDocumentRoutes } from './documentRoutes.ts';
import { acceptInvite, listAccessibleSessions, previewInvite } from './invites.ts';
import { createLogger } from './logger.ts';
import { InProcessJobRunner, registerPdfJobs, type JobRunner } from './pdfJob.ts';
import { OpPipeline, type OpPipelineHooks } from './pipeline.ts';
import { registerProjectRoutes } from './projectRoutes.ts';
import { registerStaticWebApp } from './static.ts';
import { SyncHub } from './syncHub.ts';
import { registerUploadRoutes } from './uploadRoutes.ts';
import { attachWebSocketServer, type WsHandle } from './ws.ts';

const SERVER_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function resolveRequestOrigin(request: FastifyRequest, config: ServerConfig): string {
  if (config.publicOrigin) return config.publicOrigin;
  if (config.allowedOrigins.length === 1) return config.allowedOrigins[0]!;
  const forwardedProto = request.headers['x-forwarded-proto'];
  const rawProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = rawProto === 'https' || rawProto === 'http' ? rawProto : request.protocol;
  const host = request.headers.host || `${config.host}:${config.port}`;
  return `${proto}://${host}`;
}

export interface BuildServerOptions {
  config: ServerConfig;
  db: Kysely<Database>;
  pool: pg.Pool;
  logger?: Logger;
  broadcaster?: Broadcaster;
  pipelineHooks?: OpPipelineHooks;
  blobStore?: BlobStore;
  jobRunner?: JobRunner;
}

export interface ServerInstance {
  app: FastifyInstance<HttpServer, IncomingMessage, ServerResponse, Logger>;
  broadcaster: Broadcaster;
  pipeline: OpPipeline;
  ws: WsHandle;
  blobStore: BlobStore;
  jobRunner: JobRunner;
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

  const blobStore = options.blobStore ?? new LocalDiskBlobStore(config.blobDir);
  const jobRunner =
    options.jobRunner ??
    new InProcessJobRunner({
      onError: (err, job) => logger.error({ err, jobId: job.id, jobName: job.name }, 'Background job failed'),
    });
  registerPdfJobs(jobRunner, { db, blobStore, logger });

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

  app.get('/config.json', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      mode: 'server' as const,
      origin: resolveRequestOrigin(request, config),
      version: SERVER_VERSION,
      auth: { local: true },
    };
  });

  const hub = new SyncHub({ db, pool, pipeline, broadcaster, logger });
  const ws = attachWebSocketServer({
    httpServer: app.server,
    config,
    db,
    hub,
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

    auth.get<{ Params: { token: string } }>(
      '/api/invites/:token',
      {
        config: {
          rateLimit: {
            max: config.loginRateLimitMax * 2,
            timeWindow: config.loginRateLimitWindowMs,
            keyGenerator: (request) => request.ip,
          },
        },
      },
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const result = await previewInvite(db, request.params.token);
        if (!result.ok) {
          const status =
            result.code === 'invite_expired' || result.code === 'invite_revoked'
              ? 410
              : result.code === 'invite_already_accepted'
                ? 409
                : 404;
          return reply.code(status).send({ error: result.code });
        }
        return reply.code(200).send({ invite: result.invite });
      },
    );

    auth.post<{ Params: { token: string }; Body: { email?: unknown; name?: unknown; password?: unknown } }>(
      '/api/invites/:token/accept',
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
        const sessionToken = extractSessionToken(request.headers, config.sessionCookieName);
        const existingSession = sessionToken ? await lookupSession(db, sessionToken) : null;

        const email = typeof request.body?.email === 'string' ? request.body.email : undefined;
        const name = typeof request.body?.name === 'string' ? request.body.name : undefined;
        const password = typeof request.body?.password === 'string' ? request.body.password : undefined;

        const result = await acceptInvite(db, request.params.token, {
          signedInUser: existingSession?.user ?? null,
          email,
          name,
          password,
          sessionTtlMs: config.sessionTtlMs,
        });

        if (!result.ok) {
          return reply.code(result.status).send({ error: result.code });
        }

        if (result.session) {
          reply.header(
            'Set-Cookie',
            formatSessionCookie(config.sessionCookieName, result.session.token, {
              secure: config.cookieSecure,
              maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
            }),
          );
          return reply.code(200).send({
            ok: true,
            user: result.user,
            sessionId: result.session.sessionId,
            expiresAt: result.session.expiresAt.toISOString(),
          });
        }

        return reply.code(200).send({ ok: true, user: result.user });
      },
    );

    auth.get('/api/sessions', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const token = extractSessionToken(request.headers, config.sessionCookieName);
      if (!token) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const session = await lookupSession(db, token);
      if (!session) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const data = await listAccessibleSessions(db, session.user);
      return reply.code(200).send(data);
    });

    // A removed member stops receiving a project's documents at once.
    registerProjectRoutes(auth, db, config, {
      onMembershipChanged: () => {
        ws.revalidateAccess().catch((err: unknown) => logger.warn({ err }, 'Failed to re-check document access'));
      },
    });
    registerDocumentRoutes(auth, { config, db, blobStore });
  });

  if (config.webDistDir) {
    const mounted = registerStaticWebApp(app, config.webDistDir);
    if (!mounted) {
      logger.warn({ webDistDir: config.webDistDir }, 'WEB_DIST_DIR does not exist or is not a directory; skipping static web serving');
    }
  }
  app.register(async (uploads) => {
    await registerUploadRoutes(uploads, { config, db, blobStore, jobRunner });
  });

  app.addHook('onClose', async () => {
    await jobRunner.close();
    await ws.close();
  });

  return { app, broadcaster, pipeline, ws, blobStore, jobRunner };
}
