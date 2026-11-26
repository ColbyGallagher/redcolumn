import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import { importColumns, importStatuses, parseDefaultStyle, scaleFromMeasure } from './bluebeam.ts';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { markupShape } from './geometry.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { MarkupStore } from './store.ts';
import { rotatePoint, rotationCentre, type Markup } from './model.ts';
import { assertValidPdf } from '../test/qpdf.ts';

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
  assertValidPdf(out, 'bluebeam saved markups');
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

/**
 * Bluebeam's other forms (page 400 × 400): a polygon cloud, an elliptical arc, a count of two items
 * (one ticked with a Marked state), a flag and a three-point radius.
 */
async function bluebeamShapes() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const cloud = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Polygon', IT: 'PolygonCloud', BE: { S: 'C', I: 2 }, C: [1, 0, 0], NM: text('CLOUD'), Vertices: [10, 10, 60, 10, 80, 50, 10, 40], Rect: [0, 0, 90, 60] }));
  const arc = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Circle', IT: 'CircleArc', C: [1, 0, 0], NM: text('ARC'), Angle1: 90, Angle2: 180, RD: [0, 0, 0, 0], Rect: [100, 100, 200, 140] }));
  const item = (nm: string, x: number) => ({ Type: 'Annot', Subtype: 'Polygon', IT: 'PolygonCount', CountStyle: 'Checkmark', IC: [1, 0, 0], C: [1, 0, 0], NM: text(nm), NumCounts: 2, Contents: text('2'), Vertices: [x - 9, 200, x - 7, 202, x - 3, 197, x + 7, 207, x + 9, 205, x - 3, 193], Rect: [x - 10, 190, x + 10, 210] });
  const count1 = ctx.register(ctx.obj({ ...item('C1', 250), GroupNesting: [text('Count'), text('/C1'), text('/C2')] }));
  const count2 = ctx.register(ctx.obj({ ...item('C2', 280), IRT: count1, RT: 'Group' }));
  const marked = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', IRT: count1, StateModel: text('Marked'), State: text('Marked'), NM: text('M1'), F: 30, Rect: [0, 0, 0, 0] }));
  const flag = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Subj: text('Flag'), Flag: ctx.obj({ Type: 'Flag' }), C: [0.5, 0.1, 0.15], FillOpacity: 0.6, DS: text('font: Helvetica 8pt; color:#FFFFFF'), Contents: text('FLAG'), NM: text('FLAG'), RD: [14.5, 5.5, 5.5, 5.5], Rect: [10, 300, 170, 330] }));
  const radius = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Polygon', IT: 'PolygonRadius', C: [1, 0, 0], NM: text('RAD'), Vertices: [330, 100, 300, 100, 300, 130], Rect: [265, 65, 335, 135] }));
  const refs = [cloud, arc, count1, count2, marked, flag, radius];
  page.node.set(PDFName.of('Annots'), ctx.obj(refs));
  return { bytes: await doc.save(), refs };
}

function pdfiumShapes(refs: PDFRef[]): ImportableAnnotation[] {
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: '#ff0000', interior: null, opacity: 1, borderWidth: 1, contents: '', author: 'Pat', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
  const subtypes = ['Polygon', 'Circle', 'Polygon', 'Polygon', 'Text', 'FreeText', 'Polygon'];
  return refs.map((r, index) => ({ ...base, index, objectNumber: r.objectNumber, subtype: subtypes[index]!, flags: index === 4 ? 30 : 4 }));
}

async function importedShapes() {
  const { bytes, refs } = await bluebeamShapes();
  const extras = await readPdfExtras(bytes);
  assert.ok(extras);
  return { bytes, result: importAnnotations(0, pdfiumShapes(refs), () => null, extras) };
}

test("Bluebeam's polygon clouds, elliptical arcs, counts, checkmarks, flags and radius arcs import as their own types", async () => {
  const { result } = await importedShapes();
  const of = (type: string) => result.markups.filter((m) => m.type === type);
  assert.equal(of('polygonCloud')[0]?.points.length, 4);
  assert.equal(of('polygonCloud')[0]?.style.arcRadius, 6);
  const arc = of('ellipticalArc')[0]!;
  assert.deepEqual(arc.arcAngles?.map(Math.round), [90, 180]);
  assert.deepEqual(arc.points, [[100, 260], [200, 300]]);
  // Two count items are one count of two, ticked.
  const count = of('count');
  assert.equal(count.length, 1);
  assert.equal(count[0]!.points.length, 2);
  assert.deepEqual(count[0]!.pdfAnnot?.members, [2, 3]);
  assert.equal(count[0]!.checked, true);
  assert.equal(count[0]!.groupId, undefined);
  const flag = of('flagLabel')[0]!;
  assert.equal(flag.text, 'FLAG');
  assert.equal(flag.style.fillOpacity, 0.6);
  assert.equal(of('radius')[0]?.points.length, 3);
  assert.deepEqual(result.imported, [0, 1, 2, 3, 4, 5, 6]);
});

test('edited Bluebeam counts keep one annotation per item, and checkmark changes are saved as Marked states', async () => {
  const { bytes, result } = await importedShapes();
  const options = { imported: { 0: [0, 1, 2, 3, 4, 5, 6] } };
  // Unchanged: every annotation exactly as it was.
  const sameBytes = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, result.markups, options);
  assertValidPdf(sameBytes, 'bluebeam unchanged shapes');
  const same = await PDFDocument.load(sameBytes);
  const before = await PDFDocument.load(bytes);
  const dicts = (d: PDFDocument) => d.getPage(0).node.Annots()!.asArray().map((r) => d.context.lookup(r, PDFDict));
  assert.deepEqual(dicts(same).map((d) => d.toString()), dicts(before).map((d) => d.toString()));

  // A third item, the tick removed and the arc moved.
  const edited = result.markups.map((m): Markup =>
    m.type === 'count' ? { ...m, points: [...m.points, [320, 195]], checked: false } : m.type === 'ellipticalArc' ? { ...m, points: m.points.map(([x, y]) => [x + 10, y] as [number, number]) } : m,
  );
  const outBytes = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, edited, options);
  assertValidPdf(outBytes, 'bluebeam edited counts');
  const out = await PDFDocument.load(outBytes);
  const after = dicts(out);
  const str = (d: PDFDict, k: string) => d.lookupMaybe(PDFName.of(k), PDFString, PDFHexString)?.decodeText();
  const items = after.filter((d) => d.lookupMaybe(PDFName.of('IT'), PDFName)?.decodeText() === 'PolygonCount');
  assert.equal(items.length, 3);
  assert.ok(items.every((d) => d.lookup(PDFName.of('NumCounts'), PDFNumber).asNumber() === 3 && str(d, 'Contents') === '3'));
  assert.deepEqual(items.slice(0, 2).map((d) => str(d, 'NM')), ['C1', 'C2']);
  assert.ok(items[2]!.has(PDFName.of('IRT')));
  assert.deepEqual(items[0]!.lookup(PDFName.of('GroupNesting'), PDFArray).asArray().map((v) => (v as PDFHexString | PDFString).decodeText()), ['Count', '/C1', '/C2', `/${str(items[2]!, 'NM')}`]);
  assert.ok(after.some((d) => str(d, 'StateModel') === 'Marked' && str(d, 'State') === 'Unmarked'));
  const arc = after.find((d) => str(d, 'NM') === 'ARC')!;
  assert.equal(arc.lookup(PDFName.of('Subtype'), PDFName).decodeText(), 'Circle');
  assert.equal(Math.round(arc.lookup(PDFName.of('Angle1'), PDFNumber).asNumber()), 90);
  assert.equal(Math.round(arc.lookup(PDFName.of('Angle2'), PDFNumber).asNumber()), 180);
});

test('scales keep Bluebeam\'s unit wording and angle precision', () => {
  const s = scaleFromMeasure({
    X: [{ U: 'mm', C: 7.055555, D: 100 }],
    A: [{ U: 'sq m', C: 0.000001 }],
    V: [{ U: 'cu m', C: 1e-9 }],
    T: [{ U: '°', C: 1, D: 100 }],
  })!;
  assert.equal(s.areaUnit, 'm');
  assert.deepEqual(s.areaLabel, { unit: 'm', label: 'sq m' });
  assert.equal(s.anglePrecision, 2);
});

/**
 * Columns and statuses as a project's Bluebeam profile leaves them: columns removed from the file
 * stay listed as /Deleted (one with the same name as a live column), and a custom status set
 * (/BSIStatus) whose states sit alongside a Review state on the same markup.
 */
async function bluebeamStatusSet() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  doc.catalog.set(
    PDFName.of('BSIAnnotColumns'),
    ctx.obj([
      { Deleted: true, DisplayOrder: -1, Name: text('Package'), Subtype: 'Text' },
      { Deleted: true, DisplayOrder: -1, Name: text('Priority'), Subtype: 'Choice', Items: ctx.register(ctx.obj([text('Old')])) },
      { DisplayOrder: 1, Name: text('Priority'), Subtype: 'Choice', Items: ctx.register(ctx.obj([text('High'), text('Medium')])) },
      { DisplayOrder: 0, Name: text('Organisation'), Subtype: 'Text' },
    ]),
  );
  doc.catalog.set(
    PDFName.of('BSIStatus'),
    ctx.obj([
      { M: text('BSI_SET'), S: text('1.0 Open'), C: [1, 0, 0] },
      { M: text('BSI_SET'), S: text('1.2 Closed'), C: [0, 0, 1] },
    ]),
  );
  const cloud = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', NM: text('SQ'), C: [1, 0, 0], Rect: [10, 10, 100, 100], BSIColumnData: [text('pkg'), text('old'), text('Medium'), text('KESTREL')] }));
  const state = (nm: string, model: string, s: string, date: string) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', IRT: cloud, StateModel: text(model), State: text(s), NM: text(nm), M: text(date), F: 30, Rect: [0, 0, 0, 0] }));
  const refs = [cloud, state('S1', 'BSI_SET', '1.0 Open', 'D:20251223142229'), state('S2', 'Review', 'Completed', 'D:20260128141815'), state('S3', 'BSI_SET', '1.2 Closed', 'D:20260219100000')];
  page.node.set(PDFName.of('Annots'), ctx.obj(refs));
  const bytes = await doc.save();
  const extras = (await readPdfExtras(bytes))!;
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: '#ff0000', interior: null, opacity: 1, borderWidth: 1, contents: '', author: 'Pat', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
  const annotations = refs.map((r, index) => ({ ...base, index, objectNumber: r.objectNumber, subtype: index ? 'Text' : 'Square', flags: index ? 30 : 4 }));
  return { bytes, extras, result: importAnnotations(0, annotations, () => null, extras), columns: importColumns(extras.columns), statuses: importStatuses(extras.statusDefs ?? []) };
}

test("Bluebeam's deleted columns are not the file's columns, and custom status sets are statuses", async () => {
  const { result, columns, statuses } = await bluebeamStatusSet();
  assert.deepEqual(columns.map((c) => [c.name, c.options]), [['Organisation', undefined], ['Priority', ['High', 'Medium']]]);
  const m = result.markups[0]!;
  assert.deepEqual(m.fields, { 'bluebeam:Priority': 'Medium', 'bluebeam:Organisation': 'KESTREL' });
  // The latest state of any model, here the custom set's, is the status.
  assert.equal(m.status, '1.2 closed');
  assert.deepEqual(statuses, [
    { id: '1.0 open', name: '1.0 Open', color: '#ff0000', model: 'BSI_SET' },
    { id: '1.2 closed', name: '1.2 Closed', color: '#0000ff', model: 'BSI_SET' },
  ]);
  assert.deepEqual(result.statuses, [
    { name: '1.0 Open', model: 'BSI_SET' },
    { name: 'Completed', model: 'Review' },
    { name: '1.2 Closed', model: 'BSI_SET' },
  ]);
});

test('saving keeps deleted Bluebeam columns and their values, and writes custom statuses in their own set', async () => {
  const { bytes, result, columns, statuses } = await bluebeamStatusSet();
  const options = { imported: { 0: [0, 1, 2, 3] }, columns, statuses };
  const before = await PDFDocument.load(bytes);
  const catalog = (d: PDFDocument) => d.catalog.lookup(PDFName.of('BSIAnnotColumns'), PDFArray).toString();
  // Unchanged: the column list exactly as it was (option lists still by reference).
  const sameBytes = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, result.markups, options);
  assertValidPdf(sameBytes, 'bluebeam unchanged columns');
  const same = await PDFDocument.load(sameBytes);
  assert.equal(catalog(same), catalog(before));

  const edited = result.markups.map((m) => ({ ...m, status: '1.0 open', fields: { ...m.fields, 'bluebeam:Priority': 'High' } }));
  const outBytes = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, edited, options);
  assertValidPdf(outBytes, 'bluebeam edited columns and statuses');
  const out = await PDFDocument.load(outBytes);
  assert.equal(catalog(out), catalog(before));
  const dicts = out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict));
  const str = (d: PDFDict, k: string) => d.lookupMaybe(PDFName.of(k), PDFString, PDFHexString)?.decodeText();
  // Deleted columns keep their values in their own places.
  assert.deepEqual(dicts[0]!.lookup(PDFName.of('BSIColumnData'), PDFArray).asArray().map((v) => (v as PDFHexString | PDFString).decodeText()), ['pkg', 'old', 'High', 'KESTREL']);
  const added = dicts.find((d) => str(d, 'StateModel') && !['S1', 'S2', 'S3'].includes(str(d, 'NM')!))!;
  assert.deepEqual([str(added, 'StateModel'), str(added, 'State')], ['BSI_SET', '1.0 Open']);
});

test("a markup's whole status history imports with who set each status and when", async () => {
  const { result } = await bluebeamStatusSet();
  const m = result.markups[0]!;
  assert.deepEqual(
    m.statusHistory?.map((c) => [c.state, c.model, c.nm, new Date(c.at).toISOString().slice(0, 10)]),
    [
      ['1.0 Open', 'BSI_SET', 'S1', '2025-12-23'],
      ['Completed', 'Review', 'S2', '2026-01-28'],
      ['1.2 Closed', 'BSI_SET', 'S3', '2026-02-19'],
    ],
  );
});

test('status changes made here are saved as state annotations with who and when; earlier ones stay as they were', async () => {
  const { bytes, result, columns, statuses } = await bluebeamStatusSet();
  const store = await MarkupStore.open('history', { persist: false });
  store.importAnnotations(result.markups, [], { 0: [0, 1, 2, 3] }, { statuses });
  MarkupStore.author = 'Julie Smit';
  store.update(result.markups[0]!.id, { status: '1.0 open' });
  MarkupStore.author = '';
  const m = store.get(result.markups[0]!.id)!;
  assert.deepEqual(m.statusHistory?.slice(-1).map((c) => [c.state, c.model, c.author, c.nm]), [['1.0 Open', 'BSI_SET', 'Julie Smit', undefined]]);
  const outBytes = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, [m], { imported: { 0: [0, 1, 2, 3] }, columns, statuses });
  assertValidPdf(outBytes, 'bluebeam status history');
  const out = await PDFDocument.load(outBytes);
  const dicts = out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict));
  const str = (d: PDFDict, k: string) => d.lookupMaybe(PDFName.of(k), PDFString, PDFHexString)?.decodeText();
  const states = dicts.filter((d) => str(d, 'StateModel'));
  // The three states the file had, then the new one, by Julie Smit.
  assert.deepEqual(states.map((d) => [str(d, 'State'), str(d, 'T') ?? '']), [['1.0 Open', ''], ['Completed', ''], ['1.2 Closed', ''], ['1.0 Open', 'Julie Smit']]);
  assert.equal(str(states[3]!, 'Contents'), '1.0 Open set by Julie Smit');
  await store.destroy();
});

test("Bluebeam callouts: the text box where Revu draws it (/RD's insets read Revu's way up) and no outline when /BS /W is 0", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([2384, 1684]);
  const ctx = doc.context;
  // As Revu wrote them: the lease-area callout (no fill) and a Cloud+ callout (filled, no border).
  const lease = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', IT: 'FreeTextCallout', NM: text('LEASE'), Contents: text('Why is this lease area still showing?'), DA: text('0 0 1 rg /Helv 12 Tf'), C: [], BS: { W: 0, S: 'S' }, LE: 'OpenArrow', Rect: [707.7795, 1257.421, 1151.957, 1513.268], RD: [5.5, 188.9471, 312.6776, 5.500057], CL: [1146.457, 1262.921, 859.0795, 1477.068, 839.2795, 1477.068] }));
  const cloud = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', IT: 'FreeTextCallout', NM: text('CLOUDPLUS'), Contents: text('Comment carried from 80% design.'), DA: text('0 0 1 rg /Helv 12 Tf'), C: [0.5019608, 1, 1], FillOpacity: 0.4, BS: { W: 0, S: 'S' }, Rect: [8.677246, 795.1425, 145.6772, 971.5886], RD: [5.5, 122.2855, 5.5, 5.500015], CL: [90.65066, 800.6425, 77.17725, 897.6279, 77.17725, 917.428] }));
  page.node.set(PDFName.of('Annots'), ctx.obj([lease, cloud]));
  const bytes = await doc.save();
  const extras = (await readPdfExtras(bytes))!;
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: 'FreeTextCallout', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
  const result = importAnnotations(0, [lease, cloud].map((r, index) => ({ ...base, index, objectNumber: r.objectNumber, subtype: 'FreeText', contents: '' })), () => null, extras);
  const [a, b] = result.markups;
  // In PDF space (y up): Revu draws the text at y 1446–1508 and 917–966, beside where the leaders end.
  const yUp = (m: Markup) => [1684 - Math.max(m.points[2]![1], m.points[3]![1]), 1684 - Math.min(m.points[2]![1], m.points[3]![1])].map(Math.round);
  assert.deepEqual(yUp(a!), [1446, 1508]);
  assert.deepEqual(yUp(b!), [917, 966]);
  assert.equal(b!.style.borderless, true, 'filled, but no outline');
  assert.equal(b!.style.fill, '#80ffff');
  assert.equal(b!.style.width, 1, 'the leader still draws');

  // Saved again, its box's top and bottom insets are equal, so every reader puts it in the same place.
  const outBytes = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, [{ ...b!, pdfAnnot: undefined, id: 'new' }], {});
  assertValidPdf(outBytes, 'bluebeam callout');
  const out = await PDFDocument.load(outBytes);
  const saved = out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict)).find((d) => d.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText() === 'new')!;
  const rd = saved.lookup(PDFName.of('RD'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber());
  assert.ok(Math.abs(rd[1]! - rd[3]!) < 1e-6, `RD ${rd}`);
  assert.equal(saved.lookup(PDFName.of('BS'), PDFDict).lookup(PDFName.of('W'), PDFNumber).asNumber(), 0);
});

test('a Bluebeam callout whose leader ends on the box top keeps its corner and its box (RD tie), and a narrow box wraps mid-word', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.2756, 841.8895]);
  const ctx = doc.context;
  const ds = 'font: Helvetica 12pt; text-align:left; margin:3pt; line-height:13.8pt; color:#FF0000';
  const corner = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', IT: 'FreeTextCallout', NM: text('CORNER'), Contents: text('e5yerureu\re5yerureu'), DA: text('1 0 0 rg /Helv 12 Tf'), DS: text(ds), C: [], BS: { W: 0, S: 'S' }, LE: 'OpenArrow', Rect: [59.58131, 532.9078, 214.5954, 663.5325], RD: [5.5, 5.5, 23.51414, 63.72467], CL: [209.0954, 650.8649, 128.0813, 658.0325, 128.0813, 599.8078] }));
  page.node.set(PDFName.of('Annots'), ctx.obj([corner]));
  const bytes = await doc.save();
  const extras = (await readPdfExtras(bytes))!;
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: 'FreeTextCallout', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
  const { markups } = importAnnotations(0, [{ ...base, index: 0, objectNumber: corner.objectNumber, subtype: 'FreeText', contents: '' }], () => null, extras);
  const m = markups[0]!;
  // PDF space (y up): the text box is 538.4-599.8 and the leader goes up from its top (y 599.8) to the knee (y 658).
  const ys = [841.8895 - m.points[2]![1], 841.8895 - m.points[3]![1]].sort((x, y) => x - y).map((v) => Math.round(v * 10) / 10);
  assert.deepEqual(ys, [538.4, 599.8]);
  assert.equal(m.style.textMargin, 4);
  const { calloutLanding } = await import('./callout.ts');
  const box = { x: Math.min(m.points[2]![0], m.points[3]![0]), y: Math.min(m.points[2]![1], m.points[3]![1]), w: Math.abs(m.points[3]![0] - m.points[2]![0]), h: Math.abs(m.points[3]![1] - m.points[2]![1]) };
  const land = calloutLanding(m.points[1]!, box);
  assert.equal(land.side, 'top');
  assert.ok(Math.abs(land.attach[0] - 128.0813) < 0.01 && Math.abs(841.8895 - land.knee[1] - 658.0325) < 0.01, 'the knee stays up where it was drawn');
  const { wrapParagraph } = await import('./textLists.ts');
  assert.deepEqual(wrapParagraph('e5yerureu', 39, (s) => s.length * 6.5), ['e5yeru', 'reu']);
});

test("Bluebeam's turned text box (/Rotation, clockwise) imports as an upright box about the same centre, turned", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.2756, 841.8895]);
  const ctx = doc.context;
  const ds = 'font: Helvetica 12pt; text-align:left; margin:3pt; line-height:13.8pt; color:#FF0000';
  // As Revu wrote them: /Rect is the turned box's bounds; the appearance's /BBox is the box before turning.
  const turned = (name: string, rotation: number, rect: number[], bbox: number[]) => {
    const ap = ctx.register(ctx.stream('q Q', { Type: 'XObject', Subtype: 'Form', BBox: bbox, Matrix: [1, 0, 0, 1, 0, 0] }));
    return ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', NM: text(name), Contents: text('TEXTBOX'), DA: text('1 0 0 rg /Helv 12 Tf'), DS: text(ds), C: [], BS: { W: 0, S: 'S' }, Rotation: rotation, Rect: rect, AP: { N: ap } }));
  };
  const a = turned('R315', 315, [185.4119, 745.3135, 266.4438, 826.3455], [178.6296, 775.8295, 273.226, 795.8295]);
  const b = turned('R90', 90, [244.8549, 691.0908, 264.8549, 785.6872], [207.5567, 728.389, 302.1531, 748.389]);
  page.node.set(PDFName.of('Annots'), ctx.obj([a, b]));
  const bytes = await doc.save();
  const extras = (await readPdfExtras(bytes))!;
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
  const { markups } = importAnnotations(0, [a, b].map((r, index) => ({ ...base, index, objectNumber: r.objectNumber, subtype: 'FreeText', contents: '' })), () => null, extras);
  const [m315, m90] = markups;
  assert.equal(m315!.rotation, 315);
  assert.equal(m90!.rotation, 90);
  const size = (m: Markup) => [Math.abs(m.points[1]![0] - m.points[0]![0]), Math.abs(m.points[1]![1] - m.points[0]![1])].map((v) => Math.round(v * 10) / 10);
  assert.deepEqual(size(m315!), [94.6, 20]);
  assert.deepEqual(size(m90!), [94.6, 20]);
  const centre = (m: Markup) => [(m.points[0]![0] + m.points[1]![0]) / 2, (m.points[0]![1] + m.points[1]![1]) / 2].map((v) => Math.round(v * 10) / 10);
  assert.deepEqual(centre(m315!), [225.9, 56.1]);
  assert.deepEqual(centre(m90!), [254.9, 103.5]);

  // Saved again, it carries /Rotation for the other tool.
  const outBytes = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, [{ ...m315!, pdfAnnot: undefined, id: 'new' }], {});
  assertValidPdf(outBytes, 'bluebeam rotated text box');
  const out = await PDFDocument.load(outBytes);
  const saved = out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict)).find((d) => d.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText() === 'new')!;
  assert.equal(saved.lookup(PDFName.of('Rotation'), PDFNumber).asNumber(), 315);
});

test('#459: on a sheet turned 90°, Bluebeam turned rectangles keep their turn and upright-set text boxes are not turned twice', async () => {
  // The reported file's sheet and markups as Revu wrote them (author and wording made up): an A0
  // sheet with /Rotate 90, two turned rectangles, and text boxes Revu set upright on the turned sheet
  // (/Rotate 90 on the annotation, its /BBox in user space and its content counter-turned).
  const doc = await PDFDocument.create();
  const page = doc.addPage([2384, 3370]);
  page.setRotation(degrees(90));
  const ctx = doc.context;
  const ap = (bbox: number[], matrix: number[], ops: string) => ctx.register(ctx.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Matrix: matrix }));
  const square = (name: string, rotation: number, rect: number[], bbox: number[], matrix: number[], re: number[]) =>
    ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Square', Subj: text('Rectangle'), T: text('Pat'), NM: text(name), F: 4, C: [1, 0, 1], IC: [1, 0, 1], FillOpacity: 0.7, RD: [1, 1, 1, 1],
      BS: { W: 2, S: 'S', Type: 'Border' }, Rotation: rotation, Rect: rect, AP: { N: ap(bbox, matrix, `1 0 1 RG 2 w 1 0 1 rg ${re.join(' ')} re B`) },
    }));
  const ds = 'font: Helvetica 5pt; text-align:left; margin:0pt; line-height:5.75pt; color:#FF00FF';
  const textBox = (name: string, words: string, rotation: number, rect: number[], bbox: number[], matrix: number[]) =>
    ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'FreeText', Subj: text('Text Box'), T: text('Pat'), NM: text(name), F: 4, C: [1, 1, 1], Contents: text(words), DA: text('1 0 1 rg /Helv 5 Tf'), DS: text(ds),
      BS: { W: 0.5, S: 'S', Type: 'Border' }, Rotation: rotation, Rotate: 90, Rect: rect, AP: { N: ap(bbox, matrix, `q 0 1 -1 0 0 0 cm 1 1 1 rg 1 0 1 RG 0.5 w Q`) },
    }));
  const r60 = square('R60', 60, [427.7071, 761.8246, 553.1931, 873.1714], [456.764, 764.4974, 524.1364, 870.4987], [0.4999999, -0.8660254, 0.8660254, 0.4999999, -890.4561, 71.66678], [458.764, 766.4974, 63.37231, 102.0013]);
  const r330 = square('R330', 330, [639.8082, 1118.462, 751.155, 1243.948], [661.7954, 1128.205, 729.1677, 1234.206], [0.8660254, 0.5, -0.5, 0.8660254, 43.97137, -1307.952], [663.7954, 1130.205, 63.37231, 102.0013]);
  const t45 = textBox('T45', 'Duct A', 45, [576.0616, 964.7899, 616.4551, 1005.183], [592.2583, 960.4241, 600.2583, 1009.549], [0.7071066, -0.7071069, 0.7071069, 0.7071066, -1097.912, -254.6754]);
  const t270 = textBox('T270', 'Duct B', 270, [461.0917, 1071.086, 519.9417, 1079.086], [486.5167, 1045.661, 494.5167, 1104.511], [0, 1, -1, 0, 1104.511, -486.5167]);
  const refs = [r60, r330, t45, t270];
  page.node.set(PDFName.of('Annots'), ctx.obj(refs));
  const bytes = await doc.save();
  const extras = (await readPdfExtras(bytes))!;
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null, contents: '' };
  const subtypes = ['Square', 'Square', 'FreeText', 'FreeText'];
  const { markups } = importAnnotations(0, refs.map((r, index) => ({ ...base, index, objectNumber: r.objectNumber, subtype: subtypes[index]! })), () => null, extras);
  const [m60, m330, m45, m270] = markups;
  const round = (v: number) => Math.round(v * 10) / 10;
  const size = (m: Markup) => [Math.abs(m.points[1]![0] - m.points[0]![0]), Math.abs(m.points[1]![1] - m.points[0]![1])].map(round);
  const centre = (m: Markup) => [(m.points[0]![0] + m.points[1]![0]) / 2, (m.points[0]![1] + m.points[1]![1]) / 2].map(round);

  // Rectangles: the box before turning (its /BBox less /RD), turned by /Rotation plus the sheet's 90°,
  // which is the turn the appearance's /Matrix draws on the shown sheet.
  assert.equal(m60!.type, 'rect');
  assert.equal(m60!.rotation, 150);
  assert.deepEqual(size(m60!), [65.4, 104]);
  assert.deepEqual(centre(m60!), [817.5, 490.5]);
  assert.equal(m330!.rotation, 60);
  assert.deepEqual(size(m330!), [65.4, 104]);

  // Text boxes: Revu already set them upright on the sheet, so the sheet's turn does not add again.
  assert.equal(m45!.type, 'text');
  assert.equal(m45!.rotation, 45);
  assert.equal(m270!.rotation, 270);
  // Wider than tall the way the words run: the user-space /BBox is 8 × 49, less the 0.25 border inset.
  assert.deepEqual(size(m45!), [48.6, 7.5]);
  assert.deepEqual(size(m270!), [58.3, 7.5]);
  assert.deepEqual(centre(m45!), [985, 596.3]);
});

test('#459: text Revu turned with its sheet (no /Rotate of its own) reads the way the sheet turned it', async () => {
  // As Revu leaves them when a sheet is turned without setting its text upright: the text box,
  // typewriter and flag keep their user-space /Rect and appearance, so they turn with the sheet.
  // A turned ellipse turns by its /Rotation plus the sheet's turn, as the rectangle does.
  const build = async (turn: number) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.2756, 841.8898]);
    page.setRotation(degrees(turn));
    const ctx = doc.context;
    const ds = 'font: Helvetica 12pt; text-align:left; margin:3pt; line-height:13.8pt; color:#FF0000';
    const form = (bbox: number[]) => ({ N: ctx.register(ctx.stream('q Q', { Type: 'XObject', Subtype: 'Form', BBox: bbox, Matrix: [1, 0, 0, 1, 0, 0] })) });
    const free = (name: string, extra: Record<string, unknown>, rect: number[]) =>
      ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', NM: text(name), Contents: text('WORDS'), DA: text('1 0 0 rg /Helv 12 Tf'), DS: text(ds), C: [], BS: { W: 0, S: 'S' }, Rect: rect, AP: form(rect), ...extra }));
    const box = free('TEXT', {}, [100, 700, 200, 720]);
    const typed = free('TYPED', { IT: 'FreeTextTypeWriter' }, [100, 600, 180, 634]);
    const flag = free('FLAG', { Subj: text('Flag'), RD: [14.5, 5.5, 5.5, 5.5] }, [356.6935, 503.9723, 520.6935, 532.9723]);
    const ellipse = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Circle', NM: text('OVAL'), C: [0, 0, 1], BS: { W: 1, S: 'S' }, RD: [0.5, 0.5, 0.5, 0.5], Rotation: 30, Rect: [300, 300, 380, 360], AP: form([310, 300, 370, 360]) }));
    const refs = [box, typed, flag, ellipse];
    page.node.set(PDFName.of('Annots'), ctx.obj(refs));
    const bytes = await doc.save();
    const extras = (await readPdfExtras(bytes))!;
    const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null, contents: '' };
    const kinds = [['FreeText', ''], ['FreeText', 'FreeTextTypeWriter'], ['FreeText', ''], ['Circle', '']] as const;
    return importAnnotations(0, refs.map((r, index) => ({ ...base, index, objectNumber: r.objectNumber, subtype: kinds[index]![0], intent: kinds[index]![1] })), () => null, extras).markups;
  };
  const round = (v: number) => Math.round(v * 10) / 10;
  const size = (m: Markup) => [Math.abs(m.points[1]![0] - m.points[0]![0]), Math.abs(m.points[1]![1] - m.points[0]![1])].map(round);
  // Where the flag's whole box lands once turned about its text, as the page shows it.
  const flagCentre = (m: Markup) => {
    const [p, q] = m.points as [[number, number], [number, number]];
    return rotatePoint([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], rotationCentre(m), m.rotation ?? 0).map(round);
  };

  const upright = await build(0);
  assert.deepEqual(upright.map((m) => m.rotation ?? 0), [0, 0, 0, 30]);

  const [t90, w90, f90, e90] = await build(90);
  assert.equal(t90!.rotation, 90);
  // The box before turning keeps the text's own width and height (100 × 20), about the same centre.
  assert.deepEqual(size(t90!), [100, 20]);
  assert.equal(w90!.type, 'typewriter');
  assert.equal(w90!.rotation, 90);
  assert.deepEqual(size(w90!), [80, 34]);
  assert.equal(f90!.type, 'flagLabel');
  assert.equal(f90!.rotation, 90);
  assert.deepEqual(size(f90!), [153, 18]);
  // The flag's middle stays at its /Rect's middle on the page.
  assert.deepEqual(flagCentre(f90!), [518.5, 438.7]);
  assert.equal(e90!.type, 'ellipse');
  assert.equal(e90!.rotation, 120);
  assert.deepEqual(size(e90!), [59, 59]);

  const [t180, w180, f180] = await build(180);
  assert.equal(t180!.rotation, 180);
  assert.equal(w180!.rotation, 180);
  assert.equal(f180!.rotation, 180);
  assert.deepEqual(flagCentre(f180!), [156.6, 518.5]);
});

test("another tool's file attachment shows its own appearance (icon and file name), and keeps it when moved", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const ap = ctx.register(ctx.stream('0 0 1 rg 0 0 120 58 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 120, 58] }));
  const file = ctx.register(ctx.stream('hello', { Type: 'EmbeddedFile' }));
  const attach = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Subj: text('File Attachment'), NM: text('ATT1'), C: [0, 0, 1], IsFileIcon: true, ShowFileName: true, Rect: [100, 300, 220, 358], AP: { N: ap }, FS: { Type: 'Filespec', F: text('a.xlsx'), EF: { F: file } } }),
  );
  page.node.set(PDFName.of('Annots'), ctx.obj([attach]));
  const bytes = await doc.save();
  const extras = await readPdfExtras(bytes);
  assert.ok(extras);
  const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  extras.appearances = new Map([['0:0', picture]]);
  const base = { color: '#0000ff', interior: null, opacity: 1, borderWidth: 1, contents: '', author: 'Pat', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
  const annots: ImportableAnnotation[] = [{ ...base, index: 0, objectNumber: attach.objectNumber, subtype: 'FileAttachment', rect: { x: 100, y: 42, w: 120, h: 58 }, file: { name: 'a.xlsx', data: new TextEncoder().encode('hello') } }];
  const result = importAnnotations(0, annots, () => null, extras);
  const m = result.markups[0]!;
  assert.equal(m.type, 'attachment');
  assert.equal(m.image, picture);
  assert.deepEqual(m.points, [[100, 42], [220, 100]]);
  assert.equal(m.attachment?.name, 'a.xlsx');
  // The picture is drawn, not our paperclip tag stretched over the whole box.
  assert.deepEqual(markupShape(m).map((p) => p.stroke), [false]);

  const moved = { ...m, points: m.points.map(([x, y]) => [x + 10, y] as [number, number]) };
  const outBytes = await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, [moved], { imported: { 0: [0] } });
  assertValidPdf(outBytes, 'bluebeam moved file attachment');
  const out = await PDFDocument.load(outBytes);
  const d = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.equal(d.get(PDFName.of('Subtype'))?.toString(), '/FileAttachment');
  assert.equal(d.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))?.toString(), ap.toString());
  assert.deepEqual(d.lookup(PDFName.of('Rect'), PDFArray).asArray().map((n) => Math.round((n as PDFNumber).asNumber())), [110, 300, 230, 358]);
});

test('line-height in a default style reads as a multiple of the font size, in pt, % or unitless', () => {
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; line-height:13.8pt; color:#000000').lineHeight, 1.15);
  // Declared before the font size, still relative to it.
  assert.equal(parseDefaultStyle('line-height:30pt; font: Helvetica 20pt').lineHeight, 1.5);
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; line-height:150%').lineHeight, 1.5);
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; line-height:2').lineHeight, 2);
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; line-height:normal').lineHeight, undefined);
  assert.equal(parseDefaultStyle('font: Helvetica 12pt').lineHeight, undefined);
  // As the reference sample writes it (every FreeText), 12pt x 1.15 and 8pt x 1.15.
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; text-align:left; margin:3pt; line-height:13.8pt; color:#FF0000').lineHeight, 1.15);
  assert.equal(parseDefaultStyle('font: Helvetica 8pt; text-align:left; line-height:9.2pt; color:#000000').lineHeight, 1.15);
  // No size in /DS: the /DA size is the one a pt height is read against; a size of 0 (auto) is no size.
  assert.equal(parseDefaultStyle('font: Helvetica; line-height:13.8pt', 10).lineHeight, 1.38);
  assert.equal(parseDefaultStyle('font: Helvetica 0pt; line-height:13.8pt', 10).lineHeight, 1.38);
  assert.equal(parseDefaultStyle('font: Helvetica 0pt; line-height:13.8pt').lineHeight, 1.15);
  // Outside the panel's range it is left at the default.
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; line-height:600pt').lineHeight, undefined);
});

test('a default style\'s margin reads as the text inset in points', () => {
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; text-align:left; margin:3pt; line-height:13.8pt').textMargin, 4);
  assert.equal(parseDefaultStyle('font: Helvetica 12pt; margin:4px').textMargin, 4);
  assert.equal(parseDefaultStyle('font: Helvetica 12pt').textMargin, undefined);
});

test('a newer importer refreshes other tools\' markups that were not edited, and leaves edited and deleted ones', async () => {
  const { MarkupStore } = await import('./store.ts');
  const { markupDigest } = await import('./digest.ts');
  const mk = (n: number, x: number): Markup => {
    const m = { id: `pdf-0-${n}`, type: 'rect', pageIndex: 0, points: [[x, 0], [x + 10, 10]], style: { stroke: '#f00', width: 1, fill: null, opacity: 1 }, createdAt: 1, modifiedAt: 1, author: '', pdfAnnot: { index: n, digest: '', id: `pdf-0-${n}` } } as unknown as Markup;
    m.pdfAnnot!.digest = markupDigest(m);
    return m;
  };
  const store = await MarkupStore.open('refresh', { persist: false });
  // Imported by an older importer (version 0): untouched, edited, and deleted since.
  store.importAnnotations([mk(1, 0), mk(2, 0), mk(3, 0)], [], {});
  store.update('pdf-0-2', { points: [[5, 5], [15, 15]] });
  store.remove(['pdf-0-3']);
  store.refreshImported([mk(1, 100), mk(2, 100), mk(3, 100)], 2);
  assert.deepEqual(store.get('pdf-0-1')!.points[0], [100, 0], 'untouched: refreshed');
  assert.deepEqual(store.get('pdf-0-2')!.points[0], [5, 5], 'edited: kept');
  assert.equal(store.get('pdf-0-3'), undefined, 'deleted: stays deleted');
  assert.equal(store.importVersion(), 2);
  await store.destroy();
});

/**
 * The way the words run on the page in an appearance Revu wrote, in degrees clockwise: the text's x-axis
 * through its first Tm and any cm before it, then the form's /Matrix (fitting the /BBox onto /Rect only
 * scales and moves it), then the sheet's turn.
 */
function drawnTextTurn(tm: number[], cm: number[], matrix: number[], pageTurn: number): number {
  // Row vectors, as PDF composes them: [1 0] · Tm · cm · Matrix.
  const times = (v: number[], m: number[]) => [v[0]! * m[0]! + v[1]! * m[2]!, v[0]! * m[1]! + v[1]! * m[3]!];
  const [x, y] = times(times(times([1, 0], tm), cm), matrix);
  // User space is y up: clockwise on the sheet is negative there, and the sheet turns it on.
  const turn = (-Math.atan2(y!, x!) * 180) / Math.PI + pageTurn;
  return Math.round(((turn % 360) + 360) % 360);
}

test('#459: a callout Revu turned with its sheet comes in turned, its leader where Revu drew it', async () => {
  // As Revu leaves a callout when its sheet is turned half round: no /Rotate or /Rotation of its own,
  // its /RD box, /CL leader and appearance all upright in user space, so the sheet turns them all.
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.setRotation(degrees(180));
  const ctx = doc.context;
  const rect = [100, 100, 260, 200];
  const tm = [1, 0, 0, 1, 184, 176];
  const ops = `q 1 0 0 1 0 0 cm 1 0 0 RG 1 w 180 150 70 40 re S BT /Helv 10 Tf ${tm.join(' ')} Tm (NOTE A) Tj ET Q`;
  const ap = ctx.register(ctx.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: rect, Matrix: [1, 0, 0, 1, 0, 0] }));
  const callout = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'FreeText', IT: 'FreeTextCallout', NM: text('TURNED'), Contents: text('NOTE A'), DA: text('1 0 0 rg /Helv 10 Tf'), C: [], BS: { W: 1, S: 'S' }, LE: 'OpenArrow',
    // The box (180, 150)-(250, 190); the leader from (110, 110) to its left side.
    Rect: rect, RD: [80, 10, 10, 50], CL: [110, 110, 150, 170, 180, 170], AP: { N: ap },
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([callout]));
  const bytes = await doc.save();
  const extras = (await readPdfExtras(bytes))!;
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 1, author: '', intent: 'FreeTextCallout', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null, contents: 'NOTE A' };
  const [m] = importAnnotations(0, [{ ...base, index: 0, objectNumber: callout.objectNumber, subtype: 'FreeText' }], () => null, extras).markups;
  assert.equal(m!.type, 'callout');
  // The turn Revu's appearance draws its words at on the sheet.
  assert.equal(drawnTextTurn(tm, [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], 180), 180);
  assert.equal(m!.rotation, 180);
  const round = (p: number[]) => p.map((v) => Math.round(v * 10) / 10);
  // The box before its turn keeps the size Revu gave it, about the same middle: user (215, 170), page (185, 170).
  const [p, q] = m!.points.slice(2, 4) as [[number, number], [number, number]];
  assert.deepEqual(round([q[0] - p[0], q[1] - p[1]]), [70, 40]);
  assert.deepEqual(round(rotationCentre(m!)), [185, 170]);
  // The tip and the leader's end are where Revu drew them on the page (user x runs right to left here).
  const shown = (pt: [number, number]) => round(rotatePoint(pt, rotationCentre(m!), m!.rotation!));
  assert.deepEqual(shown(m!.points[0]! as [number, number]), [290, 110]);
  const leader = markupShape(m!)[1]!.path;
  const end = leader[leader.length - 1]!;
  assert.deepEqual(shown([end[1] as number, end[2] as number]), [220, 170]);
});

test('#459: a Bluebeam legend comes in at the turn Revu drew it', async () => {
  const build = async (rotation: number | null) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    page.setRotation(degrees(90));
    const ctx = doc.context;
    // Turned 90° clockwise in user space by its /Matrix: the box (100, 100)-(300, 180) about (200, 140)
    // has the turned bounds (160, 40)-(240, 240) as its /Rect.
    const turned = rotation !== null;
    const bbox = [100, 100, 300, 180];
    const matrix = turned ? [0, -1, 1, 0, 60, 340] : [1, 0, 0, 1, 0, 0];
    const ap = ctx.register(ctx.stream('q 0 0 0 RG 0.75 w 100 100 200 80 re S BT /Helv 8 Tf 1 0 0 1 110 160 Tm (Legend) Tj ET Q', { Type: 'XObject', Subtype: 'Form', BBox: bbox, Matrix: matrix }));
    const key = { Type: 9, AdditionalData: [text('Rectangle'), text(''), text('Count')], Color: -65536, BorderWidth: 1 };
    const legend = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Stamp', IT: 'StampSnapshot', Subj: text('Legend'), NM: text('KEY'), BS: { W: 0, S: 'S' },
      Rect: turned ? [160, 40, 240, 240] : bbox, ...(turned ? { Rotation: rotation } : {}), AP: { N: ap },
      BSILegend: { MajorVersion: 1, MinorVersion: 0, NameID: text('ABCDEFGHIJKLMNOP'), Title: text('Legend'), PageRangeType: 2, PageRange: [0], Keys: [key], Sums: { QuantityColumn: [0] } },
    }));
    page.node.set(PDFName.of('Annots'), ctx.obj([legend]));
    const bytes = await doc.save();
    const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: 'StampSnapshot', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null, contents: '' };
    const [m] = importAnnotations(0, [{ ...base, index: 0, objectNumber: legend.objectNumber, subtype: 'Stamp' }], () => null, (await readPdfExtras(bytes))!).markups;
    return { m: m!, drawn: drawnTextTurn([1, 0, 0, 1, 110, 160], [1, 0, 0, 1, 0, 0], matrix, 90) };
  };
  const round = (v: number) => Math.round(v * 10) / 10;
  const size = (m: Markup) => [m.points[1]![0] - m.points[0]![0], m.points[1]![1] - m.points[0]![1]].map(round);

  // Turned with its sheet: it reads the way the sheet turned it, 200 × 80 before the turn.
  const plain = await build(null);
  assert.equal(plain.m.type, 'legend');
  assert.equal(plain.drawn, 90);
  assert.equal(plain.m.rotation, 90);
  assert.deepEqual(size(plain.m), [200, 80]);
  assert.deepEqual(rotationCentre(plain.m).map(round), [140, 200]);

  // /Rotation 90 as well: the turn its /Matrix draws, on top of the sheet's.
  const own = await build(90);
  assert.equal(own.m.type, 'legend');
  assert.equal(own.drawn, 180);
  assert.equal(own.m.rotation, own.drawn);
  assert.deepEqual(size(own.m), [200, 80]);
  assert.deepEqual(rotationCentre(own.m).map(round), [140, 200]);
});
