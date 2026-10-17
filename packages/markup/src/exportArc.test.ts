import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup, type Point } from './model.ts';

const arc = (points: Point[], style: Partial<Markup['style']> = {}): Markup => ({
  id: 'arc1',
  type: 'arc',
  pageIndex: 0,
  points,
  style: { ...DEFAULT_STYLES.arc, ...style },
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
});

async function exported(m: Markup) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]));
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  const num = (k: string) => annot.lookup(PDFName.of(k), PDFNumber).asNumber();
  return { annot, num, rect: annot.lookup(PDFName.of('Rect'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber()) };
}

test('a three-point arc is written as Bluebeam writes its Arc: a Circle with /IT /CircleArc and two angles', async () => {
  // Left, over the top, to the right: the upper half of the circle centred (200, 200), radius 100.
  const { annot, num, rect } = await exported(arc([[100, 200], [200, 100], [300, 200]]));
  assert.equal(annot.lookup(PDFName.of('Subtype'), PDFName).decodeText(), 'Circle');
  assert.equal(annot.lookup(PDFName.of('IT'), PDFName).decodeText(), 'CircleArc');
  assert.ok(Math.abs(num('Angle1') - 0) < 1e-6 || Math.abs(num('Angle1') - 360) < 1e-6, `Angle1 ${num('Angle1')}`);
  assert.ok(Math.abs(num('Angle2') - 180) < 1e-6, `Angle2 ${num('Angle2')}`);
  // Its Rect holds the whole circle, which is what Bluebeam builds the arc from.
  assert.ok(rect[0]! <= 100 && rect[2]! >= 300 && rect[1]! <= 100 && rect[3]! >= 300, `${rect}`);
});

test('the lower half of the circle runs from west to east counter-clockwise on paper', async () => {
  const { num } = await exported(arc([[100, 200], [200, 300], [300, 200]]));
  assert.ok(Math.abs(num('Angle1') - 180) < 1e-6, `Angle1 ${num('Angle1')}`);
  assert.ok(Math.abs(num('Angle2') - 0) < 1e-6 || Math.abs(num('Angle2') - 360) < 1e-6, `Angle2 ${num('Angle2')}`);
});

test('three points in a line have no circle and stay a polyline', async () => {
  const { annot } = await exported(arc([[100, 200], [200, 200], [300, 200]]));
  assert.equal(annot.lookup(PDFName.of('Subtype'), PDFName).decodeText(), 'PolyLine');
});

test('an arc keeps its line endings on the right ends', async () => {
  const { annot } = await exported(arc([[100, 200], [200, 100], [300, 200]], { startCap: 'circle', endCap: 'openArrow' }));
  const le = annot.lookup(PDFName.of('LE'), PDFArray).asArray().map((n) => (n as PDFName).decodeText());
  // Described from its far end (the arc runs clockwise on the page), so the endings come out swapped.
  assert.deepEqual(le, ['OpenArrow', 'Circle']);
});
