import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { hitTest } from './geometry.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { DEFAULT_STYLES, markupBounds, type Markup } from './model.ts';
import { handlePositions } from './render.ts';

const base = (m: Partial<Markup> & Pick<Markup, 'id' | 'type' | 'points'>): Markup => ({ pageIndex: 0, style: { ...DEFAULT_STYLES[m.type] }, status: 'none', author: 'T', createdAt: 1, modifiedAt: 1, ...m });

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  return (await doc.save()).buffer as ArrayBuffer;
}

const annotation = (over: Partial<ImportableAnnotation>): ImportableAnnotation => ({
  index: 0, subtype: '', rect: { x: 0, y: 0, w: 10, h: 10 }, color: '#ff0000', interior: null, opacity: 1, borderWidth: 1, contents: '', author: 'Other', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null, ...over,
});

test('a file attachment is embedded once and comes back with its bytes', async () => {
  const data = Buffer.from('hello attachment').toString('base64');
  const m = base({ id: 'a1', type: 'attachment', points: [[20, 20], [40, 44]], attachment: { name: 'notes.txt', mime: 'text/plain', size: 16, data } });
  const bytes = await exportWithAnnotations(await blank(), [m]);
  const doc = await PDFDocument.load(bytes);
  const annot = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.equal(annot.get(PDFName.of('Subtype'))?.toString(), '/FileAttachment');
  const fs = annot.lookup(PDFName.of('FS'), PDFDict);
  const file = fs.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')) as PDFRawStream;
  const body = Buffer.from(decodePDFRawStream(file).decode()).toString();
  assert.equal(body, 'hello attachment');
  const appData = annot.lookup(PDFName.of('NBData'), PDFString, PDFHexString).decodeText();
  assert.ok(!appData.includes(data), 'the bytes are not duplicated in the markup data');
  const { markups } = importAnnotations(0, [annotation({ subtype: 'FileAttachment', appData, file: { name: 'notes.txt', data: new Uint8Array(Buffer.from('hello attachment')) } })]);
  assert.deepEqual(markups[0], m);
});

test('hidden and rotated markups export with the Hidden flag and a turned appearance', async () => {
  const m = base({ id: 'r1', type: 'rect', points: [[100, 100], [200, 150]], rotation: 90, hidden: true });
  const bytes = await exportWithAnnotations(await blank(), [m]);
  const doc = await PDFDocument.load(bytes);
  const annot = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.equal(Number(annot.get(PDFName.of('F'))?.toString()) & 2, 2);
  // Turned a quarter, the 100 × 50 box stands 50 wide and 100 tall about its centre (150, 125).
  const rect = annot.lookup(PDFName.of('Rect'), PDFArray).asArray().map((n) => Number(n.toString()));
  assert.ok(Math.abs(rect[2]! - rect[0]! - (50 + m.style.width)) < 0.01, `width ${rect[2]! - rect[0]!}`);
  assert.ok(Math.abs(rect[3]! - rect[1]! - (100 + m.style.width)) < 0.01);
});

test('rotation turns bounds, handles and hit testing', () => {
  const m = base({ id: 'r2', type: 'rect', points: [[0, 0], [100, 20]], rotation: 90 });
  const b = markupBounds({ ...m, style: { ...m.style, width: 0 } });
  assert.ok(Math.abs(b.w - 20) < 1e-9 && Math.abs(b.h - 100) < 1e-9 && Math.abs(b.x - 40) < 1e-9);
  const [h0] = handlePositions(m);
  assert.ok(Math.abs(h0![0] - 60) < 1e-9 && Math.abs(h0![1] + 40) < 1e-9, JSON.stringify(h0));
  // The top edge now runs down the right side.
  assert.ok(hitTest(m, [60, 0], 1));
  assert.ok(!hitTest(m, [0, 10], 1));
});

test("other tools' text markups and replace-text edits import from their quad points", () => {
  const quads: [number, number][][] = [[[10, 10], [60, 10], [10, 20], [60, 20]], [[10, 30], [40, 30], [10, 40], [40, 40]]];
  const { markups } = importAnnotations(0, [
    annotation({ index: 0, subtype: 'Highlight', quads }),
    annotation({ index: 1, subtype: 'StrikeOut', intent: 'StrikeOutTextEdit', quads: quads.slice(0, 1), contents: 'new words' }),
  ]);
  assert.deepEqual(markups.map((m) => m.type), ['textHighlight', 'replaceText']);
  assert.deepEqual(markups[0]!.points, [[10, 10], [60, 20], [10, 30], [40, 40]]);
});
