#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createLocalUser } from './auth.ts';
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

function parseFlags(args: readonly string[]): { flags: Map<string, string | boolean>; positional: string[] } {
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
  ].join('\n');
}

export async function runCli(argv: readonly string[], io: CliIo = DEFAULT_IO): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    io.stdout(usage());
    return 0;
  }

  const databaseUrl = io.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    io.stderr('Error: DATABASE_URL is required');
    return 1;
  }

  const { flags } = parseFlags(rest);
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
      const email = getStringFlag(flags, 'email') ?? '';
      const name = getStringFlag(flags, 'name') ?? '';
      // A password on the command line is visible in the process list and shell history.
      if (flags.has('password')) {
        io.stderr('Error: --password is not supported; use --password-stdin or REDCOLUMN_ADMIN_PASSWORD');
        return 1;
      }
      let password: string | undefined;
      if (flags.get('password-stdin') === true) {
        password = (await io.readStdin()).replace(/\r?\n$/, '');
      } else if (io.env.REDCOLUMN_ADMIN_PASSWORD) {
        password = io.env.REDCOLUMN_ADMIN_PASSWORD;
      }

      if (!email || !name || !password) {
        io.stderr('Error: --email, --name, and a password (--password-stdin or REDCOLUMN_ADMIN_PASSWORD) are required');
        return 1;
      }

      await runMigrations(pool);
      const user = await createLocalUser(db, { email, name, password, role: 'admin' });
      io.stdout(`Created admin user ${user.email} (${user.id})`);
      return 0;
    }

    io.stderr(`Unknown command: ${command}\n\n${usage()}`);
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
