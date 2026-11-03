import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';

async function appearanceText(m: Markup): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, [m]));
  return out.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') ? [Buffer.from(decodePDFRawStream(o).decode()).toString('latin1')] : []))
    .join('\n');
}

const box = (text: string): Markup => ({
  id: 't1',
  type: 'text',
  pageIndex: 0,
  points: [[20, 20], [220, 120]],
  style: { ...DEFAULT_STYLES.text },
  text,
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
});

// Hex-encoded Tj strings in an appearance stream, decoded.
const shown = (stream: string): string[] => [...stream.matchAll(/<([0-9A-F]+)> Tj/g)].map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'));

test('a text box with line breaks is drawn as separate lines, not one line with question marks', async () => {
  const lines = shown(await appearanceText(box('first\nsecond\n\nfourth')));
  assert.deepEqual(lines.filter((l) => l.trim()), ['first', 'second', 'fourth']);
  assert.ok(lines.every((l) => !l.includes('?')));
});

test('CRLF and CR breaks are line breaks too, and a tab becomes spaces', async () => {
  const lines = shown(await appearanceText(box('a\r\nb\rc\td')));
  assert.deepEqual(lines, ['a', 'b', 'c    d']);
});

test('line spacing is written to /DS and /RC, and the drawn lines follow it', async () => {
  const withSpacing = (lineHeight?: number): Markup => ({ ...box('a\nb\nc'), style: { ...DEFAULT_STYLES.text, fontSize: 10, lineHeight } });
  const ys = (stream: string) => [...stream.matchAll(/1 0 0 -1 \S+ (\S+) Tm/g)].map((m) => Number(m[1]));
  const gaps = (a: number[]) => a.slice(1).map((y, i) => Math.round((y - a[i]!) * 100) / 100);
  assert.deepEqual(gaps(ys(await appearanceText(withSpacing()))), [12, 12]);
  assert.deepEqual(gaps(ys(await appearanceText(withSpacing(2)))), [20, 20]);
  assert.deepEqual(gaps(ys(await appearanceText(withSpacing(1.5)))), [15, 15]);

  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [withSpacing(1.5)]));
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.match(annot.lookup(PDFName.of('DS'), PDFString, PDFHexString).decodeText(), /line-height:15pt/);
  assert.match(annot.lookup(PDFName.of('RC'), PDFString, PDFHexString).decodeText(), /line-height:15pt/);
  const plain = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [withSpacing()]));
  const ds = plain.context.lookup(plain.getPage(0).node.Annots()!.get(0), PDFDict).lookup(PDFName.of('DS'), PDFString, PDFHexString).decodeText();
  assert.doesNotMatch(ds, /line-height/);
});
