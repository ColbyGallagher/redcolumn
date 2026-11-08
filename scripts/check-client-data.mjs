#!/usr/bin/env node
// Keeps client project data out of the repository: drawings, corpus output and client or project
// identifiers. The repository is public, so this runs as a pre-commit and commit-msg hook
// (.githooks, set up by `pnpm install`) and in CI on every push and pull request.
//
//   node scripts/check-client-data.mjs              every tracked file (as on disk)
//   node scripts/check-client-data.mjs --staged     the files about to be committed (as staged)
//   node scripts/check-client-data.mjs --message F  a commit message file
//   node scripts/check-client-data.mjs --range A..B commit messages, added lines and added files in A..B
//   node scripts/check-client-data.mjs --hash WORD  the hash to add to BLOCKED for a new identifier
//
// Identifiers are matched as whole words (letters and digits, split at other characters and at
// camelCase), compared by hash so the list itself names nobody. Words in an untracked
// `.client-data.local` file (one per line, never committed) are also matched, anywhere in a word.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** sha256 (first 16 hex digits) of each blocked identifier, lower case. Add with --hash. */
const BLOCKED = new Set([
  // client agency, as an abbreviation and as its name run together
  '73a45708df42e0ac',
  '7be6409a252b90e8',
  // project and package codes from client drawing numbers
  '2fe791ceba792430',
  'f48858bf53b04ee7',
  'bcae6dff43a30894',
  '7fe38965ce4d08a5',
  '93e017071c04d34e',
  '7234e753f3013c1e',
  // the local folder client drawings are kept in
  '4907f4ceeddb72a9',
]);

/** Drawing and plot files: only the converter's generated fixtures may be committed. */
const DRAWING = /\.(dwg|dxf|dwl2?|dwf|dwfx|dgn|bak|sv\$|ctb|stb|pc3|bpx)$/i;
const DRAWING_OK = ['apps/web/test/fixtures/cad/'];
/** Folders that hold client files or reports on them locally, never in git. */
const NEVER = [/^reference_data\/cad-corpus\//i, /(^|\/)reference-data\//i];

/** Compressed pictures, video, fonts and icons: their bytes look like words by chance. PDFs and
 * everything else are read. */
const MEDIA = /\.(png|jpe?g|gif|webp|ico|icns|mp4|webm|mov|woff2?|ttf|otf|zip|gz)$/i;

const hash = (w) => createHash('sha256').update(w.toLowerCase()).digest('hex').slice(0, 16);
const local = existsSync(join(root, '.client-data.local'))
  ? readFileSync(join(root, '.client-data.local'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'))
  : [];

/** The blocked identifiers in some text, as found (empty when it is clean). */
function findIn(text) {
  const words = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const found = new Set();
  for (let i = 0; i < words.length; i++) {
    // Single words, and up to three run together (an agency name written out).
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const w = words.slice(i, i + n).join('');
      if (w.length >= 3 && w.length <= 40 && BLOCKED.has(hash(w))) found.add(w);
    }
  }
  if (local.length) {
    const lower = text.toLowerCase();
    for (const w of local) if (lower.includes(w)) found.add(w);
  }
  return [...found];
}

function checkPath(path, problems) {
  const p = path.replace(/\\/g, '/');
  if (DRAWING.test(p) && !DRAWING_OK.some((d) => p.startsWith(d))) problems.push(`${p}: drawing or plot file (only ${DRAWING_OK.join(', ')} may hold drawings)`);
  if (NEVER.some((r) => r.test(p))) problems.push(`${p}: in a folder kept out of git`);
  for (const w of findIn(p)) problems.push(`${p}: the path names a client identifier (${mask(w)})`);
}

function checkText(label, text, problems) {
  for (const w of findIn(text)) problems.push(`${label}: client identifier ${mask(w)}`);
}

/** Shown as T***W: enough to find it, without printing it again in CI logs. */
const mask = (w) => (w.length <= 2 ? '**' : `${w[0]}${'*'.repeat(w.length - 2)}${w[w.length - 1]}`);

const git = (args, opts = {}) => execFileSync('git', args, { cwd: root, maxBuffer: 1 << 30, ...opts });
const MAX_BYTES = 50 << 20;

function main(argv) {
  const problems = [];
  const flag = (n) => argv.indexOf(n);
  if (flag('--hash') >= 0) {
    for (const w of argv.slice(flag('--hash') + 1)) console.log(`'${hash(w)}', // ${w.length} chars`);
    return 0;
  }
  if (flag('--message') >= 0) {
    checkText('commit message', readFileSync(argv[flag('--message') + 1], 'utf8'), problems);
  } else if (flag('--range') >= 0) {
    const range = argv[flag('--range') + 1];
    checkText(`commit messages in ${range}`, git(['log', '--format=%B', range], { encoding: 'utf8' }), problems);
    for (const p of git(['log', '--diff-filter=AR', '--name-only', '--format=', range], { encoding: 'utf8' }).split('\n').filter(Boolean)) checkPath(p, problems);
    const added = git(['log', '-p', '--no-color', '--format=', range], { encoding: 'latin1' })
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .join('\n');
    checkText(`lines added in ${range}`, added, problems);
  } else if (flag('--staged') >= 0) {
    const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const p of names) {
      checkPath(p, problems);
      if (MEDIA.test(p)) continue;
      const blob = git(['show', `:${p}`]);
      if (blob.length <= MAX_BYTES) checkText(p, blob.toString('latin1'), problems);
    }
  } else {
    for (const p of git(['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)) {
      checkPath(p, problems);
      const file = join(root, p);
      if (!existsSync(file) || statSync(file).size > MAX_BYTES || MEDIA.test(p)) continue;
      checkText(p, readFileSync(file).toString('latin1'), problems);
    }
  }
  if (!problems.length) return 0;
  console.error('Client data must not be committed (scripts/check-client-data.mjs):');
  for (const p of problems) console.error(`  ${p}`);
  console.error('Use fictional names and generated drawings instead (see scripts/make_cad_fixtures.py).');
  return 1;
}

process.exitCode = main(process.argv.slice(2));
