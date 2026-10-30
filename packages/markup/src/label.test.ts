import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { readPdfExtras } from './pdfExtras.ts';

const base = (m: Partial<Markup> & Pick<Markup, 'id' | 'type' | 'points'>): Markup => ({ pageIndex: 0, style: { ...DEFAULT_STYLES[m.type] }, status: 'none', author: 'T', createdAt: 1, modifiedAt: 1, ...m });

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  return (await doc.save()).buffer as ArrayBuffer;
}

const text = (d: PDFDict, key: string) => d.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText();

test('a label is written as /Label, above the value in a count’s contents, and read back from another tool’s file', async () => {
  const count = base({ id: 'c1', type: 'count', points: [[20, 20]], label: 'Sockets' });
  const plain = base({ id: 'c2', type: 'count', points: [[60, 60]] });
  const bytes = await exportWithAnnotations(await blank(), [count, plain]);
  const out = await PDFDocument.load(bytes);
  const annots = out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict));
  const withLabel = annots.find((a) => text(a, 'NM') === 'c1')!;
  assert.equal(text(withLabel, 'Label'), 'Sockets');
  assert.match(text(withLabel, 'Contents') ?? '', /^Sockets\r/);
  assert.equal(text(annots.find((a) => text(a, 'NM') === 'c2')!, 'Label') ?? '', '');

  // Without our own data, as Bluebeam's file would be: the label still comes back.
  const found: ImportableAnnotation[] = annots.map((a, index) => ({
    index, subtype: '', rect: { x: 0, y: 0, w: 10, h: 10 }, color: null, interior: null, opacity: 1, borderWidth: 1, contents: '', author: '', intent: '', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null,
    ...(text(a, 'NM') === 'c1' ? { subtype: 'Polygon', intent: 'PolygonCount', vertices: [20, 20, 30, 20, 30, 30] } : {}),
  }));
  const { markups } = importAnnotations(0, found, undefined, await readPdfExtras(bytes));
  assert.ok(markups.some((m) => m.label === 'Sockets'));
});
