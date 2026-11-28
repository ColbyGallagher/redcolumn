import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testPatterns, unrunTestFiles, unsafeGlobs } from './check-test-files.mjs';

test('reads the file globs out of a test script', () => {
  assert.deepEqual(
    testPatterns('node --test --experimental-strip-types --import ./test/resolve-ts.mjs src/*.test.ts test/qpdf.test.ts'),
    ['src/*.test.ts', 'test/qpdf.test.ts'],
  );
  assert.deepEqual(testPatterns('node --test "src/**/*.test.ts" "../../scripts/*.test.mjs"'), [
    'src/**/*.test.ts',
    '../../scripts/*.test.mjs',
  ]);
});

// A stand-in for fs.globSync: one level for `*`, any depth for `**`.
const FILES = ['packages/a/src/x.test.ts', 'packages/a/src/deep/y.test.ts', 'packages/b/src/z.test.ts'];
function expand(dir, pattern) {
  // Escape every regex character except `*`, then turn `**/` and `*` into their patterns.
  const escaped = `${dir}/${pattern}`.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped.replace(/\*\*\//g, '(?:.+/)?').replace(/\*/g, '[^/]*')}$`);
  return FILES.filter((f) => re.test(f));
}

test('a non-recursive glob misses a nested test file', () => {
  const missed = unrunTestFiles(FILES, [
    { dir: 'packages/a', script: 'node --test src/*.test.ts' },
    { dir: 'packages/b', script: 'node --test src/*.test.ts' },
  ], expand);
  assert.deepEqual(missed, ['packages/a/src/deep/y.test.ts']);
});

test('a recursive glob reaches it', () => {
  const missed = unrunTestFiles(FILES, [
    { dir: 'packages/a', script: 'node --test "src/**/*.test.ts"' },
    { dir: 'packages/b', script: 'node --test src/*.test.ts' },
  ], expand);
  assert.deepEqual(missed, []);
});

test('a package with tests but no test script is reported', () => {
  const missed = unrunTestFiles(FILES, [{ dir: 'packages/a', script: 'node --test "src/**/*.test.ts"' }, { dir: 'packages/b' }], expand);
  assert.deepEqual(missed, ['packages/b/src/z.test.ts']);
});

test('a ** glob outside double quotes is reported, because sh would not recurse', () => {
  assert.deepEqual(unsafeGlobs('node --test src/**/*.test.ts'), ['src/**/*.test.ts']);
  assert.deepEqual(unsafeGlobs("node --test 'src/**/*.test.ts'"), ["'src/**/*.test.ts'"]);
  assert.deepEqual(unsafeGlobs('node --test "src/**/*.test.ts" src/*.test.ts'), []);
});
