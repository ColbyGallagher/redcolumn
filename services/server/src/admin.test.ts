import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  BACKUP_MANIFEST_VERSION,
  DATABASE_DUMP_FILENAME,
  MANIFEST_FILENAME,
  buildPgToolEnv,
  defaultExecPgDump,
  defaultExecPgRestore,
  hashFileSha256,
  isSafeRelativePath,
  runBackup,
  runRestore,
  runVerify,
  safeResolveUnder,
  validateBackupManifest,
  verifyBackupDirectory,
  type BackupManifest,
} from './admin.ts';
import { authenticateLocalUser, createLocalUser, createSession, lookupSession } from './auth.ts';
import { runCli } from './cli.ts';
import { createDb, type DbHandle } from './db.ts';
import { runMigrations } from './migrate.ts';

const execFileAsync = promisify(execFile);
const DEPLOY_DIR = fileURLToPath(new URL('../deploy', import.meta.url));

function makeCliIo(lines: { stdout: string[]; stderr: string[] }, options: { stdin?: string; env?: NodeJS.ProcessEnv } = {}) {
  return {
    stdout: (line: string) => lines.stdout.push(line),
    stderr: (line: string) => lines.stderr.push(line),
    readStdin: async () => options.stdin ?? '',
    env: options.env ?? ({ DATABASE_URL: 'postgres://nobody:fictional@127.0.0.1:1/none' } as NodeJS.ProcessEnv),
  };
}

function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('admin CLI argument validation', () => {
  it('lists all lifecycle commands in --help and never offers --password', async () => {
    const lines = { stdout: [] as string[], stderr: [] as string[] };
    assert.equal(await runCli(['--help'], makeCliIo(lines)), 0);
    const help = lines.stdout.join('\n');
    for (const cmd of ['migrate', 'create-admin', 'reset-password', 'backup', 'restore', 'verify']) {
      assert.match(help, new RegExp(`\\b${cmd}\\b`));
    }
    assert.doesNotMatch(help, /--password </);
  });

  it('refuses --password on reset-password and never echoes the secret', async () => {
    const lines = { stdout: [] as string[], stderr: [] as string[] };
    const code = await runCli(
      ['reset-password', '--email', 'ada@northbridge.example', '--password', 'fictional-secret-val'],
      makeCliIo(lines),
    );
    assert.equal(code, 1);
    const err = lines.stderr.join('\n');
    assert.match(err, /--password is not supported/);
    assert.doesNotMatch(err, /fictional-secret-val/);
  });

  it('requires --email on reset-password', async () => {
    const lines = { stdout: [] as string[], stderr: [] as string[] };
    const code = await runCli(['reset-password', '--password-stdin'], makeCliIo(lines, { stdin: 'new-pass-1234\n' }));
    assert.equal(code, 1);
    assert.match(lines.stderr.join('\n'), /--email/);
  });

  it('requires --out on backup', async () => {
    const lines = { stdout: [] as string[], stderr: [] as string[] };
    const code = await runCli(['backup'], makeCliIo(lines));
    assert.equal(code, 1);
    assert.match(lines.stderr.join('\n'), /--out/);
  });

  it('requires --from and --yes on restore', async () => {
    const missingFrom = { stdout: [] as string[], stderr: [] as string[] };
    assert.equal(await runCli(['restore'], makeCliIo(missingFrom)), 1);
    assert.match(missingFrom.stderr.join('\n'), /--from/);

    const missingYes = { stdout: [] as string[], stderr: [] as string[] };
    assert.equal(await runCli(['restore', '--from', '/tmp/fictional-backup'], makeCliIo(missingYes)), 1);
    assert.match(missingYes.stderr.join('\n'), /--yes/);
  });
});

describe('backup manifest and checksum verification', () => {
  let workDir: string;

  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'rc-admin-unit-'));
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('rejects unsafe relative paths and path traversal', () => {
    assert.equal(isSafeRelativePath('projects/p1/abc'), true);
    assert.equal(isSafeRelativePath('../escape'), false);
    assert.equal(isSafeRelativePath('projects/../escape'), false);
    assert.equal(isSafeRelativePath('/etc/passwd'), false);
    assert.equal(isSafeRelativePath('projects\\win\\path'), false);
    assert.equal(isSafeRelativePath('projects/null\0byte'), false);
    assert.throws(() => safeResolveUnder(workDir, '../escape'));
  });

  it('verifies a valid backup directory and detects tampering', async () => {
    const backupDir = join(workDir, 'valid-backup');
    const dumpBytes = Buffer.from('PGDMP-fictional-database-dump');
    const blobBytes = Buffer.from('fictional-pdf-content');
    const blobHash = sha256Hex(blobBytes);
    const blobRel = `projects/proj-1/${blobHash}`;

    await mkdir(join(backupDir, 'blobs', 'projects', 'proj-1'), { recursive: true });
    await writeFile(join(backupDir, DATABASE_DUMP_FILENAME), dumpBytes);
    await writeFile(join(backupDir, 'blobs', 'projects', 'proj-1', blobHash), blobBytes);

    const manifest: BackupManifest = {
      version: BACKUP_MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      schemaVersion: '0002',
      appliedMigrations: ['0001', '0002'],
      database: {
        file: DATABASE_DUMP_FILENAME,
        sha256: sha256Hex(dumpBytes),
        sizeBytes: dumpBytes.length,
      },
      blobs: [
        {
          path: blobRel,
          sha256: blobHash,
          sizeBytes: blobBytes.length,
        },
      ],
    };
    await writeFile(join(backupDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), 'utf8');

    const okResult = await verifyBackupDirectory(backupDir);
    assert.equal(okResult.ok, true);
    assert.equal(okResult.errors.length, 0);
    assert.equal(okResult.manifest?.blobs.length, 1);

    // Corrupt blob content
    await writeFile(join(backupDir, 'blobs', 'projects', 'proj-1', blobHash), Buffer.from('tampered-pdf-content!'));
    const badBlob = await verifyBackupDirectory(backupDir);
    assert.equal(badBlob.ok, false);
    assert.match(badBlob.errors.join('\n'), /Blob SHA-256 mismatch/);

    // Restore blob and corrupt database dump
    await writeFile(join(backupDir, 'blobs', 'projects', 'proj-1', blobHash), blobBytes);
    await writeFile(join(backupDir, DATABASE_DUMP_FILENAME), Buffer.from('corrupted-dump'));
    const badDump = await verifyBackupDirectory(backupDir);
    assert.equal(badDump.ok, false);
    assert.match(badDump.errors.join('\n'), /Database dump SHA-256 mismatch/);
  });

  it('rejects malformed manifests', () => {
    assert.throws(() => validateBackupManifest(null), /JSON object/);
    assert.throws(() => validateBackupManifest({ version: 2 }), /Unsupported backup manifest version/);
    assert.throws(
      () =>
        validateBackupManifest({
          version: 1,
          createdAt: new Date().toISOString(),
          schemaVersion: '0002',
          appliedMigrations: ['0001', '0002'],
          database: { file: DATABASE_DUMP_FILENAME, sha256: 'a'.repeat(64), sizeBytes: 10 },
          blobs: [{ path: '../outside', sha256: 'b'.repeat(64), sizeBytes: 5 }],
        }),
      /Invalid manifest blob path/,
    );
  });
  it('parses DATABASE_URL into PG* env vars without leaking credentials to argv', () => {
    const env = buildPgToolEnv('postgres://redcolumn:p%40ss%2Fword@db.internal:5433/reviewdb?sslmode=require', {
      PATH: '/usr/bin',
      PGPASSWORD: 'stale-password',
    });
    assert.equal(env.PGHOST, 'db.internal');
    assert.equal(env.PGPORT, '5433');
    assert.equal(env.PGUSER, 'redcolumn');
    assert.equal(env.PGPASSWORD, 'p@ss/word');
    assert.equal(env.PGDATABASE, 'reviewdb');
    assert.equal(env.PGSSLMODE, 'require');
    assert.equal(env.PATH, '/usr/bin');

    const noPassEnv = buildPgToolEnv('postgresql://localhost/reviewdb', { PGPASSWORD: 'stale-password' });
    assert.equal(noPassEnv.PGHOST, 'localhost');
    assert.equal(noPassEnv.PGDATABASE, 'reviewdb');
    assert.equal(noPassEnv.PGPASSWORD, undefined);

    assert.throws(() => buildPgToolEnv('http://localhost/reviewdb'), /protocol/);
  });
});

describe('deploy bundle sanity checks', () => {
  it('has a valid multi-stage Dockerfile on node:24-trixie-slim with all workspace deps, PG 17 client, non-root user, and healthcheck', async () => {
    const dockerfile = await readFile(join(DEPLOY_DIR, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /FROM node:24-trixie-slim AS base/);
    assert.match(dockerfile, /FROM node:24-trixie-slim AS runtime/);
    assert.match(dockerfile, /postgresql-client-17/);
    for (const pkg of [
      'apps/desktop/package.json',
      'apps/web/package.json',
      'e2e/package.json',
      'packages/i18n/package.json',
      'packages/markup/package.json',
      'packages/measure/package.json',
      'packages/ops/package.json',
      'packages/sheets/package.json',
      'services/server/package.json',
    ]) {
      assert.ok(dockerfile.includes(pkg), `Expected ${pkg} in Dockerfile`);
    }
    for (const srcDir of [
      'packages/i18n/src',
      'packages/sheets/src',
      'packages/measure/src',
      'packages/markup/src',
      'packages/ops/src',
      'services/server/src',
    ]) {
      assert.ok(dockerfile.includes(srcDir), `Expected ${srcDir} in Dockerfile runtime stage`);
    }
    assert.match(dockerfile, /USER redcolumn/);
    assert.match(dockerfile, /EXPOSE 3000/);
    assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/healthz/);
    assert.match(dockerfile, /redcolumn-admin/);
  });

  it('has compose.yaml with postgres 17, server, caddy, and named volumes', async () => {
    const compose = await readFile(join(DEPLOY_DIR, 'compose.yaml'), 'utf8');
    assert.match(compose, /image:\s*postgres:17-alpine/);
    assert.match(compose, /pg_isready/);
    assert.match(compose, /Caddyfile\.\$\{CADDY_MODE:-internal-ca\}/);
    for (const vol of ['pgdata:', 'blobs:', 'caddy_data:', 'caddy_config:']) {
      assert.ok(compose.includes(vol), `Expected volume ${vol} in compose.yaml`);
    }
  });

  it('ships all three Caddy TLS modes without any insecure skip-verify option', async () => {
    for (const name of ['Caddyfile.org-ca', 'Caddyfile.dns01', 'Caddyfile.internal-ca']) {
      const content = await readFile(join(DEPLOY_DIR, 'caddy', name), 'utf8');
      assert.match(content, /reverse_proxy\s+server:3000/);
      assert.match(content, /Strict-Transport-Security/);
      assert.doesNotMatch(content, /insecure_skip_verify/i);
    }
    const orgCa = await readFile(join(DEPLOY_DIR, 'caddy', 'Caddyfile.org-ca'), 'utf8');
    assert.match(orgCa, /TLS_CERT_FILE/);
    assert.match(orgCa, /TLS_KEY_FILE/);

    const dns01 = await readFile(join(DEPLOY_DIR, 'caddy', 'Caddyfile.dns01'), 'utf8');
    assert.match(dns01, /\bdns\b/);
    assert.match(dns01, /DNS_PROVIDER_API_TOKEN/);

    const internalCa = await readFile(join(DEPLOY_DIR, 'caddy', 'Caddyfile.internal-ca'), 'utf8');
    assert.match(internalCa, /tls internal/);

    const caddyDockerfile = await readFile(join(DEPLOY_DIR, 'caddy', 'Dockerfile.caddy-dns01'), 'utf8');
    assert.match(caddyDockerfile, /xcaddy build/);
  });

  it('ships .env.example and backup/restore scripts with expected keys', async () => {
    const envExample = await readFile(join(DEPLOY_DIR, '.env.example'), 'utf8');
    for (const key of ['COOKIE_SECURE=true', 'BLOB_DIR=', 'DATABASE_URL=', 'ALLOWED_ORIGINS=', 'CADDY_MODE=']) {
      assert.ok(envExample.includes(key), `Expected ${key} in .env.example`);
    }
    assert.match(envExample, /openssl rand -hex 24/);
    const backupSh = await readFile(join(DEPLOY_DIR, 'backup.sh'), 'utf8');
    const restoreSh = await readFile(join(DEPLOY_DIR, 'restore.sh'), 'utf8');
    assert.match(backupSh, /redcolumn-admin backup/);
    assert.match(backupSh, /mktemp -d/);
    assert.doesNotMatch(backupSh, /\$\$/);
    assert.match(restoreSh, /redcolumn-admin restore/);
    assert.match(restoreSh, /redcolumn-admin verify/);
    assert.match(restoreSh, /mktemp -d/);
    assert.match(restoreSh, /tar -xf - -C/);
    assert.doesNotMatch(restoreSh, /\$\$/);
  });
});

// --- Postgres 17 integration tests -------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const REQUIRE_POSTGRES = process.env.REQUIRE_POSTGRES_TESTS === '1';

if (!DATABASE_URL && REQUIRE_POSTGRES) {
  throw new Error('REQUIRE_POSTGRES_TESTS=1 is set but DATABASE_URL is not configured');
}

async function hasPgDumpTools(): Promise<boolean> {
  try {
    await execFileAsync('pg_dump', ['--version']);
    await execFileAsync('pg_restore', ['--version']);
    return true;
  } catch {
    return false;
  }
}

describe('admin lifecycle integration (Postgres)', { skip: !DATABASE_URL }, () => {
  let handle: DbHandle;
  let tempRoot: string;

  before(async () => {
    handle = createDb(DATABASE_URL!);
    await runMigrations(handle.pool);
    tempRoot = await mkdtemp(join(tmpdir(), 'rc-admin-pg-'));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    await handle.close();
  });

  beforeEach(async () => {
    await handle.pool.query(
      'TRUNCATE sessions, users, workspaces, streams, op_results, markups, placements, events CASCADE',
    );
  });

  it('reset-password updates argon2id hash, revokes active sessions, and allows login with new password', async () => {
    const user = await createLocalUser(handle.db, {
      email: 'ada@northbridge.example',
      name: 'Ada Lovelace',
      password: 'initial-password-123',
      role: 'admin',
    });

    const sessionA = await createSession(handle.db, user.id, 60_000);
    const sessionB = await createSession(handle.db, user.id, 60_000);
    assert.ok(await lookupSession(handle.db, sessionA.token));
    assert.ok(await lookupSession(handle.db, sessionB.token));

    const lines = { stdout: [] as string[], stderr: [] as string[] };
    const code = await runCli(
      ['reset-password', '--email', 'ada@northbridge.example', '--password-stdin'],
      makeCliIo(lines, {
        stdin: 'rotated-password-456\n',
        env: { DATABASE_URL: DATABASE_URL! },
      }),
    );

    assert.equal(code, 0, lines.stderr.join('\n'));
    assert.match(lines.stdout.join('\n'), /revoked 2 active session/);

    // Old sessions are revoked
    assert.equal(await lookupSession(handle.db, sessionA.token), null);
    assert.equal(await lookupSession(handle.db, sessionB.token), null);

    // Old password fails, new password succeeds
    assert.equal(await authenticateLocalUser(handle.db, 'ada@northbridge.example', 'initial-password-123'), null);
    const authed = await authenticateLocalUser(handle.db, 'ada@northbridge.example', 'rotated-password-456');
    assert.ok(authed);
    assert.equal(authed.id, user.id);
  });

  it('verify passes on valid DB + blobs + events, and fails on missing/mismatched blobs or bad stream seq', async () => {
    const blobDir = join(tempRoot, `blobs-verify-${randomUUID()}`);
    const wsId = randomUUID();
    const projId = randomUUID();
    const blobData = Buffer.from('%PDF-1.7 fictional drawing bytes\n');
    const blobSha = sha256Hex(blobData);
    const storageKey = `projects/${projId}/${blobSha}`;

    await mkdir(dirname(join(blobDir, storageKey)), { recursive: true });
    await writeFile(join(blobDir, storageKey), blobData);

    await handle.pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [wsId, 'Northbridge']);
    await handle.pool.query('INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)', [
      projId,
      wsId,
      'Harbour Bridge',
    ]);
    await handle.pool.query(
      'INSERT INTO assets (project_id, sha256, size_bytes, media_type, storage_key) VALUES ($1, $2, $3, $4, $5)',
      [projId, blobSha, blobData.length, 'application/pdf', storageKey],
    );

    const streamId = `doc-${randomUUID()}`;
    await handle.pool.query('INSERT INTO streams (id, kind, seq, project_id) VALUES ($1, $2, $3, $4)', [
      streamId,
      'document',
      2,
      projId,
    ]);
    await handle.pool.query(
      `INSERT INTO events (stream_id, seq, op_id, actor_id, op_type, entity_id, payload_json, received_at)
       VALUES ($1, 1, $2, 'user-1', 'markup.create', 'm-1', '{}'::jsonb, '2026-11-28T00:00:05Z'),
              ($1, 2, $3, 'user-1', 'markup.patch', 'm-1', '{}'::jsonb, '2026-11-28T00:00:01Z')`,
      [streamId, randomUUID(), randomUUID()],
    );

    // 1. Valid state passes via runVerify and CLI
    const passReport = await runVerify({ pool: handle.pool, blobDir });
    assert.equal(passReport.ok, true, passReport.errors.join('; '));
    assert.equal(passReport.assetsChecked, 1);
    assert.equal(passReport.streamsChecked, 1);
    assert.equal(passReport.rowCounts.assets, 1);

    const cliOk = { stdout: [] as string[], stderr: [] as string[] };
    assert.equal(
      await runCli(['verify', '--blob-dir', blobDir], makeCliIo(cliOk, { env: { DATABASE_URL: DATABASE_URL! } })),
      0,
    );
    assert.match(cliOk.stdout.join('\n'), /Verification passed/);

    // 2. Corrupted blob fails verify
    await writeFile(join(blobDir, storageKey), Buffer.from('corrupted-bytes'));
    const mismatchReport = await runVerify({ pool: handle.pool, blobDir });
    assert.equal(mismatchReport.ok, false);
    assert.deepEqual(mismatchReport.mismatchedBlobs, [storageKey]);

    const cliBad = { stdout: [] as string[], stderr: [] as string[] };
    assert.equal(
      await runCli(['verify', '--blob-dir', blobDir], makeCliIo(cliBad, { env: { DATABASE_URL: DATABASE_URL! } })),
      1,
    );
    assert.match(cliBad.stderr.join('\n'), /integrity mismatch/i);

    // 3. Missing blob fails verify
    await rm(join(blobDir, storageKey));
    const missingReport = await runVerify({ pool: handle.pool, blobDir });
    assert.equal(missingReport.ok, false);
    assert.deepEqual(missingReport.missingBlobs, [storageKey]);

    // 4. Restore blob, then introduce event seq exceeding streams.seq
    await writeFile(join(blobDir, storageKey), blobData);
    await handle.pool.query('UPDATE streams SET seq = 1 WHERE id = $1', [streamId]);
    const badStreamReport = await runVerify({ pool: handle.pool, blobDir });
    assert.equal(badStreamReport.ok, false);
    assert.deepEqual(badStreamReport.nonMonotonicStreams, [streamId]);
  });

  it('backup and restore round-trip validates manifest, restores blobs, and passes verify', async () => {
    const srcBlobDir = join(tempRoot, `blobs-src-${randomUUID()}`);
    const restoredBlobDir = join(tempRoot, `blobs-dst-${randomUUID()}`);
    const backupOutDir = join(tempRoot, `backup-out-${randomUUID()}`);

    const wsId = randomUUID();
    const projId = randomUUID();
    const pdfBytes = Buffer.from('%PDF-1.7 fictional backup sheet\n');
    const pdfSha = sha256Hex(pdfBytes);
    const storageKey = `projects/${projId}/${pdfSha}`;

    await mkdir(dirname(join(srcBlobDir, storageKey)), { recursive: true });
    await writeFile(join(srcBlobDir, storageKey), pdfBytes);

    await handle.pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [wsId, 'Northbridge']);
    await handle.pool.query('INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)', [
      projId,
      wsId,
      'Civic Centre',
    ]);
    await handle.pool.query(
      'INSERT INTO assets (project_id, sha256, size_bytes, media_type, storage_key) VALUES ($1, $2, $3, $4, $5)',
      [projId, pdfSha, pdfBytes.length, 'application/pdf', storageKey],
    );

    const pgToolsAvailable = await hasPgDumpTools();

    const manifest = await runBackup({
      databaseUrl: DATABASE_URL!,
      pool: handle.pool,
      blobDir: srcBlobDir,
      outDir: backupOutDir,
      execPgDump: pgToolsAvailable
        ? defaultExecPgDump
        : async (_url, outFile) => {
            await writeFile(outFile, Buffer.from('PGDMP-stub-when-pg_dump-not-installed'));
          },
    });

    assert.equal(manifest.version, 1);
    assert.equal(manifest.schemaVersion, '0002');
    assert.equal(manifest.blobs.length, 1);
    assert.equal(manifest.blobs[0]!.path, storageKey);
    assert.equal(manifest.blobs[0]!.sha256, pdfSha);

    const dirCheck = await verifyBackupDirectory(backupOutDir);
    assert.equal(dirCheck.ok, true, dirCheck.errors.join('; '));

    if (pgToolsAvailable) {
      // Full end-to-end wipe + pg_restore
      await handle.pool.query('TRUNCATE workspaces CASCADE');
    }

    const { verification } = await runRestore({
      databaseUrl: DATABASE_URL!,
      pool: handle.pool,
      blobDir: restoredBlobDir,
      fromDir: backupOutDir,
      execPgRestore: pgToolsAvailable
        ? defaultExecPgRestore
        : async () => {
            // Stub: database state remains intact when host lacks pg_restore.
          },
    });

    assert.equal(verification.ok, true, verification.errors.join('; '));
    assert.equal(verification.assetsChecked, 1);
    const restoredDigest = await hashFileSha256(join(restoredBlobDir, storageKey));
    assert.equal(restoredDigest.sha256, pdfSha);
  });
});
