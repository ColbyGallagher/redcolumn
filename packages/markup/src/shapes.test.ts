import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { arcPoints, circleThrough } from './arc.ts';
import { exportWithAnnotations } from './export.ts';
import { hitTest, markupShape } from './geometry.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { DEFAULT_STYLES, markupBounds, type Markup, type MarkupType, type Point } from './model.ts';

function markup(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-1`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: 'Test', createdAt: 1, modifiedAt: 1, ...extra };
}

test('circleThrough finds the circle through three points', () => {
  const c = circleThrough([0, 0], [10, 10], [20, 0])!;
  assert.ok(Math.abs(c.cx - 10) < 1e-9 && Math.abs(c.cy - 0) < 1e-9 && Math.abs(c.r - 10) < 1e-9);
  assert.equal(circleThrough([0, 0], [5, 0], [10, 0]), null);
});

test('arcPoints runs from the start, through the middle point, to the end', () => {
  // A semicircle below the x axis (y down), through (10, 10).
  const pts = arcPoints([[0, 0], [10, 10], [20, 0]], 32);
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts.at(-1), [20, 0]);
  assert.ok(pts.every(([x, y]) => Math.abs(Math.hypot(x - 10, y) - 10) < 1e-6));
  assert.ok(pts.some(([, y]) => y > 9.9), 'passes through the middle point side');
  // The other way round: the same ends through (10, -10) bulges upward instead.
  assert.ok(arcPoints([[0, 0], [10, -10], [20, 0]], 32).every(([, y]) => y <= 1e-9));
  // Collinear points draw a straight line.
  assert.deepEqual(arcPoints([[0, 0], [5, 0], [10, 0]]), [[0, 0], [10, 0]]);
});

test('an arc is bounded by its curve, not just its three points', () => {
  const b = markupBounds(markup('arc', [[0, 0], [10, 10], [20, 0]]));
  assert.ok(b.y + b.h >= 10);
});

test('polygons close and hit inside only when filled', () => {
  const square: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const open = markup('polygon', square);
  const path = markupShape(open)[0]!.path;
  assert.deepEqual(path.at(-1), ['Z']);
  assert.equal(hitTest(open, [50, 50], 2), false);
  assert.equal(hitTest(open, [100, 50], 2), true);
  assert.equal(hitTest({ ...open, style: { ...open.style, fill: '#00ff00' } }, [50, 50], 2), true);
});

test('polylines are open and hit along their segments', () => {
  const m = markup('polyline', [[0, 0], [100, 0], [100, 100]]);
  assert.notDeepEqual(markupShape(m)[0]!.path.at(-1), ['Z']);
  assert.equal(hitTest(m, [100, 50], 2), true);
  assert.equal(hitTest(m, [50, 50], 2), false);
});

test('notes and images are grabbable anywhere in their box', () => {
  assert.equal(hitTest(markup('note', [[0, 0], [20, 20]]), [10, 10], 1), true);
  assert.equal(hitTest(markup('image', [[0, 0], [50, 30]], { image: 'data:image/png;base64,' }), [25, 15], 1), true);
  assert.equal(hitTest(markup('typewriter', [[0, 0], [50, 14]], { text: 'Hi' }), [25, 7], 1), true);
});

function annot(partial: Partial<ImportableAnnotation>): ImportableAnnotation {
  return {
    index: 0,
    subtype: 'Square',
    rect: { x: 100, y: 100, w: 20, h: 20 },
    color: '#ff0000',
    interior: null,
    opacity: 1,
    borderWidth: 1,
    contents: '',
    author: 'Jane',
    intent: '',
    cloudy: false,
    da: '',
    appData: '',
    flags: 4,
    vertices: [],
    ink: [],
    line: null,
    link: null,
    ...partial,
  };
}

test('plain polygons, polylines, sticky notes and typewriter text import as their own types', () => {
  const { markups } = importAnnotations(0, [
    annot({ index: 0, subtype: 'Polygon', vertices: [[0, 0], [10, 0], [10, 10]] }),
    annot({ index: 1, subtype: 'PolyLine', vertices: [[0, 0], [10, 0], [10, 10]] }),
    annot({ index: 2, subtype: 'Text', color: '#fde047', contents: 'Check with MEP' }),
    annot({ index: 3, subtype: 'FreeText', intent: 'FreeTextTypeWriter', contents: 'Typed', da: '/Helv 10 Tf 0 0 0 rg' }),
  ]);
  assert.deepEqual(
    markups.map((m) => m.type),
    ['polygon', 'polyline', 'note', 'typewriter'],
  );
  assert.equal(markups[2]!.comment, 'Check with MEP');
  assert.equal(markups[2]!.style.fill, '#fde047');
  assert.equal(markups[3]!.text, 'Typed');
  assert.equal(markups[3]!.style.fontSize, 10);
});

test('new markup types export as matching PDF annotations', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const markups = [
    markup('polyline', [[10, 10], [50, 10], [50, 50]], { style: { ...DEFAULT_STYLES.polyline, endCap: 'filledArrow' } }),
    markup('polygon', [[100, 100], [150, 100], [125, 150]]),
    markup('arc', [[200, 200], [220, 220], [240, 200]]),
    markup('note', [[300, 300], [320, 320]], { comment: 'Hello' }),
    markup('typewriter', [[10, 300], [80, 316]], { text: 'Typed' }),
  ].map((m, i) => ({ ...m, id: `m${i}`, createdAt: i }));
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, markups));
  const annots = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  const dicts = annots.asArray().map((ref) => out.context.lookup(ref, PDFDict));
  const name = (d: PDFDict, key: string) => d.get(PDFName.of(key))?.toString();
  assert.deepEqual(
    dicts.map((d) => name(d, 'Subtype')),
    ['/PolyLine', '/Polygon', '/PolyLine', '/Text', '/FreeText'],
  );
  assert.equal(dicts[0]!.lookup(PDFName.of('LE'), PDFArray).asArray().map(String).join(' '), '/None /ClosedArrow');
  // The arc is exported as points along its curve.
  assert.ok(dicts[2]!.lookup(PDFName.of('Vertices'), PDFArray).size() > 6);
  assert.equal(dicts[3]!.lookup(PDFName.of('Contents'), PDFString, PDFHexString).decodeText(), 'Hello');
  assert.equal(name(dicts[4]!, 'IT'), '/FreeTextTypeWriter');
});

test('callouts put the text in their box and lead from the arrow tip to its nearer side', async () => {
  const { calloutPoints, calloutAttach } = await import('./callout.ts');
  const { contentBox } = await import('./model.ts');
  const pts = calloutPoints([0, 0], [100, 50], 80, 20, 10);
  assert.deepEqual(pts, [[0, 0], [90, 50], [100, 40], [180, 60]]);
  const m = markup('callout', pts, { text: 'See detail 3' });
  assert.deepEqual(contentBox(m), { x: 100, y: 40, w: 80, h: 20 });
  assert.deepEqual(calloutAttach([90, 50], contentBox(m)), [100, 50]);
  // Box to the left of the tip: the landing points the other way.
  assert.deepEqual(calloutPoints([200, 0], [100, 50], 80, 20, 10).slice(1), [[110, 50], [20, 40], [100, 60]]);
  // Grabbable inside the box, not in the empty space between tip and box.
  assert.equal(hitTest(m, [140, 50], 1), true);
  assert.equal(hitTest(m, [40, 45], 1), false);
  // Leader then box: the leader's last point is the attach point.
  const leader = markupShape(m)[1]!;
  assert.deepEqual(leader.path.at(-1), ['L', 100, 50]);
});

test('cutouts: an area with a hole fills even-odd and is not grabbed inside the hole', () => {
  const m: Markup = {
    id: 'a', type: 'area', pageIndex: 0,
    points: [[0, 0], [100, 0], [100, 100], [0, 100]],
    holes: [[[40, 40], [60, 40], [60, 60], [40, 60]]],
    style: { ...DEFAULT_STYLES.area }, status: 'none', author: '', createdAt: 0, modifiedAt: 0,
  };
  const [part] = markupShape(m);
  assert.equal(part!.evenOdd, true);
  assert.equal(part!.path.filter((c) => c[0] === 'Z').length, 2);
  assert.equal(hitTest(m, [20, 20], 1), true);
  assert.equal(hitTest(m, [50, 50], 1), false);
});

test('diameter and radius draw their circle; bounds cover it', () => {
  const d: Markup = { id: 'd', type: 'diameter', pageIndex: 0, points: [[0, 50], [100, 50]], style: { ...DEFAULT_STYLES.diameter }, status: 'none', author: '', createdAt: 0, modifiedAt: 0 };
  const b = markupBounds(d);
  assert.ok(b.y < 1 && b.y + b.h > 99, 'the circle reaches above and below the diameter');
  const r: Markup = { ...d, type: 'radius', points: [[50, 50], [100, 50]] };
  assert.ok(markupBounds(r).x < 1);
});

test('a callout leader always meets its box head-on: horizontal at a side, vertical at the top or bottom', async () => {
  const { calloutLanding } = await import('./callout.ts');
  const box = { x: 100, y: 40, w: 80, h: 20 };
  // Knee beside the box, level with it: lands straight in.
  assert.deepEqual(calloutLanding([90, 50], box), { side: 'left', knee: [90, 50], attach: [100, 50] });
  // Knee beside the box but above its top edge: the final stretch still runs along a horizontal line.
  const high = calloutLanding([60, 10], box);
  assert.equal(high.side, 'left');
  assert.equal(high.attach[1], high.knee[1]);
  // Knee above the box: vertical into the top; below: vertical into the bottom.
  assert.deepEqual(calloutLanding([130, 20], box), { side: 'top', knee: [130, 20], attach: [130, 40] });
  assert.deepEqual(calloutLanding([150, 90], box), { side: 'bottom', knee: [150, 90], attach: [150, 60] });
  // Off to a corner: whichever way it overshoots most, never a diagonal.
  const corner = calloutLanding([20, 120], box);
  assert.ok(corner.attach[0] === corner.knee[0] || corner.attach[1] === corner.knee[1]);
});
