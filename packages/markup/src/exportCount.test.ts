import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type CountShape, type Markup, type Point } from './model.ts';

const count = (points: Point[], countShape?: CountShape): Markup => ({
  id: 'cnt',
  type: 'count',
  pageIndex: 0,
  points,
  style: { ...DEFAULT_STYLES.count, ...(countShape ? { countShape } : {}) },
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
});

async function exported(m: Markup) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]));
  return out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict));
}
const name = (d: PDFDict, k: string) => d.get(PDFName.of(k))?.toString();

test('a count is one Polygon per item, grouped, each saying the total, as Bluebeam writes it', async () => {
  const dicts = await exported(count([[50, 50], [100, 50], [150, 50]], 'check'));
  assert.equal(dicts.length, 3);
  for (const d of dicts) {
    assert.equal(name(d, 'Subtype'), '/Polygon');
    assert.equal(name(d, 'IT'), '/PolygonCount');
    assert.equal(name(d, 'CountStyle'), '/Checkmark');
    assert.equal(d.lookup(PDFName.of('NumCounts'), PDFNumber).asNumber(), 3);
    assert.equal(d.lookup(PDFName.of('Contents'), PDFString, PDFHexString).decodeText(), '3');
    assert.equal(d.lookup(PDFName.of('Vertices'), PDFArray).size(), 12, 'a checkmark has six vertices');
  }
  const [lead, ...others] = dicts;
  const nesting = lead!.lookup(PDFName.of('GroupNesting'), PDFArray).asArray().map((o) => (o instanceof PDFString ? o.decodeText() : (o as PDFHexString).decodeText()));
  assert.deepEqual(nesting, ['Count Measurement', '/cnt', '/cnt~1', '/cnt~2']);
  for (const d of others) {
    assert.ok(d.has(PDFName.of('IRT')));
    assert.equal(name(d, 'RT'), '/Group');
  }
});

test('every count marker is a polygon', async () => {
  for (const shape of ['circle', 'check', 'square', 'diamond', 'triangle', 'cross'] as const) {
    const [d] = await exported(count([[100, 100]], shape));
    assert.equal(name(d!, 'Subtype'), '/Polygon', shape);
    assert.ok(d!.lookup(PDFName.of('Vertices'), PDFArray).size() >= 6, shape);
  }
});
