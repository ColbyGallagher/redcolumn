// Optional external regression: no third-party drawing bytes are committed.
// node --experimental-transform-types --import ./apps/web/test/resolve-ts.mjs scripts/check-cad-samples.mjs --download
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { convertCad, readDrawing } from '../apps/web/src/cad/convert.ts';
import { readPdfExtras } from '../packages/markup/src/pdfExtras.ts';
import { importViewports } from '../packages/markup/src/bluebeam.ts';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const fixtures = resolve(option('--fixtures') || resolve(root, 'reference-data/cad-sample-tests'));
const output = resolve(option('--output') || resolve(fixtures, 'output'));
const manifest = JSON.parse(await readFile(new URL('./cad-public-samples.json', import.meta.url), 'utf8'));
const { PDFDocument } = createRequire(resolve(root, 'apps/web/package.json'))('pdf-lib');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const font = async family => new Uint8Array(await readFile(resolve(root, `apps/web/public/fonts/Liberation${family}-Regular.ttf`)));
const fonts = { sans: await font('Sans'), serif: await font('Serif'), mono: await font('Mono') };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
await mkdir(output, { recursive: true });
for (const file of manifest.files) {
  const local = resolve(fixtures, file.path);
  let bytes = await readFile(local).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!bytes && args.includes('--download')) {
    const url = `https://raw.githubusercontent.com/haiha-ux/cad-sample-tests/${manifest.revision}/${file.path}`;
    const response = await fetch(url);
    assert(response.ok, `Download failed: ${response.status} ${file.path}`);
    bytes = Buffer.from(await response.arrayBuffer());
    assert(hash(bytes) === file.sha256, `Unexpected upstream bytes: ${file.path}`);
    await mkdir(dirname(local), { recursive: true }); await writeFile(local, bytes);
  }
  assert(bytes, `Missing ${file.path}. Supply --fixtures DIR or use --download for local evaluation.`);
  assert(hash(bytes) === file.sha256, `Original changed: ${file.path}`);
}

const rows = [];
for (const sample of manifest.cases) for (const format of ['dwg', 'dxf']) {
  const path = `${sample.stem}.${format}`, source = new Uint8Array(await readFile(resolve(fixtures, path)));
  const before = hash(source), start = performance.now();
  const { drawing, unreadable } = readDrawing(basename(path), source);
  assert(unreadable === 0, `${path}: unreadable objects`);
  assert(drawing.modelSpace.filter(e => e.type === 'DIMENSION').length === sample.dimensions, `${path}: dimension count changed`);
  const { pdf, report } = await convertCad(basename(path), source, { fonts });
  assert(report.format === format && report.version === 'AC1032', `${path}: format/version`);
  assert(report.pages.length === 1, `${path}: expected one model sheet`);
  assert(report.pages[0].scale === `1:${sample.ratio}`, `${path}: default model policy changed`);
  const doc = await PDFDocument.load(pdf), page = doc.getPage(0), pt = 72 / 25.4;
  assert(Math.abs(page.getWidth() / pt - sample.paperMm[0]) < .001 && Math.abs(page.getHeight() / pt - sample.paperMm[1]) < .001, `${path}: sheet dimensions`);
  const extras = await readPdfExtras(pdf), scale = extras && importViewports(0, extras.pages[0]).scale;
  assert(scale && Math.abs(scale.metersPerPoint - .0254 / 72 * sample.ratio) < 1e-10, `${path}: viewer calibration`);
  const skipped = report.warnings.filter(w => w.kind === 'unsupported');
  const missingLeader = format === 'dwg' && sample.stem.includes('CST-A-');
  assert(skipped.length === (missingLeader ? 1 : 0), `${path}: unexpected omitted content ${JSON.stringify(skipped)}`);
  if (missingLeader) assert(skipped[0].type === 'LEADER arrowhead (style unavailable)' && skipped[0].count === 2, `${path}: leader limitation must be precise`);
  assert(hash(await readFile(resolve(fixtures, path))) === before, `${path}: source changed`);
  const pdfPath = resolve(output, `${basename(path)}.pdf`); await writeFile(pdfPath, pdf);
  rows.push({ path, sourceHash: before, sourceUnchanged: true, elapsedMs: performance.now() - start,
    pdf: pdfPath, report, intendedRatio: sample.intendedRatio, actualRatio: sample.ratio });
  console.log(`PASS ${path}: ${sample.paperMm.join(' x ')} mm, 1:${sample.ratio}${missingLeader ? ' (two leader arrowheads explicitly unsupported)' : ''}`);
}
for (const file of manifest.files) assert(hash(await readFile(resolve(fixtures, file.path))) === file.sha256, `Original changed: ${file.path}`);
await writeFile(resolve(output, 'results.json'), JSON.stringify({ revision: manifest.revision, rights: manifest.rights,
  oracle: 'Fixed source dimensions and existing model-fit policy; supplied PDFs are not an infallible oracle.', rows }, null, 2));
