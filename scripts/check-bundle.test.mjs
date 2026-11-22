// Tests for scripts/check-bundle.mjs against fixture manifests. Run by `pnpm test` (apps/web's test
// script includes scripts/*.test.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareBaseline, inspect, staticGraph } from './check-bundle.mjs';

/** A small build: index.html -> a, a -> b (and back to index.html: the real graph has cycles), plus a dynamic chunk. */
function fixture(overrides = {}) {
  const manifest = {
    'index.html': { file: 'assets/main-1.js', name: 'main', isEntry: true, imports: ['_a.js'], dynamicImports: ['src/model3d/host.ts'] },
    '_a.js': { file: 'assets/a-1.js', name: 'a', imports: ['_b.js', 'index.html'] },
    '_b.js': { file: 'assets/b-1.js', name: 'b' },
    'src/model3d/host.ts': { file: 'assets/host-1.js', name: 'host', src: 'src/model3d/host.ts', isDynamicEntry: true, imports: ['_three.js'] },
    '_three.js': { file: 'assets/three-1.js', name: 'three' },
  };
  const files = {
    'assets/main-1.js': 'console.log("main");'.repeat(50),
    'assets/a-1.js': 'export const a = 1;'.repeat(50),
    'assets/b-1.js': 'export const b = 2;'.repeat(50),
    // Loaded on demand only: the guard must not look at these.
    'assets/host-1.js': 'import "./three-1.js";',
    'assets/three-1.js': 'new WebGLRenderer(); window.__THREE__ = "182";',
  };
  return { manifest: { ...manifest, ...overrides.manifest }, files: { ...files, ...overrides.files } };
}
const reader = (files) => (file) => Buffer.from(files[file] ?? '');

test('passes: 3D code only behind a dynamic import', () => {
  const { manifest, files } = fixture();
  const r = inspect(manifest, reader(files));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.graph.map((g) => g.key).sort(), ['_a.js', '_b.js', 'index.html']);
  assert.ok(r.sizes.entry > 0);
  assert.ok(r.sizes.graph > r.sizes.entry);
});

test('the static walk follows imports, survives cycles, and skips dynamicImports', () => {
  const { manifest } = fixture();
  const keys = staticGraph(manifest);
  assert.equal(keys.length, 3);
  assert.ok(!keys.includes('src/model3d/host.ts'));
  assert.throws(() => staticGraph(manifest, 'nope.html'), /not in the manifest/);
  assert.throws(() => staticGraph({ 'index.html': { file: 'x.js', imports: ['_gone.js'] } }), /no chunk "_gone.js"/);
});

test('fails: a forbidden module in the static graph, by manifest id', () => {
  const { manifest, files } = fixture({
    manifest: { '_b.js': { file: 'assets/b-1.js', name: 'b', src: '../../node_modules/.pnpm/three@0.182.0/node_modules/three/build/three.module.js' } },
  });
  const r = inspect(manifest, reader(files));
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /assets\/b-1\.js.*contains three/);
});

test('fails: a forbidden chunk name pulled in statically', () => {
  const { manifest, files } = fixture({
    manifest: { '_a.js': { file: 'assets/a-1.js', name: 'a', imports: ['_three.js', 'index.html'] } },
  });
  const r = inspect(manifest, reader(files));
  assert.ok(r.problems.some((p) => /three-1\.js.*contains three/.test(p)));
});

test('fails: forbidden code inside a chunk the manifest does not name', () => {
  for (const [code, lib] of [
    ['const r = new WebGLRenderer();', 'three'],
    ['var v = "@thatopen/components";', '@thatopen'],
    ['fetch("web-ifc.wasm")', 'web-ifc'],
    ['import("camera-controls")', 'camera-controls'],
  ]) {
    const { manifest, files } = fixture({ files: { 'assets/a-1.js': code } });
    const r = inspect(manifest, reader(files));
    assert.deepEqual(r.problems, [`assets/a-1.js (static import of index.html) contains ${lib}`], lib);
  }
});

test('"three" as a plain word is not a hit', () => {
  const { manifest, files } = fixture({ files: { 'assets/a-1.js': 'const msg = "three pages selected";' } });
  assert.deepEqual(inspect(manifest, reader(files)).problems, []);
});

test('baseline: within 5% passes, over 5% fails, shrinking passes', () => {
  const base = { entry: 1000, graph: 2000 };
  assert.deepEqual(compareBaseline({ entry: 1050, graph: 2100 }, base), []);
  assert.deepEqual(compareBaseline({ entry: 500, graph: 900 }, base), []);
  const over = compareBaseline({ entry: 1051, graph: 2000 }, base);
  assert.equal(over.length, 1);
  assert.match(over[0], /main entry chunk grew 5\.1%/);
  assert.match(over[0], /pnpm check:bundle --update/);
  assert.equal(compareBaseline({ entry: 2000, graph: 4000 }, base).length, 2);
});

test('baseline: growth in the static graph alone is caught', () => {
  // A leak into a shared chunk does not touch the entry file.
  const problems = compareBaseline({ entry: 1000, graph: 2500 }, { entry: 1000, graph: 2000 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /static import graph/);
});

test('size regression end to end: a bigger shared chunk trips the baseline', () => {
  const { manifest, files } = fixture();
  const small = inspect(manifest, reader(files));
  let noise = '';
  for (let i = 0; i < 4000; i++) noise += `x${(i * 2654435761) % 1000003};`; // poorly compressible
  const grown = inspect(manifest, reader({ ...files, 'assets/b-1.js': noise }));
  assert.deepEqual(grown.problems, []);
  const problems = compareBaseline(grown.sizes, small.sizes);
  assert.ok(problems.some((p) => /static import graph grew/.test(p)));
});
