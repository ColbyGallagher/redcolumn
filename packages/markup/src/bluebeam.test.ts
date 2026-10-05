import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import { importColumns, scaleFromMeasure } from './bluebeam.ts';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { readPdfExtras } from './pdfExtras.ts';
import type { Markup } from './model.ts';

const text = (s: string) => PDFHexString.fromText(s);

/**
 * A page as Bluebeam Revu writes one (page 400 × 400): a 1:20 mm viewport, two custom columns, an
 * area measurement with a cutout and column values, a reply and a review state on it, and a Space.
 */
async function bluebeamFile() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const measure = () => ({
    Type: 'Measure',
    Subtype: 'RL',
    R: PDFString.of('1 mm = 20 mm'),
    X: [{ Type: 'NumberFormat', U: PDFString.of('mm'), C: 7.055555, D: 100 }],
    D: [{ Type: 'NumberFormat', U: PDFString.of('mm'), C: 1, D: 100 }],
    A: [{ Type: 'NumberFormat', U: PDFString.of('sq m'), C: 0.000001, D: 100 }],
  });
  page.node.set(PDFName.of('VP'), ctx.obj([{ Type: 'Viewport', BBox: [0, 0, 400, 400], Measure: measure() }]));
  page.node.set(PDFName.of('BSISpaces'), ctx.obj([{ Type: 'Space', Title: text('ROOM 1'), Path: [[10, 10], [100, 10], [100, 100], [10, 100]], C: [0, 0, 1], CA: 0.1 }]));
  doc.catalog.set(
    PDFName.of('BSIAnnotColumns'),
    ctx.obj([
      { Subtype: 'Text', DisplayOrder: 0, Name: text('Trade') },
      { Subtype: 'Checkmark', DisplayOrder: 1, Name: text('Done'), DefaultValue: text('False') },
    ]),
  );
  const area = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Polygon',
      Subj: text('Area Measurement'),
      IT: 'PolygonDimension',
      T: text('Pat'),
      NM: text('AREA1'),
      C: [1, 0, 0],
      Vertices: [200, 200, 300, 200, 300, 300, 200, 300],
      Cutouts: [[220, 220, 240, 220, 240, 240, 220, 240]],
      Rect: [195, 195, 305, 305],
      Measure: measure(),
      MeasurementTypes: 129,
      Contents: text('0.33 sq m'),
      BSIColumnData: [text('Electrical'), text('True')],
      BSIUnknownVendorKey: 42,
    }),
  );
  const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', IRT: area, RT: 'R', T: text('Lee'), NM: text('REPLY1'), Contents: text('Checked\r'), Rect: [0, 0, 0, 0] }));
  const state = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', IRT: area, StateModel: text('Review'), State: text('Accepted'), T: text('Lee'), NM: text('STATE1'), F: 30, Rect: [0, 0, 0, 0] }));
  page.node.set(PDFName.of('Annots'), ctx.obj([area, reply, state]));
  return { bytes: await doc.save(), refs: [area, reply, state] };
}

/** What PDFium reports for those annotations (geometry in page space: y flipped). */
function pdfium(refs: PDFRef[]): ImportableAnnotation[] {
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: '#ff0000', interior: null, opacity: 1, borderWidth: 1, author: '', intent: '', cloudy: false, da: '', appData: '', flags: 4, ink: [], line: null, link: null };
  return [
    { ...base, index: 0, objectNumber: refs[0]!.objectNumber, subtype: 'Polygon', contents: '0.33 sq m', author: 'Pat', intent: 'PolygonDimension', vertices: [[200, 200], [300, 200], [300, 100], [200, 100]] },
    { ...base, index: 1, objectNumber: refs[1]!.objectNumber, subtype: 'Text', contents: 'Checked\r', author: 'Lee', vertices: [] },
    { ...base, index: 2, objectNumber: refs[2]!.objectNumber, subtype: 'Text', contents: '', author: 'Lee', flags: 30, vertices: [] },
  ];
}

async function imported() {
  const { bytes, refs } = await bluebeamFile();
  const extras = await readPdfExtras(bytes);
  assert.ok(extras);
  const result = importAnnotations(0, pdfium(refs), () => null, extras);
  return { bytes, extras, result, columns: importColumns(extras.columns) };
}

test('Bluebeam measurements import with their scale, cutouts, columns, reply, status and Space', async () => {
  const { result, columns } = await imported();
  assert.equal(result.scale?.label, '1:20');
  assert.equal(result.scale?.unit, 'mm');
  assert.equal(result.scale?.areaUnit, 'm');
  assert.deepEqual(result.imported, [0, 1, 2]);
  const area = result.markups.find((m) => m.type === 'area')!;
  assert.equal(area.subject, 'Area Measurement');
  assert.equal(area.style.stroke, '#ff0000');
  assert.equal(area.holes?.length, 1);
  assert.equal(area.status, 'accepted');
  assert.deepEqual(area.replies?.map((r) => [r.id, r.author, r.text]), [['REPLY1', 'Lee', 'Checked']]);
  assert.equal(area.comment, undefined, "a measurement's /Contents is its value, not a comment");
  assert.deepEqual(columns.map((c) => [c.id, c.type]), [['bluebeam:Trade', 'text'], ['bluebeam:Done', 'checkmark']]);
  assert.deepEqual(area.fields, { 'bluebeam:Trade': 'Electrical', 'bluebeam:Done': 'true' });
  const space = result.markups.find((m) => m.type === 'space')!;
  assert.equal(space.subject, 'ROOM 1');
  assert.deepEqual(space.points[0], [10, 390]);
  assert.equal(scaleFromMeasure({ X: [{ U: 'ft', C: 2 }, { U: 'in', C: 12, D: 16 }] })?.feetInches, true);
});

async function saved(bytes: Uint8Array, markups: Markup[], columns: ReturnType<typeof importColumns>) {
  const out = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, markups, { imported: { 0: [0, 1, 2] }, importedSpaces: { 0: [0] }, columns });
  const doc = await PDFDocument.load(out);
  const annots = doc.getPage(0).node.Annots()!;
  return { doc, annots, dicts: annots.asArray().map((r) => doc.context.lookup(r, PDFDict)) };
}

test('saving unchanged Bluebeam markups leaves their annotations exactly as they were', async () => {
  const { bytes, result, columns } = await imported();
  const before = await PDFDocument.load(bytes);
  const { doc, dicts } = await saved(bytes, result.markups, columns);
  const original = before.getPage(0).node.Annots()!.asArray().map((r) => before.context.lookup(r, PDFDict).toString());
  assert.deepEqual(
    dicts.map((d) => d.toString()),
    original,
  );
  assert.equal(doc.getPage(0).node.lookup(PDFName.of('BSISpaces'), PDFArray).size(), 1);
});

test('an edited Bluebeam markup is written over its annotation, keeping what it has no equivalent for', async () => {
  const { bytes, result, columns } = await imported();
  const markups = result.markups.map((m) =>
    m.type === 'area'
      ? { ...m, points: m.points.map(([x, y]) => [x + 10, y] as [number, number]), status: 'rejected', fields: { ...m.fields, 'bluebeam:Trade': 'Plumbing' }, replies: [...(m.replies ?? []), { id: 'new', author: 'Me', text: 'Moved', createdAt: 1 }] }
      : m.type === 'space'
        ? { ...m, subject: 'ROOM 2' }
        : m,
  );
  const { doc, annots, dicts } = await saved(bytes, markups, columns);
  const area = dicts[0]!;
  const str = (d: PDFDict, k: string) => d.lookupMaybe(PDFName.of(k), PDFString, PDFHexString)?.decodeText();
  // Same object, identity and Bluebeam keys kept; geometry and values updated.
  assert.equal(str(area, 'NM'), 'AREA1');
  assert.equal(str(area, 'Subj'), 'Area Measurement');
  assert.equal(area.lookup(PDFName.of('BSIUnknownVendorKey'), PDFNumber).asNumber(), 42);
  assert.equal(area.lookup(PDFName.of('MeasurementTypes'), PDFNumber).asNumber(), 129);
  assert.equal(area.lookup(PDFName.of('Vertices'), PDFArray).lookup(0, PDFNumber).asNumber(), 210);
  assert.ok(area.has(PDFName.of('Cutouts')));
  assert.deepEqual(area.lookup(PDFName.of('BSIColumnData'), PDFArray).asArray().map((v) => (v as PDFHexString).decodeText()), ['Plumbing', 'True']);
  // The reply and state still point at it; the new reply and the new status are added.
  const areaRef = annots.get(0) as PDFRef;
  const thread = dicts.filter((d) => d.get(PDFName.of('IRT')) === areaRef);
  assert.deepEqual(thread.filter((d) => !d.has(PDFName.of('StateModel'))).map((d) => str(d, 'NM')), ['REPLY1', 'new']);
  assert.deepEqual(thread.flatMap((d) => (d.has(PDFName.of('StateModel')) ? [str(d, 'State')] : [])), ['Accepted', 'Rejected']);
  const space = doc.getPage(0).node.lookup(PDFName.of('BSISpaces'), PDFArray).lookup(0, PDFDict);
  assert.equal(str(space, 'Title'), 'ROOM 2');
});
