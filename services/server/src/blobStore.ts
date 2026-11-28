import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COMPARE_CHUNK_BYTES = 64 * 1024;

export interface BlobStat {
  sha256: string;
  sizeBytes: number;
  storageKey: string;
}

export interface UploadAppendOptions {
  /** Maximum number of bytes accepted in a single chunk request. */
  maxChunkBytes?: number;
  /** Maximum total staged file size (offset + bytes written). */
  maxTotalBytes?: number;
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

export class UploadSizeExceededError extends Error {
  readonly kind: 'chunk' | 'total';
  readonly limitBytes: number;

  constructor(kind: 'chunk' | 'total', limitBytes: number) {
    super(
      kind === 'chunk'
        ? `Chunk size exceeds limit of ${limitBytes} bytes`
        : `Upload size exceeds total limit of ${limitBytes} bytes`,
    );
    this.name = 'UploadSizeExceededError';
    this.kind = kind;
    this.limitBytes = limitBytes;
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
    options?: UploadAppendOptions,
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

/**
 * Consumes a Readable stream sequentially with backpressure. On error, pauses the stream
 * immediately so no further bytes are read; destroys non-HTTP streams while leaving HTTP
 * `IncomingMessage` sockets intact long enough for the server to flush an error response
 * with `Connection: close`.
 */
async function consumeReadableSequential(
  stream: Readable,
  onChunk: (buf: Buffer) => Promise<void>,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    let ended = false;
    let closed = false;
    let processing = false;

    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('close', onClose);
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      cleanup();
      if (!('socket' in stream)) {
        stream.destroy();
      }
      rejectPromise(err);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise();
    };

    const onData = (chunk: unknown) => {
      if (settled) return;
      stream.pause();
      processing = true;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      void onChunk(buf).then(
        () => {
          processing = false;
          if (settled) return;
          if (ended) {
            finish();
          } else if (closed || stream.destroyed) {
            fail(new Error('Upload stream closed prematurely'));
          } else {
            stream.resume();
          }
        },
        (err) => {
          processing = false;
          fail(err);
        },
      );
    };

    const onEnd = () => {
      ended = true;
      if (!processing) finish();
    };

    const onError = (err: unknown) => {
      fail(err);
    };

    const onClose = () => {
      closed = true;
      if (!settled && !ended && !processing) {
        fail(new Error('Upload stream closed prematurely'));
      }
    };

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    stream.on('close', onClose);
    stream.resume();
  });
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

  /**
   * Verifies that no path component inside `rootDir` is a symbolic link and that the deepest
   * existing component's `realpath` stays contained within `realpath(rootDir)`.
   */
  private async assertNoSymlinks(targetPath: string): Promise<void> {
    const rel = relative(this.rootDir, targetPath);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new BlobValidationError('Resolved path escapes blob storage root');
    }

    const segments = rel.split(/[/\\]+/).filter(Boolean);
    let current = this.rootDir;
    let deepestExisting: string | null = null;

    for (const seg of segments) {
      current = join(current, seg);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) {
          throw new BlobValidationError('Symlink detected inside blob storage root');
        }
        deepestExisting = current;
      } catch (err) {
        if (isEnoent(err)) break;
        throw err;
      }
    }

    if (deepestExisting) {
      const [canonicalRoot, canonicalTarget] = await Promise.all([
        realpath(this.rootDir),
        realpath(deepestExisting),
      ]);
      const canonicalRel = relative(canonicalRoot, canonicalTarget);
      if (!canonicalRel || canonicalRel.startsWith('..') || isAbsolute(canonicalRel)) {
        throw new BlobValidationError('Resolved path escapes blob storage root');
      }
    }
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
    await this.assertNoSymlinks(tmpPath);
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
      await this.assertNoSymlinks(finalPath);
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
    await this.assertNoSymlinks(target);
    let fh: FileHandle;
    try {
      fh = await open(target, 'r');
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
    try {
      const info = await fh.stat();
      if (!info.isFile()) {
        await fh.close();
        return null;
      }
      return fh.createReadStream();
    } catch (err) {
      await fh.close();
      throw err;
    }
  }

  async has(projectId: string, sha256: string): Promise<boolean> {
    return (await this.stat(projectId, sha256)) !== null;
  }

  async stat(projectId: string, sha256: string): Promise<BlobStat | null> {
    const target = this.blobPath(projectId, sha256);
    await this.assertNoSymlinks(target);
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) {
        throw new BlobValidationError('Symlink detected inside blob storage root');
      }
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
    await this.assertNoSymlinks(target);
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
    await this.assertNoSymlinks(partPath);
    await mkdir(dirname(partPath), { recursive: true });
    const fh = await open(partPath, 'w');
    await fh.close();
  }

  async statUpload(projectId: string, uploadId: string): Promise<{ receivedBytes: number } | null> {
    const partPath = this.uploadPath(projectId, uploadId);
    await this.assertNoSymlinks(partPath);
    try {
      const info = await lstat(partPath);
      if (info.isSymbolicLink()) {
        throw new BlobValidationError('Symlink detected inside blob storage root');
      }
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
    options?: UploadAppendOptions,
  ): Promise<UploadAppendResult> {
    assertSafeOffset(offset);
    if (options?.maxTotalBytes !== undefined && offset > options.maxTotalBytes) {
      if (!(data instanceof Uint8Array)) {
        data.pause();
        if (!('socket' in data)) data.destroy();
      }
      throw new UploadSizeExceededError('total', options.maxTotalBytes);
    }

    const partPath = this.uploadPath(projectId, uploadId);
    await this.assertNoSymlinks(partPath);

    let fh: FileHandle;
    try {
      fh = await open(partPath, 'r+');
    } catch (err) {
      if (isEnoent(err)) {
        if (!(data instanceof Uint8Array)) data.resume();
        throw new UploadNotFoundError(uploadId);
      }
      throw err;
    }

    try {
      const info = await fh.stat();
      let currentSize = info.size;

      if (offset > currentSize) {
        // Drain incoming stream to avoid hanging HTTP sockets before rejecting.
        if (!(data instanceof Uint8Array)) data.resume();
        throw new UploadOffsetMismatchError(currentSize, offset);
      }

      let writePos = offset;
      let chunkBytesRead = 0;
      let compareBuf: Buffer | null = null;

      const processBuffer = async (buf: Buffer): Promise<void> => {
        if (buf.byteLength === 0) return;

        chunkBytesRead += buf.byteLength;
        if (options?.maxChunkBytes !== undefined && chunkBytesRead > options.maxChunkBytes) {
          throw new UploadSizeExceededError('chunk', options.maxChunkBytes);
        }
        if (options?.maxTotalBytes !== undefined && writePos + buf.byteLength > options.maxTotalBytes) {
          throw new UploadSizeExceededError('total', options.maxTotalBytes);
        }

        // If the client retried an earlier offset (e.g. after a dropped response), verify any
        // overlapping bytes in bounded slices, then append only bytes past currentSize.
        if (writePos < currentSize) {
          const overlapLen = Math.min(buf.byteLength, currentSize - writePos);
          compareBuf ??= Buffer.allocUnsafe(COMPARE_CHUNK_BYTES);
          let checked = 0;
          while (checked < overlapLen) {
            const sliceLen = Math.min(overlapLen - checked, COMPARE_CHUNK_BYTES);
            let readTotal = 0;
            while (readTotal < sliceLen) {
              const res = await fh.read(
                compareBuf,
                readTotal,
                sliceLen - readTotal,
                writePos + checked + readTotal,
              );
              if (res.bytesRead === 0) break;
              readTotal += res.bytesRead;
            }
            if (
              readTotal !== sliceLen ||
              !compareBuf.subarray(0, sliceLen).equals(buf.subarray(checked, checked + sliceLen))
            ) {
              throw new UploadOffsetMismatchError(currentSize, offset);
            }
            checked += sliceLen;
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
        await consumeReadableSequential(data, processBuffer);
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
    await this.assertNoSymlinks(partPath);

    let fh: FileHandle;
    try {
      fh = await open(partPath, 'r');
    } catch (err) {
      if (isEnoent(err)) throw new UploadNotFoundError(uploadId);
      throw err;
    }

    let actualSha256: string;
    let sizeBytes = 0;
    try {
      const info = await fh.stat();
      if (expectedBytes !== undefined && info.size !== expectedBytes) {
        throw new UploadSizeMismatchError(expectedBytes, info.size);
      }

      const hash = createHash('sha256');
      const stream = fh.createReadStream({ highWaterMark: 256 * 1024, autoClose: false });
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        sizeBytes += buf.byteLength;
        hash.update(buf);
      }
      actualSha256 = hash.digest('hex');
    } finally {
      await fh.close();
    }

    if (expectedBytes !== undefined && sizeBytes !== expectedBytes) {
      throw new UploadSizeMismatchError(expectedBytes, sizeBytes);
    }

    if (actualSha256 !== safeHash) {
      await rm(partPath, { force: true });
      throw new UploadHashMismatchError(safeHash, actualSha256);
    }

    const finalPath = this.blobPath(safeProject, actualSha256);
    await this.assertNoSymlinks(finalPath);
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
    await this.assertNoSymlinks(partPath);
    await rm(partPath, { force: true });
  }

  private async moveIntoPlace(srcPath: string, destPath: string): Promise<void> {
    try {
      await rename(srcPath, destPath);
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined;
      // On Windows, renaming over an existing identical content-addressed blob can throw
      // EEXIST or EPERM. Never swallow ENOENT on srcPath.
      if (code === 'EEXIST' || code === 'EPERM') {
        try {
          const existing = await lstat(destPath);
          if (existing.isFile() && !existing.isSymbolicLink()) {
            await rm(srcPath, { force: true });
            return;
          }
        } catch {
          // Destination does not exist; rethrow original rename error.
        }
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
    options?: UploadAppendOptions,
  ): Promise<UploadAppendResult> {
    assertSafeOffset(offset);
    if (options?.maxTotalBytes !== undefined && offset > options.maxTotalBytes) {
      if (!(data instanceof Uint8Array)) {
        data.pause();
        if (!('socket' in data)) data.destroy();
      }
      throw new UploadSizeExceededError('total', options.maxTotalBytes);
    }
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

    let incoming: Buffer;
    if (data instanceof Uint8Array) {
      const buf = Buffer.from(data);
      if (options?.maxChunkBytes !== undefined && buf.byteLength > options.maxChunkBytes) {
        throw new UploadSizeExceededError('chunk', options.maxChunkBytes);
      }
      if (options?.maxTotalBytes !== undefined && offset + buf.byteLength > options.maxTotalBytes) {
        throw new UploadSizeExceededError('total', options.maxTotalBytes);
      }
      incoming = buf;
    } else {
      const chunks: Buffer[] = [];
      let totalRead = 0;
      await consumeReadableSequential(data, async (buf) => {
        totalRead += buf.byteLength;
        if (options?.maxChunkBytes !== undefined && totalRead > options.maxChunkBytes) {
          throw new UploadSizeExceededError('chunk', options.maxChunkBytes);
        }
        if (options?.maxTotalBytes !== undefined && offset + totalRead > options.maxTotalBytes) {
          throw new UploadSizeExceededError('total', options.maxTotalBytes);
        }
        chunks.push(buf);
      });
      incoming = Buffer.concat(chunks);
    }

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
