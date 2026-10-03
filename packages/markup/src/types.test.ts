import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { isMeasureKind } from '@nb/measure';
import { exportWithAnnotations } from './export.ts';
import { markupShape } from './geometry.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { DEFAULT_STYLES, MARKUP_TYPES, type Markup, type MarkupType, type Point } from './model.ts';
import { TYPE_INFO } from './types.ts';

/** Enough points to draw each type. */
function sample(type: MarkupType): Point[] {
  const info = TYPE_INFO[type];
  if (info.draw === 'click') return [[10, 10], [60, 20], [40, 70], [5, 50]].slice(0, info.click?.fixed ?? Math.max(info.click?.min ?? 2, 3)) as Point[];
  if (info.draw === 'freehand') return [[10, 10], [20, 15], [30, 12]];
  return [[10, 10], [60, 40]];
}

test('the type table is complete and consistent', () => {
  for (const t of MARKUP_TYPES) {
    const info = TYPE_INFO[t];
    assert.ok(info.label, t);
    assert.equal(info.measure, isMeasureKind(t), `${t} measure flag`);
    assert.equal(info.draw === 'click', !!info.click, `${t} click rules`);
    assert.equal(!!info.ends, info.caps.lineEnds, `${t} line endings`);
    if (info.caps.hatch) assert.ok(info.closed, `${t} hatches but is not closed`);
    assert.ok(markupShape({ id: t, type: t, pageIndex: 0, points: sample(t), style: DEFAULT_STYLES[t], status: 'none', author: '', createdAt: 0, modifiedAt: 0 }).length > 0, `${t} draws`);
  }
});

test('every markup type exports to a PDF annotation and comes back exactly, replies included', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const markups: Markup[] = MARKUP_TYPES.map((t, i) => ({
    id: `m-${t}`,
    type: t,
    pageIndex: 0,
    points: sample(t),
    style: { ...DEFAULT_STYLES[t] },
    ...(TYPE_INFO[t].content === 'text' ? { text: 'Hello' } : {}),
    ...(TYPE_INFO[t].content === 'image' ? { image: png } : {}),
    ...(i === 0 ? { replies: [{ id: 'r1', author: 'Sam', text: 'Agreed, revise', createdAt: 5 }] } : {}),
    status: 'none',
    author: 'Test',
    createdAt: i,
    modifiedAt: i,
  }));
  const bytes = await exportWithAnnotations(original.buffer as ArrayBuffer, markups);
  // Read each annotation's markup data back as pdf-core does, and import it.
  const out = await PDFDocument.load(bytes);
  const annots = out.getPage(0).node.Annots()!;
  const found: ImportableAnnotation[] = annots.asArray().map((ref, index) => {
    const appData = out.context.lookup(ref, PDFDict).lookup(PDFName.of('NBData'), PDFString, PDFHexString).decodeText();
    return { index, subtype: '', rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 1, contents: '', author: '', intent: '', cloudy: false, da: '', appData, flags: 4, vertices: [], ink: [], line: null, link: null };
  });
  // One annotation per markup, plus the reply (which import leaves to its markup).
  assert.equal(found.length, markups.length + 1);
  const { markups: back } = importAnnotations(0, found);
  assert.deepEqual(back.map((m) => m.type), MARKUP_TYPES);
  assert.deepEqual(back, markups);
});
