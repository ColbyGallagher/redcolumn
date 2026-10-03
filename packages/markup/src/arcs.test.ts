import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { measureValue } from '@nb/measure';
import { exportWithAnnotations } from './export.ts';
import { flip } from './arrange.ts';
import { hitTest } from './geometry.ts';
import { DEFAULT_STYLES, markupBounds, measureProps, type Markup } from './model.ts';

const area = (bulges?: number[]): Markup => ({
  id: 'a',
  type: 'area',
  pageIndex: 0,
  points: [
    [100, 100],
    [200, 100],
    [200, 200],
    [100, 200],
  ],
  ...(bulges ? { bulges } : {}),
  style: DEFAULT_STYLES.area,
  status: 'none',
  author: 'A',
  createdAt: 1,
  modifiedAt: 1,
});

test('an area with a curved edge measures, draws, hits and exports along the arc', async () => {
  // Page space is y-down; the top edge (100,100)→(200,100) bulges up and out into a half circle.
  const m = area([1, 0, 0, 0]);
  const plain = measureValue('area', m.points, 1);
  const curved = measureValue('area', m.points, 1, measureProps(m));
  assert.ok(Math.abs(curved - (plain + (Math.PI * 50 * 50) / 2)) < 1e-6, `${curved}`);
  // The bounds and the hit area reach the top of the arc.
  assert.ok(markupBounds(m).y < 55);
  assert.ok(hitTest(m, [150, 60], 1));
  assert.ok(!hitTest(area(), [150, 60], 1));
  // Exported as many short segments; NBData keeps the bulges for us.
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]);
  const out = await PDFDocument.load(bytes);
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.ok(annot.lookup(PDFName.of('Vertices'), PDFArray).size() > 20);
  // A mirror image curves the other way.
  const flipped = flip([m], 'vertical').get('a')!;
  assert.deepEqual(flipped.bulges, [-1, -0, -0, -0]);
});
