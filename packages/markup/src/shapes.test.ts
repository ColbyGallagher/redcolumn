import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { arcPoints, circleThrough } from './arc.ts';
import { exportWithAnnotations } from './export.ts';
import { circleBox, hitTest, markupShape, polarPoint, resizedBox, segmentPolar, withSegment } from './geometry.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { dimensionText, measurementLabel } from './render.ts';
import { DEFAULT_STYLES, markupBounds, rotatePoint, rotationCentre, type Markup, type MarkupType, type Point } from './model.ts';

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
    // An arc is Bluebeam's Arc: a Circle with /IT /CircleArc.
    ['/PolyLine', '/Polygon', '/Circle', '/Text', '/FreeText'],
  );
  assert.equal(dicts[0]!.lookup(PDFName.of('LE'), PDFArray).asArray().map(String).join(' '), '/None /ClosedArrow');
  assert.equal(name(dicts[2]!, 'IT'), '/CircleArc');
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

test('segmentPolar and polarPoint measure angles counter-clockwise from east, as on paper', () => {
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  // Page y runs down, so "up the sheet" is 90°.
  const up = segmentPolar([10, 10], [10, 0]);
  close(up.length, 10);
  close(up.angle, 90);
  close(segmentPolar([0, 0], [-5, 5]).angle, 225);
  close(segmentPolar([0, 0], [3, 0]).angle, 0);
  for (const angle of [0, 30, 135, 270, 359]) {
    const p = polarPoint([4, 7], 12, angle);
    const back = segmentPolar([4, 7], p);
    close(back.length, 12);
    close(back.angle, angle);
  }
});

test('withSegment sets one segment and carries the rest of the path along', () => {
  const pts = withSegment([[0, 0], [10, 0], [10, 10]], 0, 20, 0);
  assert.deepEqual(pts, [[0, 0], [20, 0], [20, 10]]);
  // Out of range: unchanged.
  assert.deepEqual(withSegment([[0, 0], [1, 1]], 1, 5, 0), [[0, 0], [1, 1]]);
});

test('resizedBox keeps the first corner, also when rotated', () => {
  assert.deepEqual(resizedBox({ type: 'rect', points: [[10, 10], [0, 30]] }, 4, 5), [[10, 10], [6, 15]]);
  const m = { type: 'rect' as const, points: [[0, 0], [10, 20]] as Point[], rotation: 30 };
  const corner = rotatePoint([0, 0], rotationCentre(m), 30);
  const points = resizedBox(m, 40, 8);
  const moved = rotatePoint(points[0]!, rotationCentre({ type: 'rect', points }), 30);
  assert.ok(Math.hypot(moved[0] - corner[0], moved[1] - corner[1]) < 1e-9);
  assert.ok(Math.abs(points[1]![0] - points[0]![0] - 40) < 1e-9 && Math.abs(points[1]![1] - points[0]![1] - 8) < 1e-9);
});

test('circleBox centres the circle on its point', () => {
  assert.deepEqual(circleBox([10, 20], 5), [[5, 15], [15, 25]]);
});

test('a cloud\'s bounds hold its stretched bumps, which a short edge makes bigger than the nominal radius', () => {
  // 163 long at radius 35 is 2.3 bumps, rounded to 2 of radius 40.75: past a 35 point pad.
  const m = markup('cloud', [[0, 0], [163, 100]], { style: { ...DEFAULT_STYLES.cloud, arcRadius: 35, width: 2 } });
  const b = markupBounds(m);
  assert.ok(b.x <= -40.75 - 1 && b.y <= -(100 / Math.round(100 / 70) / 2) - 1, `bounds ${JSON.stringify(b)}`);
  assert.ok(b.x + b.w >= 163 + 40.75 + 1);
});

test('Bluebeam sees a radius, a space and a flag label as its own kinds', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const markups = [
    markup('radius', [[200, 200], [250, 200]]),
    markup('space', [[10, 10], [100, 10], [100, 100], [10, 100]], { subject: 'Kitchen' }),
    markup('flagLabel', [[300, 300], [380, 320]], { text: 'Check' }),
    markup('legend', [[10, 200], [150, 300]]),
  ].map((m, i) => ({ ...m, id: `m${i}`, createdAt: i }));
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, markups));
  const page = out.getPage(0).node;
  const dicts = page.lookup(PDFName.of('Annots'), PDFArray).asArray().map((ref) => out.context.lookup(ref, PDFDict));
  const name = (d: PDFDict, key: string) => d.get(PDFName.of(key))?.toString();

  // A radius is a polygon of a point on the circle, its centre and the arc's end, not a boxed circle.
  const radius = dicts.find((d) => name(d, 'IT') === '/PolygonRadius')!;
  assert.equal(name(radius, 'Subtype'), '/Polygon');
  assert.deepEqual(radius.lookup(PDFName.of('Vertices'), PDFArray).asArray().map((n) => Number(n.toString())), [250, 200, 200, 200, 250, 200].map((x, i) => (i % 2 ? 400 - x : x)));
  assert.equal(radius.has(PDFName.of('RD')), false);
  // Every annotation has a subject, which Bluebeam's Markups List names and groups them by.
  const subj = (d: PDFDict) => d.lookup(PDFName.of('Subj'), PDFString, PDFHexString).decodeText();
  assert.deepEqual(dicts.map(subj).sort(), ['Flag', 'Legend', 'Radius Measurement']);

  // A space is an entry in the page's /BSISpaces, not an annotation.
  const spaces = page.lookup(PDFName.of('BSISpaces'), PDFArray).asArray().map((e) => out.context.lookup(e, PDFDict));
  assert.equal(spaces.length, 1);
  assert.equal(spaces[0]!.lookup(PDFName.of('Title'), PDFString, PDFHexString).decodeText(), 'Kitchen');
  assert.equal(spaces[0]!.lookup(PDFName.of('Path'), PDFArray).size(), 4);
  assert.equal(dicts.length, 3, 'radius, flag label and legend');

  // A legend is a stamp: other tools scale its appearance on resize, where a FreeText would be
  // redrawn from its text, losing the symbols and bands.
  const legend = dicts.find((d) => subj(d) === 'Legend')!;
  assert.equal(name(legend, 'Subtype'), '/Stamp');
  assert.ok(legend.has(PDFName.of('AP')));

  // A flag label is listed in the catalog's /BSIFlags, and its /Flag points back at it.
  const flags = out.catalog.lookup(PDFName.of('BSIFlags'), PDFArray).asArray();
  assert.equal(flags.length, 1);
  const flagged = dicts.find((d) => d.has(PDFName.of('Flag')))!;
  assert.equal(name(flagged, 'Subtype'), '/FreeText');
  assert.equal(flagged.get(PDFName.of('Flag')), flags[0]);
  const parent = out.context.lookup(flags[0]!, PDFDict).get(PDFName.of('Parent'));
  assert.equal(out.context.lookup(parent, PDFDict), flagged);
});

test('a Cloud+ is grouped for Bluebeam: the callout leads, the cloud points at it', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const markups = [
    markup('cloud', [[50, 50], [150, 120]], { groupId: 'g' }),
    markup('callout', [[150, 50], [190, 20], [200, 10], [280, 40]], { groupId: 'g', text: 'Revise' }),
  ].map((m, i) => ({ ...m, id: `m${i}`, createdAt: i }));
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, markups));
  const dicts = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((ref) => out.context.lookup(ref, PDFDict));
  const [cloud, callout] = dicts as [PDFDict, PDFDict];
  const text = (d: PDFDict, k: string) => d.lookup(PDFName.of(k), PDFString, PDFHexString).decodeText();
  assert.equal(text(cloud, 'Subj'), 'Cloud+');
  assert.equal(text(callout, 'Subj'), 'Cloud+');
  assert.deepEqual(callout.lookup(PDFName.of('GroupNesting'), PDFArray).asArray().map((e) => (e as PDFHexString).decodeText()), ['Cloud+', '/m1', '/m0']);
  assert.equal(out.context.lookup(cloud.get(PDFName.of('IRT')), PDFDict), callout);
  assert.equal(cloud.get(PDFName.of('RT'))?.toString(), '/Group');
  assert.equal(callout.has(PDFName.of('IRT')), false);
});

test('dimension text slid past an end runs the dimension line out to it', () => {
  const m = markup('length', [[0, 0], [100, 0]], { style: { ...DEFAULT_STYLES.length, labelOffset: 80 } });
  const parts = markupShape(m);
  const runout = parts.find((p) => p.path.length === 2 && p.path[0]![1] === 100 && p.path[1]![1] === 130);
  assert.ok(runout, 'a segment from the end out to the text');
  assert.ok(markupBounds(m).x + markupBounds(m).w >= 130);
  // Text still between the ends: no run-out.
  const inside = markupShape({ ...m, style: { ...m.style, labelOffset: 20 } });
  assert.equal(inside.length, parts.length - 1);
});

test('dimension text follows its offsets and turns', () => {
  const m = markup('length', [[0, 0], [100, 0]], { style: { ...DEFAULT_STYLES.length, leader: 20, labelOffset: 10, labelRotation: 90 } });
  const label = measurementLabel(m)!;
  assert.deepEqual(label.at, [60, 20]);
  assert.ok(Math.abs(label.angle - Math.PI / 2) < 1e-9);
  const d = markup('dimension', [[0, 0], [100, 0]], { text: 'A', style: { ...DEFAULT_STYLES.dimension, labelRotation: 30 } });
  assert.ok(Math.abs(dimensionText(d)!.angle - Math.PI / 6) < 1e-9);
});
