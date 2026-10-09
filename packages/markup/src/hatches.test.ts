import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { markupShape } from './geometry.ts';
import { HATCH_PATTERNS, hatchDraw, resolveHatch } from './hatches.ts';
import type { Markup } from './model.ts';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

function rect(hatch: Markup['style']['hatch'], extra: Partial<Markup['style']> = {}): Markup {
  return {
    id: 'h1',
    type: 'polygon',
    pageIndex: 0,
    points: [
      [40, 40],
      [200, 50],
      [180, 160],
      [30, 140],
    ],
    style: { stroke: '#112233', fill: '#cccccc', fillOpacity: 0.4, width: 2, opacity: 1, hatch, ...extra },
    status: 'none',
    author: 'Tester',
    createdAt: 1,
    modifiedAt: 1,
  };
}

test('Standard set lists the eleven Revu patterns', () => {
  assert.deepEqual(
    HATCH_PATTERNS.map((h) => h.label),
    ['None', 'Brick', 'Diagonal Brick', 'Horizontal', 'Vertical', 'Diagonal Down', 'Diagonal Up', 'Grid', 'Weave', '10% Dots', '20% Dots', '30% Dots'],
  );
  assert.equal(hatchDraw('brick', 100)!.lines.length, 6);
  assert.equal(hatchDraw('weave', 100)!.lines.length, 8);
  assert.equal(hatchDraw('dots10', 100)!.dots.length, 41);
  assert.equal(hatchDraw('dots20', 100)!.dots.length, 85);
  assert.equal(hatchDraw('dots30', 100)!.dots.length, 113);
});

test('horizontal lines sit at the mirrored tile Y, and scale multiplies the cell and the stroke', () => {
  const tile = hatchDraw('horizontal', 100)!;
  const ys = tile.lines.map((l) => l.y1 / tile.metrics.cellH).sort((a, b) => a - b);
  assert.ok(close(ys[0]!, 0.25) && close(ys[1]!, 0.75));
  assert.equal(tile.metrics.cellW, 18);
  assert.equal(tile.metrics.lineWidth, 1);
  const big = hatchDraw('horizontal', 200)!;
  assert.equal(big.metrics.cellW, 36);
  assert.equal(big.metrics.lineWidth, 2);
  assert.equal(hatchDraw('dots10', 100)!.dots[0]!.r, 0.5);
});

test('diagonal up runs up and to the right in page space', () => {
  const tile = hatchDraw('diagonalUp', 100)!;
  const main = tile.lines.reduce((a, b) => (Math.hypot(b.x2 - b.x1, b.y2 - b.y1) > Math.hypot(a.x2 - a.x1, a.y2 - a.y1) ? b : a));
  assert.ok(main.x2 > main.x1 && main.y2 < main.y1);
});

test('a hatched polygon clips the pattern and does not expand every tile', () => {
  const parts = markupShape(rect('brick', { hatchColor: '#0000ff', hatchScale: 150 }));
  const hatch = parts.find((p) => p.hatch);
  assert.ok(hatch);
  assert.equal(hatch.path.length, 0);
  assert.equal(hatch.clip, parts[0]!.path);
  assert.equal(hatch.hatch!.color, '#0000ff');
  assert.equal(hatch.hatch!.scale, 150);
});

test('an area cutout clips the hatch with the even-odd rule', () => {
  const m = rect('grid');
  m.type = 'area';
  m.holes = [[[60, 60], [80, 60], [80, 80], [60, 80]]];
  const hatch = markupShape(m).find((p) => p.hatch);
  assert.equal(hatch?.evenOdd, true);
  assert.ok((hatch?.clip ?? []).filter((c) => c[0] === 'Z').length >= 2);
});

test('legacy hatch ids still produce a pattern', () => {
  assert.equal(resolveHatch('diagonal')?.id, 'diagonalUp');
  assert.equal(resolveHatch('backDiagonal')?.id, 'diagonalDown');
  assert.equal(resolveHatch('cross')?.id, 'grid');
  assert.equal(resolveHatch('diagonalCross')?.id, 'diagonalCross');
  assert.equal(resolveHatch('none'), null);
  const hatch = markupShape(rect('diagonalCross')).find((p) => p.hatch);
  assert.equal(hatch?.hatch?.id, 'diagonalCross');
  assert.ok((hatchDraw('diagonalCross', 100)?.lines.length ?? 0) >= 2);
});

test('a brick rectangle exports an uncolored tiling pattern and round-trips its style', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const original = await doc.save();
  const m = rect('brick', { hatchColor: '#0000ff', hatchScale: 100 });
  m.type = 'rect';
  m.points = [
    [40, 40],
    [160, 110],
  ];
  const bytes = await exportWithAnnotations(original.buffer as ArrayBuffer, [m]);
  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /\/PatternType 1/);
  assert.match(text, /\/PaintType 2/);

  const out = await PDFDocument.load(bytes);
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.asArray()[0]!, PDFDict);
  const raw = annot.lookupMaybe(PDFName.of('NBData'), PDFString, PDFHexString);
  assert.ok(raw);
  const parsed = JSON.parse(raw.decodeText()) as Markup;
  assert.equal(parsed.style.hatch, 'brick');
  assert.equal(parsed.style.hatchColor, '#0000ff');
  assert.equal(parsed.style.hatchScale, 100);
});
