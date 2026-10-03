import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { calibratedScale, DEFAULT_SCALE } from '@nb/measure';
import { exportWithAnnotations } from './export.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';
import { scaleOfMarkup, viewportAt, type Viewport } from './viewports.ts';

const detail: Viewport = { id: 'v1', pageIndex: 0, name: 'Detail', rect: { x: 100, y: 100, w: 100, h: 100 }, scale: calibratedScale(10, 1, 'm') };
const inner: Viewport = { ...detail, id: 'v2', name: 'Inner', rect: { x: 120, y: 120, w: 20, h: 20 } };

const length = (points: [number, number][], pageIndex = 0): Markup => ({
  id: 'l', type: 'length', pageIndex, points, style: { ...DEFAULT_STYLES.length }, status: 'none', author: '', createdAt: 0, modifiedAt: 0,
});

test('a markup takes the scale of the viewport it starts in; the smallest when they overlap', () => {
  assert.equal(viewportAt([detail, inner], 0, [130, 130])?.id, 'v2');
  assert.equal(viewportAt([detail, inner], 0, [150, 190])?.id, 'v1');
  assert.equal(viewportAt([detail], 1, [150, 150]), null);
  assert.equal(scaleOfMarkup(length([[150, 150], [160, 150]]), DEFAULT_SCALE, [detail]), detail.scale);
  assert.equal(scaleOfMarkup(length([[10, 10], [150, 150]]), DEFAULT_SCALE, [detail]), DEFAULT_SCALE);
});

test('exported measurement labels use the viewport scale', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [length([[110, 150], [160, 150]])], { viewports: [detail] });
  const out = await PDFDocument.load(bytes);
  const annot = out.context.lookup(out.getPage(0).node.Annots()!.get(0), PDFDict);
  // 50 points at 10 points per metre.
  assert.match(annot.lookup(PDFName.of('Contents'), PDFHexString).decodeText(), /5\.00 m/);
});
