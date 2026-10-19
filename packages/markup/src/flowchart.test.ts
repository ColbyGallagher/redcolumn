import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { exportWithAnnotations } from './export.ts';
import { anchorOf, canConnect, connectorLabel, elbowRoute, facingSides, relinkCopies, routeConnector } from './flowchart.ts';
import { hitTest, markupShape } from './geometry.ts';
import { contentBox, DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';
import { handlePositions } from './render.ts';
import { MarkupStore } from './store.ts';

function markup(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-1`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: 'Test', createdAt: 1, modifiedAt: 1, ...extra };
}

const shape = (id: string, x: number, y: number, extra: Partial<Markup> = {}) => markup('flowShape', [[x, y], [x + 100, y + 50]], { id, flowShape: 'process', ...extra });

/** Every piece of the path runs along an axis. */
function orthogonal(path: Point[]): boolean {
  return path.every((p, i) => i === 0 || p[0] === path[i - 1]![0] || p[1] === path[i - 1]![1]);
}

test('flowchart shapes draw their outline and keep their text clear of slanted edges', () => {
  const box: Point[] = [[0, 0], [100, 60]];
  for (const kind of ['process', 'decision', 'terminator', 'data', 'document', 'predefined', 'preparation', 'manualInput', 'database', 'circle'] as const) {
    const m = markup('flowShape', box, { flowShape: kind, text: kind });
    const parts = markupShape(m);
    assert.ok(parts[0]!.path.length > 2, kind);
    assert.equal(parts[0]!.fill, DEFAULT_STYLES.flowShape.fill, `${kind} is filled`);
    const t = contentBox(m);
    // Inset evenly: the text stays centred on the shape.
    assert.ok(Math.abs(t.x + t.w / 2 - 50) < 1e-9 && Math.abs(t.y + t.h / 2 - 30) < 1e-9, kind);
    assert.ok(t.w > 0 && t.h > 0 && t.w <= 100 && t.h <= 60, kind);
    assert.ok(hitTest(m, [50, 30], 1), `${kind} is grabbed in the middle`);
  }
  assert.deepEqual(contentBox(markup('flowShape', box, { flowShape: 'decision' })), { x: 20, y: 12, w: 60, h: 36 });
  // A subprocess has its two inner bars; a cylinder the front of its rim.
  assert.equal(markupShape(markup('flowShape', box, { flowShape: 'predefined' })).length, 3);
  assert.equal(markupShape(markup('flowShape', box, { flowShape: 'database' })).length, 2);
});

test('shapes above each other join bottom to top, side by side right to left', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual(facingSides(a, { x: 0, y: 120, w: 100, h: 50 }), ['bottom', 'top']);
  assert.deepEqual(facingSides(a, { x: 0, y: -120, w: 100, h: 50 }), ['top', 'bottom']);
  assert.deepEqual(facingSides(a, { x: 200, y: 20, w: 100, h: 50 }), ['right', 'left']);
  assert.deepEqual(facingSides(a, { x: -200, y: 20, w: 100, h: 50 }), ['left', 'right']);
});

test('a connector between stacked shapes runs straight down between them', () => {
  const shapes = new Map([shape('a', 0, 0), shape('b', 0, 150)].map((m) => [m.id, m]));
  const c = markup('connector', [[0, 0], [1, 1]], { connect: { from: { id: 'a' }, to: { id: 'b' } } });
  assert.deepEqual(routeConnector(c, (id) => shapes.get(id)), [[50, 50], [50, 150]]);
});

test('elbow connectors bend at right angles and leave and enter the shapes outward', () => {
  const shapes = new Map([shape('a', 0, 0), shape('b', 200, 150)].map((m) => [m.id, m]));
  const get = (id: string) => shapes.get(id);
  const c = markup('connector', [[0, 0], [1, 1]], { connect: { from: { id: 'a' }, to: { id: 'b' } } });
  const path = routeConnector(c, get);
  assert.ok(orthogonal(path));
  assert.deepEqual(path[0], [50, 50]);
  assert.deepEqual(path.at(-1), [250, 150]);
  // Down out of the first, down into the second: two turns.
  assert.equal(path.length, 4);
  assert.ok(path[1]![1] > 50 && path[2]![1] < 150);

  // Glued to chosen sides: out of the right, into the left.
  const sides = routeConnector({ ...c, connect: { from: { id: 'a', side: 'right' }, to: { id: 'b', side: 'left' } } }, get);
  assert.ok(orthogonal(sides));
  assert.deepEqual(sides[0], [100, 25]);
  assert.deepEqual(sides.at(-1), [200, 175]);
  assert.ok(sides[1]![0] > 100 && sides.at(-2)![0] < 200);

  // A straight connector is one line between the facing sides.
  assert.deepEqual(routeConnector({ ...c, connect: { ...c.connect, route: 'straight' } }, get), [[50, 50], [250, 150]]);
});

test('an elbow route goes round a shape rather than through it', () => {
  // Both ends leave upward from shapes side by side: the path goes over the top.
  const a = { x: 0, y: 100, w: 100, h: 50 };
  const b = { x: 200, y: 100, w: 100, h: 50 };
  const path = elbowRoute({ at: [50, 100], dir: [0, -1] }, { at: [250, 100], dir: [0, -1] }, [a, b]);
  assert.ok(orthogonal(path));
  assert.ok(path.every(([, y]) => y <= 100));
  // Out of the bottom of one, into the bottom of a shape above it: round the side.
  const low = { x: 0, y: 200, w: 100, h: 50 };
  const high = { x: 0, y: 0, w: 100, h: 50 };
  const round = elbowRoute({ at: [50, 250], dir: [0, 1] }, { at: [50, 50], dir: [0, 1] }, [low, high]);
  assert.ok(orthogonal(round));
  for (let i = 1; i < round.length; i++) {
    const [p, q] = [round[i - 1]!, round[i]!];
    for (const r of [low, high]) {
      const inside = Math.max(p[0], q[0]) > r.x + 1 && Math.min(p[0], q[0]) < r.x + r.w - 1 && Math.max(p[1], q[1]) > r.y + 1 && Math.min(p[1], q[1]) < r.y + r.h - 1;
      assert.ok(!inside, `piece ${i} stays out of the shapes`);
    }
  }
});

test('a connector end that is not glued stays where it was put', () => {
  const shapes = new Map([shape('a', 0, 0)].map((m) => [m.id, m]));
  const c = markup('connector', [[0, 0], [300, 25]], { connect: { from: { id: 'a' } } });
  const path = routeConnector(c, (id) => shapes.get(id));
  assert.deepEqual(path[0], [100, 25]);
  assert.deepEqual(path.at(-1), [300, 25]);
  // Unglued (or its shape gone or on another page): its points as they are.
  assert.deepEqual(routeConnector({ ...c, connect: {} }, () => undefined), c.points);
  assert.deepEqual(routeConnector(c, () => ({ ...shapes.get('a')!, pageIndex: 3 })), c.points);
});

test('anchors turn with a rotated shape', () => {
  const m = shape('a', 0, 0, { rotation: 90 });
  const { at, dir } = anchorOf(m, 'top');
  // Turned a quarter clockwise about its centre (50, 25), the top's middle faces right.
  assert.ok(Math.abs(at[0] - 75) < 1e-9 && Math.abs(at[1] - 25) < 1e-9);
  assert.deepEqual(dir, [1, 0]);
});

test('only boxes and outlines take connectors', () => {
  assert.ok(canConnect(shape('a', 0, 0)));
  assert.ok(canConnect(markup('rect', [[0, 0], [10, 10]])));
  assert.ok(canConnect(markup('polygon', [[0, 0], [10, 0], [5, 8]])));
  assert.ok(!canConnect(markup('line', [[0, 0], [10, 10]])));
  assert.ok(!canConnect(markup('connector', [[0, 0], [10, 10]])));
});

test('a connector shows only its ends as handles, and its text halfway along', () => {
  const c = markup('connector', [[0, 0], [0, 40], [60, 40], [60, 100]], { text: 'Yes' });
  assert.deepEqual(handlePositions(c), [[0, 0], [60, 100]]);
  assert.deepEqual(connectorLabel(c)?.at, [40, 40]);
  assert.equal(connectorLabel({ ...c, text: '  ' }), null);
});

test('copied connectors glue to the copies of their shapes and come loose from the rest', () => {
  const c = markup('connector', [[0, 0], [1, 1]], { connect: { from: { id: 'a', side: 'right' }, to: { id: 'b' }, route: 'straight' } });
  const [copy] = relinkCopies([c], new Map([['a', 'a2']]));
  assert.deepEqual(copy!.connect, { route: 'straight', from: { id: 'a2', side: 'right' } });
});

test('the store re-routes connectors when their shapes move, in the same undo step', async () => {
  const store = await MarkupStore.open('flow', { persist: false });
  store.add(shape('a', 0, 0));
  store.add(shape('b', 0, 150));
  store.add(markup('connector', [[0, 0], [1, 1]], { id: 'c', connect: { from: { id: 'a' }, to: { id: 'b' } } }));
  assert.deepEqual(store.get('c')!.points, [[50, 50], [50, 150]]);
  store.checkpoint();
  store.update('b', { points: [[200, 150], [300, 200]] });
  const moved = store.get('c')!.points;
  assert.deepEqual(moved[0], [50, 50]);
  assert.deepEqual(moved.at(-1), [250, 150]);
  assert.ok(orthogonal(moved));
  store.undo();
  assert.deepEqual(store.get('c')!.points, [[50, 50], [50, 150]]);
  // Deleting a shape leaves the connector where it was; undoing it glues it again.
  store.checkpoint();
  store.remove(['b']);
  assert.deepEqual(store.get('c')!.points, [[50, 50], [50, 150]]);
  store.undo();
  store.update('b', { points: [[0, 300], [100, 350]] });
  assert.deepEqual(store.get('c')!.points, [[50, 50], [50, 300]]);
  await store.destroy();
});

test('flowchart shapes and connectors save as a polygon and a polyline with their text', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const original = await doc.save();
  const markups = [
    shape('a', 10, 10, { flowShape: 'decision', text: 'OK?' }),
    markup('connector', [[60, 60], [60, 120]], { id: 'c', text: 'Yes', connect: { from: { id: 'a' } }, createdAt: 2 }),
  ];
  const out = await PDFDocument.load(await exportWithAnnotations(original.buffer as ArrayBuffer, markups));
  const dicts = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((ref) => out.context.lookup(ref, PDFDict));
  const text = (d: PDFDict, key: string) => d.lookup(PDFName.of(key), PDFString, PDFHexString).decodeText();
  assert.deepEqual(dicts.map((d) => d.get(PDFName.of('Subtype'))?.toString()), ['/Polygon', '/PolyLine']);
  // The diamond's four corners.
  assert.equal(dicts[0]!.lookup(PDFName.of('Vertices'), PDFArray).size(), 10);
  assert.equal(text(dicts[0]!, 'Contents'), 'OK?');
  assert.equal(text(dicts[0]!, 'Subj'), 'Decision');
  assert.equal(text(dicts[1]!, 'Contents'), 'Yes');
  const data = JSON.parse(text(dicts[1]!, 'NBData')) as Markup;
  assert.deepEqual(data.connect, { from: { id: 'a' } });
});
