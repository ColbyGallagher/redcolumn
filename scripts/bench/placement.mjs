#!/usr/bin/env node
/**
 * Placement benchmark: generates deterministic fictional PDF revision pairs, renders and reads
 * them through PDFium (just like the app), pairs sheets via `@nb/sheets`, aligns pages and
 * suggests comment placements via `@nb/align`, and reports per-case accuracy against ground truth.
 *
 * Usage:
 *   pnpm bench:placement [--seed 20261127] [--tolerance 12] [--dpi 100] [--details] [--baseline-global] [--json]
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2).filter((a) => a !== '--');

function readFlagValue(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v ?? fallback;
}
function hasFlag(name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

const seed = Number(readFlagValue('--seed', '20261127'));
const tolerance = Number(readFlagValue('--tolerance', '12'));
const dpi = Number(readFlagValue('--dpi', '100'));
const showDetails = hasFlag('--details');
const baselineGlobal = hasFlag('--baseline-global');
const jsonOut = hasFlag('--json');
const useOracleSheetPairing = hasFlag('--oracle-sheet-pairing');

const alignLib = await import(pathToFileURL(join(root, 'packages/align/src/index.ts')).href);
const sheetsLib = await import(pathToFileURL(join(root, 'packages/sheets/src/index.ts')).href);
const pairingLib = await import(pathToFileURL(join(root, 'apps/web/src/compare/pairing.ts')).href);
const fixturesLib = await import(pathToFileURL(join(root, 'scripts/bench/placement-fixtures.ts')).href);

const { alignPages, alignRenderScale, inkMask, suggestPlacement } = alignLib;
const { detectSheets } = sheetsLib;
const { pairPages } = pairingLib;
const { generatePlacementFixtures } = fixturesLib;

// Load PDFium wasm directly for full-page RGBA bitmap rendering (same path as scripts/render-bench.mjs),
// and use `globalThis.__pdfNode()` (scripts/bench/pdf-node.mjs) for app-identical word extraction.
const pdfiumEntry = createRequire(join(root, 'packages/pdf-core/package.json')).resolve('@embedpdf/pdfium');
const { init } = await import(pathToFileURL(join(dirname(pdfiumEntry), 'index.js')).href);
const pdfium = await init({ wasmBinary: readFileSync(join(dirname(pdfiumEntry), 'pdfium.wasm')) });
pdfium.PDFiumExt_Init();

const pdfNode = await globalThis.__pdfNode();

const FPDFBitmap_BGRA = 4;
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;

function openPdfium(bytes) {
  const ptr = pdfium.pdfium.wasmExports.malloc(bytes.length);
  pdfium.pdfium.HEAPU8.set(bytes, ptr);
  const handle = pdfium.FPDF_LoadMemDocument(ptr, bytes.length, '');
  if (!handle) {
    pdfium.pdfium.wasmExports.free(ptr);
    throw new Error('PDFium failed to open generated PDF');
  }
  return {
    handle,
    close() {
      pdfium.FPDF_CloseDocument(handle);
      pdfium.pdfium.wasmExports.free(ptr);
    },
  };
}

function renderInkMask(docHandle, pageIndex, scale) {
  const page = pdfium.FPDF_LoadPage(docHandle, pageIndex);
  const W = pdfium.FPDF_GetPageWidthF(page);
  const H = pdfium.FPDF_GetPageHeightF(page);
  const w = Math.max(1, Math.ceil(W * scale));
  const h = Math.max(1, Math.ceil(H * scale));
  const bmp = pdfium.FPDFBitmap_CreateEx(w, h, FPDFBitmap_BGRA, 0, 0);
  pdfium.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
  pdfium.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER);
  const buf = pdfium.FPDFBitmap_GetBuffer(bmp);
  const rgba = pdfium.pdfium.HEAPU8.slice(buf, buf + w * h * 4);
  pdfium.FPDFBitmap_Destroy(bmp);
  pdfium.FPDF_ClosePage(page);
  return { size: { width: W, height: H }, mask: inkMask(rgba, w, h) };
}

async function readPagesText(bytes) {
  const opened = await pdfNode.open(bytes.slice().buffer);
  try {
    const pages = [];
    for (let i = 0; i < opened.pages.length; i++) {
      pages.push({ width: opened.pages[i].width, height: opened.pages[i].height, words: await pdfNode.text(opened.docId, i) });
    }
    return pages;
  } finally {
    await pdfNode.close(opened.docId);
  }
}

/** Max vertex Euclidean distance between two geometries (points). */
function maxVertexError(a, b) {
  if (a.points.length !== b.points.length) return Infinity;
  let maxErr = 0;
  for (let i = 0; i < a.points.length; i++) {
    const d = Math.hypot(a.points[i][0] - b.points[i][0], a.points[i][1] - b.points[i][1]);
    if (d > maxErr) maxErr = d;
  }
  return maxErr;
}

const fixtures = generatePlacementFixtures(seed);
const results = [];

for (const fx of fixtures) {
  const oldTextPages = await readPagesText(fx.oldPdf);
  const newTextPages = await readPagesText(fx.newPdf);

  const oldDetected = detectSheets(oldTextPages).map((s) => s?.number ?? null);
  const newDetected = detectSheets(newTextPages).map((s) => s?.number ?? null);

  let pairs;
  if (useOracleSheetPairing) {
    // Ground-truth sheet pairing (simulates a human confirming sheet matches before placement).
    const map = new Map();
    for (const c of fx.comments) {
      if (c.expected && !map.has(c.oldPage)) map.set(c.oldPage, c.expected.newPage);
    }
    pairs = [...map.entries()].map(([oldPage, newPage]) => ({ oldPage, newPage }));
  } else {
    pairs = pairPages(oldDetected, newDetected, fx.pairBySheet);
  }

  const pairByOld = new Map(pairs.map((p) => [p.oldPage, p.newPage]));

  const oldDoc = openPdfium(fx.oldPdf);
  const newDoc = openPdfium(fx.newPdf);
  const alignments = new Map();

  try {
    for (const pair of pairs) {
      const oldSize = { width: oldTextPages[pair.oldPage].width, height: oldTextPages[pair.oldPage].height };
      const newSize = { width: newTextPages[pair.newPage].width, height: newTextPages[pair.newPage].height };
      const scale = alignRenderScale(oldSize, newSize, dpi);
      const oldRender = renderInkMask(oldDoc.handle, pair.oldPage, scale);
      const newRender = renderInkMask(newDoc.handle, pair.newPage, scale);
      const alignment = alignPages(
        {
          oldSize: oldRender.size,
          newSize: newRender.size,
          oldMask: oldRender.mask,
          newMask: newRender.mask,
          scale,
          oldWords: oldTextPages[pair.oldPage].words,
          newWords: newTextPages[pair.newPage].words,
        },
        { align: true, maxShift: 72, scaleToFit: true, retainEvidence: !baselineGlobal },
      );
      alignments.set(pair.oldPage, { newPage: pair.newPage, alignment });
    }
  } finally {
    oldDoc.close();
    newDoc.close();
  }

  const caseStats = {
    id: fx.id,
    label: fx.label,
    sheets: fx.oldSheets.length,
    total: fx.comments.length,
    expectedPlaced: 0,
    expectedNone: 0,
    correct: 0,
    wrong: 0,
    none: 0,
    withheldCorrectly: 0,
    missed: 0,
    wrongOnDeleted: 0,
    wrongPosition: 0,
    wrongPage: 0,
    details: [],
  };

  for (const c of fx.comments) {
    if (c.expected) caseStats.expectedPlaced++;
    else caseStats.expectedNone++;

    const entry = alignments.get(c.oldPage);
    if (!entry) {
      caseStats.none++;
      if (c.expected) caseStats.missed++;
      else caseStats.withheldCorrectly++;
      caseStats.details.push({
        id: c.id,
        subcase: c.subcase,
        outcome: 'none',
        reason: 'unpaired-sheet',
        confidence: 0,
        errorPt: null,
        expectedNone: !c.expected,
      });
      continue;
    }

    const sug = suggestPlacement(entry.alignment, c.oldGeometry);
    if (sug.kind === 'none') {
      caseStats.none++;
      if (c.expected) caseStats.missed++;
      else caseStats.withheldCorrectly++;
      caseStats.details.push({
        id: c.id,
        subcase: c.subcase,
        outcome: 'none',
        reason: sug.reason,
        confidence: Number(sug.confidence.toFixed(3)),
        errorPt: null,
        expectedNone: !c.expected,
      });
    } else if (!c.expected) {
      caseStats.wrong++;
      caseStats.wrongOnDeleted++;
      caseStats.details.push({
        id: c.id,
        subcase: c.subcase,
        outcome: 'wrong',
        reason: 'placed-on-deleted',
        confidence: Number(sug.confidence.toFixed(3)),
        errorPt: null,
        expectedNone: true,
      });
    } else if (entry.newPage !== c.expected.newPage) {
      caseStats.wrong++;
      caseStats.wrongPage++;
      caseStats.details.push({
        id: c.id,
        subcase: c.subcase,
        outcome: 'wrong',
        reason: `wrong-page(${entry.newPage}!=${c.expected.newPage})`,
        confidence: Number(sug.confidence.toFixed(3)),
        errorPt: null,
        expectedNone: false,
      });
    } else {
      const err = maxVertexError(sug.geometry, c.expected.geometry);
      if (err <= tolerance) {
        caseStats.correct++;
        caseStats.details.push({
          id: c.id,
          subcase: c.subcase,
          outcome: 'correct',
          reason: 'ok',
          confidence: Number(sug.confidence.toFixed(3)),
          errorPt: Number(err.toFixed(2)),
          expectedNone: false,
        });
      } else {
        caseStats.wrong++;
        caseStats.wrongPosition++;
        caseStats.details.push({
          id: c.id,
          subcase: c.subcase,
          outcome: 'wrong',
          reason: 'beyond-tolerance',
          confidence: Number(sug.confidence.toFixed(3)),
          errorPt: Number(err.toFixed(2)),
          expectedNone: false,
        });
      }
    }
  }

  results.push({
    ...caseStats,
    detectedOldSheets: oldDetected,
    detectedNewSheets: newDetected,
    pairedCount: pairByOld.size,
  });
}

const totals = results.reduce(
  (acc, r) => {
    acc.sheets += r.sheets;
    acc.total += r.total;
    acc.expectedPlaced += r.expectedPlaced;
    acc.expectedNone += r.expectedNone;
    acc.correct += r.correct;
    acc.wrong += r.wrong;
    acc.none += r.none;
    acc.withheldCorrectly += r.withheldCorrectly;
    acc.missed += r.missed;
    acc.wrongOnDeleted += r.wrongOnDeleted;
    acc.wrongPosition += r.wrongPosition;
    acc.wrongPage += r.wrongPage;
    return acc;
  },
  {
    sheets: 0,
    total: 0,
    expectedPlaced: 0,
    expectedNone: 0,
    correct: 0,
    wrong: 0,
    none: 0,
    withheldCorrectly: 0,
    missed: 0,
    wrongOnDeleted: 0,
    wrongPosition: 0,
    wrongPage: 0,
  },
);

if (jsonOut) {
  console.log(JSON.stringify({ seed, tolerance, dpi, baselineGlobal, useOracleSheetPairing, results, totals }, null, 2));
} else {
  const mode = [
    baselineGlobal ? 'global-only (no local check)' : 'global + local verification',
    useOracleSheetPairing ? 'confirmed sheet pairing' : 'automatic sheet-number pairing',
  ].join(', ');
  console.log(`Placement benchmark (seed=${seed}, tolerance=${tolerance} pt, dpi=${dpi}, mode=${mode})\n`);
  const cols = [
    ['Case', 20, false],
    ['Total', 5, true],
    ['ExpPos', 6, true],
    ['ExpNil', 6, true],
    ['Correct', 7, true],
    ['Wrong', 5, true],
    ['None', 4, true],
    ['Withheld', 8, true],
    ['Missed', 6, true],
  ];
  const fmt = (vals) => vals.map((v, i) => (cols[i][2] ? String(v).padStart(cols[i][1]) : String(v).padEnd(cols[i][1]))).join(' | ');
  console.log(fmt(cols.map((c) => c[0])));
  console.log(cols.map((c) => '-'.repeat(c[1])).join('-+-'));
  for (const r of results) {
    console.log(fmt([r.label, r.total, r.expectedPlaced, r.expectedNone, r.correct, r.wrong, r.none, r.withheldCorrectly, r.missed]));
  }
  console.log(cols.map((c) => '-'.repeat(c[1])).join('-+-'));
  console.log(fmt(['TOTAL', totals.total, totals.expectedPlaced, totals.expectedNone, totals.correct, totals.wrong, totals.none, totals.withheldCorrectly, totals.missed]));
  const placed = totals.correct + totals.wrong;
  const precision = placed > 0 ? ((100 * totals.correct) / placed).toFixed(1) : 'n/a';
  const recall = totals.expectedPlaced > 0 ? ((100 * totals.correct) / totals.expectedPlaced).toFixed(1) : 'n/a';
  console.log(`\nPlaced suggestions: ${placed}/${totals.total} (${totals.correct} correct, ${totals.wrong} wrong -> precision ${precision}%; recall on placeable comments ${recall}%)`);
  console.log(`Wrong breakdown: ${totals.wrongPosition} position/scale error, ${totals.wrongOnDeleted} placed on deleted/redesigned content, ${totals.wrongPage} wrong sheet.`);
  console.log(`Unplaced breakdown: ${totals.withheldCorrectly}/${totals.expectedNone} properly withheld on deleted/redesigned content, ${totals.missed}/${totals.expectedPlaced} missed placeable comments.`);

  if (showDetails) {
    console.log('\nPer-comment breakdown:');
    for (const r of results) {
      console.log(`\n[${r.id}] detected old=${JSON.stringify(r.detectedOldSheets)} new=${JSON.stringify(r.detectedNewSheets)}`);
      for (const d of r.details) {
        console.log(
          `  ${d.id.padEnd(12)} ${d.subcase.padEnd(20)} ${d.outcome.padEnd(8)} conf=${String(d.confidence).padEnd(5)} err=${d.errorPt === null ? '-' : `${d.errorPt}pt`} (${d.reason})`,
        );
      }
    }
  }
}
