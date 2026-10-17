import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
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

test('an imported hatch carried on the markup draws and exports as a tiling pattern', async () => {
  const spec = { scaleX: 1, scaleY: 1, size: 18, lineWidth: 1, elements: [{ type: 'line' as const, x1: 0, y1: 0.5, x2: 1, y2: 0.5 }] };
  const m = rect('set:Mine/Stripe', { hatchSpec: spec });
  const part = markupShape(m).find((p) => p.hatch);
  assert.deepEqual(part?.hatch?.spec, spec);
  assert.equal(markupShape(rect('set:Mine/Stripe')).find((p) => p.hatch), undefined, 'without its pattern an imported hatch is not drawn');
  const original = await (async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    return doc.save({ useObjectStreams: false });
  })();
  const bytes = await exportWithAnnotations(original.buffer as ArrayBuffer, [m]);
  assert.match(Buffer.from(bytes).toString('latin1'), /\/PatternType 1/);
});

test('a dot hatch pattern is drawn with curves, not the PostScript arc operator PDF does not have', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const original = await doc.save();
  const m = rect('dots20');
  m.type = 'rect';
  m.points = [[40, 40], [160, 110]];
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, [m]));
  const streams = out.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('PatternType')) ? [Buffer.from(decodePDFRawStream(o).decode()).toString('latin1')] : []));
  assert.equal(streams.length, 2, "the appearance's pattern and the annotation's own");
  for (const text of streams) {
    assert.doesNotMatch(text, /\barc\b/);
    assert.match(text, / c f\b/, 'each dot is four Béziers, filled');
  }
});

test('a hatched shape carries Bluebeam\'s hatch keys: a coloured pattern, its name and its colour', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const original = await doc.save();
  const m = rect('diagonalDown', { hatchColor: '#0000ff' });
  m.type = 'rect';
  m.points = [[40, 40], [160, 110]];
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, [m]));
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.asArray()[0]!, PDFDict);
  assert.equal(annot.lookup(PDFName.of('PatternName'), PDFString, PDFHexString).decodeText(), 'Diagonal Down');
  assert.deepEqual(annot.lookup(PDFName.of('PatternColor'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber()), [0, 0, 1]);
  const pattern = annot.lookup(PDFName.of('Pattern')) as PDFRawStream;
  assert.equal((pattern.dict.get(PDFName.of('PaintType')) as PDFNumber).asNumber(), 1, 'a coloured pattern, as Bluebeam writes');
  const text = Buffer.from(decodePDFRawStream(pattern).decode()).toString('latin1');
  assert.match(text, /0 0 1 RG/);
  // An unhatched shape has none of these.
  const plain = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, [{ ...m, id: 'p', style: { ...m.style, hatch: undefined } }]));
  const bare = plain.context.lookup(plain.getPage(0).node.Annots()!.asArray()[0]!, PDFDict);
  assert.equal(bare.has(PDFName.of('PatternName')), false);
});

test('an imported hatch is named by its own name', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const spec = { scaleX: 1, scaleY: 1, size: 18, lineWidth: 1, elements: [{ type: 'line' as const, x1: 0, y1: 0.5, x2: 1, y2: 0.5 }] };
  const m = rect('set:Mine/Stripe', { hatchSpec: spec });
  m.type = 'rect';
  m.points = [[40, 40], [160, 110]];
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]));
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.asArray()[0]!, PDFDict);
  assert.equal(annot.lookup(PDFName.of('PatternName'), PDFString, PDFHexString).decodeText(), 'Stripe');
});
