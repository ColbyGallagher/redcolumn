import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { extractSessionToken, lookupSession, type SessionInfo } from './auth.ts';
import {
  BlobValidationError,
  UploadHashMismatchError,
  UploadNotFoundError,
  UploadOffsetMismatchError,
  UploadSizeExceededError,
  UploadSizeMismatchError,
  validateProjectId,
  validateSha256,
  validateUploadId,
  type BlobStore,
} from './blobStore.ts';
import type { ServerConfig } from './config.ts';
import {
  PDF_INSPECT_JOB,
  parseSheetSuggestions,
  type JobRunner,
  type PdfInspectJobPayload,
  type SheetSuggestion,
} from './pdfJob.ts';
import type { Database } from './schema.ts';

export interface UploadRoutesOptions {
  config: ServerConfig;
  db: Kysely<Database>;
  blobStore: BlobStore;
  jobRunner: JobRunner;
}

const MAX_FILENAME_LENGTH = 255;
const MAX_DOC_NUMBER_LENGTH = 128;
const MAX_DOC_TITLE_LENGTH = 255;
const MAX_REVISION_LABEL_LENGTH = 64;
const CONTENT_RANGE_RE = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i;

function parseChunkOffset(request: FastifyRequest): { ok: true; offset: number } | { ok: false; error: string } {
  const offsetHeader = request.headers['x-upload-offset'];
  if (offsetHeader !== undefined) {
    const raw = Array.isArray(offsetHeader) ? offsetHeader[0] : offsetHeader;
    if (!raw || !/^\d+$/.test(raw.trim())) {
      return { ok: false, error: 'invalid_upload_offset' };
    }
    const offset = Number(raw.trim());
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return { ok: false, error: 'invalid_upload_offset' };
    }
    return { ok: true, offset };
  }

  const rangeHeader = request.headers['content-range'];
  if (rangeHeader !== undefined) {
    const raw = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;
    const match = raw ? CONTENT_RANGE_RE.exec(raw.trim()) : null;
    if (!match) {
      return { ok: false, error: 'invalid_content_range' };
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
      return { ok: false, error: 'invalid_content_range' };
    }
    return { ok: true, offset: start };
  }

  return { ok: false, error: 'missing_upload_offset' };
}

function deriveDocumentNumber(filename: string, fallbackId: string): string {
  const base = filename.replace(/\.[^./\\]+$/, '').trim();
  const cleaned = base.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_DOC_NUMBER_LENGTH);
  return cleaned || `DOC-${fallbackId.slice(0, 8)}`;
}

function getPgErrorInfo(err: unknown): { code?: string; constraint?: string } {
  if (!err || typeof err !== 'object') return {};
  const rec = err as { code?: unknown; constraint?: unknown };
  return {
    code: typeof rec.code === 'string' ? rec.code : undefined,
    constraint: typeof rec.constraint === 'string' ? rec.constraint : undefined,
  };
}

async function requireAuthenticatedProjectAccess(
  db: Kysely<Database>,
  config: ServerConfig,
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
): Promise<SessionInfo | null> {
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

  try {
    validateProjectId(projectId);
  } catch {
    reply.code(400).send({ error: 'invalid_project_id' });
    return null;
  }

  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', projectId)
    .executeTakeFirst();

  if (!project) {
    reply.code(404).send({ error: 'project_not_found' });
    return null;
  }

  if (!session.user.isAdmin) {
    const membership = await db
      .selectFrom('project_members')
      .select('state')
      .where('project_id', '=', projectId)
      .where('user_id', '=', session.user.id)
      .executeTakeFirst();
    if (!membership || membership.state !== 'active') {
      reply.code(404).send({ error: 'project_not_found' });
      return null;
    }
  }

  return session;
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  options: UploadRoutesOptions,
): Promise<void> {
  const { config, db, blobStore, jobRunner } = options;

  // Serialize per-uploadId mutations (chunk appends, complete, abort) within this process.
  const uploadLocks = new Map<string, Promise<unknown>>();
  async function withUploadLock<T>(projectId: string, uploadId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${projectId}:${uploadId}`;
    const prev = uploadLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = prev.then(() => gate);
    uploadLocks.set(key, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (uploadLocks.get(key) === chain) {
        uploadLocks.delete(key);
      }
    }
  }

  // Stream raw binary chunks straight to BlobStore without buffering the body in Fastify.
  app.addContentTypeParser('application/octet-stream', (_request, payload: IncomingMessage, done) => {
    done(null, payload);
  });

  // 1. Create a resumable chunked upload session.
  app.post<{
    Params: { projectId: string };
    Body: {
      filename?: unknown;
      totalBytes?: unknown;
      expectedSha256?: unknown;
      documentId?: unknown;
      documentNumber?: unknown;
      documentTitle?: unknown;
      discipline?: unknown;
      revisionLabel?: unknown;
      sheetSuggestions?: unknown;
    };
  }>('/api/projects/:projectId/uploads', async (request, reply) => {
    const { projectId } = request.params;
    const session = await requireAuthenticatedProjectAccess(db, config, request, reply, projectId);
    if (!session) return;

    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
    if (!filename || filename.length > MAX_FILENAME_LENGTH || /[/\\\0]/.test(filename)) {
      return reply.code(400).send({ error: 'invalid_filename' });
    }

    const totalBytes = body.totalBytes;
    if (
      typeof totalBytes !== 'number' ||
      !Number.isSafeInteger(totalBytes) ||
      totalBytes <= 0 ||
      totalBytes > config.maxUploadBytes
    ) {
      return reply.code(400).send({ error: 'invalid_total_bytes', maxUploadBytes: config.maxUploadBytes });
    }

    let expectedSha256: string;
    try {
      expectedSha256 = validateSha256(typeof body.expectedSha256 === 'string' ? body.expectedSha256.trim().toLowerCase() : '');
    } catch {
      return reply.code(400).send({ error: 'invalid_sha256' });
    }

    let documentId: string | null = null;
    if (body.documentId !== undefined && body.documentId !== null) {
      if (typeof body.documentId !== 'string' || !body.documentId.trim()) {
        return reply.code(400).send({ error: 'invalid_document_id' });
      }
      const doc = await db
        .selectFrom('documents')
        .select('id')
        .where('id', '=', body.documentId.trim())
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!doc) {
        return reply.code(404).send({ error: 'document_not_found' });
      }
      documentId = doc.id;
    }

    let documentNumber: string | null = null;
    if (body.documentNumber !== undefined && body.documentNumber !== null) {
      if (typeof body.documentNumber !== 'string' || !body.documentNumber.trim() || body.documentNumber.trim().length > MAX_DOC_NUMBER_LENGTH) {
        return reply.code(400).send({ error: 'invalid_document_number' });
      }
      documentNumber = body.documentNumber.trim();
    }

    let documentTitle = '';
    if (body.documentTitle !== undefined && body.documentTitle !== null) {
      if (typeof body.documentTitle !== 'string' || body.documentTitle.trim().length > MAX_DOC_TITLE_LENGTH) {
        return reply.code(400).send({ error: 'invalid_document_title' });
      }
      documentTitle = body.documentTitle.trim();
    }

    let discipline: string | null = null;
    if (body.discipline !== undefined && body.discipline !== null) {
      if (typeof body.discipline !== 'string' || body.discipline.trim().length > 128) {
        return reply.code(400).send({ error: 'invalid_discipline' });
      }
      discipline = body.discipline.trim() || null;
    }

    let revisionLabel = '1';
    if (body.revisionLabel !== undefined && body.revisionLabel !== null) {
      if (typeof body.revisionLabel !== 'string' || !body.revisionLabel.trim() || body.revisionLabel.trim().length > MAX_REVISION_LABEL_LENGTH) {
        return reply.code(400).send({ error: 'invalid_revision_label' });
      }
      revisionLabel = body.revisionLabel.trim();
    }

    const parsedSuggestions = parseSheetSuggestions(body.sheetSuggestions);
    if (!parsedSuggestions.ok) {
      return reply.code(400).send({ error: 'invalid_sheet_suggestions', detail: parsedSuggestions.error });
    }

    const uploadId = randomUUID();
    await blobStore.createUpload(projectId, uploadId);

    try {
      await db
        .insertInto('document_uploads')
        .values({
          id: uploadId,
          project_id: projectId,
          created_by: session.user.id,
          document_id: documentId,
          document_number: documentNumber,
          document_title: documentTitle,
          discipline,
          revision_label: revisionLabel,
          filename,
          total_bytes: totalBytes,
          expected_sha256: expectedSha256,
          received_bytes: 0,
          chunk_size: config.uploadChunkBytes,
          sheet_suggestions_json: JSON.stringify(parsedSuggestions.suggestions),
          state: 'uploading',
          revision_id: null,
          error_message: null,
        })
        .execute();
    } catch (err) {
      await blobStore.abortUpload(projectId, uploadId);
      throw err;
    }

    return reply.code(201).send({
      uploadId,
      projectId,
      filename,
      totalBytes,
      expectedSha256,
      chunkSize: config.uploadChunkBytes,
      receivedBytes: 0,
      state: 'uploading',
    });
  });

  // 2. Query upload status & current byte offset for resuming after a cut connection.
  app.get<{ Params: { projectId: string; uploadId: string } }>(
    '/api/projects/:projectId/uploads/:uploadId',
    async (request, reply) => {
      const { projectId, uploadId } = request.params;
      const session = await requireAuthenticatedProjectAccess(db, config, request, reply, projectId);
      if (!session) return;

      try {
        validateUploadId(uploadId);
      } catch {
        return reply.code(400).send({ error: 'invalid_upload_id' });
      }

      const upload = await db
        .selectFrom('document_uploads')
        .selectAll()
        .where('id', '=', uploadId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();

      if (!upload) {
        return reply.code(404).send({ error: 'upload_not_found' });
      }

      let receivedBytes = Number(upload.received_bytes);
      if (upload.state === 'uploading') {
        const staged = await blobStore.statUpload(projectId, uploadId);
        if (staged && staged.receivedBytes !== receivedBytes) {
          receivedBytes = staged.receivedBytes;
          await db
            .updateTable('document_uploads')
            .set({ received_bytes: receivedBytes, updated_at: new Date() })
            .where('id', '=', uploadId)
            .execute();
        }
      }

      return reply.code(200).send({
        uploadId: upload.id,
        projectId: upload.project_id,
        filename: upload.filename,
        totalBytes: Number(upload.total_bytes),
        expectedSha256: upload.expected_sha256,
        chunkSize: upload.chunk_size,
        receivedBytes,
        state: upload.state,
        documentId: upload.document_id,
        revisionId: upload.revision_id,
        errorMessage: upload.error_message,
      });
    },
  );

  const maxChunkBytes = Math.max(config.uploadChunkBytes * 2, 64 * 1024 * 1024);
  const chunkRouteOpts = {
    bodyLimit: maxChunkBytes,
  };

  // 3. Append a chunk (supports both PUT and PATCH for resumable clients).
  const handleChunkUpload = async (
    request: FastifyRequest<{ Params: { projectId: string; uploadId: string } }>,
    reply: FastifyReply,
  ) => {
    const { projectId, uploadId } = request.params;
    const session = await requireAuthenticatedProjectAccess(db, config, request, reply, projectId);
    if (!session) return;

    try {
      validateUploadId(uploadId);
    } catch {
      return reply.code(400).send({ error: 'invalid_upload_id' });
    }

    const offsetParsed = parseChunkOffset(request);
    if (!offsetParsed.ok) {
      return reply.code(400).send({ error: offsetParsed.error });
    }

    const body = request.body;
    if (!body || (!(body instanceof Uint8Array) && typeof (body as IncomingMessage).on !== 'function')) {
      return reply.code(415).send({ error: 'expected_octet_stream' });
    }

    return withUploadLock(projectId, uploadId, async () => {
      const upload = await db
        .selectFrom('document_uploads')
        .select(['id', 'project_id', 'total_bytes', 'state'])
        .where('id', '=', uploadId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();

      if (!upload) {
        if (!(body instanceof Uint8Array)) (body as IncomingMessage).resume();
        return reply.code(404).send({ error: 'upload_not_found' });
      }
      if (upload.state !== 'uploading') {
        if (!(body instanceof Uint8Array)) (body as IncomingMessage).resume();
        return reply.code(409).send({ error: 'upload_not_active', state: upload.state });
      }

      const totalBytes = Number(upload.total_bytes);
      const contentLengthHeader = request.headers['content-length'];
      if (contentLengthHeader !== undefined && /^\d+$/.test(String(contentLengthHeader))) {
        const contentLength = Number(contentLengthHeader);
        if (contentLength > maxChunkBytes) {
          if (!(body instanceof Uint8Array)) (body as IncomingMessage).pause();
          return reply.code(413).header('connection', 'close').send({ error: 'chunk_too_large', maxChunkBytes });
        }
        if (offsetParsed.offset + contentLength > totalBytes) {
          if (!(body instanceof Uint8Array)) (body as IncomingMessage).pause();
          return reply.code(400).header('connection', 'close').send({ error: 'upload_size_exceeded', totalBytes });
        }
      }

      try {
        const result = await blobStore.appendChunk(
          projectId,
          uploadId,
          offsetParsed.offset,
          body as Uint8Array | IncomingMessage,
          { maxChunkBytes, maxTotalBytes: totalBytes },
        );

        const updated = await db
          .updateTable('document_uploads')
          .set({ received_bytes: result.receivedBytes, updated_at: new Date() })
          .where('id', '=', uploadId)
          .where('project_id', '=', projectId)
          .where('state', '=', 'uploading')
          .returning('id')
          .executeTakeFirst();

        if (!updated) {
          return reply.code(409).send({ error: 'upload_not_active' });
        }

        return reply.code(200).send({
          uploadId,
          receivedBytes: result.receivedBytes,
          totalBytes,
          complete: result.receivedBytes === totalBytes,
        });
      } catch (err) {
        if (err instanceof UploadSizeExceededError) {
          if (err.kind === 'chunk') {
            return reply
              .code(413)
              .header('connection', 'close')
              .send({ error: 'chunk_too_large', maxChunkBytes: err.limitBytes });
          }
          await blobStore.abortUpload(projectId, uploadId);
          await db
            .updateTable('document_uploads')
            .set({ state: 'failed', error_message: 'upload_size_exceeded', updated_at: new Date() })
            .where('id', '=', uploadId)
            .where('state', '=', 'uploading')
            .execute();
          return reply.code(400).header('connection', 'close').send({ error: 'upload_size_exceeded', totalBytes });
        }
        if (err instanceof UploadOffsetMismatchError) {
          return reply.code(409).send({
            error: 'offset_mismatch',
            expectedOffset: err.expectedOffset,
            receivedOffset: err.receivedOffset,
          });
        }
        if (err instanceof UploadNotFoundError) {
          return reply.code(404).send({ error: 'upload_not_found' });
        }
        if (err instanceof BlobValidationError) {
          return reply.code(400).send({ error: 'invalid_upload_request' });
        }
        throw err;
      }
    });
  };

  app.put('/api/projects/:projectId/uploads/:uploadId/chunks', chunkRouteOpts, handleChunkUpload);
  app.patch('/api/projects/:projectId/uploads/:uploadId/chunks', chunkRouteOpts, handleChunkUpload);

  // 4. Complete upload: verify size + SHA-256, commit blob, create document/revision, enqueue PDF job.
  app.post<{ Params: { projectId: string; uploadId: string } }>(
    '/api/projects/:projectId/uploads/:uploadId/complete',
    async (request, reply) => {
      const { projectId, uploadId } = request.params;
      const session = await requireAuthenticatedProjectAccess(db, config, request, reply, projectId);
      if (!session) return;

      try {
        validateUploadId(uploadId);
      } catch {
        return reply.code(400).send({ error: 'invalid_upload_id' });
      }

      const sendIdempotentCompleted = async (completedUploadId: string, revisionId: string) => {
        const rev = await db
          .selectFrom('revisions')
          .select(['id', 'document_id', 'file_sha256', 'file_size', 'page_count', 'processing_status', 'processing_error'])
          .where('id', '=', revisionId)
          .executeTakeFirst();
        if (!rev) return null;
        return reply.code(200).send({
          uploadId: completedUploadId,
          documentId: rev.document_id,
          revisionId: rev.id,
          fileSha256: rev.file_sha256,
          fileSize: Number(rev.file_size),
          pageCount: rev.page_count,
          processingStatus: rev.processing_status,
          processingError: rev.processing_error,
        });
      };

      return withUploadLock(projectId, uploadId, async () => {
        const upload = await db
          .selectFrom('document_uploads')
          .selectAll()
          .where('id', '=', uploadId)
          .where('project_id', '=', projectId)
          .executeTakeFirst();

        if (!upload) {
          return reply.code(404).send({ error: 'upload_not_found' });
        }

        if (upload.state === 'completed' && upload.revision_id && upload.document_id) {
          const sent = await sendIdempotentCompleted(upload.id, upload.revision_id);
          if (sent) return sent;
        }

        if (upload.state !== 'uploading') {
          return reply.code(409).send({ error: 'upload_not_active', state: upload.state });
        }

        // Atomically claim the upload for completion so concurrent callers across processes cannot race.
        const claimed = await db
          .updateTable('document_uploads')
          .set({ state: 'completing', updated_at: new Date() })
          .where('id', '=', uploadId)
          .where('project_id', '=', projectId)
          .where('state', '=', 'uploading')
          .returningAll()
          .executeTakeFirst();

        if (!claimed) {
          const latest = await db
            .selectFrom('document_uploads')
            .select(['id', 'state', 'revision_id', 'document_id'])
            .where('id', '=', uploadId)
            .where('project_id', '=', projectId)
            .executeTakeFirst();
          if (latest?.state === 'completed' && latest.revision_id && latest.document_id) {
            const sent = await sendIdempotentCompleted(latest.id, latest.revision_id);
            if (sent) return sent;
          }
          return reply.code(409).send({ error: 'upload_not_active', state: latest?.state ?? 'unknown' });
        }

        const totalBytes = Number(claimed.total_bytes);

        let committed;
        try {
          committed = await blobStore.finalizeUpload(projectId, uploadId, claimed.expected_sha256, totalBytes);
        } catch (err) {
          if (err instanceof UploadSizeMismatchError) {
            // Revert to uploading so the client can finish sending remaining chunks and retry complete.
            await db
              .updateTable('document_uploads')
              .set({ state: 'uploading', updated_at: new Date() })
              .where('id', '=', uploadId)
              .where('state', '=', 'completing')
              .execute();
            return reply.code(400).send({
              error: 'upload_incomplete',
              expectedBytes: err.expectedBytes,
              actualBytes: err.actualBytes,
            });
          }
          if (err instanceof UploadHashMismatchError) {
            await db
              .updateTable('document_uploads')
              .set({
                state: 'failed',
                error_message: 'hash_mismatch',
                updated_at: new Date(),
              })
              .where('id', '=', uploadId)
              .where('state', '=', 'completing')
              .execute();
            return reply.code(400).send({
              error: 'hash_mismatch',
              expectedSha256: err.expectedSha256,
              actualSha256: err.actualSha256,
            });
          }
          if (err instanceof UploadNotFoundError) {
            await db
              .updateTable('document_uploads')
              .set({
                state: 'failed',
                error_message: 'upload_not_found',
                updated_at: new Date(),
              })
              .where('id', '=', uploadId)
              .where('state', '=', 'completing')
              .execute();
            return reply.code(404).send({ error: 'upload_not_found' });
          }
          await db
            .updateTable('document_uploads')
            .set({ state: 'uploading', updated_at: new Date() })
            .where('id', '=', uploadId)
            .where('state', '=', 'completing')
            .execute();
          throw err;
        }

        const revisionId = randomUUID();
        let documentId = claimed.document_id;

        try {
          await db.transaction().execute(async (trx) => {
            if (!documentId) {
              documentId = randomUUID();
              const docNumber = claimed.document_number ?? deriveDocumentNumber(claimed.filename, documentId);
              const docTitle = claimed.document_title || claimed.filename;
              await trx
                .insertInto('documents')
                .values({
                  id: documentId,
                  project_id: projectId,
                  number: docNumber,
                  title: docTitle,
                  discipline: claimed.discipline,
                })
                .execute();
            }

            await trx
              .insertInto('assets')
              .values({
                project_id: projectId,
                sha256: committed.sha256,
                size_bytes: committed.sizeBytes,
                media_type: 'application/pdf',
                storage_key: committed.storageKey,
              })
              .onConflict((oc) => oc.columns(['project_id', 'sha256']).doNothing())
              .execute();

            await trx
              .insertInto('revisions')
              .values({
                id: revisionId,
                document_id: documentId,
                label: claimed.revision_label,
                file_sha256: committed.sha256,
                file_size: committed.sizeBytes,
                page_count: 0,
                processing_status: 'pending',
                processing_error: null,
                issued_by: session.user.id,
                issued_at: new Date(),
              })
              .execute();

            await trx
              .updateTable('document_uploads')
              .set({
                state: 'completed',
                received_bytes: committed.sizeBytes,
                document_id: documentId,
                revision_id: revisionId,
                error_message: null,
                updated_at: new Date(),
              })
              .where('id', '=', uploadId)
              .where('state', '=', 'completing')
              .execute();
          });
        } catch (err) {
          const pgErr = getPgErrorInfo(err);
          if (pgErr.code === '23505') {
            const conflictError = pgErr.constraint?.includes('documents')
              ? 'document_number_conflict'
              : 'revision_label_conflict';
            await db
              .updateTable('document_uploads')
              .set({
                state: 'failed',
                error_message: conflictError,
                updated_at: new Date(),
              })
              .where('id', '=', uploadId)
              .where('state', '=', 'completing')
              .execute();
            return reply.code(409).send({ error: conflictError });
          }
          await db
            .updateTable('document_uploads')
            .set({
              state: 'failed',
              error_message: 'commit_failed',
              updated_at: new Date(),
            })
            .where('id', '=', uploadId)
            .where('state', '=', 'completing')
            .execute();
          throw err;
        }

        const rawSuggestions = Array.isArray(claimed.sheet_suggestions_json)
          ? (claimed.sheet_suggestions_json as SheetSuggestion[])
          : [];

        const jobPayload: PdfInspectJobPayload = {
          projectId,
          documentId: documentId!,
          revisionId,
          sha256: committed.sha256,
          sheetSuggestions: rawSuggestions,
        };
        await jobRunner.enqueue(PDF_INSPECT_JOB, jobPayload);

        return reply.code(201).send({
          uploadId,
          documentId: documentId!,
          revisionId,
          fileSha256: committed.sha256,
          fileSize: committed.sizeBytes,
          storageKey: committed.storageKey,
          processingStatus: 'pending',
        });
      });
    },
  );

  // 5. Abort an in-progress upload and remove its staging file.
  app.delete<{ Params: { projectId: string; uploadId: string } }>(
    '/api/projects/:projectId/uploads/:uploadId',
    async (request, reply) => {
      const { projectId, uploadId } = request.params;
      const session = await requireAuthenticatedProjectAccess(db, config, request, reply, projectId);
      if (!session) return;

      try {
        validateUploadId(uploadId);
      } catch {
        return reply.code(400).send({ error: 'invalid_upload_id' });
      }

      return withUploadLock(projectId, uploadId, async () => {
        const upload = await db
          .selectFrom('document_uploads')
          .select(['id', 'state'])
          .where('id', '=', uploadId)
          .where('project_id', '=', projectId)
          .executeTakeFirst();

        if (!upload) {
          return reply.code(404).send({ error: 'upload_not_found' });
        }
        if (upload.state === 'completed' || upload.state === 'completing') {
          return reply.code(409).send({ error: 'upload_already_completed', state: upload.state });
        }

        await blobStore.abortUpload(projectId, uploadId);
        await db
          .updateTable('document_uploads')
          .set({ state: 'aborted', updated_at: new Date() })
          .where('id', '=', uploadId)
          .where('project_id', '=', projectId)
          .where('state', 'in', ['uploading', 'failed', 'aborted'])
          .execute();

        return reply.code(200).send({ uploadId, state: 'aborted' });
      });
    },
  );

  // 6. Read a revision's processing status, authoritative pages, and linked sheets.
  app.get<{ Params: { projectId: string; documentId: string; revisionId: string } }>(
    '/api/projects/:projectId/documents/:documentId/revisions/:revisionId',
    async (request, reply) => {
      const { projectId, documentId, revisionId } = request.params;
      const session = await requireAuthenticatedProjectAccess(db, config, request, reply, projectId);
      if (!session) return;

      const revision = await db
        .selectFrom('revisions')
        .innerJoin('documents', 'documents.id', 'revisions.document_id')
        .select([
          'revisions.id as id',
          'revisions.document_id as document_id',
          'revisions.label as label',
          'revisions.file_sha256 as file_sha256',
          'revisions.file_size as file_size',
          'revisions.page_count as page_count',
          'revisions.processing_status as processing_status',
          'revisions.processing_error as processing_error',
          'revisions.issued_by as issued_by',
          'revisions.issued_at as issued_at',
          'documents.number as document_number',
          'documents.title as document_title',
        ])
        .where('revisions.id', '=', revisionId)
        .where('revisions.document_id', '=', documentId)
        .where('documents.project_id', '=', projectId)
        .executeTakeFirst();

      if (!revision) {
        return reply.code(404).send({ error: 'revision_not_found' });
      }

      const pages = await db
        .selectFrom('pages')
        .leftJoin('sheets', 'sheets.id', 'pages.sheet_id')
        .select([
          'pages.id as id',
          'pages.position as position',
          'pages.width as width',
          'pages.height as height',
          'pages.rotation as rotation',
          'pages.sheet_id as sheet_id',
          'sheets.sheet_number as sheet_number',
          'sheets.title as sheet_title',
        ])
        .where('pages.revision_id', '=', revisionId)
        .orderBy('pages.position', 'asc')
        .execute();

      return reply.code(200).send({
        id: revision.id,
        documentId: revision.document_id,
        documentNumber: revision.document_number,
        documentTitle: revision.document_title,
        label: revision.label,
        fileSha256: revision.file_sha256,
        fileSize: Number(revision.file_size),
        pageCount: revision.page_count,
        processingStatus: revision.processing_status,
        processingError: revision.processing_error,
        issuedBy: revision.issued_by,
        issuedAt: revision.issued_at ? revision.issued_at.toISOString() : null,
        pages: pages.map((p) => ({
          id: p.id,
          position: p.position,
          width: p.width,
          height: p.height,
          rotation: p.rotation,
          sheetId: p.sheet_id,
          sheetNumber: p.sheet_number,
          sheetTitle: p.sheet_title,
        })),
      });
    },
  );
}
