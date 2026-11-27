import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATION_LOCK_KEY = '724918302411891';
const MIGRATION_FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationCheckResult {
  applied: string[];
  pending: string[];
  mismatched: string[];
}

export interface MigrationRunResult {
  appliedNow: string[];
  alreadyApplied: string[];
}

export function listMigrationFiles(migrationsDir: string = DEFAULT_MIGRATIONS_DIR): MigrationFile[] {
  const entries = readdirSync(migrationsDir).sort();
  const files: MigrationFile[] = [];
  const seenVersions = new Set<string>();
  for (const filename of entries) {
    if (!filename.endsWith('.sql')) continue;
    const match = MIGRATION_FILE_RE.exec(filename);
    if (!match) {
      throw new Error(`Invalid migration filename "${filename}": expected NNNN_description.sql`);
    }
    const version = match[1]!;
    const name = match[2]!;
    if (seenVersions.has(version)) {
      throw new Error(`Duplicate migration version "${version}"`);
    }
    seenVersions.add(version);
    const sql = readFileSync(join(migrationsDir, filename), 'utf8');
    const checksum = createHash('sha256').update(sql, 'utf8').digest('hex');
    files.push({ version, name, filename, sql, checksum });
  }
  return files;
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function withMigrationLock<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    try {
      return await fn(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function checkMigrations(
  pool: pg.Pool,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationCheckResult> {
  const files = listMigrationFiles(migrationsDir);
  return withMigrationLock(pool, async (client) => {
    const existsRes = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
    );
    const appliedMap = new Map<string, string>();
    if (existsRes.rows[0]?.exists) {
      const rows = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version ASC',
      );
      for (const row of rows.rows) {
        appliedMap.set(row.version, row.checksum);
      }
    }

    const applied: string[] = [];
    const pending: string[] = [];
    const mismatched: string[] = [];
    for (const file of files) {
      const existingChecksum = appliedMap.get(file.version);
      if (existingChecksum === undefined) {
        pending.push(file.filename);
      } else if (existingChecksum !== file.checksum) {
        mismatched.push(file.filename);
      } else {
        applied.push(file.filename);
      }
    }
    return { applied, pending, mismatched };
  });
}

export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationRunResult> {
  const files = listMigrationFiles(migrationsDir);
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationsTable(client);
    const existingRes = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version ASC',
    );
    const appliedMap = new Map<string, string>();
    for (const row of existingRes.rows) {
      appliedMap.set(row.version, row.checksum);
    }

    const alreadyApplied: string[] = [];
    const appliedNow: string[] = [];

    for (const file of files) {
      const existingChecksum = appliedMap.get(file.version);
      if (existingChecksum !== undefined) {
        if (existingChecksum !== file.checksum) {
          throw new Error(`Migration ${file.filename} checksum mismatch (applied migration was modified)`);
        }
        alreadyApplied.push(file.filename);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [file.version, file.name, file.checksum],
        );
        await client.query('COMMIT');
        appliedNow.push(file.filename);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    return { appliedNow, alreadyApplied };
  });
}
