import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chunks, DIMS, Embedder, quantize, similarity } from './semantic';

test('quantize keeps the leading dimensions as a unit vector in int8', () => {
  const v = Float32Array.from({ length: 768 }, (_, i) => (i < DIMS ? (i % 2 ? 0.05 : -0.05) : 9));
  const q = quantize(v);
  assert.equal(q.length, DIMS);
  // A vector against itself is a cosine of about 1, whatever came after the kept dimensions.
  assert.ok(Math.abs(similarity(q, q) - 1) < 0.02);
  const neg = quantize(v.map((x) => -x));
  assert.ok(Math.abs(similarity(q, neg) + 1) < 0.02);
});

test('chunks: overlapping passages of the kept words, with their word range', () => {
  const words = Array.from({ length: 150 }, (_, i) => `w${i}`);
  const c = chunks(words, (i) => i < 10);
  assert.equal(c[0]!.first, 10);
  assert.equal(c[0]!.text.split(' ').length, 64);
  assert.equal(c[1]!.first, 58);
  assert.equal(c[c.length - 1]!.last, 149);
  // Punctuation alone and pages with almost no text are not embedded.
  assert.deepEqual(chunks(['—', '·', 'A', 'B'], () => false), []);
});

// The real model, when it has been fetched (pnpm --filter @nb/desktop exec node scripts/fetch-search-models.mjs).
const dir = fileURLToPath(new URL('../../../../desktop/dist/semantic/', import.meta.url));
const haveModel = existsSync(`${dir}manifest.json`);

test('the model ranks pages by meaning, not shared words', { skip: !haveModel && 'search model not fetched' }, async () => {
  const base = pathToFileURL(dir).href;
  const embedder = await Embedder.load(
    base,
    (name) => readFile(`${dir}${name}`).then((b) => new Uint8Array(b), () => null),
    (url) => import(url),
  );
  assert.ok(embedder);
  const pages = [
    'MAXIMUM OPERATING TEMPERATURE OF THE PIPE IS 85 DEGREES CELSIUS',
    'DOOR SCHEDULE DOOR 1 HOLLOW CORE DOOR 2 SOLID CORE',
    'ALL DIMENSIONS ARE IN MILLIMETRES UNLESS NOTED OTHERWISE',
    'STORMWATER PIT SW-04 WITH 600 DIAMETER REINFORCED CONCRETE PIPE',
  ];
  const vecs = await embedder.embed(pages, 'document');
  const rank = async (q: string) => {
    const [qv] = await embedder.embed([q], 'query');
    return vecs.map((v, i) => ({ i, s: similarity(qv!, v) })).sort((a, b) => b.s - a.s);
  };
  assert.equal((await rank('how hot can the pipe get'))[0]!.i, 0);
  assert.equal((await rank('which doors are solid'))[0]!.i, 1);
  assert.equal((await rank('what units are the measurements in'))[0]!.i, 2);
  assert.equal((await rank('drainage pit'))[0]!.i, 3);
});

test('chunks: a page with almost nothing outside the chrome keeps its chrome', () => {
  const c = chunks(['GENERAL', 'NOTES', 'ALL', 'DIMENSIONS', 'IN', 'FEET'], () => true);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.text, 'GENERAL NOTES ALL DIMENSIONS IN FEET');
});
