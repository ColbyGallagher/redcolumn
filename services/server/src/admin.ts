import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type pg from 'pg';
import { checkDbConnection } from './db.ts';
import { checkMigrations, type MigrationCheckResult } from './migrate.ts';

const execFileAsync = promisify(execFile);

export const BACKUP_MANIFEST_VERSION = 1;
export const DATABASE_DUMP_FILENAME = 'database.dump';
export const MANIFEST_FILENAME = 'manifest.json';
export const BLOBS_SUBDIR = 'blobs';

const SHA256_RE = /^[0-9a-f]{64}$/;

export interface BackupBlobEntry {
  /** Forward-slash relative path under `blobs/`, e.g. `projects/<id>/<sha256>`. */
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface BackupManifest {
  version: 1;
  createdAt: string;
  schemaVersion: string | null;
  appliedMigrations: string[];
  database: {
    file: string;
    sha256: string;
    sizeBytes: number;
  };
  blobs: BackupBlobEntry[];
}

export interface BackupVerifyResult {
  ok: boolean;
  manifest?: BackupManifest;
  errors: string[];
}

export interface VerifyReport {
  ok: boolean;
  databaseConnected: boolean;
  migrations: MigrationCheckResult;
  assetsChecked: number;
  missingBlobs: string[];
  mismatchedBlobs: string[];
  rowCounts: Record<string, number>;
  streamsChecked: number;
  nonMonotonicStreams: string[];
  errors: string[];
}

export type PgDumpExecutor = (databaseUrl: string, outFile: string) => Promise<void>;
export type PgRestoreExecutor = (databaseUrl: string, dumpFile: string) => Promise<void>;

export function isSafeRelativePath(relPath: string): boolean {
  if (!relPath || relPath.includes('\0') || relPath.includes('\\')) return false;
  if (relPath.startsWith('/') || isAbsolute(relPath)) return false;
  const segments = relPath.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') return false;
  }
  return true;
}

export function safeResolveUnder(baseDir: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Unsafe relative path: "${relativePath}"`);
  }
  const resolvedBase = resolve(baseDir);
  const target = resolve(resolvedBase, ...relativePath.split('/'));
  const rel = relative(resolvedBase, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: "${relativePath}"`);
  }
  return target;
}

export async function hashFileSha256(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buf.length;
      hash.update(buf);
    });
    stream.on('end', () => resolvePromise());
    stream.on('error', reject);
  });
  return { sha256: hash.digest('hex'), sizeBytes };
}

export async function collectBlobFiles(blobDir: string): Promise<string[]> {
  try {
    const info = await stat(blobDir);
    if (!info.isDirectory()) return [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const results: string[] = [];
  const walk = async (currentDir: string, prefix: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
  };
  await walk(blobDir, '');
  return results;
}

export function validateBackupManifest(raw: unknown): BackupManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Manifest must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== BACKUP_MANIFEST_VERSION) {
    throw new Error(`Unsupported backup manifest version: ${String(obj.version)}`);
  }
  if (typeof obj.createdAt !== 'string' || Number.isNaN(Date.parse(obj.createdAt))) {
    throw new Error('Manifest createdAt must be a valid ISO timestamp');
  }
  if (obj.schemaVersion !== null && typeof obj.schemaVersion !== 'string') {
    throw new Error('Manifest schemaVersion must be a string or null');
  }
  if (!Array.isArray(obj.appliedMigrations) || !obj.appliedMigrations.every((m) => typeof m === 'string')) {
    throw new Error('Manifest appliedMigrations must be an array of strings');
  }

  if (typeof obj.database !== 'object' || obj.database === null || Array.isArray(obj.database)) {
    throw new Error('Manifest database entry must be an object');
  }
  const db = obj.database as Record<string, unknown>;
  if (typeof db.file !== 'string' || !isSafeRelativePath(db.file) || db.file.includes('/')) {
    throw new Error(`Invalid manifest database.file: "${String(db.file)}"`);
  }
  if (typeof db.sha256 !== 'string' || !SHA256_RE.test(db.sha256)) {
    throw new Error('Manifest database.sha256 must be a 64-character lowercase hex string');
  }
  if (typeof db.sizeBytes !== 'number' || !Number.isSafeInteger(db.sizeBytes) || db.sizeBytes < 0) {
    throw new Error('Manifest database.sizeBytes must be a non-negative integer');
  }

  if (!Array.isArray(obj.blobs)) {
    throw new Error('Manifest blobs must be an array');
  }
  const seenPaths = new Set<string>();
  const blobs: BackupBlobEntry[] = [];
  for (const item of obj.blobs) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Each manifest blob entry must be an object');
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== 'string' || !isSafeRelativePath(entry.path)) {
      throw new Error(`Invalid manifest blob path: "${String(entry.path)}"`);
    }
    if (seenPaths.has(entry.path)) {
      throw new Error(`Duplicate manifest blob path: "${entry.path}"`);
    }
    seenPaths.add(entry.path);
    if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) {
      throw new Error(`Invalid SHA-256 for blob "${entry.path}"`);
    }
    if (typeof entry.sizeBytes !== 'number' || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
      throw new Error(`Invalid sizeBytes for blob "${entry.path}"`);
    }
    blobs.push({ path: entry.path, sha256: entry.sha256, sizeBytes: entry.sizeBytes });
  }

  return {
    version: 1,
    createdAt: obj.createdAt,
    schemaVersion: obj.schemaVersion,
    appliedMigrations: obj.appliedMigrations as string[],
    database: {
      file: db.file,
      sha256: db.sha256,
      sizeBytes: db.sizeBytes,
    },
    blobs,
  };
}

export async function verifyBackupDirectory(dir: string): Promise<BackupVerifyResult> {
  const errors: string[] = [];
  const manifestPath = join(dir, MANIFEST_FILENAME);
  let rawText: string;
  try {
    rawText = await readFile(manifestPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      errors: [`Cannot read ${MANIFEST_FILENAME}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  let manifest: BackupManifest;
  try {
    manifest = validateBackupManifest(JSON.parse(rawText));
  } catch (err) {
    return {
      ok: false,
      errors: [`Invalid ${MANIFEST_FILENAME}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const dumpPath = safeResolveUnder(dir, manifest.database.file);
  try {
    const actual = await hashFileSha256(dumpPath);
    if (actual.sizeBytes !== manifest.database.sizeBytes) {
      errors.push(
        `Database dump size mismatch: expected ${manifest.database.sizeBytes}, got ${actual.sizeBytes}`,
      );
    }
    if (actual.sha256 !== manifest.database.sha256) {
      errors.push(
        `Database dump SHA-256 mismatch: expected ${manifest.database.sha256}, got ${actual.sha256}`,
      );
    }
  } catch (err) {
    errors.push(`Database dump missing or unreadable (${manifest.database.file}): ${err instanceof Error ? err.message : String(err)}`);
  }

  const blobsRoot = join(dir, BLOBS_SUBDIR);
  for (const entry of manifest.blobs) {
    const blobPath = safeResolveUnder(blobsRoot, entry.path);
    try {
      const actual = await hashFileSha256(blobPath);
      if (actual.sizeBytes !== entry.sizeBytes) {
        errors.push(`Blob size mismatch for ${entry.path}: expected ${entry.sizeBytes}, got ${actual.sizeBytes}`);
      }
      if (actual.sha256 !== entry.sha256) {
        errors.push(`Blob SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, got ${actual.sha256}`);
      }
    } catch (err) {
      errors.push(`Blob missing or unreadable (${entry.path}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ok: errors.length === 0, manifest, errors };
}

export async function defaultExecPgDump(databaseUrl: string, outFile: string): Promise<void> {
  await execFileAsync('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', outFile, databaseUrl], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function defaultExecPgRestore(databaseUrl: string, dumpFile: string): Promise<void> {
  await execFileAsync(
    'pg_restore',
    ['--clean', '--if-exists', '--no-owner', '--no-acl', '-d', databaseUrl, dumpFile],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}

export async function runBackup(options: {
  databaseUrl: string;
  pool: pg.Pool;
  blobDir: string;
  outDir: string;
  execPgDump?: PgDumpExecutor;
}): Promise<BackupManifest> {
  const { databaseUrl, pool, blobDir, outDir } = options;
  const execPgDump = options.execPgDump ?? defaultExecPgDump;

  await mkdir(outDir, { recursive: true });
  const existing = await readdir(outDir);
  if (existing.length > 0) {
    throw new Error(`Backup output directory is not empty: ${outDir}`);
  }

  // Record applied migrations before dumping.
  const appliedMigrations: string[] = [];
  const existsRes = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
  );
  if (existsRes.rows[0]?.exists) {
    const rows = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    for (const row of rows.rows) appliedMigrations.push(row.version);
  }

  // Write pg_dump -Fc first, then copy immutable blobs so every blob referenced by the dump exists.
  const dumpPath = join(outDir, DATABASE_DUMP_FILENAME);
  await execPgDump(databaseUrl, dumpPath);
  const dumpHash = await hashFileSha256(dumpPath);

  const blobRelPaths = await collectBlobFiles(blobDir);
  const blobsRoot = join(outDir, BLOBS_SUBDIR);
  const blobs: BackupBlobEntry[] = [];
  for (const relPath of blobRelPaths) {
    const src = safeResolveUnder(blobDir, relPath);
    const dst = safeResolveUnder(blobsRoot, relPath);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    const digest = await hashFileSha256(dst);
    blobs.push({ path: relPath, sha256: digest.sha256, sizeBytes: digest.sizeBytes });
  }

  const manifest: BackupManifest = {
    version: BACKUP_MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    schemaVersion: appliedMigrations.length > 0 ? appliedMigrations[appliedMigrations.length - 1]! : null,
    appliedMigrations,
    database: {
      file: DATABASE_DUMP_FILENAME,
      sha256: dumpHash.sha256,
      sizeBytes: dumpHash.sizeBytes,
    },
    blobs,
  };

  await writeFile(join(outDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export async function runRestore(options: {
  databaseUrl: string;
  pool: pg.Pool;
  blobDir: string;
  fromDir: string;
  execPgRestore?: PgRestoreExecutor;
}): Promise<{ manifest: BackupManifest; verification: VerifyReport }> {
  const { databaseUrl, pool, blobDir, fromDir } = options;
  const execPgRestore = options.execPgRestore ?? defaultExecPgRestore;

  const check = await verifyBackupDirectory(fromDir);
  if (!check.ok || !check.manifest) {
    throw new Error(`Backup verification failed:\n${check.errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  const { manifest } = check;

  const dumpPath = safeResolveUnder(fromDir, manifest.database.file);
  await execPgRestore(databaseUrl, dumpPath);

  await mkdir(blobDir, { recursive: true });
  const blobsRoot = join(fromDir, BLOBS_SUBDIR);
  for (const entry of manifest.blobs) {
    const src = safeResolveUnder(blobsRoot, entry.path);
    const dst = safeResolveUnder(blobDir, entry.path);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }

  const verification = await runVerify({ pool, blobDir });
  if (!verification.ok) {
    throw new Error(`Post-restore verification failed:\n${verification.errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  return { manifest, verification };
}

const ROW_COUNT_TABLES = [
  'users',
  'sessions',
  'workspaces',
  'projects',
  'documents',
  'revisions',
  'streams',
  'markups',
  'placements',
  'issues',
  'responses',
  'events',
  'assets',
] as const;

export async function runVerify(options: {
  pool: pg.Pool;
  blobDir: string;
  eventStreamSampleLimit?: number;
}): Promise<VerifyReport> {
  const { pool, blobDir } = options;
  const sampleLimit = options.eventStreamSampleLimit ?? 50;
  const errors: string[] = [];
  const missingBlobs: string[] = [];
  const mismatchedBlobs: string[] = [];
  const nonMonotonicStreams: string[] = [];
  const rowCounts: Record<string, number> = {};

  const databaseConnected = await checkDbConnection(pool);
  if (!databaseConnected) {
    return {
      ok: false,
      databaseConnected: false,
      migrations: { applied: [], pending: [], mismatched: [], unknown: [] },
      assetsChecked: 0,
      missingBlobs,
      mismatchedBlobs,
      rowCounts,
      streamsChecked: 0,
      nonMonotonicStreams,
      errors: ['Database connection failed'],
    };
  }

  const migrations = await checkMigrations(pool);
  if (migrations.unknown.length > 0) {
    errors.push(`Unknown migrations in database: ${migrations.unknown.join(', ')}`);
  }
  if (migrations.mismatched.length > 0) {
    errors.push(`Migration checksum mismatch: ${migrations.mismatched.join(', ')}`);
  }
  if (migrations.pending.length > 0) {
    errors.push(`Pending migrations (${migrations.pending.length}): ${migrations.pending.join(', ')}`);
  }

  for (const table of ROW_COUNT_TABLES) {
    const exists = await pool.query<{ exists: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [`public.${table}`],
    );
    if (exists.rows[0]?.exists) {
      const countRes = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
      rowCounts[table] = Number(countRes.rows[0]?.count ?? '0');
    }
  }

  let assetsChecked = 0;
  if (rowCounts.assets !== undefined) {
    const assetRows = await pool.query<{
      project_id: string;
      sha256: string;
      size_bytes: string;
      storage_key: string;
    }>('SELECT project_id, sha256, size_bytes::text, storage_key FROM assets ORDER BY project_id, sha256');

    for (const row of assetRows.rows) {
      assetsChecked += 1;
      const relKey = row.storage_key?.trim() || `projects/${row.project_id}/${row.sha256}`;
      let fullPath: string;
      try {
        fullPath = safeResolveUnder(blobDir, relKey);
      } catch {
        mismatchedBlobs.push(relKey);
        errors.push(`Asset has unsafe storage_key: ${relKey}`);
        continue;
      }

      try {
        const actual = await hashFileSha256(fullPath);
        const expectedSize = Number(row.size_bytes);
        if (actual.sha256 !== row.sha256 || actual.sizeBytes !== expectedSize) {
          mismatchedBlobs.push(relKey);
          errors.push(
            `Blob integrity mismatch for ${relKey}: expected sha256=${row.sha256} (${expectedSize} bytes), got sha256=${actual.sha256} (${actual.sizeBytes} bytes)`,
          );
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          missingBlobs.push(relKey);
          errors.push(`Missing blob for asset ${relKey}`);
        } else {
          mismatchedBlobs.push(relKey);
          errors.push(`Unreadable blob ${relKey}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  let streamsChecked = 0;
  if (rowCounts.events !== undefined) {
    const streamRows = await pool.query<{ stream_id: string; stream_seq: string | null }>(
      `SELECT e.stream_id, s.seq::text AS stream_seq
       FROM (SELECT DISTINCT stream_id FROM events ORDER BY stream_id ASC LIMIT $1) e
       LEFT JOIN streams s ON s.id = e.stream_id`,
      [sampleLimit],
    );

    for (const s of streamRows.rows) {
      streamsChecked += 1;
      const seqRows = await pool.query<{ seq: string }>(
        'SELECT seq::text FROM events WHERE stream_id = $1 ORDER BY received_at ASC, seq ASC',
        [s.stream_id],
      );
      let prev = 0n;
      let ok = true;
      for (const r of seqRows.rows) {
        const current = BigInt(r.seq);
        if (current <= prev) {
          ok = false;
          break;
        }
        prev = current;
      }
      if (ok && s.stream_seq !== null && prev > BigInt(s.stream_seq)) {
        ok = false;
      }
      if (!ok) {
        nonMonotonicStreams.push(s.stream_id);
        errors.push(`Event stream ${s.stream_id} failed sequence monotonicity check`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    databaseConnected,
    migrations,
    assetsChecked,
    missingBlobs,
    mismatchedBlobs,
    rowCounts,
    streamsChecked,
    nonMonotonicStreams,
    errors,
  };
}
