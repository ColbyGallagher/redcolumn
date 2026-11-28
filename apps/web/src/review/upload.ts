import { ServerClientError } from '../connect/client.ts';
import { defaultFetch, getJson, responseError, type FetchLike } from './documentsApi.ts';

/**
 * Sends a PDF to a project in chunks, as a new document with revision 1. A dropped connection is
 * retried from the last byte the server has; after giving up, calling again with the same
 * {@link UploadAttempt} carries on where it stopped.
 */

/** What is kept between tries. Start with an empty object for each file. */
export interface UploadAttempt {
  sha256?: string;
  uploadId?: string;
  chunkSize?: number;
}

export interface UploadOptions {
  attempt?: UploadAttempt;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  fetchImpl?: FetchLike;
  /** Failures in a row before giving up. */
  maxRetries?: number;
  wait?: (ms: number) => Promise<void>;
}

export interface UploadResult {
  documentId: string;
  revisionId: string;
}

interface UploadStatus {
  state: 'uploading' | 'completing' | 'completed' | 'aborted' | 'failed';
  receivedBytes: number;
  chunkSize: number;
  documentId: string | null;
  revisionId: string | null;
  errorMessage: string | null;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Worth trying again: the request never got an answer, or the server could not deal with it just then. */
const transient = (err: unknown): boolean => !(err instanceof ServerClientError) || err.status >= 500 || err.status === 429;

export async function uploadPdf(projectId: string, file: Blob & { name: string }, options: UploadOptions = {}): Promise<UploadResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const attempt = options.attempt ?? {};
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 5;
  const uploads = `/api/projects/${encodeURIComponent(projectId)}/uploads`;
  const total = file.size;

  const send = async (path: string, init: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetchImpl(path, { ...init, credentials: 'same-origin' });
    if (!res.ok) throw await responseError(res);
    return (await res.json()) as Record<string, unknown>;
  };

  attempt.sha256 ??= await sha256Hex(await file.arrayBuffer());

  let offset = 0;
  let failures = 0;
  options.onProgress?.(0, total);
  for (;;) {
    try {
      if (attempt.uploadId) {
        // Ask what the server has: it may differ from what was last heard.
        let status: UploadStatus | null = null;
        try {
          status = await getJson<UploadStatus>(`${uploads}/${attempt.uploadId}`, fetchImpl);
        } catch (err) {
          if (!(err instanceof ServerClientError && err.status === 404)) throw err;
        }
        if (status?.state === 'completed' && status.documentId && status.revisionId) {
          return { documentId: status.documentId, revisionId: status.revisionId };
        }
        if (status?.state === 'uploading') {
          offset = status.receivedBytes;
          attempt.chunkSize = status.chunkSize;
        } else if (status?.state === 'completing') {
          throw new ServerClientError(503, 'upload_completing');
        } else {
          delete attempt.uploadId;
        }
      }
      if (!attempt.uploadId) {
        const created = await send(uploads, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            totalBytes: total,
            expectedSha256: attempt.sha256,
            documentTitle: file.name,
          }),
        });
        attempt.uploadId = String(created.uploadId);
        attempt.chunkSize = Number(created.chunkSize);
        offset = 0;
      }

      while (offset < total) {
        options.onProgress?.(offset, total);
        const chunk = file.slice(offset, offset + Math.max(1, attempt.chunkSize ?? 1024 * 1024));
        const accepted = await send(`${uploads}/${attempt.uploadId}/chunks`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': String(offset) },
          body: chunk,
        });
        offset = Number(accepted.receivedBytes);
        failures = 0;
      }
      options.onProgress?.(total, total);

      const done = await send(`${uploads}/${attempt.uploadId}/complete`, { method: 'POST' });
      return { documentId: String(done.documentId), revisionId: String(done.revisionId) };
    } catch (err) {
      // The server has a different length from ours: ask again and carry on from there.
      const resumable =
        err instanceof ServerClientError && (err.code === 'offset_mismatch' || err.code === 'upload_incomplete');
      if (!resumable && !transient(err)) {
        // This upload cannot be continued; another try starts a new one.
        delete attempt.uploadId;
        throw err;
      }
      failures += 1;
      if (failures > maxRetries) throw err;
      await wait(Math.min(10_000, 500 * 2 ** (failures - 1)));
    }
  }
}
