import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { buildServer, type ServerInstance } from './app.ts';
import { createLocalUser } from './auth.ts';
import {
  BlobValidationError,
  LocalDiskBlobStore,
  MemoryBlobStore,
  UploadHashMismatchError,
  UploadOffsetMismatchError,
  UploadSizeExceededError,
  UploadSizeMismatchError,
  type BlobStore,
} from './blobStore.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import { createDb, type DbHandle } from './db.ts';
import { runMigrations } from './migrate.ts';
import { parseSheetSuggestions, readPdfMetadataFromBlob } from './pdfJob.ts';

interface GeneratedPageSpec {
  width: number;
  height: number;
  rotation?: 0 | 90 | 180 | 270;
}

/**
 * Builds a minimal, standards-compliant PDF 1.4 document with exact page sizes and rotations.
 * All byte offsets in the xref table are exact so PDFium parses it cleanly.
 */
function buildPdfBytes(pages: readonly GeneratedPageSpec[]): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let pos = 0;

  const push = (str: string) => {
    const buf = Buffer.from(str, 'ascii');
    parts.push(buf);
    pos += buf.byteLength;
  };

  const addObject = (body: string): number => {
    const num = offsets.length + 1;
    offsets.push(pos);
    push(`${num} 0 obj\n${body}\nendobj\n`);
    return num;
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const catalogNum = 1;
  const pagesNum = 2;
  const firstPageNum = 3;
  const pageNums = pages.map((_, i) => firstPageNum + i);

  addObject(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);
  addObject(
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );

  for (const page of pages) {
    const rotatePart = page.rotation ? ` /Rotate ${page.rotation}` : '';
    addObject(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${page.width} ${page.height}]${rotatePart} >>`,
    );
  }

  const xrefOffset = pos;
  push(`xref\n0 ${offsets.length + 1}\n`);
  push('0000000000 65535 f \n');
  for (const off of offsets) {
    push(`${String(off).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${offsets.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts);
}

/**
 * Streaming generator for a valid multi-hundred-MB PDF whose payload is an indirect stream object
 * of `paddingBytes` length, followed by real page objects and an exact xref table.
 * Keeps memory bounded to a single chunk buffer while producing a real PDFium-readable PDF.
 */
interface StreamingLargePdf {
  totalBytes: number;
  sha256: string;
  readRange(start: number, length: number): Buffer;
}

function createStreamingLargePdf(
  pages: readonly GeneratedPageSpec[],
  paddingBytes: number,
): StreamingLargePdf {
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'ascii');
  const offsets: number[] = [];

  // Object 1: Catalog
  const obj1Start = header.byteLength;
  const obj1 = Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'ascii');
  offsets.push(obj1Start);

  // Object 2: Pages
  const pageNums = pages.map((_, i) => 4 + i);
  const obj2Start = obj1Start + obj1.byteLength;
  const obj2 = Buffer.from(
    `2 0 obj\n<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    'ascii',
  );
  offsets.push(obj2Start);

  // Object 3: Large padding stream (unreferenced binary stream)
  const obj3Start = obj2Start + obj2.byteLength;
  const obj3Head = Buffer.from(`3 0 obj\n<< /Length ${paddingBytes} >>\nstream\n`, 'ascii');
  offsets.push(obj3Start);

  const prefix = Buffer.concat([header, obj1, obj2, obj3Head]);
  const paddingStart = prefix.byteLength;
  const paddingEnd = paddingStart + paddingBytes;

  // Suffix begins right after paddingBytes of payload.
  const suffixParts: Buffer[] = [];
  let cursor = paddingEnd;
  const pushSuffix = (str: string) => {
    const b = Buffer.from(str, 'ascii');
    suffixParts.push(b);
    cursor += b.byteLength;
  };

  pushSuffix('\nendstream\nendobj\n');

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const num = 4 + i;
    offsets.push(cursor);
    const rotatePart = p.rotation ? ` /Rotate ${p.rotation}` : '';
    pushSuffix(`${num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}]${rotatePart} >>\nendobj\n`);
  }

  const xrefOffset = cursor;
  pushSuffix(`xref\n0 ${offsets.length + 1}\n`);
  pushSuffix('0000000000 65535 f \n');
  for (const off of offsets) {
    pushSuffix(`${String(off).padStart(10, '0')} 00000 n \n`);
  }
  pushSuffix(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const suffix = Buffer.concat(suffixParts);
  const totalBytes = paddingEnd + suffix.byteLength;

  // Deterministic 1 MiB fill block so hashing & range reads use O(1) memory.
  const BLOCK_SIZE = 1024 * 1024;
  const fillBlock = Buffer.alloc(BLOCK_SIZE, 0x20); // spaces

  const hash = createHash('sha256');
  hash.update(prefix);
  let remaining = paddingBytes;
  while (remaining > 0) {
    const take = Math.min(remaining, BLOCK_SIZE);
    hash.update(take === BLOCK_SIZE ? fillBlock : fillBlock.subarray(0, take));
    remaining -= take;
  }
  hash.update(suffix);
  const sha256 = hash.digest('hex');

  function readRange(start: number, length: number): Buffer {
    const end = Math.min(totalBytes, start + length);
    const outLen = Math.max(0, end - start);
    const out = Buffer.allocUnsafe(outLen);
    let written = 0;
    let pos = start;

    // 1. Prefix overlap
    if (pos < paddingStart && written < outLen) {
      const take = Math.min(paddingStart - pos, outLen - written);
      prefix.copy(out, written, pos, pos + take);
      pos += take;
      written += take;
    }

    // 2. Padding overlap
    if (pos < paddingEnd && written < outLen) {
      const take = Math.min(paddingEnd - pos, outLen - written);
      out.fill(0x20, written, written + take);
      pos += take;
      written += take;
    }

    // 3. Suffix overlap
    if (pos >= paddingEnd && written < outLen) {
      const suffixOffset = pos - paddingEnd;
      const take = Math.min(suffix.byteLength - suffixOffset, outLen - written);
      suffix.copy(out, written, suffixOffset, suffixOffset + take);
      written += take;
    }

    return out;
  }

  return { totalBytes, sha256, readRange };
}

function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

function toBody(buf: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------------------------
// Unit tests (no Postgres required)
// ---------------------------------------------------------------------------------------------

describe('BlobStore unit tests', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'rc-blob-unit-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  for (const kind of ['local-disk', 'memory'] as const) {
    describe(`${kind} driver`, () => {
      const makeStore = (): BlobStore =>
        kind === 'local-disk' ? new LocalDiskBlobStore(join(tmpDir, `store-${Math.random().toString(16).slice(2)}`)) : new MemoryBlobStore();

      it('rejects path-traversal and invalid identifiers strictly', async () => {
        const store = makeStore();
        const validHash = 'a'.repeat(64);
        const badIds = ['', '..', '../etc', 'proj/sub', 'proj\\sub', 'proj..id', '.hidden', '-dash', 'a b'];
        for (const bad of badIds) {
          await assert.rejects(() => store.has(bad, validHash), BlobValidationError, `projectId=${bad}`);
          await assert.rejects(() => store.createUpload(bad, 'up-1'), BlobValidationError, `upload projectId=${bad}`);
          await assert.rejects(() => store.createUpload('proj-1', bad), BlobValidationError, `uploadId=${bad}`);
        }
        const badHashes = ['', 'abc', 'A'.repeat(64), '../' + 'a'.repeat(61), 'g'.repeat(64)];
        for (const bad of badHashes) {
          await assert.rejects(() => store.has('proj-1', bad), BlobValidationError, `sha256=${bad}`);
          await assert.rejects(() => store.get('proj-1', bad), BlobValidationError, `get sha256=${bad}`);
        }
      });

      it('stores, reads, stats, and deletes content-addressed blobs per project', async () => {
        const store = makeStore();
        const payload = Buffer.from('fictional drawing content v1');
        const expectedHash = sha256Hex(payload);

        const stat = await store.put('proj-alpha', payload);
        assert.equal(stat.sha256, expectedHash);
        assert.equal(stat.sizeBytes, payload.byteLength);
        assert.equal(stat.storageKey, `projects/proj-alpha/${expectedHash}`);

        assert.equal(await store.has('proj-alpha', expectedHash), true);
        assert.equal(await store.has('proj-beta', expectedHash), false);

        const readStream = await store.get('proj-alpha', expectedHash);
        assert.ok(readStream);
        assert.deepEqual(await readAll(readStream), payload);

        if (store instanceof LocalDiskBlobStore) {
          const localPath = store.resolveLocalPath('proj-alpha', expectedHash);
          assert.ok(localPath && existsSync(localPath));
          assert.ok(localPath.endsWith(join('projects', 'proj-alpha', expectedHash)));
        }

        assert.equal(await store.delete('proj-alpha', expectedHash), true);
        assert.equal(await store.has('proj-alpha', expectedHash), false);
        assert.equal(await store.get('proj-alpha', expectedHash), null);
      });

      it('supports chunked resume, idempotent overlap retries, and rejects bad offsets or hashes', async () => {
        const store = makeStore();
        const payload = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
        const expectedHash = sha256Hex(payload);

        await store.createUpload('proj-1', 'up-resume');
        assert.deepEqual(await store.appendChunk('proj-1', 'up-resume', 0, payload.subarray(0, 10)), {
          receivedBytes: 10,
        });

        // Out-of-order offset ahead of receivedBytes is rejected.
        await assert.rejects(
          () => store.appendChunk('proj-1', 'up-resume', 15, payload.subarray(15, 20)),
          UploadOffsetMismatchError,
        );

        // Retrying an overlapping slice with matching bytes is idempotent and advances cleanly.
        assert.deepEqual(await store.appendChunk('proj-1', 'up-resume', 5, payload.subarray(5, 20)), {
          receivedBytes: 20,
        });

        // Retrying an overlapping slice with mismatched bytes is rejected.
        await assert.rejects(
          () => store.appendChunk('proj-1', 'up-resume', 5, Buffer.from('XXXXXXXXXX')),
          UploadOffsetMismatchError,
        );

        // Finalizing before all bytes arrive fails with UploadSizeMismatchError.
        await assert.rejects(
          () => store.finalizeUpload('proj-1', 'up-resume', expectedHash, payload.byteLength),
          UploadSizeMismatchError,
        );

        // Finish remaining bytes and finalize.
        assert.deepEqual(await store.appendChunk('proj-1', 'up-resume', 20, payload.subarray(20)), {
          receivedBytes: payload.byteLength,
        });
        const committed = await store.finalizeUpload('proj-1', 'up-resume', expectedHash, payload.byteLength);
        assert.equal(committed.sha256, expectedHash);
        assert.equal(committed.sizeBytes, payload.byteLength);
        assert.equal(await store.statUpload('proj-1', 'up-resume'), null);

        // Hash mismatch rejects and removes the staging upload.
        await store.createUpload('proj-1', 'up-bad-hash');
        await store.appendChunk('proj-1', 'up-bad-hash', 0, payload);
        await assert.rejects(
          () => store.finalizeUpload('proj-1', 'up-bad-hash', 'f'.repeat(64), payload.byteLength),
          UploadHashMismatchError,
        );
        assert.equal(await store.statUpload('proj-1', 'up-bad-hash'), null);

        // Large overlap retry (> 64 KiB) uses bounded slice comparison and verifies accurately.
        const largeOverlap = Buffer.alloc(160 * 1024, 0x41);
        largeOverlap[100_000] = 0x42;
        await store.createUpload('proj-1', 'up-large-overlap');
        await store.appendChunk('proj-1', 'up-large-overlap', 0, largeOverlap);
        assert.deepEqual(await store.appendChunk('proj-1', 'up-large-overlap', 0, largeOverlap), {
          receivedBytes: largeOverlap.byteLength,
        });
        const tampered = Buffer.from(largeOverlap);
        tampered[100_000] = 0x43;
        await assert.rejects(
          () => store.appendChunk('proj-1', 'up-large-overlap', 0, tampered),
          UploadOffsetMismatchError,
        );

        // Incremental streaming limits reject immediately without consuming unbounded bytes.
        await store.createUpload('proj-1', 'up-stream-limit');
        let chunksYielded = 0;
        const hugeStream = Readable.from(
          (async function* () {
            for (let i = 0; i < 10; i++) {
              chunksYielded += 1;
              yield Buffer.alloc(1024, 0x5a);
            }
          })(),
        );
        await assert.rejects(
          () => store.appendChunk('proj-1', 'up-stream-limit', 0, hugeStream, { maxTotalBytes: 2500 }),
          UploadSizeExceededError,
        );
        assert.ok(chunksYielded <= 4, `expected stream to stop early, yielded ${chunksYielded} chunks`);
      });
    });
  }

  it('rejects symlinks inside LocalDiskBlobStore rootDir', async () => {
    const storeRoot = join(tmpDir, 'symlink-store');
    const outsideDir = join(tmpDir, 'outside-secret');
    await mkdir(join(storeRoot, 'projects'), { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    const fakeHash = 'b'.repeat(64);
    await writeFile(join(outsideDir, fakeHash), 'outside-data');

    // Directory junction works without elevated privileges on Windows and as a symlink on POSIX.
    await symlink(outsideDir, join(storeRoot, 'projects', 'proj-link'), 'junction');

    const store = new LocalDiskBlobStore(storeRoot);
    await assert.rejects(() => store.stat('proj-link', fakeHash), BlobValidationError);
    await assert.rejects(() => store.get('proj-link', fakeHash), BlobValidationError);
    await assert.rejects(() => store.delete('proj-link', fakeHash), BlobValidationError);
    await assert.rejects(() => store.put('proj-link', Buffer.from('x')), BlobValidationError);
  });
});

describe('sheet suggestion validation & PDFium inspection unit tests', () => {
  it('validates and bounds sheet suggestions', () => {
    const ok = parseSheetSuggestions([
      { pageIndex: 0, sheetNumber: ' A-101 ', title: ' Ground Floor Plan ' },
      { pageIndex: 1, sheetNumber: 'A-102' },
    ]);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.deepEqual(ok.suggestions, [
        { pageIndex: 0, sheetNumber: 'A-101', title: 'Ground Floor Plan' },
        { pageIndex: 1, sheetNumber: 'A-102', title: null },
      ]);
    }

    assert.equal(parseSheetSuggestions('not-an-array').ok, false);
    assert.equal(parseSheetSuggestions([{ pageIndex: -1, sheetNumber: 'A-1' }]).ok, false);
    assert.equal(parseSheetSuggestions([{ pageIndex: 0, sheetNumber: '   ' }]).ok, false);
    assert.equal(parseSheetSuggestions([{ pageIndex: 0, sheetNumber: 'A'.repeat(65) }]).ok, false);
  });

  it('reads authoritative page sizes and rotations via @nb/pdf-core', async () => {
    const store = new MemoryBlobStore();
    const pdf = buildPdfBytes([
      { width: 612, height: 792, rotation: 0 },
      { width: 595, height: 842, rotation: 90 },
      { width: 1191, height: 842, rotation: 180 },
    ]);
    const stat = await store.put('proj-pdf', pdf);
    const pages = await readPdfMetadataFromBlob(store, 'proj-pdf', stat.sha256);

    assert.equal(pages.length, 3);
    assert.deepEqual(pages[0], { position: 0, width: 612, height: 792, rotation: 0 });
    // Rotation 90 swaps width/height in PDFium's rotation-applied size.
    assert.deepEqual(pages[1], { position: 1, width: 842, height: 595, rotation: 90 });
    assert.deepEqual(pages[2], { position: 2, width: 1191, height: 842, rotation: 180 });
  });
});

// ---------------------------------------------------------------------------------------------
// Postgres 17 integration tests
// ---------------------------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const REQUIRE_POSTGRES = process.env.REQUIRE_POSTGRES_TESTS === '1';

if (!DATABASE_URL && REQUIRE_POSTGRES) {
  throw new Error('REQUIRE_POSTGRES_TESTS=1 is set but DATABASE_URL is not configured');
}

async function login(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}

describe('document uploads & PDF inspection (Postgres 17)', { skip: !DATABASE_URL ? 'DATABASE_URL is not set' : false }, () => {
  const dbName = `rc_uploads_${randomBytes(4).toString('hex')}`;
  let adminPool: pg.Pool;
  let dbHandle: DbHandle;
  let blobDir: string;
  let server: ServerInstance;
  let baseUrl: string;
  let cookie: string;
  const projectId = 'prj-harbour-01';

  function makeConfig(dbUrl: string, dir: string): ServerConfig {
    return loadConfig({
      DATABASE_URL: dbUrl,
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'silent',
      COOKIE_SECURE: 'false',
      AUTO_MIGRATE: 'false',
      BLOB_DIR: dir,
      UPLOAD_CHUNK_BYTES: String(8 * 1024 * 1024),
      MAX_UPLOAD_BYTES: String(512 * 1024 * 1024),
    });
  }

  before(async () => {
    adminPool = new pg.Pool({ connectionString: DATABASE_URL });
    await adminPool.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(DATABASE_URL!);
    url.pathname = `/${dbName}`;
    const isolatedUrl = url.toString();

    dbHandle = createDb(isolatedUrl);
    await runMigrations(dbHandle.pool);
    blobDir = await mkdtemp(join(tmpdir(), 'rc-upload-it-'));
    const config = makeConfig(isolatedUrl, blobDir);
    server = buildServer({ config, db: dbHandle.db, pool: dbHandle.pool });
    baseUrl = await server.app.listen({ host: '127.0.0.1', port: 0 });
  });

  after(async () => {
    await server?.app.close();
    await dbHandle?.close();
    if (adminPool) {
      await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await adminPool.end();
    }
    if (blobDir) await rm(blobDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dbHandle.pool.query(
      'TRUNCATE document_uploads, pages, sheets, revisions, documents, assets, project_members, projects, workspaces, sessions, users CASCADE',
    );
    const user = await createLocalUser(dbHandle.db, {
      email: 'reviewer@harbour.example',
      name: 'Morgan Rivera',
      password: 'fictional-password-42',
      role: 'user',
    });
    await dbHandle.db.insertInto('workspaces').values({ id: 'ws-harbour', name: 'Harbour Works' }).execute();
    await dbHandle.db
      .insertInto('projects')
      .values({ id: projectId, workspace_id: 'ws-harbour', name: 'Harbour Bridge', number: 'HB-01' })
      .execute();
    await dbHandle.db
      .insertInto('project_members')
      .values({ project_id: projectId, user_id: user.id, party_id: null, state: 'active' })
      .execute();
    cookie = await login(baseUrl, 'reviewer@harbour.example', 'fictional-password-42');
  });

  it('uploads a multi-page PDF in chunks, resumes after a cut connection, and extracts real PDFium metadata', async () => {
    const pdf = buildPdfBytes([
      { width: 612, height: 792, rotation: 0 },
      { width: 595, height: 842, rotation: 90 },
      { width: 1191, height: 842, rotation: 0 },
    ]);
    const sha256 = sha256Hex(pdf);

    // 1. Start upload session with client-detected sheet suggestions (including an out-of-range page).
    const startRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'S-100-Bridge-Deck.pdf',
        totalBytes: pdf.byteLength,
        expectedSha256: sha256,
        documentNumber: 'S-100',
        documentTitle: 'Bridge Deck Framing',
        revisionLabel: 'A',
        sheetSuggestions: [
          { pageIndex: 0, sheetNumber: 'S-101', title: 'Deck Plan' },
          { pageIndex: 1, sheetNumber: 'S-102', title: 'Pier Elevation' },
          { pageIndex: 99, sheetNumber: 'S-999', title: 'Out Of Range Suggestion' },
        ],
      }),
    });
    assert.equal(startRes.status, 201);
    const created = (await startRes.json()) as { uploadId: string; chunkSize: number; receivedBytes: number };
    assert.equal(created.receivedBytes, 0);
    assert.ok(created.chunkSize > 0);

    // 2. Upload first part via PUT + x-upload-offset, then simulate a cut connection before finishing.
    const splitAt = Math.floor(pdf.byteLength / 2);
    const part1Res = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${created.uploadId}/chunks`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-upload-offset': '0',
        cookie,
        origin: baseUrl,
      },
      body: toBody(pdf.subarray(0, splitAt)),
    });
    assert.equal(part1Res.status, 200);
    const part1 = (await part1Res.json()) as { receivedBytes: number; complete: boolean };
    assert.equal(part1.receivedBytes, splitAt);
    assert.equal(part1.complete, false);

    // 3. Reconnect: query upload status to learn where to resume from.
    const statusRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${created.uploadId}`, {
      headers: { cookie },
    });
    assert.equal(statusRes.status, 200);
    const status = (await statusRes.json()) as { receivedBytes: number; totalBytes: number; state: string };
    assert.equal(status.receivedBytes, splitAt);
    assert.equal(status.totalBytes, pdf.byteLength);
    assert.equal(status.state, 'uploading');

    // 4. Resume remaining bytes via PATCH + Content-Range.
    const part2Res = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${created.uploadId}/chunks`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/octet-stream',
        'content-range': `bytes ${status.receivedBytes}-${pdf.byteLength - 1}/${pdf.byteLength}`,
        cookie,
        origin: baseUrl,
      },
      body: toBody(pdf.subarray(status.receivedBytes)),
    });
    assert.equal(part2Res.status, 200);
    const part2 = (await part2Res.json()) as { receivedBytes: number; complete: boolean };
    assert.equal(part2.receivedBytes, pdf.byteLength);
    assert.equal(part2.complete, true);

    // 5. Complete upload and wait for the server PDF job to finish.
    const completeRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${created.uploadId}/complete`, {
      method: 'POST',
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(completeRes.status, 201);
    const completed = (await completeRes.json()) as {
      documentId: string;
      revisionId: string;
      fileSha256: string;
      fileSize: number;
      processingStatus: string;
    };
    assert.equal(completed.fileSha256, sha256);
    assert.equal(completed.fileSize, pdf.byteLength);

    await server.jobRunner.drain();

    // 6. Assert Postgres rows directly.
    const doc = await dbHandle.db
      .selectFrom('documents')
      .selectAll()
      .where('id', '=', completed.documentId)
      .executeTakeFirst();
    assert.ok(doc);
    assert.equal(doc.project_id, projectId);
    assert.equal(doc.number, 'S-100');
    assert.equal(doc.title, 'Bridge Deck Framing');

    const rev = await dbHandle.db
      .selectFrom('revisions')
      .selectAll()
      .where('id', '=', completed.revisionId)
      .executeTakeFirst();
    assert.ok(rev);
    assert.equal(rev.label, 'A');
    assert.equal(rev.file_sha256, sha256);
    assert.equal(Number(rev.file_size), pdf.byteLength);
    assert.equal(rev.page_count, 3);
    assert.equal(rev.processing_status, 'ready');
    assert.equal(rev.processing_error, null);

    // Once ready, the revision row is strictly immutable again.
    await assert.rejects(
      () => dbHandle.pool.query(`UPDATE revisions SET label = 'B' WHERE id = $1`, [completed.revisionId]),
      /rows are immutable/,
    );

    const pages = await dbHandle.db
      .selectFrom('pages')
      .selectAll()
      .where('revision_id', '=', completed.revisionId)
      .orderBy('position', 'asc')
      .execute();
    assert.equal(pages.length, 3);
    assert.equal(pages[0]!.width, 612);
    assert.equal(pages[0]!.height, 792);
    assert.equal(pages[0]!.rotation, 0);
    assert.ok(pages[0]!.sheet_id);

    assert.equal(pages[1]!.width, 842);
    assert.equal(pages[1]!.height, 595);
    assert.equal(pages[1]!.rotation, 90);
    assert.ok(pages[1]!.sheet_id);

    assert.equal(pages[2]!.width, 1191);
    assert.equal(pages[2]!.height, 842);
    assert.equal(pages[2]!.rotation, 0);
    assert.equal(pages[2]!.sheet_id, null);

    const sheets = await dbHandle.db
      .selectFrom('sheets')
      .selectAll()
      .where('document_id', '=', completed.documentId)
      .orderBy('sheet_number', 'asc')
      .execute();
    assert.deepEqual(
      sheets.map((s) => ({ sheet_number: s.sheet_number, title: s.title })),
      [
        { sheet_number: 'S-101', title: 'Deck Plan' },
        { sheet_number: 'S-102', title: 'Pier Elevation' },
      ],
    );

    // 7. Verify HTTP read endpoint returns the same authoritative revision & pages.
    const revRes = await fetch(
      `${baseUrl}/api/projects/${projectId}/documents/${completed.documentId}/revisions/${completed.revisionId}`,
      { headers: { cookie } },
    );
    assert.equal(revRes.status, 200);
    const revJson = (await revRes.json()) as { processingStatus: string; pageCount: number; pages: unknown[] };
    assert.equal(revJson.processingStatus, 'ready');
    assert.equal(revJson.pageCount, 3);
    assert.equal(revJson.pages.length, 3);
  });

  it('refuses hash mismatches cleanly with 400 and deletes the staging file', async () => {
    const pdf = buildPdfBytes([{ width: 612, height: 792 }]);
    const wrongHash = '0'.repeat(64);

    const startRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'mismatch.pdf',
        totalBytes: pdf.byteLength,
        expectedSha256: wrongHash,
      }),
    });
    assert.equal(startRes.status, 201);
    const { uploadId } = (await startRes.json()) as { uploadId: string };

    const chunkRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-upload-offset': '0',
        cookie,
        origin: baseUrl,
      },
      body: toBody(pdf),
    });
    assert.equal(chunkRes.status, 200);

    const completeRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
      method: 'POST',
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(completeRes.status, 400);
    const errBody = (await completeRes.json()) as { error: string; expectedSha256: string; actualSha256: string };
    assert.equal(errBody.error, 'hash_mismatch');
    assert.equal(errBody.expectedSha256, wrongHash);
    assert.equal(errBody.actualSha256, sha256Hex(pdf));

    // Staging file must be cleaned up and no revision row created.
    assert.equal(await server.blobStore.statUpload(projectId, uploadId), null);
    const revCount = await dbHandle.pool.query('SELECT count(*)::int AS n FROM revisions');
    assert.equal(revCount.rows[0]!.n, 0);
  });

  it('marks revision failed cleanly when uploaded bytes are not a valid PDF', async () => {
    const corrupt = Buffer.from('not-a-valid-pdf-document-at-all');
    const sha256 = sha256Hex(corrupt);

    const startRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'corrupt.pdf',
        totalBytes: corrupt.byteLength,
        expectedSha256: sha256,
      }),
    });
    assert.equal(startRes.status, 201);
    const { uploadId } = (await startRes.json()) as { uploadId: string };

    await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: baseUrl },
      body: toBody(corrupt),
    });

    const completeRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
      method: 'POST',
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(completeRes.status, 201);
    const { revisionId } = (await completeRes.json()) as { revisionId: string };

    await server.jobRunner.drain();

    const rev = await dbHandle.db
      .selectFrom('revisions')
      .select(['processing_status', 'processing_error', 'page_count'])
      .where('id', '=', revisionId)
      .executeTakeFirst();
    assert.ok(rev);
    assert.equal(rev.processing_status, 'failed');
    assert.ok(rev.processing_error && rev.processing_error.length > 0);
    assert.equal(rev.page_count, 0);

    const pages = await dbHandle.db.selectFrom('pages').select('id').where('revision_id', '=', revisionId).execute();
    assert.equal(pages.length, 0);
  });

  it('uploads a 300 MB generated PDF in chunks, resumes after a cut connection, verifies SHA-256, and reads pages via @nb/pdf-core', async () => {
    const PADDING_BYTES = 300 * 1024 * 1024; // 300 MiB (> 300 MB)
    const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MiB chunks -> ~19 chunks
    const CUT_AFTER_CHUNK = 9; // Simulate cut connection at 144 MiB

    const largePdf = createStreamingLargePdf(
      [
        { width: 612, height: 792, rotation: 0 },
        { width: 1191, height: 842, rotation: 0 },
      ],
      PADDING_BYTES,
    );
    assert.ok(largePdf.totalBytes > 300 * 1024 * 1024);

    const startRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'Full-Set-300MB.pdf',
        totalBytes: largePdf.totalBytes,
        expectedSha256: largePdf.sha256,
        documentNumber: 'SET-300',
        documentTitle: 'Full Tender Set',
        revisionLabel: '0',
        sheetSuggestions: [
          { pageIndex: 0, sheetNumber: 'G-001', title: 'Cover Sheet' },
          { pageIndex: 1, sheetNumber: 'A-101', title: 'Site Plan' },
        ],
      }),
    });
    assert.equal(startRes.status, 201);
    const { uploadId } = (await startRes.json()) as { uploadId: string };

    // Phase 1: Upload chunks up to CUT_AFTER_CHUNK, then simulate a connection drop.
    let offset = 0;
    for (let i = 0; i < CUT_AFTER_CHUNK; i++) {
      const chunk = largePdf.readRange(offset, CHUNK_SIZE);
      const res = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-upload-offset': String(offset),
          cookie,
          origin: baseUrl,
        },
        body: toBody(chunk),
      });
      assert.equal(res.status, 200);
      offset += chunk.byteLength;
    }

    // Query status after the simulated cut connection.
    const statusRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}`, {
      headers: { cookie },
    });
    assert.equal(statusRes.status, 200);
    const status = (await statusRes.json()) as { receivedBytes: number; state: string };
    assert.equal(status.state, 'uploading');
    assert.equal(status.receivedBytes, CUT_AFTER_CHUNK * CHUNK_SIZE);

    // Phase 2: Resume from server-reported offset until complete.
    offset = status.receivedBytes;
    while (offset < largePdf.totalBytes) {
      const chunk = largePdf.readRange(offset, CHUNK_SIZE);
      const res = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-upload-offset': String(offset),
          cookie,
          origin: baseUrl,
        },
        body: toBody(chunk),
      });
      assert.equal(res.status, 200);
      offset += chunk.byteLength;
    }

    // Complete upload (streaming SHA-256 verification + atomic rename) and run PDFium job.
    const completeRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
      method: 'POST',
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(completeRes.status, 201);
    const completed = (await completeRes.json()) as {
      documentId: string;
      revisionId: string;
      fileSha256: string;
      fileSize: number;
    };
    assert.equal(completed.fileSha256, largePdf.sha256);
    assert.equal(completed.fileSize, largePdf.totalBytes);

    await server.jobRunner.drain();

    const rev = await dbHandle.db
      .selectFrom('revisions')
      .selectAll()
      .where('id', '=', completed.revisionId)
      .executeTakeFirst();
    assert.ok(rev);
    assert.equal(rev.processing_status, 'ready');
    assert.equal(rev.processing_error, null);
    assert.equal(rev.page_count, 2);
    assert.equal(Number(rev.file_size), largePdf.totalBytes);

    const pages = await dbHandle.db
      .selectFrom('pages')
      .select(['position', 'width', 'height', 'rotation'])
      .where('revision_id', '=', completed.revisionId)
      .orderBy('position', 'asc')
      .execute();
    assert.deepEqual(pages, [
      { position: 0, width: 612, height: 792, rotation: 0 },
      { position: 1, width: 1191, height: 842, rotation: 0 },
    ]);
  });

  it('enforces authentication (401), project membership (404), and CSRF origin checks (403)', async () => {
    const pdf = buildPdfBytes([{ width: 612, height: 792 }]);
    const sha256 = sha256Hex(pdf);

    // Create an upload and a completed revision as the authorized project member.
    const startRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'auth-check.pdf',
        totalBytes: pdf.byteLength,
        expectedSha256: sha256,
        documentNumber: 'AUTH-01',
      }),
    });
    assert.equal(startRes.status, 201);
    const { uploadId } = (await startRes.json()) as { uploadId: string };

    // Unauthenticated requests must receive 401 across all upload & revision endpoints.
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseUrl },
          body: JSON.stringify({ filename: 'x.pdf', totalBytes: pdf.byteLength, expectedSha256: sha256 }),
        })
      ).status,
      401,
    );
    assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}`)).status, 401);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', origin: baseUrl },
          body: toBody(pdf),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
          method: 'POST',
          headers: { origin: baseUrl },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}`, {
          method: 'DELETE',
          headers: { origin: baseUrl },
        })
      ).status,
      401,
    );

    // Disallowed Origin header on state-changing routes must receive 403.
    const badOrigin = 'https://untrusted.example';
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie, origin: badOrigin },
          body: JSON.stringify({ filename: 'csrf.pdf', totalBytes: pdf.byteLength, expectedSha256: sha256 }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: badOrigin },
          body: toBody(pdf),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
          method: 'POST',
          headers: { cookie, origin: badOrigin },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}`, {
          method: 'DELETE',
          headers: { cookie, origin: badOrigin },
        })
      ).status,
      403,
    );

    // Finish the upload as the authorized member so we also have a document/revision to test.
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: baseUrl },
          body: toBody(pdf),
        })
      ).status,
      200,
    );
    const doneRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
      method: 'POST',
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(doneRes.status, 201);
    const { documentId, revisionId } = (await doneRes.json()) as { documentId: string; revisionId: string };
    await server.jobRunner.drain();

    // Unauthenticated revision GET must return 401.
    assert.equal(
      (await fetch(`${baseUrl}/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}`)).status,
      401,
    );

    // A second user who is NOT a member of projectId must receive 404 across all endpoints.
    await createLocalUser(dbHandle.db, {
      email: 'outsider@harbour.example',
      name: 'Taylor Brooks',
      password: 'fictional-password-99',
      role: 'user',
    });
    const outsiderCookie = await login(baseUrl, 'outsider@harbour.example', 'fictional-password-99');

    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: outsiderCookie, origin: baseUrl },
          body: JSON.stringify({ filename: 'x.pdf', totalBytes: pdf.byteLength, expectedSha256: sha256 }),
        })
      ).status,
      404,
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}`, { headers: { cookie: outsiderCookie } }))
        .status,
      404,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
          method: 'PUT',
          headers: {
            'content-type': 'application/octet-stream',
            'x-upload-offset': '0',
            cookie: outsiderCookie,
            origin: baseUrl,
          },
          body: toBody(pdf),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
          method: 'POST',
          headers: { cookie: outsiderCookie, origin: baseUrl },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}`, {
          method: 'DELETE',
          headers: { cookie: outsiderCookie, origin: baseUrl },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/projects/${projectId}/documents/${documentId}/revisions/${revisionId}`, {
          headers: { cookie: outsiderCookie },
        })
      ).status,
      404,
    );
  });

  it('aborts an active upload via DELETE and removes the staging file', async () => {
    const pdf = buildPdfBytes([{ width: 612, height: 792 }]);
    const startRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'abort-me.pdf',
        totalBytes: pdf.byteLength,
        expectedSha256: sha256Hex(pdf),
      }),
    });
    assert.equal(startRes.status, 201);
    const { uploadId } = (await startRes.json()) as { uploadId: string };

    // Upload a partial chunk so staging file has bytes on disk.
    const partRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: baseUrl },
      body: toBody(pdf.subarray(0, 32)),
    });
    assert.equal(partRes.status, 200);
    assert.deepEqual(await server.blobStore.statUpload(projectId, uploadId), { receivedBytes: 32 });

    // DELETE aborts the upload and deletes the staging file.
    const delRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}`, {
      method: 'DELETE',
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(delRes.status, 200);
    assert.deepEqual(await delRes.json(), { uploadId, state: 'aborted' });
    assert.equal(await server.blobStore.statUpload(projectId, uploadId), null);

    // Subsequent chunk appends must be refused with 409.
    const afterRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '32', cookie, origin: baseUrl },
      body: toBody(pdf.subarray(32)),
    });
    assert.equal(afterRes.status, 409);
  });

  it('enforces upload_size_exceeded both via Content-Length and incrementally while streaming', async () => {
    const pdf = buildPdfBytes([{ width: 612, height: 792 }]);
    const startRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'size-cap.pdf',
        totalBytes: 100,
        expectedSha256: sha256Hex(pdf),
      }),
    });
    assert.equal(startRes.status, 201);
    const { uploadId } = (await startRes.json()) as { uploadId: string };

    // 1. Oversized Content-Length is rejected immediately with 400.
    const clRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: baseUrl },
      body: toBody(Buffer.alloc(150, 0x41)),
    });
    assert.equal(clRes.status, 400);
    assert.equal(((await clRes.json()) as { error: string }).error, 'upload_size_exceeded');

    // 2. Transfer-Encoding: chunked (no Content-Length) exceeding totalBytes aborts mid-stream.
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60).fill(0x41));
        controller.enqueue(new Uint8Array(60).fill(0x42));
        controller.close();
      },
    });
    const streamedRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: baseUrl },
      body: streamBody,
      // @ts-expect-error Node fetch requires duplex: 'half' for ReadableStream request bodies.
      duplex: 'half',
    });
    assert.equal(streamedRes.status, 400);
    assert.equal(((await streamedRes.json()) as { error: string }).error, 'upload_size_exceeded');
    assert.equal(await server.blobStore.statUpload(projectId, uploadId), null);

    const statusRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}`, {
      headers: { cookie },
    });
    assert.equal(statusRes.status, 200);
    assert.equal(((await statusRes.json()) as { state: string }).state, 'failed');
  });

  it('handles concurrent double-complete idempotently and returns 409 on duplicate document numbers or revision labels', async () => {
    const pdf = buildPdfBytes([{ width: 612, height: 792 }]);
    const sha256 = sha256Hex(pdf);

    const startRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'race-test.pdf',
        totalBytes: pdf.byteLength,
        expectedSha256: sha256,
        documentNumber: 'RACE-01',
        revisionLabel: '1',
      }),
    });
    assert.equal(startRes.status, 201);
    const { uploadId } = (await startRes.json()) as { uploadId: string };

    const chunkRes = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: baseUrl },
      body: toBody(pdf),
    });
    assert.equal(chunkRes.status, 200);

    // Fire two concurrent POST .../complete requests for the same uploadId.
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
        method: 'POST',
        headers: { cookie, origin: baseUrl },
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/uploads/${uploadId}/complete`, {
        method: 'POST',
        headers: { cookie, origin: baseUrl },
      }),
    ]);
    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 201]);
    const bodyA = (await resA.json()) as { documentId: string; revisionId: string };
    const bodyB = (await resB.json()) as { documentId: string; revisionId: string };
    assert.equal(bodyA.documentId, bodyB.documentId);
    assert.equal(bodyA.revisionId, bodyB.revisionId);

    await server.jobRunner.drain();

    // Only one document and one revision row should exist.
    const docCount = await dbHandle.pool.query('SELECT count(*)::int AS n FROM documents');
    const revCount = await dbHandle.pool.query('SELECT count(*)::int AS n FROM revisions');
    assert.equal(docCount.rows[0]!.n, 1);
    assert.equal(revCount.rows[0]!.n, 1);

    // Duplicate documentNumber in the same project must return 409 and mark upload failed.
    const dupDocStart = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'dup-doc.pdf',
        totalBytes: pdf.byteLength,
        expectedSha256: sha256,
        documentNumber: 'RACE-01',
        revisionLabel: '1',
      }),
    });
    assert.equal(dupDocStart.status, 201);
    const { uploadId: dupDocUploadId } = (await dupDocStart.json()) as { uploadId: string };
    await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${dupDocUploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: baseUrl },
      body: toBody(pdf),
    });
    const dupDocComplete = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${dupDocUploadId}/complete`, {
      method: 'POST',
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(dupDocComplete.status, 409);
    const dupDocStatus = (await (
      await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${dupDocUploadId}`, { headers: { cookie } })
    ).json()) as { state: string };
    assert.equal(dupDocStatus.state, 'failed');

    // Duplicate revisionLabel on an existing documentId must return 409 and mark upload failed.
    const dupRevStart = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({
        filename: 'dup-rev.pdf',
        totalBytes: pdf.byteLength,
        expectedSha256: sha256,
        documentId: bodyA.documentId,
        revisionLabel: '1',
      }),
    });
    assert.equal(dupRevStart.status, 201);
    const { uploadId: dupRevUploadId } = (await dupRevStart.json()) as { uploadId: string };
    await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${dupRevUploadId}/chunks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-offset': '0', cookie, origin: baseUrl },
      body: toBody(pdf),
    });
    const dupRevComplete = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${dupRevUploadId}/complete`, {
      method: 'POST',
      headers: { cookie, origin: baseUrl },
    });
    assert.equal(dupRevComplete.status, 409);
    const dupRevStatus = (await (
      await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${dupRevUploadId}`, { headers: { cookie } })
    ).json()) as { state: string };
    assert.equal(dupRevStatus.state, 'failed');
  });
});
