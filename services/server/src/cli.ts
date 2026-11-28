#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runBackup, runRestore, runVerify } from './admin.ts';
import { createLocalUser, resetLocalUserPassword } from './auth.ts';
import { createDb } from './db.ts';
import { checkMigrations, runMigrations } from './migrate.ts';

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readStdin: () => Promise<string>;
  env: NodeJS.ProcessEnv;
}

const DEFAULT_IO: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readStdin: () =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      process.stdin.on('error', reject);
    }),
  env: process.env,
};

export function parseFlags(args: readonly string[]): { flags: Map<string, string | boolean>; positional: string[] } {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf('=');
    if (eqIndex > 2) {
      flags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { flags, positional };
}

function getStringFlag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const val = flags.get(name);
  return typeof val === 'string' ? val : undefined;
}

function resolveBlobDir(flags: Map<string, string | boolean>, env: NodeJS.ProcessEnv): string {
  return getStringFlag(flags, 'blob-dir')?.trim() || env.BLOB_DIR?.trim() || './data/blobs';
}

async function readSecretPassword(
  flags: Map<string, string | boolean>,
  io: CliIo,
): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  // A password on the command line is visible in the process list and shell history.
  if (flags.has('password')) {
    return {
      ok: false,
      error: '--password is not supported; use --password-stdin or REDCOLUMN_ADMIN_PASSWORD',
    };
  }
  if (flags.get('password-stdin') === true) {
    const value = (await io.readStdin()).replace(/\r?\n$/, '');
    if (!value) return { ok: false, error: 'Password from stdin was empty' };
    return { ok: true, password: value };
  }
  if (io.env.REDCOLUMN_ADMIN_PASSWORD) {
    return { ok: true, password: io.env.REDCOLUMN_ADMIN_PASSWORD };
  }
  return {
    ok: false,
    error: 'A password is required via --password-stdin or REDCOLUMN_ADMIN_PASSWORD',
  };
}

function usage(): string {
  return [
    'Usage: redcolumn-admin <command> [options]',
    '',
    'Commands:',
    '  migrate [--check]       Run pending SQL migrations, or check status with --check',
    '  create-admin            Create a local admin user',
    '    --email <email>         Admin email address (required)',
    '    --name <name>           Admin display name (required)',
    '    --password-stdin        Read the password from stdin',
    '                            (or set REDCOLUMN_ADMIN_PASSWORD)',
    '  reset-password          Reset a local user password and revoke active sessions',
    '    --email <email>         User email address (required)',
    '    --password-stdin        Read the new password from stdin',
    '                            (or set REDCOLUMN_ADMIN_PASSWORD)',
    '  backup                  Back up database (pg_dump -Fc), blobs, and manifest.json',
    '    --out <dir>             Output directory (must be empty or not exist)',
    '    --blob-dir <dir>        Blob directory (defaults to BLOB_DIR)',
    '  restore                 Validate manifest and restore database + blobs',
    '    --from <dir>            Backup directory containing manifest.json',
    '    --yes                   Confirm overwriting current database and blobs',
    '    --blob-dir <dir>        Blob directory (defaults to BLOB_DIR)',
    '  verify                  Check database connectivity, migrations, blobs, and events',
    '    --blob-dir <dir>        Blob directory (defaults to BLOB_DIR)',
  ].join('\n');
}

const KNOWN_COMMANDS = new Set(['migrate', 'create-admin', 'reset-password', 'backup', 'restore', 'verify']);

export async function runCli(argv: readonly string[], io: CliIo = DEFAULT_IO): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    io.stdout(usage());
    return 0;
  }

  if (!KNOWN_COMMANDS.has(command)) {
    io.stderr(`Unknown command: ${command}\n\n${usage()}`);
    return 1;
  }

  const { flags } = parseFlags(rest);

  // Validate command arguments before connecting to the database.
  if (command === 'create-admin') {
    const email = getStringFlag(flags, 'email') ?? '';
    const name = getStringFlag(flags, 'name') ?? '';
    if (flags.has('password')) {
      io.stderr('Error: --password is not supported; use --password-stdin or REDCOLUMN_ADMIN_PASSWORD');
      return 1;
    }
    if (!email || !name) {
      io.stderr('Error: --email, --name, and a password (--password-stdin or REDCOLUMN_ADMIN_PASSWORD) are required');
      return 1;
    }
  } else if (command === 'reset-password') {
    const email = getStringFlag(flags, 'email') ?? '';
    if (flags.has('password')) {
      io.stderr('Error: --password is not supported; use --password-stdin or REDCOLUMN_ADMIN_PASSWORD');
      return 1;
    }
    if (!email) {
      io.stderr('Error: --email and a new password (--password-stdin or REDCOLUMN_ADMIN_PASSWORD) are required');
      return 1;
    }
  } else if (command === 'backup') {
    if (!getStringFlag(flags, 'out')?.trim()) {
      io.stderr('Error: --out <dir> is required');
      return 1;
    }
  } else if (command === 'restore') {
    if (!getStringFlag(flags, 'from')?.trim()) {
      io.stderr('Error: --from <dir> is required');
      return 1;
    }
    if (flags.get('yes') !== true) {
      io.stderr('Error: restore overwrites existing data; pass --yes to confirm');
      return 1;
    }
  }

  const databaseUrl = io.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    io.stderr('Error: DATABASE_URL is required');
    return 1;
  }

  const { db, pool, close } = createDb(databaseUrl);

  try {
    if (command === 'migrate') {
      const checkOnly = flags.get('check') === true;
      if (checkOnly) {
        const status = await checkMigrations(pool);
        if (status.unknown.length > 0) {
          io.stderr(`Unknown migrations in database (newer than this build): ${status.unknown.join(', ')}`);
          return 1;
        }
        if (status.mismatched.length > 0) {
          io.stderr(`Migration checksum mismatch: ${status.mismatched.join(', ')}`);
          return 1;
        }
        if (status.pending.length > 0) {
          io.stderr(`Pending migrations (${status.pending.length}): ${status.pending.join(', ')}`);
          return 1;
        }
        io.stdout(`Migrations up to date (${status.applied.length} applied)`);
        return 0;
      }

      const result = await runMigrations(pool);
      if (result.appliedNow.length === 0) {
        io.stdout(`No pending migrations (${result.alreadyApplied.length} already applied)`);
      } else {
        io.stdout(`Applied ${result.appliedNow.length} migration(s): ${result.appliedNow.join(', ')}`);
      }
      return 0;
    }

    if (command === 'create-admin') {
      const email = getStringFlag(flags, 'email')!;
      const name = getStringFlag(flags, 'name')!;
      const secret = await readSecretPassword(flags, io);
      if (!secret.ok) {
        io.stderr(`Error: ${secret.error}`);
        return 1;
      }

      await runMigrations(pool);
      const user = await createLocalUser(db, { email, name, password: secret.password, role: 'admin' });
      io.stdout(`Created admin user ${user.email} (${user.id})`);
      return 0;
    }

    if (command === 'reset-password') {
      const email = getStringFlag(flags, 'email')!;
      const secret = await readSecretPassword(flags, io);
      if (!secret.ok) {
        io.stderr(`Error: ${secret.error}`);
        return 1;
      }

      const result = await resetLocalUserPassword(db, email, secret.password);
      io.stdout(
        `Updated password for ${result.user.email} (${result.user.id}) and revoked ${result.revokedSessions} active session(s)`,
      );
      return 0;
    }

    if (command === 'backup') {
      const outDir = getStringFlag(flags, 'out')!.trim();
      const blobDir = resolveBlobDir(flags, io.env);
      const manifest = await runBackup({ databaseUrl, pool, blobDir, outDir });
      io.stdout(
        `Backup written to ${outDir} (schema=${manifest.schemaVersion ?? 'none'}, db=${manifest.database.sizeBytes} bytes, blobs=${manifest.blobs.length})`,
      );
      return 0;
    }

    if (command === 'restore') {
      const fromDir = getStringFlag(flags, 'from')!.trim();
      const blobDir = resolveBlobDir(flags, io.env);
      const { manifest, verification } = await runRestore({ databaseUrl, pool, blobDir, fromDir });
      io.stdout(
        `Restored backup from ${fromDir} (schema=${manifest.schemaVersion ?? 'none'}, blobs=${manifest.blobs.length}, verified assets=${verification.assetsChecked})`,
      );
      return 0;
    }

    if (command === 'verify') {
      const blobDir = resolveBlobDir(flags, io.env);
      const report = await runVerify({ pool, blobDir });
      const counts = Object.entries(report.rowCounts)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      io.stdout(
        `Verify: db=${report.databaseConnected ? 'ok' : 'failed'}, migrations=${report.migrations.applied.length} applied (${report.migrations.pending.length} pending), assets=${report.assetsChecked} checked, streams=${report.streamsChecked} checked`,
      );
      if (counts) io.stdout(`Row counts: ${counts}`);
      if (!report.ok) {
        for (const err of report.errors) io.stderr(`Error: ${err}`);
        return 1;
      }
      io.stdout('Verification passed.');
      return 0;
    }

    return 1;
  } catch (err) {
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await close();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
