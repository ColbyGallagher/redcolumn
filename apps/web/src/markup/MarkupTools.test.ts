// Drawing with every markup tool as a user would: pick the tool, press, drag or click on the page,
// and check the markup that lands in the store. Then the editing features on drawn markups: select,
// move, delete, copy and paste, group, lock, restyle and undo. The page is a fake viewer at zoom 1,
// so page points and screen pixels are the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STAMPS, DEFAULT_STYLES, MARKUP_TYPES, MarkupStore, TYPE_INFO, boundsOf, type Markup, type MarkupType, type Point, type WordBox } from '@nb/markup';
import type { TileViewer } from '../viewer/TileViewer';
import type { MarkupTools as Tools } from './MarkupTools';

// MarkupTools listens on `window` for modifier keys when it loads.
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
const { MarkupTools } = await import('./MarkupTools');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const viewer = {
  zoomFor: () => 1,
  invalidate() {},
  setNavTool() {},
  mapPoint: (_from: number, _to: number, p: Point) => p,
  pageUnder: () => null,
  pageSize: () => ({ width: 612, height: 792 }),
  pageNearClient: () => 0,
  clientToPage: (x: number, y: number) => [x, y],
} as unknown as TileViewer;

/** A line of PDF text across the top of the page, for the text markup tools. */
const WORDS: WordBox[] = ['GENERAL', 'NOTES', 'APPLY', 'TO', 'ALL', 'SHEETS'].map((text, i) => ({ text, x0: 50 + i * 60, y0: 100, x1: 100 + i * 60, y1: 112 }));

function pointer(extra: Partial<PointerEvent> = {}): PointerEvent {
  return { button: 0, buttons: 1, pointerType: 'mouse', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, detail: 1, preventDefault() {}, stopPropagation() {}, ...extra } as PointerEvent;
}

async function setup() {
  const store = await MarkupStore.open(`tools-ui-${Math.random()}`, { persist: false });
  const created: Markup[] = [];
  const tools = new MarkupTools(viewer, {
    author: () => 'Tester',
    onEditText() {},
    onCalibrate() {},
    onFollowLink() {},
    onCreated: (m) => created.push(m),
    defaultStamp: () => DEFAULT_STAMPS[0]!,
    stampValues: () => ({ file: 'A-101.pdf', page: '1' }),
  });
  tools.setStore(store);
  tools.setSnap(false);
  tools.setTextSource(async () => WORDS);
  return { store, tools, created };
}

type Harness = Awaited<ReturnType<typeof setup>>;

const press = (t: Tools, p: Point, e?: Partial<PointerEvent>) => t.pointerDown(pointer(e), p, 0);
const move = (t: Tools, p: Point, e?: Partial<PointerEvent>) => t.pointerMove(pointer(e), p, 0);
const release = (t: Tools, p: Point, e?: Partial<PointerEvent>) => t.pointerUp(pointer({ buttons: 0, ...e }), p, 0);

function drag(t: Tools, from: Point, to: Point, e?: Partial<PointerEvent>) {
  press(t, from, e);
  for (let i = 1; i <= 5; i++) move(t, [from[0] + ((to[0] - from[0]) * i) / 5, from[1] + ((to[1] - from[1]) * i) / 5], e);
  release(t, to, e);
}

function click(t: Tools, p: Point) {
  press(t, p);
  release(t, p);
}

/** Text markups wait for the page's words to load once. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Arms a tool the way the toolbar does, with what it needs first (a picture, a file). */
function arm(h: Harness, type: MarkupType) {
  if (type === 'image' || type === 'signature') h.tools.setTool(type, { image: PNG, aspect: 2 });
  else if (type === 'attachment') h.tools.setTool(type, { attachment: { name: 'spec.txt', mime: 'text/plain', size: 2, data: 'aGk=' } });
  else h.tools.setTool(type);
}

/** Draws one markup of `type` the way its tool works; returns the points the user put down. */
async function drawWith(h: Harness, type: MarkupType): Promise<Point[]> {
  const info = TYPE_INFO[type];
  arm(h, type);
  switch (info.draw) {
    case 'drag':
      drag(h.tools, [100, 200], [260, 300]);
      return [[100, 200], [260, 300]];
    case 'freehand': {
      const path: Point[] = [[100, 200], [130, 220], [160, 210], [190, 240], [220, 230]];
      press(h.tools, path[0]!);
      for (const p of path.slice(1)) move(h.tools, p);
      release(h.tools, path.at(-1)!);
      return path;
    }
    case 'place':
      click(h.tools, [150, 250]);
      return [[150, 250]];
    case 'text':
      press(h.tools, [50, 105]);
      await settle();
      move(h.tools, [160, 106]);
      release(h.tools, [160, 106]);
      return [];
    case 'click': {
      const spec = info.click!;
      const n = spec.fixed ?? Math.max(spec.min, 4);
      const pts = ([[100, 200], [260, 210], [240, 330], [110, 320]] as Point[]).slice(0, n);
      for (const p of pts) click(h.tools, p);
      if (!spec.fixed) h.tools.finish();
      return pts;
    }
  }
}

for (const type of MARKUP_TYPES) {
  test(`the ${TYPE_INFO[type].label} tool draws a ${type}`, async () => {
    const h = await setup();
    const placed = await drawWith(h, type);
    const all = h.store.all();
    assert.equal(all.length, 1, `one markup drawn, got ${all.map((m) => m.type).join(', ') || 'none'}`);
    const m = all[0]!;
    assert.equal(m.type, type);
    assert.equal(m.author, 'Tester');
    assert.equal(m.pageIndex, 0);
    assert.equal(m.status, 'none');
    assert.ok(m.points.length > 0 && m.points.flat().every(Number.isFinite), 'has points');
    assert.deepEqual(h.created.map((c) => c.id), [m.id], 'reported as created');
    // Its look starts from the tool's style.
    assert.equal(m.style.stroke, DEFAULT_STYLES[type].stroke);

    const info = TYPE_INFO[type];
    if (info.draw === 'click') assert.deepEqual(m.points, placed, 'a point per click');
    if (info.draw === 'freehand') assert.ok(m.points.length >= 2, 'follows the stroke');
    if (info.draw === 'drag' && type !== 'callout') {
      const b = boundsOf(m.points);
      // Pictures keep their aspect ratio inside the dragged box.
      if (info.content !== 'image' && type !== 'stamp') assert.deepEqual([b.x, b.y, b.x + b.w, b.y + b.h], [100, 200, 260, 300], 'fills the dragged box');
      else assert.ok(b.w > 0 && b.h > 0 && b.x >= 99 && b.y >= 199, 'placed in the dragged box');
    }
    if (info.draw === 'text') {
      assert.ok(m.points.length >= 2, 'covers the words');
      const b = boundsOf(m.points);
      assert.ok(b.x <= 50.5 && b.x + b.w >= 159.5 && b.y <= 101 && b.y + b.h >= 111, `over GENERAL NOTES: ${JSON.stringify(b)}`);
    }
    if (info.content === 'image') assert.equal(m.image, PNG);
    if (type === 'stamp') assert.ok(m.stamp?.lines.length, 'carries its wording');
    if (type === 'attachment') assert.equal(m.attachment?.name, 'spec.txt');

    // One undo step takes it away, and redo brings it back.
    h.store.undo();
    assert.equal(h.store.all().length, 0, 'undone in one step');
    h.store.redo();
    assert.equal(h.store.get(m.id)?.type, type, 'redone');
    await h.store.destroy();
  });
}

test('a tiny drag or stray click does not leave an empty shape', async () => {
  const h = await setup();
  h.tools.setTool('rect');
  click(h.tools, [100, 100]);
  h.tools.setTool('polygon');
  click(h.tools, [100, 100]);
  click(h.tools, [150, 100]);
  h.tools.finish();
  assert.equal(h.store.all().length, 0);
  await h.store.destroy();
});

test('Escape (cancel) drops a shape still being drawn', async () => {
  const h = await setup();
  h.tools.setTool('polyline');
  click(h.tools, [100, 100]);
  click(h.tools, [200, 100]);
  h.tools.cancel();
  h.tools.finish();
  assert.equal(h.store.all().length, 0);
  await h.store.destroy();
});

test('clicking back on the first point closes a polygon', async () => {
  const h = await setup();
  h.tools.setTool('area');
  for (const p of [[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]] as Point[]) click(h.tools, p);
  const [m] = h.store.all();
  assert.equal(m?.type, 'area');
  assert.equal(m?.points.length, 4, 'closed without repeating the first point');
  await h.store.destroy();
});

test('select, move and delete a drawn markup', async () => {
  const h = await setup();
  await drawWith(h, 'rect');
  const [m] = h.store.all();
  h.tools.setTool('select');
  // Grab it by its edge and drag it 50 right, 20 down.
  drag(h.tools, [100, 250], [150, 270]);
  assert.deepEqual(h.tools.getState().selected, new Set([m!.id]), 'selected');
  assert.deepEqual(h.store.get(m!.id)?.points, [[150, 220], [310, 320]], 'moved with the pointer');
  h.store.undo();
  assert.deepEqual(h.store.get(m!.id)?.points, [[100, 200], [260, 300]], 'move undone');
  h.tools.select([m!.id]);
  h.tools.deleteSelected();
  assert.equal(h.store.all().length, 0, 'deleted');
  await h.store.destroy();
});

test('copy and paste makes a new markup; group moves together; lock stops edits', async () => {
  const h = await setup();
  await drawWith(h, 'cloud');
  await drawWith(h, 'arrow');
  const [a, b] = h.store.all();
  h.tools.select([a!.id]);
  const copied = h.tools.copySelected();
  h.tools.paste(copied, 0, [400, 500]);
  assert.equal(h.store.all().length, 3);
  const pasted = h.store.all().find((m) => m.id !== a!.id && m.id !== b!.id)!;
  assert.equal(pasted.type, 'cloud');
  assert.notEqual(pasted.id, a!.id);

  h.tools.select([a!.id, b!.id]);
  h.tools.group();
  assert.ok(h.store.get(a!.id)?.groupId && h.store.get(a!.id)?.groupId === h.store.get(b!.id)?.groupId, 'grouped');
  h.tools.select([]);
  h.tools.setTool('select');
  // Selecting one selects the group; moving moves both.
  drag(h.tools, [100, 250], [110, 250]);
  assert.equal(h.store.get(a!.id)?.points[0]?.[0], 110);
  assert.equal(h.store.get(b!.id)?.points[0]?.[0], 110);

  h.tools.select([pasted.id]);
  h.tools.setLocked(true);
  assert.equal(h.store.get(pasted.id)?.locked, true);
  h.tools.deleteSelected();
  assert.ok(h.store.get(pasted.id), 'a locked markup is not deleted');
  await h.store.destroy();
});

test('restyling the selection changes only it, as one undo step', async () => {
  const h = await setup();
  await drawWith(h, 'rect');
  await drawWith(h, 'ellipse');
  const [a, b] = h.store.all();
  h.tools.select([a!.id]);
  h.tools.applyStyle([a!.id], { stroke: '#00ff00', width: 4, dash: 'dashed' });
  assert.equal(h.store.get(a!.id)?.style.stroke, '#00ff00');
  assert.equal(h.store.get(a!.id)?.style.dash, 'dashed');
  assert.equal(h.store.get(b!.id)?.style.stroke, DEFAULT_STYLES.ellipse.stroke);
  h.store.undo();
  assert.equal(h.store.get(a!.id)?.style.stroke, DEFAULT_STYLES.rect.stroke);
  await h.store.destroy();
});

test('a read-only document draws nothing', async () => {
  const h = await setup();
  h.store.setReadOnly(true);
  for (const type of ['rect', 'pen', 'length', 'note'] as const) await drawWith(h, type);
  h.tools.finish();
  assert.equal(h.store.all().length, 0);
  await h.store.destroy();
});
