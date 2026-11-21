// Small helpers shared by the maintainer scripts (health, verify-fast, release, ...).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36), dim: paint(2), bold: paint(1) };

// Windows quoting: a backslash only needs doubling where it comes before a quote or the closing quote.
const quote = (a) =>
  /^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;

/** spawnSync that also works for pnpm/npx on Windows (they are .cmd files and need a shell there). */
export function run(cmd, args = [], opts = {}) {
  const opt = { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts };
  if (process.platform === 'win32' && /^(pnpm|npx)$/.test(cmd)) {
    return spawnSync([cmd, ...args].map(quote).join(' '), { ...opt, shell: true });
  }
  return spawnSync(cmd, args, opt);
}

/** Runs a command and returns its trimmed stdout; throws with its stderr if it fails. */
export function out(cmd, args = [], opts = {}) {
  const r = run(cmd, args, opts);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed${r.stderr ? `: ${r.stderr.trim()}` : ''}`);
  return r.stdout.trim();
}

/** Like out(), but returns null instead of throwing. */
export function tryOut(cmd, args = [], opts = {}) {
  try {
    return out(cmd, args, opts);
  } catch {
    return null;
  }
}

/** Runs a command with its output going straight to the terminal; returns the exit code. */
export function show(cmd, args = [], opts = {}) {
  const r = run(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/** Pulls a flag (and optionally its value) out of an argument list. */
export function flag(args, name, hasValue = false) {
  const i = args.indexOf(name);
  if (i < 0) return hasValue ? undefined : false;
  if (!hasValue) {
    args.splice(i, 1);
    return true;
  }
  const [, value] = args.splice(i, 2);
  return value;
}

/** Asks a yes/no question. `assumeYes` (the --yes flag) answers yes; with no terminal it answers no. */
export async function confirm(question, assumeYes = false) {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} ${c.dim('[y/N]')} `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

/** Waits for Enter. With --yes (or no terminal) it does not wait. */
export async function pause(message, skip = false) {
  if (skip || !process.stdin.isTTY) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`${message} ${c.dim('(press Enter)')} `);
  rl.close();
}

export const fmtSeconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
