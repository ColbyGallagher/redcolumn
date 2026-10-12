import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { lineArt, lineStyleReach, styledParts, type CustomLine } from './lineStyle.ts';
import { markupShape } from './geometry.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { readPdfExtras } from './pdfExtras.ts';

const measure = (text: string, _f: string, _b: boolean, _i: boolean, size: number) => text.length * size * 0.5;
const path = (x0: number, x1: number): Parameters<typeof lineArt>[0] => [['M', x0, 100], ['L', x1, 100]];

// The styles Bluebeam's Advanced line style set ships, as it stores them in /LineStyle.
const GAS: CustomLine = { name: 'Gas', spec: [true, [0, 18, -2, ['GAS', 'Helvetica', 6, false, false, true], -2]] };
const ZIGZAG: CustomLine = { name: 'Zig Zag', spec: [true, [0, [7, 7, 1, false, 0, -7, 0, 1, -3, -4, 1, 4, 3, 1, 7, 0]]] };
const DOUBLE: CustomLine = { name: 'Double', spec: [true, [-3], [3]] };
const ROAD: CustomLine = { name: 'Road', spec: [true, [-3], [0, 3, -3], [3]] };
const CIRCLE: CustomLine = { name: 'Fenceline Circle', spec: [true, [0, 22, [2, 2, 1, false, 0, 0, -2, 2, 1.10457, -2, 2, 2, -1.10457, 2, 2, 0, 2, 2, 1.10457, 2, 1.10457, 2, 2, 0, 2, 2, -1.10457, 2, 2, -2, 1.10457, 2, -2, 0, 2, -2, -1.10457, 2, -1.10457, -2, 2, 0, -2]]] };

test('text in a line style sits between dashes and repeats along the line', () => {
  const art = lineArt(path(0, 120), GAS, 1, measure)!;
  // 18 dash, 2 gap, 9 of text, 2 gap = 31 per repeat.
  assert.deepEqual(art.texts.map((t) => Math.round(t.x * 10) / 10), [24.5, 55.5, 86.5]);
  assert.equal(art.texts.length, 3, 'the fourth does not fit before the line ends');
  assert.ok(art.texts.every((t) => t.text === 'GAS' && t.angle === 0 && t.size === 6));
  const dashes = art.stroke.filter((c) => c[0] === 'M').map((c) => Math.round(c[1]!));
  assert.deepEqual(dashes, [0, 31, 62, 93]);
});

test('a style scales with the line width, and text runs along the line upright', () => {
  const art = lineArt([['M', 100, 0], ['L', 0, 0]], GAS, 2, measure)!;
  assert.equal(art.texts[0]!.size, 12);
  // Heading left, the text turns over to stay readable.
  assert.ok(Math.abs(Math.abs(art.texts[0]!.angle)) < 1e-9);
});

test('a symbol takes its width along the line and is drawn at its origin', () => {
  const art = lineArt(path(0, 60), ZIGZAG, 1, measure)!;
  // 14 per repeat: four whole zigzags fit in 60.
  assert.equal(art.stroke.filter((c) => c[0] === 'M').length, 4);
  const first = art.stroke.slice(0, 4);
  assert.deepEqual(first[0], ['M', 0, 100]);
  // Symbol y points up the page: (-3, -4) is below the line, which is y larger in page space.
  assert.deepEqual(first[1]!.slice(1).map((n) => Math.round(Number(n))), [4, 104]);
});

test('curves in a symbol become curves, and a filled symbol is filled', () => {
  const art = lineArt(path(0, 60), CIRCLE, 1, measure)!;
  assert.equal(art.stroke.filter((c) => c[0] === 'C').length, 8);
  assert.equal(art.fill.length, 0);
  const filled = lineArt(path(0, 60), { name: 'F', spec: [true, [0, [1, 1, 1, true, 0, 0, 0, 1, 2, 0, 1, 0, 2]]] }, 1, measure)!;
  assert.ok(filled.fill.length > 0);
});

test('lines with no components are parallel solid lines at their offsets', () => {
  const art = lineArt(path(0, 50), DOUBLE, 1, measure)!;
  assert.deepEqual(art.stroke.filter((c) => c[0] === 'M').map((c) => c[2]), [103, 97]);
  const road = lineArt(path(0, 50), ROAD, 1, measure)!;
  // The centre line dashes 3 on, 3 off; the outer two are solid.
  assert.equal(road.stroke.filter((c) => c[0] === 'M').length, 2 + 9);
});

test('a style follows a bent or curved line and keeps its pattern across corners', () => {
  const art = lineArt([['M', 0, 0], ['L', 30, 0], ['L', 30, 30]], { name: 'D', spec: [true, [0, 20, -10]] }, 1, measure)!;
  // The first dash runs 20 along the first leg; the second starts at 30 (the corner), turning it.
  const dashes = art.stroke.reduce<number[][]>((out, c) => (c[0] === 'M' ? [...out, [c[1]!, c[2]!]] : (out[out.length - 1]!.push(c[1]!, c[2]!), out)), []);
  assert.deepEqual(dashes[0], [0, 0, 20, 0]);
  assert.deepEqual(dashes[1], [30, 0, 30, 20]);
  const curved = lineArt([['M', 0, 0], ['C', 0, 30, 30, 30, 30, 0]], { name: 'S', spec: [true, [0, 3, -3]] }, 1, measure)!;
  assert.ok(curved.stroke.filter((c) => c[0] === 'M').length > 5);
});

test('an unreadable style draws as a plain line', () => {
  const part = markupShape({ id: 'x', type: 'line', pageIndex: 0, points: [[0, 0], [50, 0]], style: { ...DEFAULT_STYLES.line }, status: 'none', author: '', createdAt: 0, modifiedAt: 0 })[0]!;
  const parts = styledParts([part], { name: 'bad', spec: [true] }, 1, measure);
  assert.deepEqual(parts, [part]);
  assert.equal(lineStyleReach({ name: 'bad', spec: [] }, 1), 0);
});

test('a style reaches as far as its widest symbol or text, and its offset lines', () => {
  assert.ok(lineStyleReach(ZIGZAG, 1) >= 4);
  assert.ok(lineStyleReach(DOUBLE, 2) >= 6);
});

async function lineDoc(extra: Record<string, unknown>) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const annot = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Line',
      Rect: [10, 90, 190, 110],
      L: [20, 100, 180, 100],
      C: [1, 0, 0],
      BS: { Type: 'Border', W: 1, S: 'S' },
      Subj: PDFHexString.fromText('Line'),
      NM: PDFHexString.fromText('LINE1'),
      F: 4,
      ...extra,
    }),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
  return { doc, annot, bytes: await doc.save() };
}

const annotation = (objectNumber: number): ImportableAnnotation => ({ index: 0, objectNumber, subtype: 'Line', rect: { x: 10, y: 290, w: 180, h: 20 }, color: '#ff0000', interior: null, opacity: 1, borderWidth: 1, contents: '', author: 'Pat', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: [[20, 300], [180, 300]], link: null });

test('a Bluebeam custom line style is read from the annotation and written back unchanged', async () => {
  const spec = [true, [0, 18, -2, [PDFString.of('GAS'), PDFString.of('Helvetica'), 6, false, false, true], -2]];
  const { annot, bytes } = await lineDoc({ LineStyle: spec, LineStyleName: PDFString.of('Gas') });
  const extras = await readPdfExtras(bytes);
  const { markups } = importAnnotations(0, [annotation(annot.objectNumber)], () => null, extras);
  const line = markups[0]!;
  assert.equal(line.type, 'line');
  assert.deepEqual(line.style.lineStyle, GAS);

  // Moved, it goes out with its pattern as stored, and an appearance that draws it.
  const moved: Markup = { ...line, id: 'line-1', points: [[20, 50], [180, 50]], modifiedAt: 99 };
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [{ ...moved, pageIndex: 0 }]));
  const d = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => out.context.lookup(r, PDFDict))[0]!;
  assert.equal(d.lookup(PDFName.of('LineStyleName'), PDFString, PDFHexString).decodeText(), 'Gas');
  const written = d.lookup(PDFName.of('LineStyle'), PDFArray);
  const first = written.lookup(1, PDFArray);
  assert.equal(first.lookup(1, PDFNumber).asNumber(), 18);
  const textPart = first.lookup(3, PDFArray);
  assert.equal(textPart.lookup(0, PDFString).decodeText(), 'GAS');
  assert.equal(textPart.lookup(2, PDFNumber).asNumber(), 6);
  // The border stays solid: the pattern, not a dash array, makes the look.
  assert.equal(d.lookup(PDFName.of('BS'), PDFDict).get(PDFName.of('S'))?.toString(), '/S');
  // The appearance draws the text, in a font its resources name.
  const ap = d.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as unknown as { dict: PDFDict };
  const fonts = ap.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
  assert.ok(fonts.keys().some((k) => k.decodeText().startsWith('FL')));
});

test('a markup that loses its custom style drops the original annotation\'s pattern', async () => {
  const { annot, bytes } = await lineDoc({ LineStyle: [true, [-3], [3]], LineStyleName: PDFString.of('Double') });
  const extras = await readPdfExtras(bytes);
  const { markups } = importAnnotations(0, [annotation(annot.objectNumber)], () => null, extras);
  const line = markups[0]!;
  assert.equal(line.style.lineStyle?.name, 'Double');
  const { lineStyle: _gone, ...style } = line.style;
  const out = await PDFDocument.load(await exportWithAnnotations(bytes.buffer as ArrayBuffer, [{ ...line, style: { ...style, dash: 'dashed' }, modifiedAt: 99 }], { imported: { 0: [0] } } as never));
  const d = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => out.context.lookup(r, PDFDict))[0]!;
  assert.equal(d.has(PDFName.of('LineStyle')), false);
  assert.equal(d.has(PDFName.of('LineStyleName')), false);
});

test('an exact dash pattern from another tool is kept, drawn and written back as it was', async () => {
  for (const pattern of [[2, 2], [3, 3], [8, 4, 4, 4]]) {
    const { annot, bytes } = await lineDoc({ BS: { Type: 'Border', W: 1, S: 'D', D: pattern } });
    const extras = await readPdfExtras(bytes);
    const { markups } = importAnnotations(0, [annotation(annot.objectNumber)], () => null, extras);
    const line = markups[0]!;
    assert.deepEqual(line.style.dashArray, pattern);

    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [{ ...line, id: 'l', pageIndex: 0, modifiedAt: 99 }]));
    const d = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => out.context.lookup(r, PDFDict))[0]!;
    const bs = d.lookup(PDFName.of('BS'), PDFDict);
    assert.equal(bs.get(PDFName.of('S'))?.toString(), '/D');
    assert.deepEqual(bs.lookup(PDFName.of('D'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber()), pattern);
  }
});
