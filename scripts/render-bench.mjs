// Render benchmark: how long PDFium takes to parse and draw each page of a PDF, as it is and as
// the app's optimised render copy (apps/web/src/documents/renderCopy), and how much the two differ.
//
//   pnpm bench:render path/to/drawings.pdf [pages, e.g. 1,2,40] [--write copy.pdf]
//
// Times are for this machine and Node's wasm; the browser's are slower but in proportion.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const writeAt = args.indexOf('--write');
const writeTo = writeAt >= 0 ? args.splice(writeAt, 2)[1] : null;
const [file, pagesArg] = args;
if (!file) {
  console.error('Usage: pnpm bench:render <file.pdf> [pages, e.g. 1,2,40] [--write copy.pdf]');
  process.exit(1);
}

const pdfiumEntry = createRequire(join(root, 'packages/pdf-core/package.json')).resolve('@embedpdf/pdfium');
const { init } = await import(pathToFileURL(join(dirname(pdfiumEntry), 'index.js')).href);
const m = await init({ wasmBinary: readFileSync(join(dirname(pdfiumEntry), 'pdfium.wasm')) });
m.PDFiumExt_Init();
const { RenderCopyBuilder } = await import(pathToFileURL(join(root, 'apps/web/src/documents/renderCopy/renderCopy.ts')).href);

const original = new Uint8Array(readFileSync(file));
let t = performance.now();
const builder = await RenderCopyBuilder.load(original.slice());
const { bytes: copy, pages: plans } = await builder.build(null);
console.log(`Optimised copy built in ${((performance.now() - t) / 1000).toFixed(1)} s${copy ? '' : ': nothing worth changing'}`);
if (!copy) process.exit(0);
if (writeTo) writeFileSync(writeTo, copy);

function open(bytes) {
  const ptr = m.pdfium.wasmExports.malloc(bytes.length);
  m.pdfium.HEAPU8.set(bytes, ptr);
  return m.FPDF_LoadMemDocument(ptr, bytes.length, '');
}

/** Parses page `i` and draws it whole, 2048 px on its long side; returns times, object count and pixels. */
function measure(doc, i) {
  let t0 = performance.now();
  const page = m.FPDF_LoadPage(doc, i);
  const parse = performance.now() - t0;
  const W = m.FPDF_GetPageWidthF(page);
  const H = m.FPDF_GetPageHeightF(page);
  const s = 2048 / Math.max(W, H);
  const w = Math.ceil(W * s);
  const h = Math.ceil(H * s);
  const bmp = m.FPDFBitmap_CreateEx(w, h, 4, 0, 0);
  m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
  t0 = performance.now();
  m.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0x11);
  const draw = performance.now() - t0;
  const buf = m.FPDFBitmap_GetBuffer(bmp);
  const px = m.pdfium.HEAPU8.slice(buf, buf + w * h * 4);
  const objects = m.FPDFPage_CountObjects(page);
  m.FPDFBitmap_Destroy(bmp);
  m.FPDF_ClosePage(page);
  return { parse, draw, objects, px };
}

const a = open(original);
const b = open(copy);
const count = m.FPDF_GetPageCount(a);
const pages = pagesArg ? pagesArg.split(',').map((p) => Number(p) - 1) : [...Array(count).keys()];
const rows = [];
let before = 0;
let after = 0;
for (const i of pages) {
  const x = measure(a, i);
  const y = measure(b, i);
  let differ = 0;
  for (let k = 0; k < x.px.length; k += 4) {
    if (Math.max(Math.abs(x.px[k] - y.px[k]), Math.abs(x.px[k + 1] - y.px[k + 1]), Math.abs(x.px[k + 2] - y.px[k + 2])) > 48) differ++;
  }
  before += x.parse + x.draw;
  after += y.parse + y.draw;
  const ms = (v) => v.toFixed(0).padStart(6);
  rows.push(
    `${String(i + 1).padStart(4)} ${String(x.objects).padStart(8)} ${String(y.objects).padStart(8)} ${ms(x.parse)} ${ms(y.parse)} ${ms(x.draw)} ${ms(y.draw)} ${(((x.parse + x.draw) / Math.max(1, y.parse + y.draw)).toFixed(1) + '×').padStart(7)} ${((100 * differ) / (x.px.length / 4)).toFixed(3).padStart(7)}%${plans[i]?.worthwhile ? '' : '  (unchanged)'}`,
  );
}
console.log('page  objects   (copy)  parse ms (copy) draw ms (copy)  faster   differ');
for (const r of rows) console.log(r);
console.log(`total ${(before / 1000).toFixed(1)} s -> ${(after / 1000).toFixed(1)} s (${(before / after).toFixed(1)}× faster)`);
