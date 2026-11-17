import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { autoSizedPoints } from './edits.ts';
import { exportWithAnnotations } from './export.ts';
import { daFont, importAnnotations } from './import.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { DEFAULT_STYLES, contentBox, rotatePoint, rotationCentre, type Markup, type MarkupType, type Point } from './model.ts';
import { textBaselineOffset, textBoxLines } from './render.ts';

function mk(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-${points.length}`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt: 1, modifiedAt: 1, ...extra };
}
const measure = (s: string) => s.length * 6;

test('auto-size of a rotated callout does not drift the box', () => {
  const c = mk('callout', [[0, 0], [10, 10], [50, 50], [170, 200]], { text: 'alpha beta gamma', rotation: 20, style: { ...DEFAULT_STYLES.callout, fontSize: 10 } });
  const pts = autoSizedPoints(c, measure)!;
  const tl = (mm: Markup) => {
    const b = contentBox(mm);
    return rotatePoint([b.x, b.y], rotationCentre(mm), 20);
  };
  const [p, q] = [tl(c), tl({ ...c, points: pts })];
  assert.ok(Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6);
});

test('auto-size is stable for a flag label, a list and a callout', () => {
  const list = '- first item that is rather long indeed\n- second item\n1. numbered entry goes here';
  const cases = [
    mk('flagLabel', [[0, 0], [150, 120]], { text: 'alpha beta gamma delta epsilon zeta' }),
    mk('text', [[0, 0], [150, 120]], { text: list }),
    mk('callout', [[0, 0], [10, 10], [50, 50], [170, 200]], { text: 'alpha beta gamma delta epsilon zeta eta' }),
  ];
  for (const m of cases) {
    const once = autoSizedPoints(m, measure)!;
    const twice = autoSizedPoints({ ...m, points: once }, measure)!;
    assert.deepEqual(twice, once, m.type);
  }
});

test('auto-size slack covers the gap between canvas and PDF text widths', async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const size = 12;
  const text = 'Mostly capital TEXT with Some Mixed words';
  const pdfW = font.widthOfTextAtSize(text, size);
  const canvasW = pdfW * 0.99; // the PDF's font tables may measure a little wider than a browser's
  const m = mk('text', [[0, 0], [1000, 100]], { text, style: { ...DEFAULT_STYLES.text, fontSize: size } });
  const [a, b] = autoSizedPoints(m, () => canvasW)!;
  const room = b![0] - a![0] - 8;
  // ceil only adds room, so these bounds hold without depending on it.
  assert.ok(room >= canvasW + size * 0.15, 'slack scales with the font size');
  assert.ok(room >= pdfW, 'the text fits its box even when the PDF measures it wider');
});

async function exported(m: Markup) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  return exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]);
}

test('padding survives export and import, including 0, and /DS never has a negative margin', async () => {
  for (const textMargin of [0, 7, 4]) {
    const m = mk('text', [[20, 20], [220, 120]], { text: 'hello', style: { ...DEFAULT_STYLES.text, textMargin } });
    const bytes = await exported(m);
    const doc = await PDFDocument.load(bytes);
    const ref = doc.getPages()[0]!.node.Annots()!.get(0) as PDFRef;
    const ds = (doc.context.lookup(ref, PDFDict).get(PDFName.of('DS')) as PDFHexString).decodeText();
    assert.ok(!/margin:\s*-/.test(ds), ds);
    const extras = (await readPdfExtras(bytes))!;
    const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
    const { markups } = importAnnotations(0, [{ ...base, index: 0, objectNumber: ref.objectNumber, subtype: 'FreeText', contents: 'hello' }], () => null, extras);
    assert.equal(markups[0]!.style.textMargin, textMargin);
  }
});

test('a middle-aligned box is drawn with its baseline at the layout offset', async () => {
  const style = { ...DEFAULT_STYLES.text, fontSize: 12, verticalAlign: 'middle' as const };
  const m = mk('text', [[20, 20], [220, 120]], { text: 'ONE', style });
  const doc = await PDFDocument.load(await exported(m));
  const streams = doc.context.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') ? [Buffer.from(decodePDFRawStream(o).decode()).toString('latin1')] : []));
  const tm = streams.join('\n').match(/1 0 0 -1 ([-\d.]+) ([-\d.]+) Tm/);
  assert.ok(tm);
  // Page space, y down. Box 20..120, 12pt sans: cap-top to baseline is 8.616 tall, centred in the 100pt box (top 63.136), baseline 0.931 em below the line top.
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const line = textBoxLines(m, (s) => font.widthOfTextAtSize(s, 12))[0]!;
  const y = Number(tm![2]);
  assert.ok(Math.abs(y - 74.308) < 0.01, `${y}`);
  assert.ok(Math.abs(y - (line.y + textBaselineOffset(style))) < 1e-6);
});

test('a hand-edited /DS margin wins over a stale private padding key', async () => {
  const m = mk('text', [[20, 20], [220, 120]], { text: 'hello', style: { ...DEFAULT_STYLES.text, textMargin: 7 } });
  const doc = await PDFDocument.load(await exported(m));
  const ref = doc.getPages()[0]!.node.Annots()!.get(0) as PDFRef;
  const dict = doc.context.lookup(ref, PDFDict);
  const ds = (dict.get(PDFName.of('DS')) as PDFHexString).decodeText();
  assert.match(ds, /margin:6pt/);
  dict.set(PDFName.of('DS'), PDFHexString.fromText(ds.replace('margin:6pt', 'margin:2pt')));
  const bytes = await doc.save();
  const extras = (await readPdfExtras(bytes))!;
  const base = { rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 0, author: '', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
  const { markups } = importAnnotations(0, [{ ...base, index: 0, objectNumber: ref.objectNumber, subtype: 'FreeText', contents: 'hello' }], () => null, extras);
  assert.equal(markups[0]!.style.textMargin, 3);
});

test('daFont reads the Tf operator in linear time', () => {
  assert.deepEqual(daFont('/Helv 12 Tf 0 0 0 rg'), { name: 'Helv', size: 12 });
  assert.deepEqual(daFont('0 g /TiRo 9.5 Tf'), { name: 'TiRo', size: 9.5 });
  assert.deepEqual(daFont('0 g'), { name: '', size: 0 });
  assert.deepEqual(daFont(undefined), { name: '', size: 0 });
  const hostile = `${'.'.repeat(200000)} x`;
  const start = Date.now();
  assert.equal(daFont(hostile).size, 0);
  assert.equal(daFont(`${'.'.repeat(200000)} Tf`).size, 0);
  assert.ok(Date.now() - start < 500);
});
