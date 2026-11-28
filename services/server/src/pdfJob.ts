import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import {
  inspectPdfPages,
  inspectPdfPagesFromBytes,
  type PdfByteSource,
  type PdfPageMetadata,
} from '@nb/pdf-core/inspect';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { BlobStore } from './blobStore.ts';
import type { Database } from './schema.ts';

export const PDF_INSPECT_JOB = 'revision.inspect_pdf';

export const MAX_SHEET_SUGGESTIONS = 5_000;
export const MAX_SHEET_NUMBER_LENGTH = 64;
export const MAX_SHEET_TITLE_LENGTH = 256;
const MAX_ERROR_MESSAGE_LENGTH = 500;

export interface SheetSuggestion {
  pageIndex: number;
  sheetNumber: string;
  title: string | null;
}

export interface PdfInspectJobPayload {
  projectId: string;
  documentId: string;
  revisionId: string;
  sha256: string;
  sheetSuggestions: SheetSuggestion[];
}

export type JobHandler<TPayload = unknown> = (payload: TPayload) => Promise<void>;

/**
 * Minimal job runner abstraction. The default implementation is an in-process async queue;
 * a persistent queue (such as pg-boss) can implement this same interface without changing callers.
 */
export interface JobRunner {
  register<TPayload>(name: string, handler: JobHandler<TPayload>): void;
  enqueue<TPayload>(name: string, payload: TPayload): Promise<string>;
  /** Resolves once all currently queued and in-flight jobs have settled. */
  drain(): Promise<void>;
  close(): Promise<void>;
}

interface QueuedJob {
  id: string;
  name: string;
  payload: unknown;
}

export interface InProcessJobRunnerOptions {
  concurrency?: number;
  onError?: (err: unknown, job: { id: string; name: string }) => void;
}

export class InProcessJobRunner implements JobRunner {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly queue: QueuedJob[] = [];
  private readonly concurrency: number;
  private readonly onError?: (err: unknown, job: { id: string; name: string }) => void;
  private active = 0;
  private closed = false;
  private drainWaiters: (() => void)[] = [];

  constructor(options: InProcessJobRunnerOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.onError = options.onError;
  }

  register<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    this.handlers.set(name, handler as JobHandler);
  }

  async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    if (this.closed) {
      throw new Error('JobRunner is closed');
    }
    if (!this.handlers.has(name)) {
      throw new Error(`No handler registered for job "${name}"`);
    }
    const id = randomUUID();
    this.queue.push({ id, name, payload });
    this.pump();
    return id;
  }

  async drain(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return;
    await new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.drain();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const handler = this.handlers.get(job.name);
      if (!handler) continue;
      this.active += 1;
      void Promise.resolve()
        .then(() => handler(job.payload))
        .catch((err) => {
          this.onError?.(err, { id: job.id, name: job.name });
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
          if (this.active === 0 && this.queue.length === 0) {
            const waiters = this.drainWaiters;
            this.drainWaiters = [];
            for (const resolve of waiters) resolve();
          }
        });
    }
  }
}

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;

/** Loads the PDFium wasm binary from `@nb/pdf-core`'s dependency tree once per process. */
export function loadPdfiumWasm(): Promise<ArrayBuffer> {
  wasmBinaryPromise ??= (async () => {
    const pdfCoreUrl = import.meta.resolve('@nb/pdf-core/inspect');
    const requireFromPdfCore = createRequire(pdfCoreUrl);
    const wasmPath = requireFromPdfCore.resolve('@embedpdf/pdfium/pdfium.wasm');
    const buf = await readFile(wasmPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  })();
  return wasmBinaryPromise;
}

async function readStreamToUint8Array(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Reads authoritative page metadata from a blob stored in `blobStore` using `@nb/pdf-core`.
 * When `blobStore` exposes a local file path, PDFium reads only the blocks it needs directly
 * from disk so multi-hundred-MB drawing sets stay bounded in memory.
 */
export async function readPdfMetadataFromBlob(
  blobStore: BlobStore,
  projectId: string,
  sha256: string,
): Promise<PdfPageMetadata[]> {
  const wasmBinary = await loadPdfiumWasm();
  const localPath = blobStore.resolveLocalPath?.(projectId, sha256) ?? null;

  if (localPath) {
    const fd = openSync(localPath, 'r');
    try {
      const byteLength = fstatSync(fd).size;
      const source: PdfByteSource = {
        byteLength,
        readBlock(position, target) {
          let totalRead = 0;
          while (totalRead < target.byteLength) {
            const n = readSync(fd, target, totalRead, target.byteLength - totalRead, position + totalRead);
            if (n === 0) return false;
            totalRead += n;
          }
          return true;
        },
      };
      return await inspectPdfPages(wasmBinary, source);
    } finally {
      closeSync(fd);
    }
  }

  const stream = await blobStore.get(projectId, sha256);
  if (!stream) {
    throw new Error(`Blob ${sha256} not found in project ${projectId}`);
  }
  const bytes = await readStreamToUint8Array(stream);
  return inspectPdfPagesFromBytes(wasmBinary, bytes);
}

/**
 * Validates and bounds client-supplied sheet number/title suggestions.
 * Suggestions are advisory only and are linked to authoritative server-read pages after PDFium runs.
 */
export function parseSheetSuggestions(raw: unknown): { ok: true; suggestions: SheetSuggestion[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, suggestions: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'sheetSuggestions must be an array' };
  }
  if (raw.length > MAX_SHEET_SUGGESTIONS) {
    return { ok: false, error: `sheetSuggestions exceeds maximum of ${MAX_SHEET_SUGGESTIONS}` };
  }

  const byPage = new Map<number, SheetSuggestion>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `sheetSuggestions[${i}] must be an object` };
    }
    const rec = item as Record<string, unknown>;
    const pageIndex = rec.pageIndex;
    if (typeof pageIndex !== 'number' || !Number.isSafeInteger(pageIndex) || pageIndex < 0) {
      return { ok: false, error: `sheetSuggestions[${i}].pageIndex must be a non-negative integer` };
    }
    if (typeof rec.sheetNumber !== 'string') {
      return { ok: false, error: `sheetSuggestions[${i}].sheetNumber must be a string` };
    }
    const sheetNumber = rec.sheetNumber.trim();
    if (!sheetNumber || sheetNumber.length > MAX_SHEET_NUMBER_LENGTH) {
      return {
        ok: false,
        error: `sheetSuggestions[${i}].sheetNumber must be 1..${MAX_SHEET_NUMBER_LENGTH} characters`,
      };
    }

    let title: string | null = null;
    if (rec.title !== undefined && rec.title !== null) {
      if (typeof rec.title !== 'string') {
        return { ok: false, error: `sheetSuggestions[${i}].title must be a string or null` };
      }
      const trimmedTitle = rec.title.trim();
      if (trimmedTitle.length > MAX_SHEET_TITLE_LENGTH) {
        return {
          ok: false,
          error: `sheetSuggestions[${i}].title exceeds ${MAX_SHEET_TITLE_LENGTH} characters`,
        };
      }
      title = trimmedTitle.length > 0 ? trimmedTitle : null;
    }

    // Last suggestion wins for a given pageIndex if the client sent duplicates.
    byPage.set(pageIndex, { pageIndex, sheetNumber, title });
  }

  return { ok: true, suggestions: [...byPage.values()] };
}

export interface PdfJobDeps {
  db: Kysely<Database>;
  blobStore: BlobStore;
  logger?: Logger;
}

function truncateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > MAX_ERROR_MESSAGE_LENGTH ? `${raw.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...` : raw;
}

/**
 * Server-side PDF page-reading job:
 * 1. Marks revision as `processing`.
 * 2. Reads authoritative page count, dimensions, and rotation with `@nb/pdf-core` (PDFium).
 * 3. Persists `pages` rows and links validated client-suggested `sheets` rows in a transaction.
 * 4. Finalizes revision `page_count` and `processing_status` (`ready` or `failed`).
 */
export async function runPdfInspectJob(deps: PdfJobDeps, payload: PdfInspectJobPayload): Promise<void> {
  const { db, blobStore, logger } = deps;

  const updated = await db
    .updateTable('revisions')
    .set({ processing_status: 'processing', processing_error: null })
    .where('id', '=', payload.revisionId)
    .where('processing_status', '=', 'pending')
    .returning('id')
    .executeTakeFirst();

  if (!updated) {
    // Already processed or revision was deleted.
    return;
  }

  try {
    const pages = await readPdfMetadataFromBlob(blobStore, payload.projectId, payload.sha256);
    if (pages.length === 0) {
      throw new Error('PDF contains zero pages');
    }

    // Index valid suggestions that correspond to actual server-read pages.
    const suggestionByPage = new Map<number, SheetSuggestion>();
    for (const s of payload.sheetSuggestions) {
      if (s.pageIndex >= 0 && s.pageIndex < pages.length) {
        suggestionByPage.set(s.pageIndex, s);
      }
    }

    await db.transaction().execute(async (trx) => {
      const sheetIdByNumber = new Map<string, string>();

      for (const suggestion of suggestionByPage.values()) {
        if (sheetIdByNumber.has(suggestion.sheetNumber)) continue;

        const existing = await trx
          .selectFrom('sheets')
          .select(['id'])
          .where('document_id', '=', payload.documentId)
          .where('sheet_number', '=', suggestion.sheetNumber)
          .executeTakeFirst();

        if (existing) {
          sheetIdByNumber.set(suggestion.sheetNumber, existing.id);
        } else {
          const sheetId = randomUUID();
          await trx
            .insertInto('sheets')
            .values({
              id: sheetId,
              document_id: payload.documentId,
              sheet_number: suggestion.sheetNumber,
              title: suggestion.title,
            })
            .execute();
          sheetIdByNumber.set(suggestion.sheetNumber, sheetId);
        }
      }

      const pageRows = pages.map((p) => {
        const suggestion = suggestionByPage.get(p.position);
        const sheetId = suggestion ? (sheetIdByNumber.get(suggestion.sheetNumber) ?? null) : null;
        return {
          id: randomUUID(),
          revision_id: payload.revisionId,
          sheet_id: sheetId,
          position: p.position,
          width: p.width,
          height: p.height,
          rotation: p.rotation,
        };
      });

      // Insert in batches so very large page counts stay well below Postgres parameter limits.
      const BATCH_SIZE = 500;
      for (let i = 0; i < pageRows.length; i += BATCH_SIZE) {
        await trx
          .insertInto('pages')
          .values(pageRows.slice(i, i + BATCH_SIZE))
          .execute();
      }

      await trx
        .updateTable('revisions')
        .set({
          page_count: pages.length,
          processing_status: 'ready',
          processing_error: null,
        })
        .where('id', '=', payload.revisionId)
        .execute();
    });

    logger?.info(
      { revisionId: payload.revisionId, documentId: payload.documentId, pageCount: pages.length },
      'PDF page inspection completed',
    );
  } catch (err) {
    const message = truncateError(err);
    logger?.warn(
      { err, revisionId: payload.revisionId, documentId: payload.documentId },
      'PDF page inspection failed',
    );
    await db
      .updateTable('revisions')
      .set({
        processing_status: 'failed',
        processing_error: message,
      })
      .where('id', '=', payload.revisionId)
      .where('processing_status', 'in', ['pending', 'processing'])
      .execute();
  }
}

export function registerPdfJobs(runner: JobRunner, deps: PdfJobDeps): void {
  runner.register<PdfInspectJobPayload>(PDF_INSPECT_JOB, (payload) => runPdfInspectJob(deps, payload));
}
