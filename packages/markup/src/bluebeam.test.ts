import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import { importColumns, importStatuses, scaleFromMeasure } from './bluebeam.ts';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { MarkupStore } from './store.ts';
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
  const same = await PDFDocument.load(await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, result.markups, options));
  const before = await PDFDocument.load(bytes);
  const dicts = (d: PDFDocument) => d.getPage(0).node.Annots()!.asArray().map((r) => d.context.lookup(r, PDFDict));
  assert.deepEqual(dicts(same).map((d) => d.toString()), dicts(before).map((d) => d.toString()));

  // A third item, the tick removed and the arc moved.
  const edited = result.markups.map((m): Markup =>
    m.type === 'count' ? { ...m, points: [...m.points, [320, 195]], checked: false } : m.type === 'ellipticalArc' ? { ...m, points: m.points.map(([x, y]) => [x + 10, y] as [number, number]) } : m,
  );
  const out = await PDFDocument.load(await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, edited, options));
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
  const cloud = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', NM: text('SQ'), C: [1, 0, 0], Rect: [10, 10, 100, 100], BSIColumnData: [text('pkg'), text('old'), text('Medium'), text('TFNSW')] }));
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
  assert.deepEqual(m.fields, { 'bluebeam:Priority': 'Medium', 'bluebeam:Organisation': 'TFNSW' });
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
  const same = await PDFDocument.load(await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, result.markups, options));
  assert.equal(catalog(same), catalog(before));

  const edited = result.markups.map((m) => ({ ...m, status: '1.0 open', fields: { ...m.fields, 'bluebeam:Priority': 'High' } }));
  const out = await PDFDocument.load(await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, edited, options));
  assert.equal(catalog(out), catalog(before));
  const dicts = out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict));
  const str = (d: PDFDict, k: string) => d.lookupMaybe(PDFName.of(k), PDFString, PDFHexString)?.decodeText();
  // Deleted columns keep their values in their own places.
  assert.deepEqual(dicts[0]!.lookup(PDFName.of('BSIColumnData'), PDFArray).asArray().map((v) => (v as PDFHexString | PDFString).decodeText()), ['pkg', 'old', 'High', 'TFNSW']);
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
  const out = await PDFDocument.load(await exportWithAnnotations(bytes.slice().buffer as ArrayBuffer, [m], { imported: { 0: [0, 1, 2, 3] }, columns, statuses }));
  const dicts = out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict));
  const str = (d: PDFDict, k: string) => d.lookupMaybe(PDFName.of(k), PDFString, PDFHexString)?.decodeText();
  const states = dicts.filter((d) => str(d, 'StateModel'));
  // The three states the file had, then the new one, by Julie Smit.
  assert.deepEqual(states.map((d) => [str(d, 'State'), str(d, 'T') ?? '']), [['1.0 Open', ''], ['Completed', ''], ['1.2 Closed', ''], ['1.0 Open', 'Julie Smit']]);
  assert.equal(str(states[3]!, 'Contents'), '1.0 Open set by Julie Smit');
  await store.destroy();
});
