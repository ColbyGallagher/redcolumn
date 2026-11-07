import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import { SCALE_PRESETS, type Scale } from '@nb/measure';
import { scaleFromMeasure } from './bluebeam.ts';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { importViewports } from './bluebeam.ts';

const preset = (label: string) => SCALE_PRESETS.find((p) => p.label === label)!.scale;
const mm = (n: number) => (n / 25.4) * 72;
const xy: Scale = { ...preset('1:100'), yMetersPerPoint: preset('1:50').metersPerPoint };

const length = (points: [number, number][]): Markup => ({
  id: 'l', type: 'length', pageIndex: 0, points, style: { ...DEFAULT_STYLES.length }, status: 'none', author: '', createdAt: 0, modifiedAt: 0,
});

async function exported(rotate = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  if (rotate) page.setRotation(degrees(rotate));
  const markups = [length([[50, 50], [50 + mm(10), 50]]), { ...length([[100, 50], [100, 50 + mm(10)]]), id: 'v' }];
  return exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, markups, { scaleFor: () => xy, pageScales: { 0: xy } });
}

test('a /Measure with a /Y array reads back as a separate Y scale', () => {
  const s = scaleFromMeasure({ R: '1:100', X: [{ U: 'm', C: 0.3528 }], Y: [{ U: 'm', C: 0.1764 }] })!;
  assert.ok(Math.abs(s.yMetersPerPoint! / s.metersPerPoint - 0.5) < 1e-9);
  // No /Y, or one equal to /X, leaves Y following X.
  assert.equal(scaleFromMeasure({ X: [{ U: 'm', C: 0.3528 }] })!.yMetersPerPoint, undefined);
  assert.equal(scaleFromMeasure({ X: [{ U: 'm', C: 0.3528 }], Y: [{ U: 'm', C: 0.3528 }] })!.yMetersPerPoint, undefined);
});

test('export writes /Y on each measurement when Y differs, and labels use it', async () => {
  const out = await PDFDocument.load(await exported());
  const annots = out.getPage(0).node.Annots()!;
  const dicts = [0, 1].map((i) => out.context.lookup(annots.get(i), PDFDict));
  const [horizontal, vertical] = dicts;
  assert.match(horizontal!.lookup(PDFName.of('Contents'), PDFHexString).decodeText(), /1\.00 m/);
  assert.match(vertical!.lookup(PDFName.of('Contents'), PDFHexString).decodeText(), /0\.50 m/);
  const measure = horizontal!.lookup(PDFName.of('Measure'), PDFDict);
  const x = measure.lookup(PDFName.of('X'), PDFArray).lookup(0, PDFDict).lookup(PDFName.of('C'), PDFNumber).asNumber();
  const y = measure.lookup(PDFName.of('Y'), PDFArray).lookup(0, PDFDict).lookup(PDFName.of('C'), PDFNumber).asNumber();
  assert.ok(Math.abs(y / x - 0.5) < 1e-9);
});

test('export without a separate Y writes no /Y', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [length([[50, 50], [90, 50]])], { scaleFor: () => preset('1:100') });
  const out = await PDFDocument.load(bytes);
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  assert.equal(annot.lookup(PDFName.of('Measure'), PDFDict).get(PDFName.of('Y')), undefined);
});

for (const rotate of [0, 90, 270]) {
  test(`the page scale keeps its Y through export and reimport (page rotated ${rotate})`, async () => {
    const extras = await readPdfExtras(await exported(rotate));
    assert.ok(extras);
    const { scale } = importViewports(0, extras.pages[0]!);
    assert.ok(scale);
    assert.ok(Math.abs(scale.metersPerPoint / xy.metersPerPoint - 1) < 1e-6);
    assert.ok(Math.abs(scale.yMetersPerPoint! / xy.yMetersPerPoint! - 1) < 1e-6);
  });
}
