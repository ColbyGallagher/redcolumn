// Puts what search by meaning needs into dist/semantic, which the package ships as the
// "semantic" extra resource and the app serves at app://redcolumn/semantic/ (src/protocol.ts):
//
// - the embedding model, MongoDB/mdbr-leaf-ir (Apache-2.0), quantised to 8 bits, and its
//   tokenizer, downloaded from Hugging Face at a pinned revision and checked against the hashes
//   below (the repository's own LFS hashes);
// - ONNX Runtime Web's CPU build (MIT), copied from node_modules, to run it.
//
// Nothing is downloaded by the app itself: the files are part of the installer. Archives are
// cached in dist/.semantic-cache. Update THIRD_PARTY_NOTICES.md when anything here changes.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODEL = 'MongoDB/mdbr-leaf-ir';
const REVISION = '4262131b32c3182bd06e67e92ae69d7bd66e0c5c';
/** Published path → [file name here, sha256]. */
const MODEL_FILES = {
  'onnx/model_quantized.onnx': ['model.onnx', '8c08cb4ecc00bad721b117a85738c537ceb9b85b3eedc52d9c6906fddaa55718'],
  // The weights; the model file names it, so it keeps its name.
  'onnx/model_quantized.onnx_data': ['model_quantized.onnx_data', 'e77ea96a124230e23e5bac8e26c3ffe5410154973d8635673fa0220b06c13f8b'],
  'tokenizer.json': ['tokenizer.json', 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0'],
};
/** ONNX Runtime Web: the CPU (WebAssembly) build only. */
const ORT_FILES = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

/** What the app reads first (src/search/index/semantic.ts): the model and how to use it. */
const MANIFEST = {
  model: MODEL,
  revision: REVISION,
  // Asymmetric retrieval: queries get this prompt, page text none (the model card's settings).
  queryPrompt: 'Represent this sentence for searching relevant passages: ',
  documentPrompt: '',
  output: 'sentence_embedding',
  maxTokens: 128,
  files: { model: 'model.onnx', data: 'model_quantized.onnx_data', tokenizer: 'tokenizer.json', ort: 'ort/ort.wasm.min.mjs' },
};

const LICENSE = `The embedding model in this folder is mdbr-leaf-ir by MongoDB
(https://huggingface.co/${MODEL}, revision ${REVISION}),
licensed under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0).
The files are the publisher's 8-bit quantised ONNX export, unmodified.

The ort/ folder holds ONNX Runtime Web (https://github.com/microsoft/onnxruntime),
Copyright (c) Microsoft Corporation, licensed under the MIT License.
`;

const desktopRoot = path.join(import.meta.dirname, '..');
const outDir = path.join(desktopRoot, 'dist', 'semantic');
const cacheDir = path.join(desktopRoot, 'dist', '.semantic-cache');

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  if (!response.url.startsWith('https://')) throw new Error(`Refused a non-https download: ${response.url}`);
  const partial = `${dest}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, dest);
}

/** tokenizer.json is a plain git file (no LFS hash); it is pinned by the revision, and kept once fetched. */
async function fetchModelFile(published, name, expected) {
  const cached = path.join(cacheDir, name);
  const have = await sha256(cached).catch(() => '');
  if (have && (expected === null || have === expected)) return cached;
  await rm(cached, { force: true });
  const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${published}`;
  console.log(`Downloading ${url}`);
  await download(url, cached);
  const actual = await sha256(cached);
  if (expected !== null && actual !== expected) {
    await rm(cached, { force: true });
    throw new Error(`${name} hash is ${actual}, expected ${expected}. It was not packaged.`);
  }
  return cached;
}

async function main() {
  await mkdir(path.join(outDir, 'ort'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  for (const [published, [name, hash]] of Object.entries(MODEL_FILES)) {
    const file = await fetchModelFile(published, name, hash);
    await copyFile(file, path.join(outDir, name));
  }
  // The tokenizer must be the BERT WordPiece one the app reads.
  const tokenizer = JSON.parse(await readFile(path.join(outDir, 'tokenizer.json'), 'utf8'));
  if (tokenizer.model?.type !== 'WordPiece') throw new Error('Unexpected tokenizer.json');
  const require = createRequire(path.join(desktopRoot, 'package.json'));
  const ortDist = path.dirname(require.resolve('onnxruntime-web/wasm'));
  for (const f of ORT_FILES) await copyFile(path.join(ortDist, f), path.join(outDir, 'ort', f));
  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  await writeFile(path.join(outDir, 'LICENSE.txt'), LICENSE);
  let total = 0;
  for (const f of [...Object.values(MODEL_FILES).map(([n]) => n), ...ORT_FILES.map((f) => `ort/${f}`)]) total += (await stat(path.join(outDir, f))).size;
  console.log(`search models ready in dist/semantic (${(total / 2 ** 20).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
