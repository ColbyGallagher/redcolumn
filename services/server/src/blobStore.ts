import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface BlobStat {
  sha256: string;
  sizeBytes: number;
  storageKey: string;
}

export interface UploadAppendResult {
  receivedBytes: number;
}

export class BlobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlobValidationError';
  }
}

export class UploadNotFoundError extends Error {
  constructor(uploadId: string) {
    super(`Upload "${uploadId}" not found`);
    this.name = 'UploadNotFoundError';
  }
}

export class UploadOffsetMismatchError extends Error {
  readonly expectedOffset: number;
  readonly receivedOffset: number;

  constructor(expectedOffset: number, receivedOffset: number) {
    super(`Upload offset mismatch: expected ${expectedOffset}, got ${receivedOffset}`);
    this.name = 'UploadOffsetMismatchError';
    this.expectedOffset = expectedOffset;
    this.receivedOffset = receivedOffset;
  }
}

export class UploadSizeMismatchError extends Error {
  readonly expectedBytes: number;
  readonly actualBytes: number;

  constructor(expectedBytes: number, actualBytes: number) {
    super(`Upload size mismatch: expected ${expectedBytes} bytes, received ${actualBytes}`);
    this.name = 'UploadSizeMismatchError';
    this.expectedBytes = expectedBytes;
    this.actualBytes = actualBytes;
  }
}

export class UploadHashMismatchError extends Error {
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(expectedSha256: string, actualSha256: string) {
    super(`Upload SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
    this.name = 'UploadHashMismatchError';
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

export interface BlobStore {
  put(projectId: string, data: Uint8Array | Readable): Promise<BlobStat>;
  get(projectId: string, sha256: string): Promise<Readable | null>;
  has(projectId: string, sha256: string): Promise<boolean>;
  stat(projectId: string, sha256: string): Promise<BlobStat | null>;
  delete(projectId: string, sha256: string): Promise<boolean>;

  createUpload(projectId: string, uploadId: string): Promise<void>;
  appendChunk(
    projectId: string,
    uploadId: string,
    offset: number,
    data: Uint8Array | Readable,
  ): Promise<UploadAppendResult>;
  statUpload(projectId: string, uploadId: string): Promise<{ receivedBytes: number } | null>;
  finalizeUpload(
    projectId: string,
    uploadId: string,
    expectedSha256: string,
    expectedBytes?: number,
  ): Promise<BlobStat>;
  abortUpload(projectId: string, uploadId: string): Promise<void>;

  /**
   * Optional direct local filesystem path for an immutable blob, allowing readers such as PDFium
   * to read blocks on demand without copying large files into memory.
   */
  resolveLocalPath?(projectId: string, sha256: string): string | null;
}

export function validateProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || !SAFE_ID_RE.test(projectId) || projectId.includes('..')) {
    throw new BlobValidationError(`Invalid projectId "${String(projectId)}"`);
  }
  return projectId;
}

export function validateUploadId(uploadId: string): string {
  if (typeof uploadId !== 'string' || !SAFE_ID_RE.test(uploadId) || uploadId.includes('..')) {
    throw new BlobValidationError(`Invalid uploadId "${String(uploadId)}"`);
  }
  return uploadId;
}

export function validateSha256(sha256: string): string {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
    throw new BlobValidationError(`Invalid sha256 "${String(sha256)}"`);
  }
  return sha256;
}

export function blobStorageKey(projectId: string, sha256: string): string {
  return `projects/${validateProjectId(projectId)}/${validateSha256(sha256)}`;
}

function assertSafeOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new BlobValidationError(`Invalid chunk offset: ${String(offset)}`);
  }
}

function isEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT');
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function hashFileSha256(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const stream = createReadStream(filePath, { highWaterMark: 256 * 1024 });
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    sizeBytes += buf.byteLength;
    hash.update(buf);
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

/**
 * Local-disk content-addressed BlobStore.
 *
 * Immutable blobs are stored at `<rootDir>/projects/<projectId>/<sha256>`.
 * In-flight chunked uploads are staged at `<rootDir>/uploads/<projectId>/<uploadId>.part`
 * and moved atomically into place once the full SHA-256 matches.
 */
export class LocalDiskBlobStore implements BlobStore {
  readonly rootDir: string;

  constructor(rootDir: string) {
    if (!rootDir || !rootDir.trim()) {
      throw new BlobValidationError('BlobStore rootDir must be non-empty');
    }
    this.rootDir = resolve(rootDir);
  }

  private safeJoin(...segments: string[]): string {
    const candidate = resolve(this.rootDir, ...segments);
    const rel = relative(this.rootDir, candidate);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new BlobValidationError('Resolved path escapes blob storage root');
    }
    return candidate;
  }

  private blobPath(projectId: string, sha256: string): string {
    const safeProject = validateProjectId(projectId);
    const safeHash = validateSha256(sha256);
    return this.safeJoin('projects', safeProject, safeHash);
  }

  private uploadPath(projectId: string, uploadId: string): string {
    const safeProject = validateProjectId(projectId);
    const safeUpload = validateUploadId(uploadId);
    return this.safeJoin('uploads', safeProject, `${safeUpload}.part`);
  }

  resolveLocalPath(projectId: string, sha256: string): string | null {
    return this.blobPath(projectId, sha256);
  }

  async put(projectId: string, data: Uint8Array | Readable): Promise<BlobStat> {
    const safeProject = validateProjectId(projectId);
    const tmpName = `put-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    const tmpPath = this.safeJoin('uploads', safeProject, tmpName);
    await mkdir(dirname(tmpPath), { recursive: true });

    const hash = createHash('sha256');
    let sizeBytes = 0;

    try {
      if (data instanceof Uint8Array) {
        hash.update(data);
        sizeBytes = data.byteLength;
        await writeFile(tmpPath, data);
      } else {
        const out = createWriteStream(tmpPath);
        try {
          for await (const chunk of data) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            hash.update(buf);
            sizeBytes += buf.byteLength;
            if (!out.write(buf)) {
              await new Promise<void>((res, rej) => {
                out.once('drain', res);
                out.once('error', rej);
              });
            }
          }
          await new Promise<void>((res, rej) => {
            out.end(() => res());
            out.once('error', rej);
          });
        } catch (err) {
          out.destroy();
          throw err;
        }
      }

      const sha256 = hash.digest('hex');
      const finalPath = this.blobPath(safeProject, sha256);
      await mkdir(dirname(finalPath), { recursive: true });
      await this.moveIntoPlace(tmpPath, finalPath);
      return { sha256, sizeBytes, storageKey: blobStorageKey(safeProject, sha256) };
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
  }

  async get(projectId: string, sha256: string): Promise<Readable | null> {
    const target = this.blobPath(projectId, sha256);
    try {
      await stat(target);
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
    return createReadStream(target);
  }

  async has(projectId: string, sha256: string): Promise<boolean> {
    return (await this.stat(projectId, sha256)) !== null;
  }

  async stat(projectId: string, sha256: string): Promise<BlobStat | null> {
    const target = this.blobPath(projectId, sha256);
    try {
      const info = await stat(target);
      if (!info.isFile()) return null;
      return {
        sha256,
        sizeBytes: info.size,
        storageKey: blobStorageKey(projectId, sha256),
      };
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }

  async delete(projectId: string, sha256: string): Promise<boolean> {
    const target = this.blobPath(projectId, sha256);
    try {
      await rm(target);
      return true;
    } catch (err) {
      if (isEnoent(err)) return false;
      throw err;
    }
  }

  async createUpload(projectId: string, uploadId: string): Promise<void> {
    const partPath = this.uploadPath(projectId, uploadId);
    await mkdir(dirname(partPath), { recursive: true });
    const fh = await open(partPath, 'w');
    await fh.close();
  }

  async statUpload(projectId: string, uploadId: string): Promise<{ receivedBytes: number } | null> {
    const partPath = this.uploadPath(projectId, uploadId);
    try {
      const info = await stat(partPath);
      if (!info.isFile()) return null;
      return { receivedBytes: info.size };
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }

  async appendChunk(
    projectId: string,
    uploadId: string,
    offset: number,
    data: Uint8Array | Readable,
  ): Promise<UploadAppendResult> {
    assertSafeOffset(offset);
    const partPath = this.uploadPath(projectId, uploadId);

    let currentSize: number;
    try {
      const info = await stat(partPath);
      currentSize = info.size;
    } catch (err) {
      if (isEnoent(err)) throw new UploadNotFoundError(uploadId);
      throw err;
    }

    if (offset > currentSize) {
      // Drain incoming stream to avoid hanging HTTP sockets before rejecting.
      if (!(data instanceof Uint8Array)) data.resume();
      throw new UploadOffsetMismatchError(currentSize, offset);
    }

    const fh = await open(partPath, 'r+');
    try {
      let writePos = offset;

      const processBuffer = async (buf: Buffer): Promise<void> => {
        if (buf.byteLength === 0) return;

        // If the client retried an earlier offset (e.g. after a dropped response), verify any
        // overlapping bytes match what is already on disk, then append only bytes past currentSize.
        if (writePos < currentSize) {
          const overlapLen = Math.min(buf.byteLength, currentSize - writePos);
          const existing = Buffer.allocUnsafe(overlapLen);
          let readTotal = 0;
          while (readTotal < overlapLen) {
            const res = await fh.read(existing, readTotal, overlapLen - readTotal, writePos + readTotal);
            if (res.bytesRead === 0) break;
            readTotal += res.bytesRead;
          }
          if (readTotal !== overlapLen || !existing.equals(buf.subarray(0, overlapLen))) {
            throw new UploadOffsetMismatchError(currentSize, offset);
          }
          writePos += overlapLen;
          if (overlapLen === buf.byteLength) return;
          buf = buf.subarray(overlapLen);
        }

        let written = 0;
        while (written < buf.byteLength) {
          const res = await fh.write(buf, written, buf.byteLength - written, writePos + written);
          written += res.bytesWritten;
        }
        writePos += buf.byteLength;
        if (writePos > currentSize) {
          currentSize = writePos;
        }
      };

      if (data instanceof Uint8Array) {
        await processBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      } else {
        for await (const chunk of data) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          await processBuffer(buf);
        }
      }

      return { receivedBytes: currentSize };
    } finally {
      await fh.close();
    }
  }

  async finalizeUpload(
    projectId: string,
    uploadId: string,
    expectedSha256: string,
    expectedBytes?: number,
  ): Promise<BlobStat> {
    const safeProject = validateProjectId(projectId);
    const safeHash = validateSha256(expectedSha256);
    const partPath = this.uploadPath(safeProject, uploadId);

    let fileSize: number;
    try {
      const info = await stat(partPath);
      fileSize = info.size;
    } catch (err) {
      if (isEnoent(err)) throw new UploadNotFoundError(uploadId);
      throw err;
    }

    if (expectedBytes !== undefined && fileSize !== expectedBytes) {
      throw new UploadSizeMismatchError(expectedBytes, fileSize);
    }

    const { sha256: actualSha256, sizeBytes } = await hashFileSha256(partPath);
    if (actualSha256 !== safeHash) {
      await rm(partPath, { force: true });
      throw new UploadHashMismatchError(safeHash, actualSha256);
    }

    const finalPath = this.blobPath(safeProject, actualSha256);
    await mkdir(dirname(finalPath), { recursive: true });
    await this.moveIntoPlace(partPath, finalPath);

    return {
      sha256: actualSha256,
      sizeBytes,
      storageKey: blobStorageKey(safeProject, actualSha256),
    };
  }

  async abortUpload(projectId: string, uploadId: string): Promise<void> {
    const partPath = this.uploadPath(projectId, uploadId);
    await rm(partPath, { force: true });
  }

  private async moveIntoPlace(srcPath: string, destPath: string): Promise<void> {
    try {
      await rename(srcPath, destPath);
    } catch (err) {
      // On Windows, renaming over an existing identical content-addressed blob can throw
      // EEXIST or EPERM. If the destination already exists, keep it and discard the temp file.
      try {
        const existing = await stat(destPath);
        if (existing.isFile()) {
          await rm(srcPath, { force: true });
          return;
        }
      } catch {
        // Destination does not exist; rethrow original rename error.
      }
      throw err;
    }
  }
}

/**
 * In-memory BlobStore for fast unit tests. Enforces the same validation, offset checks,
 * idempotent retries, and SHA-256 verification as `LocalDiskBlobStore`.
 */
export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Buffer>();
  private readonly uploads = new Map<string, Buffer>();

  private uploadKey(projectId: string, uploadId: string): string {
    return `${validateProjectId(projectId)}/${validateUploadId(uploadId)}`;
  }

  async put(projectId: string, data: Uint8Array | Readable): Promise<BlobStat> {
    const safeProject = validateProjectId(projectId);
    const buf = data instanceof Uint8Array ? Buffer.from(data) : await readStreamToBuffer(data);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const key = blobStorageKey(safeProject, sha256);
    if (!this.blobs.has(key)) {
      this.blobs.set(key, buf);
    }
    return { sha256, sizeBytes: buf.byteLength, storageKey: key };
  }

  async get(projectId: string, sha256: string): Promise<Readable | null> {
    const key = blobStorageKey(projectId, sha256);
    const buf = this.blobs.get(key);
    if (!buf) return null;
    return Readable.from(buf);
  }

  async has(projectId: string, sha256: string): Promise<boolean> {
    return this.blobs.has(blobStorageKey(projectId, sha256));
  }

  async stat(projectId: string, sha256: string): Promise<BlobStat | null> {
    const key = blobStorageKey(projectId, sha256);
    const buf = this.blobs.get(key);
    if (!buf) return null;
    return { sha256, sizeBytes: buf.byteLength, storageKey: key };
  }

  async delete(projectId: string, sha256: string): Promise<boolean> {
    return this.blobs.delete(blobStorageKey(projectId, sha256));
  }

  async createUpload(projectId: string, uploadId: string): Promise<void> {
    this.uploads.set(this.uploadKey(projectId, uploadId), Buffer.alloc(0));
  }

  async statUpload(projectId: string, uploadId: string): Promise<{ receivedBytes: number } | null> {
    const buf = this.uploads.get(this.uploadKey(projectId, uploadId));
    return buf ? { receivedBytes: buf.byteLength } : null;
  }

  async appendChunk(
    projectId: string,
    uploadId: string,
    offset: number,
    data: Uint8Array | Readable,
  ): Promise<UploadAppendResult> {
    assertSafeOffset(offset);
    const key = this.uploadKey(projectId, uploadId);
    const existing = this.uploads.get(key);
    if (!existing) {
      if (!(data instanceof Uint8Array)) data.resume();
      throw new UploadNotFoundError(uploadId);
    }
    if (offset > existing.byteLength) {
      if (!(data instanceof Uint8Array)) data.resume();
      throw new UploadOffsetMismatchError(existing.byteLength, offset);
    }

    const incoming = data instanceof Uint8Array ? Buffer.from(data) : await readStreamToBuffer(data);
    const overlapLen = Math.min(incoming.byteLength, existing.byteLength - offset);
    if (overlapLen > 0) {
      if (!existing.subarray(offset, offset + overlapLen).equals(incoming.subarray(0, overlapLen))) {
        throw new UploadOffsetMismatchError(existing.byteLength, offset);
      }
    }

    const tail = incoming.subarray(overlapLen);
    const next = tail.byteLength > 0 ? Buffer.concat([existing, tail]) : existing;
    this.uploads.set(key, next);
    return { receivedBytes: next.byteLength };
  }

  async finalizeUpload(
    projectId: string,
    uploadId: string,
    expectedSha256: string,
    expectedBytes?: number,
  ): Promise<BlobStat> {
    const safeProject = validateProjectId(projectId);
    const safeHash = validateSha256(expectedSha256);
    const key = this.uploadKey(safeProject, uploadId);
    const staged = this.uploads.get(key);
    if (!staged) throw new UploadNotFoundError(uploadId);

    if (expectedBytes !== undefined && staged.byteLength !== expectedBytes) {
      throw new UploadSizeMismatchError(expectedBytes, staged.byteLength);
    }

    const actualSha256 = createHash('sha256').update(staged).digest('hex');
    if (actualSha256 !== safeHash) {
      this.uploads.delete(key);
      throw new UploadHashMismatchError(safeHash, actualSha256);
    }

    this.uploads.delete(key);
    const storageKey = blobStorageKey(safeProject, actualSha256);
    if (!this.blobs.has(storageKey)) {
      this.blobs.set(storageKey, staged);
    }
    return { sha256: actualSha256, sizeBytes: staged.byteLength, storageKey };
  }

  async abortUpload(projectId: string, uploadId: string): Promise<void> {
    this.uploads.delete(this.uploadKey(projectId, uploadId));
  }
}

export function joinBlobDir(base: string, ...parts: string[]): string {
  return join(base, ...parts);
}
