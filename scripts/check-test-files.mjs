#!/usr/bin/env node
// Fails when a tracked test file would not be run by `pnpm test`.
//
// Each workspace package's `test` script names its test files with globs. They are easy to get
// wrong: `src/*.test.ts` is not recursive, so a test in `src/tools/x.test.ts` never runs, and a
// package with tests but no `test` script is skipped by `pnpm -r test`. Either way the test passes
// by never running. This expands every package's globs the way `node --test` does (fs.globSync)
// and lists the test files that none of them reach.
//
//   pnpm check:tests
//
// The e2e suite (e2e/specs/*.spec.ts) is run by Playwright, not by `pnpm test`, and is not checked.
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A tracked file that is a unit test: name.test.ts and its .tsx/.mts/.mjs/.js/.cjs relatives. */
export const TEST_FILE = /\.test\.(ts|tsx|mts|cts|mjs|cjs|js)$/;

/** The workspace folders whose `test` scripts `pnpm -r test` runs (pnpm-workspace.yaml, less e2e). */
export const PACKAGE_ROOTS = ['apps', 'packages', 'services'];

/** Splits a script into words, keeping quoted words whole and dropping their quotes. */
export function words(script) {
  return [...script.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** The words of a test script that name test files: globs, or paths to a test file. */
export function testPatterns(script) {
  return words(script).filter((w) => !w.startsWith('-') && (w.includes('*') || TEST_FILE.test(w)));
}

/**
 * The test files (repository-relative, forward slashes) that no package's test script reaches.
 * `packages` is [{ dir, script }], dir repository-relative; `expand(dir, pattern)` lists the
 * repository-relative files a pattern matches when run from that package.
 */
export function unrunTestFiles(testFiles, packages, expand) {
  const run = new Set();
  for (const { dir, script } of packages) {
    if (!script) continue;
    for (const pattern of testPatterns(script)) for (const f of expand(dir, pattern)) run.add(f);
  }
  return testFiles.filter((f) => !run.has(f));
}

function workspacePackages() {
  const out = [];
  for (const top of PACKAGE_ROOTS) {
    const base = join(root, top);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const file = join(base, name, 'package.json');
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      out.push({ dir: `${top}/${name}`, script: pkg.scripts?.test });
    }
  }
  return out;
}

function expandFromRepo(dir, pattern) {
  const cwd = join(root, dir);
  return globSync(pattern, { cwd, exclude: (p) => p.includes('node_modules') }).map((f) =>
    relative(root, resolve(cwd, f)).split('\\').join(posix.sep),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const tests = tracked.filter((f) => TEST_FILE.test(f) && !f.startsWith('e2e/') && !f.includes('node_modules/'));
  const missed = unrunTestFiles(tests, workspacePackages(), expandFromRepo);
  if (missed.length) {
    console.error(`${missed.length} test file(s) that \`pnpm test\` never runs:`);
    for (const f of missed) console.error(`  ${f}`);
    console.error(
      '\nAdd them to the package\'s "test" script. Globs such as src/*.test.ts are not recursive: use src/**/*.test.ts, or list the file.',
    );
    process.exit(1);
  }
  console.log(`All ${tests.length} test files are run by a package's test script.`);
}
