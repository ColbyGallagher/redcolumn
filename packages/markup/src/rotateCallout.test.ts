import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { flatten, hitTest, markupShape } from './geometry.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { calloutLeadersKept, contentBox, DEFAULT_STYLES, markupBounds, rotatePoint, rotationCentre, ROTATABLE, turnedTo, type Markup, type MarkupType, type Point } from './model.ts';
import { readPdfExtras } from './pdfExtras.ts';
import { rotateHandle } from './render.ts';

function markup(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-1`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: 'Test', createdAt: 1, modifiedAt: 1, text: 'NOTE A', ...extra };
}

/** A callout: tip at (40, 200), knee left of its 100 × 40 box at (200, 100)-(300, 140). */
const callout = (extra: Partial<Markup> = {}) => markup('callout', [[40, 200], [180, 120], [200, 100], [300, 140]], extra);

const near = (a: Point, b: Point, tol = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
const onPage = (m: Markup, p: Point): Point => (m.rotation ? rotatePoint(p, rotationCentre(m), m.rotation) : p);

/** The turned box's corners on the page. */
const turnedCorners = (m: Markup): Point[] => {
  const b = contentBox(m);
  return ([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as Point[]).map((p) => onPage(m, p));
};

/** Distance from `p` to the nearest side of the polygon `poly`. */
const toEdge = (p: Point, poly: Point[]) =>
  Math.min(
    ...poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length]!;
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    }),
  );

/** Where the callout's (first) leader ends on the page: its landing on the box. */
const leaderEnd = (m: Markup): Point => {
  const line = flatten(markupShape(m)[1]!.path)[0]!;
  return onPage(m, line[line.length - 1]!);
};

test('callouts and legends can be turned', () => {
  assert.ok(ROTATABLE.has('callout'));
  assert.ok(ROTATABLE.has('legend'));
});

test('turning a callout turns its text box about its middle; the arrow tip and knee stay where they were', () => {
  const m = callout();
  for (const angle of [90, 180, 30, 315]) {
    const t = { ...m, ...turnedTo(m, angle) };
    assert.equal(t.rotation, angle);
    // The box turns about its own middle, which does not move.
    assert.ok(near(rotationCentre(t), rotationCentre(m)));
    assert.ok(near(onPage(t, t.points[0]!), m.points[0]!), `tip stays put at ${angle}°`);
    assert.ok(near(onPage(t, t.points[1]!), m.points[1]!), `knee stays put at ${angle}°`);
    // The leader still meets the turned box, square on one of its sides.
    assert.ok(toEdge(leaderEnd(t), turnedCorners(t)) < 1e-6, `leader meets the box at ${angle}°`);
    // Turned back, it is the callout it was.
    const back = { ...t, ...turnedTo(t, 0) };
    assert.equal(back.rotation, undefined);
    back.points.forEach((p, i) => assert.ok(near(p, m.points[i]!), `point ${i} back at 0°`));
  }
});

test('a turned callout keeps its tips where they are when its box is resized or a turn is added to', () => {
  const t = { ...callout(), ...turnedTo(callout(), 40) };
  // A wider box: its middle moves, so the leader points are stored again in its new frame.
  const wider: Point[] = [...t.points];
  wider[3] = [wider[3]![0] + 60, wider[3]![1]];
  const kept = { ...t, points: calloutLeadersKept(t, wider) };
  assert.ok(near(onPage(kept, kept.points[0]!), onPage(t, t.points[0]!)));
  assert.ok(near(onPage(kept, kept.points[1]!), onPage(t, t.points[1]!)));
  const more = { ...t, ...turnedTo(t, 130) };
  assert.ok(near(onPage(more, more.points[0]!), [40, 200]));
});

test('a turned callout is hit, bounded and handled where it shows', () => {
  const t = { ...callout(), ...turnedTo(callout(), 90) };
  const c = rotationCentre(t);
  // The box turned a quarter: 40 wide and 100 tall about (250, 120).
  assert.ok(hitTest(t, [c[0], c[1] + 45], 1));
  assert.ok(!hitTest(t, [c[0] + 45, c[1]], 1));
  // Its bounds hold the turned box and the tip.
  const b = markupBounds(t);
  for (const p of [...turnedCorners(t), [40, 200] as Point]) assert.ok(p[0] >= b.x - 1e-6 && p[0] <= b.x + b.w + 1e-6 && p[1] >= b.y - 1e-6 && p[1] <= b.y + b.h + 1e-6);
  // The rotate knob sits beyond the box's own top, turned with it: right of the box for a quarter turn.
  const knob = rotateHandle(t, 1)!;
  assert.ok(near(knob.stem, [c[0] + 20, c[1]]));
  assert.ok(knob.at[0] > c[0] + 20);
});

/** Our export of `markups` on a page turned `turn`, and its annotations. */
async function exported(markups: Markup[], turn = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  if (turn) page.setRotation(degrees(turn));
  const bytes = await exportWithAnnotations((await doc.save()).buffer as ArrayBuffer, markups);
  const out = await PDFDocument.load(bytes);
  const refs = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray();
  const annots = refs.map((r) => out.context.lookup(r, PDFDict));
  return { bytes, annots, refs };
}

/** The exported annotations read back as another tool's would be (`ours` false: without our own data). */
async function reimported(markups: Markup[], turn: number, ours: boolean) {
  const { bytes, annots, refs } = await exported(markups, turn);
  const str = (d: PDFDict, k: string) => d.lookupMaybe(PDFName.of(k), PDFString, PDFHexString)?.decodeText() ?? '';
  const name = (d: PDFDict, k: string) => d.lookupMaybe(PDFName.of(k), PDFName)?.decodeText() ?? '';
  const found: ImportableAnnotation[] = annots.map((d, index) => ({
    index,
    objectNumber: (refs[index] as { objectNumber?: number }).objectNumber,
    subtype: name(d, 'Subtype'),
    rect: { x: 0, y: 0, w: 0, h: 0 },
    color: null,
    interior: null,
    opacity: 1,
    borderWidth: 1,
    contents: str(d, 'Contents'),
    author: 'Test',
    intent: name(d, 'IT'),
    cloudy: false,
    da: '',
    appData: ours ? str(d, 'NBData') : '',
    flags: 4,
    vertices: [],
    ink: [],
    line: null,
    link: null,
  }));
  return { annots, markups: importAnnotations(0, found, undefined, await readPdfExtras(bytes)).markups };
}

test('a turned callout and legend save with their turn and come back with it', async () => {
  const c = { ...callout({ id: 'c1' }), ...turnedTo(callout(), 30) };
  const l = markup('legend', [[60, 20], [200, 120]], { id: 'l1', rotation: 270 });
  const { markups } = await reimported([c, l], 0, true);
  const [c2, l2] = markups;
  assert.equal(c2!.type, 'callout');
  assert.equal(c2!.rotation, 30);
  c2!.points.forEach((p, i) => assert.ok(near(p, c.points[i]!, 1e-3)));
  assert.equal(l2!.type, 'legend');
  assert.equal(l2!.rotation, 270);
});

test('a turned callout saves as Bluebeam keeps one: /Rotation, the box before its turn in /RD, the leader on the page', async () => {
  for (const turn of [0, 90, 180]) {
    for (const angle of [30, 90, 180]) {
      const c = { ...callout({ id: 'c1' }), ...turnedTo(callout(), angle) };
      const { annots, markups } = await reimported([c], turn, false);
      const d = annots[0]!;
      // Bluebeam's /Rotation is in user space: the sheet's own turn adds to it on the page.
      const rotation = d.lookupMaybe(PDFName.of('Rotation'), PDFNumber)?.asNumber() ?? 0;
      assert.equal(rotation, (((angle - turn) % 360) + 360) % 360, `/Rotation for ${angle}° on a ${turn}° sheet`);
      // Read back without our own data, it is the same callout on the page.
      const back = markups[0]!;
      assert.equal(back.type, 'callout');
      assert.equal(back.rotation, angle, `turn back for ${angle}° on a ${turn}° sheet`);
      const size = (m: Markup) => [contentBox(m).w, contentBox(m).h];
      assert.deepEqual(size(back).map(Math.round), [100, 40]);
      assert.ok(near(rotationCentre(back), rotationCentre(c), 1e-3), 'box middle');
      assert.ok(near(onPage(back, back.points[0]!), [40, 200], 1e-3), 'tip where it was');
      assert.ok(near(leaderEnd(back), leaderEnd(c), 1e-3), 'leader lands where it did');
    }
  }
});

test('a turned legend saves its turn as Bluebeam keeps it', async () => {
  const l = markup('legend', [[60, 20], [200, 120]], { id: 'l1', rotation: 90 });
  const flat = await exported([l], 0);
  assert.equal(flat.annots[0]!.lookup(PDFName.of('Rotation'), PDFNumber).asNumber(), 90);
  // On a sheet turned as far as the legend, it turned with its sheet. Revu still writes /Rotation 90
  // there (a legend's /Rotation is its turn as shown, sheet included), over an unturned appearance.
  const sheet = await reimported([l], 90, false);
  assert.equal(sheet.annots[0]!.lookup(PDFName.of('Rotation'), PDFNumber).asNumber(), 90);
  const back = sheet.markups[0]!;
  assert.equal(back.type, 'legend');
  assert.equal(back.rotation, 90);
  const box = contentBox(back);
  assert.deepEqual([box.w, box.h].map(Math.round), [140, 100]);
  assert.ok(near(rotationCentre(back), rotationCentre(l), 1e-3));
});
