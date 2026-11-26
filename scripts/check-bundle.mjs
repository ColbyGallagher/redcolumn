#!/usr/bin/env node
// Bundle guard: the 3D viewer (three, web-ifc, @thatopen, camera-controls) must never load on the
// PDF path, and the code every user downloads at start-up must not grow unnoticed.
//
// It reads the Vite manifest of the web build (apps/web/dist/.vite/manifest.json), walks the main
// entry's static import graph (`imports`; dynamic imports are loaded on demand and are fine) and
//
//   1. fails if any chunk in that graph contains a forbidden library, judged by the manifest (chunk
//      keys, source paths, names, file names) and by scanning the chunk files themselves;
//   2. fails if the entry chunk, or the whole static graph, grows more than 5% in gzip size over the
//      committed baseline (scripts/bundle-baseline.json);
//   3. prints the sizes.
//
//   pnpm check:bundle            check the last build (pnpm build first)
//   pnpm check:bundle --update   record the current sizes as the new baseline
//
// Raise the baseline on purpose, in the PR that adds the weight, so the growth is reviewed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const MAIN_ENTRY = 'index.html';
export const MAX_GROWTH = 0.05;

/**
 * The libraries kept off the PDF path. `module` matches a path or file name (as in
 * node_modules/three/build/three.module.js or a chunk called three-Dx9.js); `code` matches text only
 * a bundled copy of the library contains (a name or a marker that survives minification).
 */
export const FORBIDDEN = [
  { name: 'three', module: /(^|[\\/_.-])three([\\/_.-]|$)/, code: /__THREE__|WebGLRenderer\b/ },
  // The app names the wasm it serves (model3d/web-ifc.wasm) to hand its URL to the lazily loaded
  // viewer. That exact path is not the library; any other mention is.
  { name: 'web-ifc', module: /web-ifc/, code: /(?<!model3d\/)web-ifc|web-ifc(?!\.wasm\b)/ },
  { name: '@thatopen', module: /@thatopen/, code: /@thatopen/ },
  { name: 'camera-controls', module: /camera-controls/, code: /camera-controls/ },
];

/** Keys of every chunk reachable from `entry` through static `imports` (the entry included). */
export function staticGraph(manifest, entry = MAIN_ENTRY) {
  if (!manifest[entry]) throw new Error(`Entry "${entry}" is not in the manifest`);
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Manifest has no chunk "${key}" (imported by a chunk in the graph)`);
    seen.add(key);
    for (const next of chunk.imports ?? []) stack.push(next);
  }
  return [...seen];
}

/** Forbidden libraries a chunk's manifest entry names: its key, source, name and file. */
export function manifestHits(key, chunk) {
  const ids = [key, chunk.src, chunk.name, chunk.file].filter((s) => typeof s === 'string');
  return FORBIDDEN.filter((f) => ids.some((id) => f.module.test(id))).map((f) => f.name);
}

/** Forbidden libraries a chunk's code contains. */
export function codeHits(code) {
  return FORBIDDEN.filter((f) => f.code.test(code)).map((f) => f.name);
}

export const gzipBytes = (data) => gzipSync(data, { level: 9 }).length;

/**
 * Checks a build. `readChunk(file)` returns a chunk's text (a Buffer or string).
 * Returns { entry, graph, problems, sizes: { entry, graph } } with gzip bytes in the sizes.
 */
export function inspect(manifest, readChunk, entry = MAIN_ENTRY) {
  const keys = staticGraph(manifest, entry);
  const problems = [];
  const graph = [];
  let total = 0;
  for (const key of keys) {
    const chunk = manifest[key];
    const isJs = /\.(m?js)$/.test(chunk.file ?? '');
    let gzip = 0;
    const found = new Set(manifestHits(key, chunk));
    if (isJs) {
      const data = readChunk(chunk.file);
      gzip = gzipBytes(data);
      for (const name of codeHits(data.toString())) found.add(name);
      total += gzip;
    }
    graph.push({ key, file: chunk.file, gzip });
    for (const name of found) problems.push(`${chunk.file ?? key} (static import of ${entry}) contains ${name}`);
  }
  const entryGzip = graph.find((g) => g.key === entry)?.gzip ?? 0;
  return { entry, graph, problems, sizes: { entry: entryGzip, graph: total } };
}

/** Problems from comparing sizes with the baseline ({ entry, graph } in gzip bytes). */
export function compareBaseline(sizes, baseline, maxGrowth = MAX_GROWTH) {
  const problems = [];
  for (const [what, label] of [['entry', 'main entry chunk'], ['graph', 'main static import graph']]) {
    const was = baseline?.[what];
    if (typeof was !== 'number' || was <= 0) continue;
    const growth = (sizes[what] - was) / was;
    if (growth > maxGrowth) {
      problems.push(
        `${label} grew ${(growth * 100).toFixed(1)}% (${kb(was)} -> ${kb(sizes[what])} gzip, limit ${(maxGrowth * 100).toFixed(0)}%). ` +
          'If the growth is intended, run: pnpm check:bundle --update',
      );
    }
  }
  return problems;
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

function main(argv) {
  const manifestPath = join(root, 'apps/web/dist/.vite/manifest.json');
  const distDir = join(root, 'apps/web/dist');
  const baselinePath = join(root, 'scripts/bundle-baseline.json');
  if (!existsSync(manifestPath)) {
    console.error(`No ${manifestPath}. Run pnpm build first.`);
    return 1;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const result = inspect(manifest, (file) => readFileSync(join(distDir, file)));

  console.log(`Main entry (${manifest[MAIN_ENTRY].file}): ${kb(result.sizes.entry)} gzip`);
  console.log(`Static import graph: ${result.graph.length} chunks, ${kb(result.sizes.graph)} gzip`);
  for (const g of [...result.graph].sort((a, b) => b.gzip - a.gzip).slice(0, 5)) console.log(`  ${kb(g.gzip).padStart(10)}  ${g.file}`);

  if (argv.includes('--update')) {
    if (result.problems.length) {
      console.error(`\nNot updating the baseline:\n${result.problems.map((p) => `  - ${p}`).join('\n')}`);
      return 1;
    }
    writeFileSync(baselinePath, `${JSON.stringify({ entry: result.sizes.entry, graph: result.sizes.graph }, null, 2)}\n`);
    console.log(`\nBaseline written to scripts/bundle-baseline.json`);
    return 0;
  }

  const problems = [...result.problems];
  if (existsSync(baselinePath)) {
    problems.push(...compareBaseline(result.sizes, JSON.parse(readFileSync(baselinePath, 'utf8'))));
  } else {
    problems.push('scripts/bundle-baseline.json is missing. Run: pnpm check:bundle --update');
  }
  if (problems.length) {
    console.error(`\nBundle check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    return 1;
  }
  console.log('\nBundle check passed.');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
