import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { extractSessionToken, lookupSession, type UserProfile } from './auth.ts';
import type { BlobStore } from './blobStore.ts';
import type { ServerConfig } from './config.ts';
import type { Database } from './db.ts';
import { loadProjectStatuses, resolveDocumentAccess, statusRules } from './documentAccess.ts';
import { getProjectForMember } from './projects.ts';

export interface DocumentRoutesOptions {
  config: ServerConfig;
  db: Kysely<Database>;
  blobStore: BlobStore;
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  options: DocumentRoutesOptions,
): Promise<UserProfile | null> {
  const token = extractSessionToken(request.headers, options.config.sessionCookieName);
  const session = token ? await lookupSession(options.db, token) : null;
  if (!session) {
    reply.code(401).send({ error: 'unauthenticated' });
    return null;
  }
  return session.user;
}

interface RevisionParams {
  projectId: string;
  documentId: string;
  revisionId: string;
}

/**
 * The revision, for a member who may open its document. Every refusal is the same 404, so these
 * routes say nothing about documents the user cannot see.
 */
async function openableRevision(db: Kysely<Database>, user: UserProfile, params: RevisionParams) {
  const access = await resolveDocumentAccess(db, user.id, params.documentId);
  if (!access || access.projectId !== params.projectId) return null;
  const revision = await db
    .selectFrom('revisions')
    .innerJoin('documents', 'documents.id', 'revisions.document_id')
    .innerJoin('projects', 'projects.id', 'documents.project_id')
    .select([
      'revisions.id as id',
      'revisions.label as label',
      'revisions.file_sha256 as file_sha256',
      'revisions.file_size as file_size',
      'revisions.page_count as page_count',
      'revisions.processing_status as processing_status',
      'documents.number as document_number',
      'documents.title as document_title',
      'projects.name as project_name',
    ])
    .where('revisions.id', '=', params.revisionId)
    .where('revisions.document_id', '=', params.documentId)
    .executeTakeFirst();
  return revision ? { access, revision } : null;
}

/** Listing a project's documents, and what the viewer needs to open one of their revisions. */
export function registerDocumentRoutes(app: FastifyInstance, options: DocumentRoutesOptions): void {
  const { db, blobStore } = options;

  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/documents', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await authenticate(request, reply, options);
    if (!user) return;
    const membership = await getProjectForMember(db, request.params.projectId, user.id);
    if (!membership.ok) return reply.code(membership.status).send({ error: membership.code });

    const rows = await db
      .selectFrom('documents')
      .leftJoin('revisions', 'revisions.document_id', 'documents.id')
      .select([
        'documents.id as document_id',
        'documents.number as number',
        'documents.title as title',
        'revisions.id as revision_id',
        'revisions.label as label',
        'revisions.file_size as file_size',
        'revisions.page_count as page_count',
        'revisions.processing_status as processing_status',
        'revisions.processing_error as processing_error',
        'revisions.created_at as revision_created_at',
      ])
      .where('documents.project_id', '=', request.params.projectId)
      .orderBy('documents.number', 'asc')
      .orderBy('revisions.created_at', 'asc')
      .execute();

    const documents = new Map<string, { id: string; number: string; title: string; revisions: unknown[] }>();
    for (const row of rows) {
      let document = documents.get(row.document_id);
      if (!document) {
        document = { id: row.document_id, number: row.number, title: row.title, revisions: [] };
        documents.set(row.document_id, document);
      }
      if (row.revision_id) {
        document.revisions.push({
          id: row.revision_id,
          label: row.label,
          fileSize: Number(row.file_size),
          pageCount: row.page_count,
          processingStatus: row.processing_status,
          processingError: row.processing_error,
          createdAt: row.revision_created_at?.toISOString() ?? null,
        });
      }
    }
    return reply.code(200).send({ role: membership.role, documents: [...documents.values()] });
  });

  app.get<{ Params: RevisionParams }>(
    '/api/projects/:projectId/documents/:documentId/revisions/:revisionId/open',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const user = await authenticate(request, reply, options);
      if (!user) return;
      const found = await openableRevision(db, user, request.params);
      if (!found) return reply.code(404).send({ error: 'revision_not_found' });
      const { access, revision } = found;
      if (revision.processing_status !== 'ready') {
        return reply.code(409).send({ error: 'revision_not_ready', processingStatus: revision.processing_status });
      }

      const pages = await db
        .selectFrom('pages')
        .select(['id', 'position'])
        .where('revision_id', '=', revision.id)
        .orderBy('position', 'asc')
        .execute();
      // Names for the authors of markups, including people who have since left the project.
      const members = await db
        .selectFrom('project_members')
        .innerJoin('users', 'users.id', 'project_members.user_id')
        .select(['users.id as userId', 'users.name as name'])
        .where('project_members.project_id', '=', access.projectId)
        .execute();

      return reply.code(200).send({
        project: { id: access.projectId, name: revision.project_name },
        document: { id: access.documentId, number: revision.document_number, title: revision.document_title },
        revision: {
          id: revision.id,
          label: revision.label,
          fileSha256: revision.file_sha256,
          fileSize: Number(revision.file_size),
          pageCount: revision.page_count,
        },
        pages: pages.map((p) => p.id),
        streamId: access.documentId,
        scopeId: access.scopeId,
        laneId: access.laneId,
        role: access.role,
        statuses: await loadProjectStatuses(db, access.projectId),
        rules: statusRules(access),
        user: { id: user.id, name: user.name },
        members,
      });
    },
  );

  app.get<{ Params: RevisionParams }>(
    '/api/projects/:projectId/documents/:documentId/revisions/:revisionId/file',
    async (request, reply) => {
      const user = await authenticate(request, reply, options);
      if (!user) return;
      const found = await openableRevision(db, user, request.params);
      if (!found) return reply.code(404).send({ error: 'revision_not_found' });
      const stat = await blobStore.stat(found.access.projectId, found.revision.file_sha256);
      const stream = stat ? await blobStore.get(found.access.projectId, found.revision.file_sha256) : null;
      if (!stat || !stream) return reply.code(404).send({ error: 'file_not_found' });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Length', String(stat.sizeBytes));
      // Kept out of the browser's cache, so losing access also loses the way to read it again.
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.code(200).send(stream);
    },
  );
}
