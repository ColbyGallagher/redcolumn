import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { extractSessionToken, lookupSession, type UserProfile } from './auth.ts';
import type { ServerConfig } from './config.ts';
import type { Database } from './db.ts';
import {
  createProject,
  createProjectInvite,
  getProjectForMember,
  listProjectMembers,
  removeProjectMember,
  revokeProjectInvite,
  updateProjectMemberRole,
} from './projects.ts';

async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Kysely<Database>,
  config: ServerConfig,
): Promise<UserProfile | null> {
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
  return session.user;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: ServerConfig,
): void {
  app.post<{ Body: { name?: unknown; number?: unknown; description?: unknown } }>(
    '/api/projects',
    async (request, reply) => {
      const user = await authenticateRequest(request, reply, db, config);
      if (!user) return;

      const name = typeof request.body?.name === 'string' ? request.body.name : '';
      const number = typeof request.body?.number === 'string' ? request.body.number : null;
      const description = typeof request.body?.description === 'string' ? request.body.description : null;

      const result = await createProject(db, user, { name, number, description });
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code });
      }
      return reply.code(201).send({
        project: result.project,
        scope: result.scope,
        lane: result.lane,
        role: result.role,
      });
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const user = await authenticateRequest(request, reply, db, config);
      if (!user) return;

      const result = await getProjectForMember(db, request.params.projectId, user.id);
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code });
      }
      return reply.code(200).send({
        project: result.project,
        role: result.role,
      });
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/members',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const user = await authenticateRequest(request, reply, db, config);
      if (!user) return;

      const result = await listProjectMembers(db, request.params.projectId, user.id);
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code });
      }
      return reply.code(200).send({
        role: result.role,
        members: result.members,
        invites: result.invites,
      });
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { email?: unknown; name?: unknown; role?: unknown; scopeId?: unknown };
  }>(
    '/api/projects/:projectId/invites',
    async (request, reply) => {
      const user = await authenticateRequest(request, reply, db, config);
      if (!user) return;

      const email =
        request.body?.email === undefined || request.body?.email === null
          ? null
          : typeof request.body.email === 'string'
            ? request.body.email
            : null;
      if (request.body?.email !== undefined && request.body?.email !== null && typeof request.body.email !== 'string') {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      const name = typeof request.body?.name === 'string' ? request.body.name : null;
      const scopeId = typeof request.body?.scopeId === 'string' ? request.body.scopeId : null;

      const result = await createProjectInvite(db, request.params.projectId, user.id, {
        email,
        name,
        role: request.body?.role,
        scopeId,
      });
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code });
      }
      return reply.code(201).send({
        invite: result.invite,
        token: result.token,
        inviteUrl: result.inviteUrl,
      });
    },
  );

  app.delete<{ Params: { projectId: string; inviteId: string } }>(
    '/api/projects/:projectId/invites/:inviteId',
    async (request, reply) => {
      const user = await authenticateRequest(request, reply, db, config);
      if (!user) return;

      const result = await revokeProjectInvite(db, request.params.projectId, user.id, request.params.inviteId);
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code });
      }
      return reply.code(200).send({ ok: true, inviteId: result.inviteId });
    },
  );

  app.patch<{
    Params: { projectId: string; userId: string };
    Body: { role?: unknown };
  }>(
    '/api/projects/:projectId/members/:userId',
    async (request, reply) => {
      const user = await authenticateRequest(request, reply, db, config);
      if (!user) return;

      const result = await updateProjectMemberRole(
        db,
        request.params.projectId,
        user.id,
        request.params.userId,
        request.body?.role,
      );
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code });
      }
      return reply.code(200).send({ member: result.member });
    },
  );

  app.delete<{ Params: { projectId: string; userId: string } }>(
    '/api/projects/:projectId/members/:userId',
    async (request, reply) => {
      const user = await authenticateRequest(request, reply, db, config);
      if (!user) return;

      const result = await removeProjectMember(db, request.params.projectId, user.id, request.params.userId);
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code });
      }
      return reply.code(200).send({ ok: true, userId: result.userId });
    },
  );
}
