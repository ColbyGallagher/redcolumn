import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { ItemKind } from '@nb/ops';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { extractSessionToken, lookupSession, type SessionInfo } from './auth.ts';
import type { ServerConfig } from './config.ts';
import type { Database } from './db.ts';
import type { ReviewEvent, ReviewStore, SeedProjectFixture } from './reviewStore.ts';

const VALID_ITEM_KINDS = new Set<string>(['markup', 'placement', 'issue', 'response', 'statusEvent']);

export interface RegisterReviewRoutesOptions {
  app: FastifyInstance<HttpServer, IncomingMessage, ServerResponse, Logger>;
  db: Kysely<Database>;
  config: ServerConfig;
  reviewStore: ReviewStore;
  onReviewEvents: (events: readonly ReviewEvent[]) => void;
}

const UNIFORM_NOT_FOUND = { error: 'not_found' } as const;

export function registerReviewRoutes(options: RegisterReviewRoutesOptions): void {
  const { app, db, config, reviewStore, onReviewEvents } = options;

  async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<SessionInfo | null> {
    const token = extractSessionToken(request.headers, config.sessionCookieName);
    if (!token) {
      reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    const session = await lookupSession(db, token);
    if (!session) {
      reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    return session;
  }

  app.post<{ Body: SeedProjectFixture }>('/api/projects/seed', async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    if (!session.user.isAdmin) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const scopeId = request.body?.process?.id;
    if (
      typeof scopeId !== 'string' ||
      scopeId.length === 0 ||
      scopeId === '__proto__' ||
      scopeId === 'constructor' ||
      scopeId === 'prototype'
    ) {
      return reply.code(400).send({ error: 'invalid_scope_id' });
    }
    const result = await reviewStore.seedFixture(request.body);
    return reply.code(201).send(result);
  });

  app.post<{ Params: { scopeId: string }; Body: unknown }>('/api/scopes/:scopeId/ops', async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const outcome = await reviewStore.submitOperation(request.params.scopeId, session.user.id, request.body);
    if (!outcome.ok) {
      if (outcome.status === 404) return reply.code(404).send(UNIFORM_NOT_FOUND);
      return reply.code(outcome.status).send({ error: outcome.error });
    }
    if (outcome.events.length > 0) {
      onReviewEvents(outcome.events);
    }
    return reply.code(outcome.status).send(outcome.data);
  });

  app.post<{ Params: { scopeId: string }; Body: unknown }>(
    '/api/scopes/:scopeId/actions',
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      const outcome = await reviewStore.submitAction(request.params.scopeId, session.user.id, request.body);
      if (!outcome.ok) {
        if (outcome.status === 404) return reply.code(404).send(UNIFORM_NOT_FOUND);
        return reply.code(outcome.status).send({ error: outcome.error });
      }
      if (outcome.events.length > 0) {
        onReviewEvents(outcome.events);
      }
      return reply.code(outcome.status).send(outcome.data);
    },
  );

  app.post<{
    Params: { scopeId: string };
    Body: { itemKind: ItemKind; itemId: string; filename: string; mediaType: string; contentBase64: string };
  }>('/api/scopes/:scopeId/assets', async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const body = request.body;
    if (
      !body ||
      !VALID_ITEM_KINDS.has(body.itemKind) ||
      typeof body.itemId !== 'string' ||
      typeof body.filename !== 'string' ||
      typeof body.mediaType !== 'string' ||
      typeof body.contentBase64 !== 'string'
    ) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const outcome = await reviewStore.uploadAsset(request.params.scopeId, session.user.id, body);
    if (!outcome.ok) {
      if (outcome.status === 404) return reply.code(404).send(UNIFORM_NOT_FOUND);
      return reply.code(outcome.status).send({ error: outcome.error });
    }
    return reply.code(outcome.status).send(outcome.data);
  });

  app.get<{ Params: { projectId: string; sha256: string } }>(
    '/api/projects/:projectId/assets/:sha256',
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      const asset = await reviewStore.getAsset(request.params.projectId, request.params.sha256, session.user.id);
      if (!asset) {
        return reply.code(404).send(UNIFORM_NOT_FOUND);
      }
      return reply.code(200).send(asset);
    },
  );

  app.get<{ Params: { scopeId: string } }>('/api/scopes/:scopeId/items', async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const items = await reviewStore.listItems(request.params.scopeId, session.user.id);
    return reply.code(200).send({ items });
  });

  app.get<{ Params: { scopeId: string; kind: string; id: string } }>(
    '/api/scopes/:scopeId/items/:kind/:id',
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      if (!VALID_ITEM_KINDS.has(request.params.kind)) {
        return reply.code(404).send(UNIFORM_NOT_FOUND);
      }
      const item = await reviewStore.getItem(
        request.params.scopeId,
        session.user.id,
        request.params.kind as ItemKind,
        request.params.id,
      );
      if (!item) {
        return reply.code(404).send(UNIFORM_NOT_FOUND);
      }
      return reply.code(200).send({ item });
    },
  );

  app.get<{ Params: { scopeId: string } }>('/api/scopes/:scopeId/counts', async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return;
    const counts = await reviewStore.getCounts(request.params.scopeId, session.user.id);
    return reply.code(200).send(counts);
  });

  app.get<{ Params: { scopeId: string }; Querystring: { q?: string } }>(
    '/api/scopes/:scopeId/search',
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      const q = typeof request.query?.q === 'string' ? request.query.q : '';
      const results = await reviewStore.searchItems(request.params.scopeId, session.user.id, q);
      return reply.code(200).send({ results });
    },
  );

  app.post<{ Params: { scopeId: string }; Body: { q?: string } }>(
    '/api/scopes/:scopeId/search',
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      const q = typeof request.body?.q === 'string' ? request.body.q : '';
      const results = await reviewStore.searchItems(request.params.scopeId, session.user.id, q);
      return reply.code(200).send({ results });
    },
  );

  app.get<{ Params: { scopeId: string }; Querystring: { format?: string } }>(
    '/api/scopes/:scopeId/register',
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      const rawFmt = request.query?.format;
      const format = rawFmt === 'csv' || rawFmt === 'text' ? rawFmt : 'json';
      const exported = await reviewStore.exportRegister(request.params.scopeId, session.user.id, format);
      return reply.code(200).type(exported.contentType).send(exported.body);
    },
  );

  app.get<{ Params: { streamId: string }; Querystring: { cursor?: string } }>(
    '/api/streams/:streamId/feed',
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      const cursor = typeof request.query?.cursor === 'string' ? request.query.cursor : null;
      const feed = await reviewStore.readSyncFeed(request.params.streamId, session.user.id, cursor);
      if (!feed.ok) {
        return reply.code(400).send({ error: 'invalid_cursor' });
      }
      return reply.code(200).send({ events: feed.events, cursor: feed.cursor });
    },
  );
}
