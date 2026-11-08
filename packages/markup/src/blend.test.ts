import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { DEFAULT_STYLES, type Markup, type MarkupType } from './model.ts';
import { paintedStyle } from './arrange.ts';
import { drawMarkup } from './render.ts';
import { BLEND_MODES, blendModeOfPdf, effectiveBlendMode, styleCapabilities, type BlendMode } from './style.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const markup = (type: MarkupType, blendMode?: BlendMode): Markup => ({
  id: `m-${type}`,
  type,
  pageIndex: 0,
  points: [[50, 50], [150, 120]],
  style: { ...DEFAULT_STYLES[type], ...(blendMode ? { blendMode } : {}) },
  ...(type === 'image' ? { image: PNG } : {}),
  status: 'none',
  author: 'Tester',
  createdAt: 1,
  modifiedAt: 1,
});

async function exported(m: Markup) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const out = await PDFDocument.load(await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, [m]));
  return { out, dict: out.getPage(0).node.Annots()!.asArray().map((r) => out.context.lookup(r, PDFDict))[0]! };
}

/** The /BM names in the annotation's appearance graphics states. */
function appearanceBlends(out: PDFDocument, dict: PDFDict): (string | undefined)[] {
  const ap = dict.lookup(PDFName.of('AP'), PDFDict);
  const stream = ap.lookup(PDFName.of('N')) as unknown as { dict: PDFDict };
  const gs = stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict);
  return gs.keys().map((k) => (gs.lookup(k, PDFDict).get(PDFName.of('BM')) as { toString(): string } | undefined)?.toString());
}

test('blend modes default to normal, except highlighters which multiply', () => {
  assert.equal(effectiveBlendMode(markup('image')), 'normal');
  assert.equal(effectiveBlendMode(markup('rect')), 'normal');
  assert.equal(effectiveBlendMode(markup('highlighter')), 'multiply');
  assert.equal(effectiveBlendMode(markup('textHighlight')), 'multiply');
});

test('an explicit blend mode overrides the type default', () => {
  assert.equal(effectiveBlendMode(markup('image', 'screen')), 'screen');
  assert.equal(effectiveBlendMode(markup('highlighter', 'normal')), 'normal');
});

test('images, shapes and lines can blend; text markups cannot', () => {
  for (const t of ['image', 'signature', 'rect', 'ellipse', 'polygon', 'line', 'pen'] as const) assert.ok(styleCapabilities(t).blend, t);
  assert.ok(!styleCapabilities('underline').blend);
});

test('every blend mode has its own canvas and PDF name, and the PDF name reads back', () => {
  assert.equal(new Set(BLEND_MODES.map((b) => b.canvas)).size, BLEND_MODES.length);
  for (const b of BLEND_MODES) assert.equal(blendModeOfPdf(b.pdf), b.value);
  assert.equal(blendModeOfPdf('Compatible'), 'normal');
  assert.equal(blendModeOfPdf('Nonsense'), null);
});

test('painting a format carries the blend mode to another type', () => {
  const painted = paintedStyle(markup('image', 'multiply'), markup('rect'));
  assert.equal(painted.blendMode, 'multiply');
});

test('an image with Multiply exports /BM on the annotation and its appearance', async () => {
  const { out, dict } = await exported(markup('image', 'multiply'));
  assert.equal(dict.get(PDFName.of('BM'))?.toString(), '/Multiply');
  assert.ok(appearanceBlends(out, dict).includes('/Multiply'));
});

test('a normal image exports no /BM', async () => {
  const { out, dict } = await exported(markup('image'));
  assert.equal(dict.has(PDFName.of('BM')), false);
  assert.ok(appearanceBlends(out, dict).every((b) => b === undefined));
});

test('a highlighter still exports Multiply, and Normal removes it', async () => {
  assert.equal((await exported(markup('highlighter'))).dict.get(PDFName.of('BM'))?.toString(), '/Multiply');
  assert.equal((await exported(markup('highlighter', 'normal'))).dict.has(PDFName.of('BM')), false);
});

const annotation = (blend?: string, multiply = false): ImportableAnnotation => ({
  index: 0,
  subtype: 'Square',
  rect: { x: 50, y: 50, w: 100, h: 70 },
  color: '#ff0000',
  interior: null,
  opacity: 1,
  borderWidth: 1,
  contents: '',
  author: 'Pat',
  intent: '',
  cloudy: false,
  da: '',
  appData: '',
  flags: 4,
  vertices: [],
  ink: [],
  line: null,
  link: null,
  ...(blend ? { blend } : {}),
  ...(multiply ? { multiply } : {}),
});

test('a blend mode round trips through export and import', async () => {
  const { dict } = await exported(markup('rect', 'colorBurn'));
  const name = dict.get(PDFName.of('BM'))!.toString().slice(1);
  assert.equal(name, 'ColorBurn');
  const [m] = importAnnotations(0, [annotation(name)]).markups;
  assert.equal(m!.style.blendMode, 'colorBurn');
});

test('importing Normal or no blend mode leaves the style alone', () => {
  assert.equal(importAnnotations(0, [annotation('Normal')]).markups[0]!.style.blendMode, undefined);
  assert.equal(importAnnotations(0, [annotation()]).markups[0]!.style.blendMode, undefined);
});

test('a Multiply highlighter imports as a highlighter without an explicit blend mode', () => {
  const ink = { ...annotation('Multiply', true), subtype: 'Ink', ink: [[[50, 50], [120, 60]]] } as unknown as ImportableAnnotation;
  const [m] = importAnnotations(0, [ink]).markups;
  assert.ok(m);
  {
    assert.equal(m.type, 'highlighter');
    assert.equal(m.style.blendMode, undefined);
  }
});

/** A canvas context that records its composite operation when each markup is drawn. */
function recordingContext() {
  const seen: unknown[] = [];
  const target: Record<string | symbol, unknown> = { globalCompositeOperation: 'source-over' };
  const ctx = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'drawImage') return () => seen.push(t.globalCompositeOperation);
      if (key === 'stroke' || key === 'fill') return () => seen.push(t.globalCompositeOperation);
      return () => undefined;
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, seen };
}

test('drawing a markup uses the canvas operation of its blend mode', () => {
  const rect = recordingContext();
  drawMarkup(rect.ctx, markup('rect', 'screen'));
  assert.ok(rect.seen.length > 0);
  assert.ok(rect.seen.every((op) => op === 'screen'));
  const plain = recordingContext();
  drawMarkup(plain.ctx, markup('rect'));
  assert.ok(plain.seen.every((op) => op === 'source-over'));
  const highlight = recordingContext();
  drawMarkup(highlight.ctx, { ...markup('highlighter'), points: [[10, 10], [80, 12]] });
  assert.ok(highlight.seen.every((op) => op === 'multiply'));
});
