import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import { legendRows } from './legend.ts';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';
import { readPdfExtras } from './pdfExtras.ts';

function markup(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-${points[0]?.[0] ?? 0}`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: 'Test', createdAt: 1, modifiedAt: 1, ...extra };
}

const text = (o: unknown) => (o instanceof PDFHexString ? o.decodeText() : String(o));
const plain = (o: unknown): unknown => {
  if (o instanceof PDFArray) return o.asArray().map(plain);
  if (o instanceof PDFDict) return Object.fromEntries([...o.entries()].map(([k, v]) => [k.decodeText(), plain(v)]));
  if (o instanceof PDFNumber) return o.asNumber();
  return o instanceof PDFHexString ? o.decodeText() : String(o);
};

async function exported(markups: Markup[]) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  doc.addPage([400, 400]);
  const original = await doc.save();
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, markups.map((m, i) => ({ ...m, id: m.id + i, createdAt: i }))));
  const annots = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => out.context.lookup(r, PDFDict));
  return { out, annots };
}

test('a legend is exported as Bluebeam writes its own: a stamp with its keys and totals', async () => {
  const legend = markup('legend', [[200, 0], [380, 200]], { id: 'legend' });
  const { annots } = await exported([
    legend,
    markup('rect', [[10, 10], [50, 50]]),
    markup('rect', [[10, 60], [50, 90]]),
    markup('line', [[10, 100], [90, 100]]),
    markup('count', [[10, 120], [20, 120], [30, 120]]),
    markup('cloud', [[10, 150], [90, 190]], { groupId: 'g' }),
    markup('callout', [[100, 150], [120, 140], [130, 130], [180, 160]], { groupId: 'g', text: 'Revise' }),
    markup('rect', [[10, 10], [50, 50]], { pageIndex: 1 }),
    markup('textHighlight', [[10, 200], [90, 210]]),
  ]);
  const stamp = annots.find((d) => text(d.get(PDFName.of('Subj'))) === 'Legend')!;
  assert.equal(stamp.get(PDFName.of('Subtype'))?.toString(), '/Stamp');
  assert.equal(stamp.get(PDFName.of('IT'))?.toString(), '/StampSnapshot');
  const bsi = plain(stamp.lookup(PDFName.of('BSILegend'), PDFDict)) as { Keys: { Type: number; AdditionalData: string[]; Subkeys?: { Type: number }[] }[]; Sums: { QuantityColumn: number[] }; PageRange: number[]; DescriptionColumn: string };
  assert.equal(bsi.DescriptionColumn, 'Subject');
  assert.deepEqual(bsi.PageRange, [0]);
  // Rectangles, a line, a count and a Cloud+ (the cloud is its sub-key): other pages and text markup are left out.
  assert.deepEqual(bsi.Keys.map((k) => [k.Type, k.AdditionalData[0], k.AdditionalData[2]]), [[9, 'Rectangle', 'Count'], [6, 'Line', 'Count'], [38, 'Count Measurement', 'Count'], [52, 'Cloud+', 'Count']]);
  assert.deepEqual(bsi.Sums.QuantityColumn, [2, 1, 3, 1]);
  assert.deepEqual(bsi.Keys[3]!.Subkeys?.map((k) => k.Type), [53]);
});

test('a Bluebeam legend comes in as a legend that lists only its keys, and keeps them on export', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const key = (type: number, subject: string) => ({ Type: type, AdditionalData: [PDFHexString.fromText(subject), PDFHexString.fromText(''), PDFHexString.fromText('Count')], Color: -65536, BorderWidth: 1 });
  const stamp = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Stamp',
      IT: 'StampSnapshot',
      Subj: PDFHexString.fromText('Legend'),
      Rect: [100, 100, 300, 300],
      NM: PDFHexString.fromText('BBLEGEND'),
      BSILegend: { MajorVersion: 1, MinorVersion: 0, NameID: PDFHexString.fromText('ABCDEFGHIJKLMNOP'), Title: PDFHexString.fromText('Legend'), PageRangeType: 2, PageRange: [0], Keys: [key(9, 'Rectangle'), key(6, 'Line')], Sums: { QuantityColumn: [1, 0] } },
    }),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj([stamp]));
  const bytes = await doc.save();
  const extras = await readPdfExtras(bytes);
  const annotation: ImportableAnnotation = { index: 0, objectNumber: stamp.objectNumber, subtype: 'Stamp', rect: { x: 100, y: 100, w: 200, h: 200 }, color: '#ff0000', interior: null, opacity: 1, borderWidth: 1, contents: '', author: 'Pat', intent: 'StampSnapshot', cloudy: false, da: '', appData: '', flags: 4, vertices: [], ink: [], line: null, link: null };
  const { markups } = importAnnotations(0, [annotation], () => null, extras);
  const legend = markups.find((m) => m.type === 'legend')!;
  assert.deepEqual(legend.legend?.keys?.map((k) => [k.type, k.subject]), [[9, 'Rectangle'], [6, 'Line']]);
  assert.equal(legend.legend?.nameId, 'ABCDEFGHIJKLMNOP');
  // Only the kinds it names are listed: not the ellipse.
  const others = [markup('rect', [[0, 0], [10, 10]]), markup('ellipse', [[0, 0], [10, 10]]), markup('line', [[0, 0], [10, 0]])];
  assert.deepEqual(legendRows(legend, [legend, ...others]).map((r) => r.sample.type), ['rect', 'line']);

  // Saved again (moved), it keeps its keys, even the line none of the markups here match.
  const { annots } = await exported([{ ...legend, pageIndex: 0 }, others[0]!]);
  const bsi = plain(annots.find((d) => text(d.get(PDFName.of('Subj'))) === 'Legend')!.lookup(PDFName.of('BSILegend'), PDFDict)) as { NameID: string; Keys: { Type: number }[]; Sums: { QuantityColumn: number[] } };
  assert.equal(bsi.NameID, 'ABCDEFGHIJKLMNOP');
  assert.deepEqual(bsi.Keys.map((k) => k.Type), [9, 6]);
  assert.deepEqual(bsi.Sums.QuantityColumn, [1, 0]);
});
