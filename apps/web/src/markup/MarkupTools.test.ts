// Drawing with every markup tool as a user would: pick the tool, press, drag or click on the page,
// and check the markup that lands in the store. Then the editing features on drawn markups: select,
// move, delete, copy and paste, group, lock, restyle and undo. The page is a fake viewer at zoom 1,
// so page points and screen pixels are the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METERS_PER_UNIT } from '@nb/measure';
import { DEFAULT_STAMPS, DEFAULT_STYLES, MARKUP_TYPES, MarkupStore, TYPE_INFO, boundsOf, type Markup, type MarkupType, type Point, type WordBox } from '@nb/markup';
import type { TileViewer } from '../viewer/TileViewer';
import { settings } from '../settings/settings';
import type { MarkupTools as Tools, MarkupToolsOptions, TableDraft } from './MarkupTools';

// MarkupTools listens on `window` for modifier keys when it loads.
type WinListener = (e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; key?: string; repeat?: boolean }) => void;
const windowListeners = new Map<string, Set<WinListener>>();
(globalThis as { window?: unknown }).window ??= {
  addEventListener(type: string, fn: WinListener) {
    let set = windowListeners.get(type);
    if (!set) windowListeners.set(type, (set = new Set()));
    set.add(fn);
  },
  removeEventListener(type: string, fn: WinListener) {
    windowListeners.get(type)?.delete(fn);
  },
};
const { MarkupTools } = await import('./MarkupTools');

/** Presses or releases Ctrl the way the page tracks modifier keys (hover has no event of its own). */
function holdCtrl(down: boolean) {
  const e = { shiftKey: false, altKey: false, ctrlKey: down, metaKey: false, key: 'Control', repeat: false };
  for (const fn of windowListeners.get(down ? 'keydown' : 'keyup') ?? []) fn(e);
}

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
  refreshPointerCursor() {},
} as unknown as TileViewer;

/** A line of PDF text across the top of the page, for the text markup tools. */
const WORDS: WordBox[] = ['GENERAL', 'NOTES', 'APPLY', 'TO', 'ALL', 'SHEETS'].map((text, i) => ({ text, x0: 50 + i * 60, y0: 100, x1: 100 + i * 60, y1: 112 }));

function pointer(extra: Partial<PointerEvent> = {}): PointerEvent {
  return { button: 0, buttons: 1, pointerType: 'mouse', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, detail: 1, preventDefault() {}, stopPropagation() {}, ...extra } as PointerEvent;
}

async function setup(extra: Partial<MarkupToolsOptions> = {}) {
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
    ...extra,
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

test('a box has grips on its corners and the middles of its edges', async () => {
  const h = await setup();
  await drawWith(h, 'rect'); // corners (100, 200) and (260, 300)
  const [m] = h.store.all();
  h.tools.setTool('select');
  h.tools.select([m!.id]);
  // The middle of the right edge moves only that edge.
  drag(h.tools, [260, 250], [300, 270]);
  assert.deepEqual(h.store.get(m!.id)?.points, [[100, 200], [300, 300]]);
  // The middle of the top edge likewise.
  drag(h.tools, [200, 200], [210, 180]);
  assert.deepEqual(h.store.get(m!.id)?.points, [[100, 180], [300, 300]]);
  // The corner that is neither of the two it was drawn by moves two edges.
  drag(h.tools, [300, 180], [320, 170]);
  assert.deepEqual(h.store.get(m!.id)?.points, [[100, 170], [320, 300]]);
  await h.store.destroy();
});

test('a turned box resizes from a grip with the grip across from it staying put', async () => {
  const h = await setup();
  await drawWith(h, 'rect'); // 160 wide, 100 high, centre (180, 250)
  const [m] = h.store.all();
  h.store.update(m!.id, { rotation: 90 });
  h.tools.setTool('select');
  h.tools.select([m!.id]);
  // Turned a quarter clockwise, the box's right edge middle (260, 250) sits at (180, 330).
  // Dragging it 20 further along the box's own axis (down on the page) lengthens it by 20.
  drag(h.tools, [180, 330], [180, 350]);
  const after = h.store.get(m!.id)!;
  const [a, b] = after.points as [Point, Point];
  assert.equal(Math.round(b[0] - a[0]), 180, 'wider by 20');
  assert.equal(Math.round(b[1] - a[1]), 100, 'same height');
  // The left edge middle stayed at (180, 170) on the page.
  const c: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const left: Point = [a[0], c[1]];
  const dx = left[0] - c[0];
  const dy = left[1] - c[1];
  assert.ok(Math.abs(c[0] - dy + 0 - 180) < 1e-6 && Math.abs(c[1] + dx - 170) < 1e-6, 'the opposite edge did not move');
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

test('Set as Default on a text highlight is what the next Highlight uses', async () => {
  const h = await setup();
  h.tools.setTool('highlighter');
  await settle();
  drag(h.tools, [50, 106], [160, 106]);
  const first = h.store.all()[0]!;
  h.store.update(first.id, { style: { ...first.style, stroke: '#a855f7', opacity: 0.5 } });
  h.tools.setDefaultStyle('textHighlight', h.store.get(first.id)!.style);

  drag(h.tools, [50, 106], [160, 106]);
  const second = h.store.all().find((m) => m.id !== first.id)!;
  assert.equal(second.type, 'textHighlight');
  assert.equal(second.style.stroke, '#a855f7');
  assert.equal(second.style.opacity, 0.5);
});

test('the highlighter marks words under the pointer and draws a stroke everywhere else', async () => {
  const h = await setup();
  h.tools.setTool('highlighter');
  h.tools.setStyle('highlighter', { stroke: '#22c55e', opacity: 0.55 });
  await settle();

  assert.equal(h.tools.hover([50, 106], 0), 'text', 'text cursor over a word');
  assert.equal(h.tools.hover([100, 200], 0), 'crosshair', 'crosshair off the text');
  holdCtrl(true);
  try {
    assert.equal(h.tools.hover([50, 106], 0), 'crosshair', 'Ctrl draws freely, so the cursor is a crosshair on text too');
  } finally {
    holdCtrl(false);
  }
  assert.equal(h.tools.hover([50, 106], 0), 'text');

  drag(h.tools, [50, 106], [160, 106]);
  const text = h.store.all()[0]!;
  assert.equal(text.type, 'textHighlight');
  assert.equal(text.comment, 'GENERAL NOTES');
  assert.equal(text.style.stroke, '#22c55e', 'uses the Highlight colour');
  assert.equal(text.style.opacity, 0.55);
  assert.equal(text.style.width, DEFAULT_STYLES.textHighlight.width, 'a text highlight is not a wide stroke');
  const b = boundsOf(text.points);
  assert.ok(b.x <= 50.5 && b.x + b.w >= 159.5 && b.y <= 101 && b.y + b.h >= 111);

  // Starting off the text stays a stroke, even when the drag ends on a word.
  drag(h.tools, [100, 200], [80, 106]);
  const stroke = h.store.all().find((m) => m.id !== text.id)!;
  assert.equal(stroke.type, 'highlighter');
  assert.equal(stroke.style.stroke, '#22c55e');
  assert.equal(stroke.style.width, DEFAULT_STYLES.highlighter.width);
  assert.ok(stroke.points.length >= 2 && stroke.points[0]![1] === 200);

  h.store.remove([stroke.id]);
  drag(h.tools, [50, 106], [160, 106], { ctrlKey: true });
  const free = h.store.all().find((m) => m.id !== text.id)!;
  assert.equal(free.type, 'highlighter', 'Ctrl draws a stroke over the words');
  assert.ok(free.points.length >= 2 && free.points[0]![1] === 106);

  h.store.undo();
  assert.equal(h.store.get(free.id), undefined, 'the stroke is one undo step');
  assert.ok(h.store.get(text.id), 'the text highlight stays');
  await h.store.destroy();
});

test('a highlight drag that starts before the page text loads still marks the words', async () => {
  const h = await setup();
  let deliver: (words: readonly WordBox[]) => void = () => {};
  h.tools.setTextSource(() => new Promise((resolve) => { deliver = resolve; }));
  h.tools.setTool('highlighter');
  press(h.tools, [50, 106]);
  move(h.tools, [160, 106]);
  assert.equal(h.store.all().length, 0, 'nothing is committed while the words are loading');
  deliver(WORDS);
  await settle();
  release(h.tools, [160, 106]);
  const [m] = h.store.all();
  assert.equal(m?.type, 'textHighlight');
  assert.equal(m?.comment, 'GENERAL NOTES');

  let deliverOff: (words: readonly WordBox[]) => void = () => {};
  h.tools.setTextSource(() => new Promise((resolve) => { deliverOff = resolve; }));
  press(h.tools, [100, 200]);
  move(h.tools, [150, 220]);
  deliverOff(WORDS);
  await settle();
  release(h.tools, [180, 240]);
  const off = h.store.all().find((markup) => markup.id !== m?.id);
  assert.equal(off?.type, 'highlighter', 'a drag that began off the text stays a stroke once the words arrive');
  await h.store.destroy();
});

test('placeCloudPlus writes a grouped cloud and callout in one undo step', async () => {
  const h = await setup();
  const { cloud, callout } = h.tools.placeCloudPlus(0, [[10, 20], [80, 90]], { text: 'Check', subject: 'Cloud+' });
  assert.equal(cloud.type, 'cloud');
  assert.equal(callout.type, 'callout');
  assert.equal(callout.text, 'Check');
  assert.ok(cloud.groupId && cloud.groupId === callout.groupId);
  assert.equal(callout.subject, 'Cloud+');
  assert.equal(h.store.all().length, 2);
  assert.equal(h.created.at(-1)?.id, cloud.id);
  h.store.undo();
  assert.equal(h.store.all().length, 0);
  await h.store.destroy();
});

test('a Cloud+ keeps the grips of its cloud and its callout, and a grip drags only its own markup', async () => {
  const h = await setup();
  const { cloud, callout } = h.tools.placeCloudPlus(0, [[100, 200], [300, 300]]);
  h.tools.setTool('select');
  h.tools.select([cloud.id]); // selecting one member selects the group
  assert.equal(h.tools.getState().selected.size, 2);
  // The cloud's bottom-left corner (a grip neither of the two defining corners).
  drag(h.tools, [100, 300], [80, 320]);
  assert.deepEqual(h.store.get(cloud.id)?.points, [[80, 200], [300, 320]]);
  // The callout's box moved nothing.
  assert.deepEqual(h.store.get(callout.id)?.points, callout.points);
  // A callout's arrow tip is a grip too.
  const tip = callout.points[0]!;
  drag(h.tools, [tip[0], tip[1]], [tip[0] + 10, tip[1] - 10]);
  assert.deepEqual(h.store.get(callout.id)?.points[0], [tip[0] + 10, tip[1] - 10]);
  assert.deepEqual(h.store.get(cloud.id)?.points, [[80, 200], [300, 320]]);
  await h.store.destroy();
});

test('place writes one markup and undo removes it', async () => {
  const h = await setup();
  const placed = h.tools.place('rect', 0, [[10, 20], [80, 90]], { text: 'A' });
  assert.equal(h.store.all().length, 1);
  assert.equal(placed.text, 'A');
  assert.equal(h.store.get(placed.id)?.author, 'Tester');
  assert.equal(h.created.at(-1)?.id, placed.id);
  h.store.undo();
  assert.equal(h.store.all().length, 0);
  await h.store.destroy();
});

test('the Table tool asks for its rows and columns, then places the table as one undo step', async () => {
  const asked: TableDraft[] = [];
  const h = await setup({ onNewTable: (d) => asked.push(d) });
  h.tools.setTool('table');
  drag(h.tools, [100, 200], [400, 320]);
  assert.equal(asked.length, 1, 'asked once');
  assert.equal(h.store.all().length, 0, 'nothing is placed until the size is chosen');
  const m = h.tools.addTable(asked[0]!, 4, 2)!;
  assert.deepEqual([m.table!.rows.length, m.table!.cols.length], [4, 2]);
  assert.deepEqual(boundsOf(m.points), { x: 100, y: 200, w: 300, h: 120 }, 'a dragged box is divided into equal cells');
  assert.deepEqual([...h.tools.getState().selected], [m.id]);
  assert.deepEqual(h.created.map((c) => c.id), [m.id]);
  h.store.undo();
  assert.equal(h.store.all().length, 0);
  await h.store.destroy();
});

test('a click with the Table tool gives each cell a comfortable size, and cancelling places nothing', async () => {
  const asked: TableDraft[] = [];
  const h = await setup({ onNewTable: (d) => asked.push(d) });
  h.tools.setTool('table');
  click(h.tools, [100, 200]);
  assert.equal(asked.length, 1);
  assert.ok(asked[0]!.tiny);
  assert.equal(h.store.all().length, 0, 'closing the dialog leaves nothing behind');
  const m = h.tools.addTable(asked[0]!, 2, 3)!;
  const b = boundsOf(m.points);
  assert.deepEqual([b.x, b.y], [100, 200]);
  assert.ok(b.w > 100 && b.h > 30 && b.w > b.h, 'wider than tall for 3 columns by 2 rows');
  await h.store.destroy();
});

test('double-clicking a table cell edits that cell', async () => {
  const edited: { id: string; row: number; col: number }[] = [];
  const h = await setup({ onEditTableCell: (id, row, col) => edited.push({ id, row, col }) });
  h.tools.setTool('table');
  drag(h.tools, [100, 200], [400, 320]);
  const m = h.store.all()[0]!;
  assert.equal(m.table?.rows.length, 3, 'three by three when nothing asks');
  h.tools.setTool('select');
  h.tools.doubleClick([350, 310], 0);
  assert.deepEqual(edited, [{ id: m.id, row: 2, col: 2 }]);
  await h.store.destroy();
});

/** A drawn 3 by 3 table, 100 wide and 40 tall per cell from (100, 200), selected with the Select tool. */
async function tableHarness(extra: Partial<MarkupToolsOptions> = {}) {
  const h = await setup(extra);
  h.tools.setTool('table');
  drag(h.tools, [100, 200], [400, 320]);
  h.tools.setTool('select');
  const m = h.store.all()[0]!;
  h.tools.select([m.id]);
  return { ...h, id: m.id, table: () => h.store.get(m.id)!.table! };
}

test('a click on a table cell selects that cell, and dragging across cells selects a block', async () => {
  const h = await tableHarness();
  click(h.tools, [250, 300]);
  assert.deepEqual(h.tools.getState().tableCells, { id: h.id, anchor: { row: 2, col: 1 }, focus: { row: 2, col: 1 } });
  drag(h.tools, [150, 220], [250, 260]);
  const sel = h.tools.getState().tableCells!;
  assert.deepEqual([sel.anchor, sel.focus], [{ row: 0, col: 0 }, { row: 1, col: 1 }]);
  assert.deepEqual(h.tools.tableSelection()!.range, { row: 0, col: 0, rowSpan: 2, colSpan: 2 });
  assert.deepEqual(boundsOf(h.store.get(h.id)!.points), { x: 100, y: 200, w: 300, h: 120 }, 'selecting cells does not move the table');
  h.tools.select([]);
  assert.equal(h.tools.getState().tableCells, null, 'deselecting the table drops its cells');
  await h.store.destroy();
});

test('the first press on a table selects it and its cell, and dragging then moves the table', async () => {
  const h = await tableHarness();
  h.tools.select([]);
  drag(h.tools, [150, 220], [170, 240]);
  assert.deepEqual(boundsOf(h.store.get(h.id)!.points), { x: 120, y: 220, w: 300, h: 120 });
  assert.deepEqual(h.tools.getState().tableCells?.anchor, { row: 0, col: 0 });
  await h.store.destroy();
});

test('a selected table moves by its outer edge', async () => {
  const h = await tableHarness();
  drag(h.tools, [100, 250], [130, 250]);
  assert.deepEqual(boundsOf(h.store.get(h.id)!.points), { x: 130, y: 200, w: 300, h: 120 });
  await h.store.destroy();
});

test('dragging a column or row line resizes the cells either side as one undo step', async () => {
  const h = await tableHarness();
  drag(h.tools, [200, 300], [250, 300]);
  assert.deepEqual(tableOfCols(h.table()), [150, 50, 100]);
  drag(h.tools, [350, 280], [350, 250]);
  assert.deepEqual(h.table().rows, [1, 0.25, 1.75]);
  assert.deepEqual(boundsOf(h.store.get(h.id)!.points), { x: 100, y: 200, w: 300, h: 120 }, 'the table keeps its size');
  h.store.undo();
  assert.deepEqual(h.table().rows, [1, 1, 1]);
  assert.deepEqual(tableOfCols(h.table()), [150, 50, 100]);
  await h.store.destroy();
});

test('a line stops short of squashing the cell beside it', async () => {
  const h = await tableHarness();
  drag(h.tools, [200, 300], [999, 300]);
  assert.deepEqual(tableOfCols(h.table()), [196, 4, 100]);
  await h.store.destroy();
});

test('selected cells merge into one and split again', async () => {
  const h = await tableHarness();
  assert.equal(h.tools.canMergeCells(), false, 'no cells are selected yet');
  drag(h.tools, [150, 220], [250, 260]);
  assert.equal(h.tools.canMergeCells(), true);
  assert.equal(h.tools.canSplitCells(), false);
  assert.equal(h.tools.mergeSelectedCells(), true);
  assert.deepEqual(h.table().merges, [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }]);
  assert.deepEqual(h.tools.getState().tableCells?.focus, { row: 0, col: 0 }, 'the merged cell is what stays selected');
  assert.equal(h.tools.canSplitCells(), true);
  assert.equal(h.tools.canMergeCells(), false, 'one merged cell is already one');
  click(h.tools, [250, 260]);
  assert.deepEqual(h.tools.getState().tableCells?.anchor, { row: 0, col: 0 }, 'any part of a merged cell selects it');
  assert.equal(h.tools.splitSelectedCells(), true);
  assert.equal(h.table().merges, undefined);
  h.store.undo();
  assert.equal(h.table().merges?.length, 1);
  await h.store.destroy();
});

test('typing on a selected cell edits it, and Enter or F2 edit it without replacing its text', async () => {
  const edited: { row: number; col: number; text?: string }[] = [];
  const h = await tableHarness({ onEditTableCell: (_id, row, col, text) => edited.push({ row, col, text }) });
  assert.equal(h.tools.editSelectedCell('x'), false, 'no cell is selected until one is clicked');
  click(h.tools, [350, 220]);
  assert.equal(h.tools.editSelectedCell('q'), true);
  assert.equal(h.tools.editSelectedCell(), true);
  assert.deepEqual(edited.slice(-2), [{ row: 0, col: 2, text: 'q' }, { row: 0, col: 2, text: undefined }]);
  await h.store.destroy();
});

test('a locked table lets its cells be selected but not merged or resized', async () => {
  const h = await tableHarness();
  h.store.update(h.id, { locked: true });
  drag(h.tools, [150, 220], [250, 260]);
  assert.equal(h.tools.mergeSelectedCells(), false);
  drag(h.tools, [200, 300], [250, 300]);
  assert.deepEqual(h.table().cols, [1, 1, 1]);
  await h.store.destroy();
});

const tableOfCols = (t: { cols: number[] }) => t.cols.map((n) => Math.round((n / t.cols.reduce((a, b) => a + b, 0)) * 300));

test('font settings go to the selected cells only, as in a spreadsheet', async () => {
  const h = await tableHarness();
  const before = h.store.get(h.id)!.style;
  drag(h.tools, [150, 220], [250, 260]);
  h.tools.applyCellStyle({ fontSize: 22, bold: true, textColor: '#ff0000', fill: '#ffff00' });
  const formats = h.table().formats!;
  assert.deepEqual(Object.keys(formats).sort(), ['0,0', '0,1', '1,0', '1,1']);
  assert.deepEqual(formats['1,1'], { fontSize: 22, bold: true, textColor: '#ff0000', fill: '#ffff00' });
  assert.deepEqual(h.store.get(h.id)!.style, before, 'the table itself is unchanged');
  assert.equal(h.tools.selectedCellStyle()!.fontSize, 22, 'the controls show the selected cell');
  h.store.undo();
  assert.equal(h.table().formats, undefined);
  await h.store.destroy();
});

test('the toolbar font controls follow the selected cells and leave the tool defaults alone', async () => {
  const h = await tableHarness();
  const defaults = h.tools.getState().styles.table;
  const size = h.store.get(h.id)!.style.fontSize;
  click(h.tools, [250, 300]);
  h.tools.setStyle('table', { fontFamily: 'serif', fontSize: 30 });
  assert.deepEqual(h.table().formats, { '2,1': { fontFamily: 'serif', fontSize: 30 } });
  assert.equal(h.store.get(h.id)!.style.fontSize, size, 'the table keeps its own size');
  assert.deepEqual(h.tools.getState().styles.table, defaults);
  await h.store.destroy();
});

test('a text setting for the whole table takes it off cells that had their own, and cell formatting can be cleared', async () => {
  const h = await tableHarness();
  click(h.tools, [250, 300]);
  h.tools.applyCellStyle({ fontSize: 30, fill: '#eeeeee' });
  h.tools.applyStyle([h.id], { fontSize: 9 });
  assert.deepEqual(h.table().formats, { '2,1': { fill: '#eeeeee' } }, 'its size goes, its background stays');
  assert.equal(h.store.get(h.id)!.style.fontSize, 9);
  h.tools.clearCellFormatting();
  assert.equal(h.table().formats, undefined);
  await h.store.destroy();
});

test('cells of a locked table cannot be formatted', async () => {
  const h = await tableHarness();
  click(h.tools, [250, 300]);
  h.store.update(h.id, { locked: true });
  h.tools.applyCellStyle({ bold: true });
  assert.equal(h.table().formats, undefined);
  await h.store.destroy();
});

test('drawing snaps to every corner and side middle of a box, and to a circle centre', async () => {
  const h = await setup();
  await drawWith(h, 'rect'); // (100, 200) to (260, 300)
  arm(h, 'ellipse');
  drag(h.tools, [300, 200], [400, 300]); // centre (350, 250)
  h.tools.setTool('line');
  // Pressed a little off the top-right corner, the right side's middle and the circle's centre.
  drag(h.tools, [262, 198], [258, 252]);
  drag(h.tools, [180, 302], [352, 248]);
  const lines = h.store.all().filter((m) => m.type === 'line');
  assert.deepEqual(lines[0]!.points, [[260, 200], [260, 250]]);
  assert.deepEqual(lines[1]!.points, [[180, 300], [350, 250]]);
  await h.store.destroy();
});

test("a length's text drags off the line (taking the line with it), along it, and turns", async () => {
  const h = await setup();
  arm(h, 'length');
  click(h.tools, [100, 200]);
  click(h.tools, [260, 200]);
  const [m] = h.store.all();
  h.tools.setTool('select');
  h.tools.select([m!.id]);
  // The text sits on the middle of the line; drag it 30 up and 100 right, past the end.
  drag(h.tools, [180, 200], [280, 170]);
  let style = h.store.get(m!.id)!.style;
  assert.equal(style.leader, -30, 'the dimension line moved out with the text');
  assert.equal(style.labelOffset, 100, 'slid along past the end');
  // Its turn knob sits above it; pointing right turns it a quarter.
  const knob: Point = [280, 170 - 7 - 14];
  drag(h.tools, knob, [320, 170]);
  style = h.store.get(m!.id)!.style;
  assert.equal(style.labelRotation, 90);
  h.store.undo();
  assert.equal(h.store.get(m!.id)!.style.labelRotation, undefined, 'turn undone');
  await h.store.destroy();
});

const rest = () => new Promise((r) => setTimeout(r, 450));

test('object snap tracking: rest on a corner, move away, and the point lines up with it', async () => {
  const h = await setup();
  await drawWith(h, 'rect'); // (100, 200) to (260, 300)
  h.tools.setTool('line');
  // Rest on the top-right corner until it is picked up.
  h.tools.hover([261, 201], 0);
  await rest();
  // Well below it, a little to the side: the line starts straight under the corner.
  drag(h.tools, [263, 420], [400, 420]);
  const line = h.store.all().find((m) => m.type === 'line')!;
  assert.deepEqual(line.points[0], [260, 420]);
  await h.store.destroy();
});

test('two picked-up points line the pointer up with both at once, and polar tracking follows angles', async () => {
  const h = await setup();
  await drawWith(h, 'rect'); // (100, 200) to (260, 300)
  arm(h, 'line');
  drag(h.tools, [400, 100], [450, 150]);
  arm(h, 'length');
  h.tools.hover([100, 200], 0);
  await rest();
  h.tools.hover([450, 150], 0);
  await rest();
  // Under the line's end and level with the box's corner.
  click(h.tools, [447, 204]);
  const g = h.tools.getState().measuring;
  assert.ok(g, 'measuring');
  // Polar tracking (45° steps) from that point: up and to the right.
  settings.set({ polarTracking: true, polarAngle: 45 });
  try {
    click(h.tools, [530, 122]);
  } finally {
    settings.set({ polarTracking: false });
  }
  const length = h.store.all().find((m) => m.type === 'length')!;
  assert.deepEqual(length.points[0], [450, 200]);
  const [a, b] = length.points as [Point, Point];
  assert.ok(Math.abs(b[0] - a[0] + (b[1] - a[1])) < 1e-6, `at 45°: ${JSON.stringify(b)}`);
  await h.store.destroy();
});

test('Scale to Length: two points on a markup are made a typed length, or the length between two picked points', async () => {
  const asked: Point[][] = [];
  const h = await setup({ onScaleToLength: (_page, points) => asked.push(points) });
  await drawWith(h, 'rect'); // (100, 200) to (260, 300)
  const [m] = h.store.all();
  h.tools.setTool('scaleLength');
  // Nothing selected: the first click picks the markup.
  click(h.tools, [100, 250]);
  assert.deepEqual(h.tools.getState().selected, new Set([m!.id]));
  // The reference: the box's top edge, from its left end (which stays put).
  click(h.tools, [101, 201]);
  click(h.tools, [259, 199]);
  assert.deepEqual(asked, [[[100, 200], [260, 200]]], 'asked for the new length');
  h.tools.scaleSelectionBy(0.5);
  assert.deepEqual(h.store.get(m!.id)!.points, [[100, 200], [180, 250]]);
  assert.equal(h.tools.getState().tool, 'select');
  h.store.undo();
  assert.deepEqual(h.store.get(m!.id)!.points, [[100, 200], [260, 300]], 'one undo step');

  // Picking the new length on the page: twice as long as the reference.
  h.tools.setTool('scaleLength');
  click(h.tools, [101, 201]);
  click(h.tools, [259, 199]);
  h.tools.pickScaleTarget();
  click(h.tools, [0, 500]);
  click(h.tools, [320, 500]);
  assert.deepEqual(h.store.get(m!.id)!.points, [[100, 200], [420, 400]]);
  await h.store.destroy();
});

test('Scale to Length and measuring ask for a page scale first on a page without one', async () => {
  const needed: string[] = [];
  const asked: Point[][] = [];
  const h = await setup({ onScaleRequired: (page, tool) => needed.push(`${page}:${tool}`), onScaleToLength: (_page, points) => asked.push(points) });
  await drawWith(h, 'rect'); // (100, 200) to (260, 300)
  const [m] = h.store.all();
  h.tools.select([m!.id]);
  h.tools.setTool('scaleLength');
  click(h.tools, [101, 201]);
  click(h.tools, [259, 199]);
  assert.deepEqual(asked, [], 'no scaling without a scale');
  h.tools.setTool('length');
  click(h.tools, [0, 0]);
  click(h.tools, [100, 0]);
  assert.equal(h.store.all().filter((s) => s.type === 'length').length, 0, 'nothing measured');
  assert.deepEqual(needed, ['0:scaleLength', '0:scaleLength', '0:length', '0:length']);
  assert.equal(h.tools.getState().tool, 'length', 'the tool stays armed');
  // Angles and counts have no length, so they need no scale.
  h.tools.setTool('count');
  click(h.tools, [50, 50]);
  assert.equal(needed.length, 4);

  // With the page's scale set, both work.
  h.store.setScale([0], { metersPerPoint: 0.01, unit: 'm', label: '1:100' } as Parameters<typeof h.store.setScale>[1]);
  h.tools.setTool('length');
  click(h.tools, [0, 0]);
  click(h.tools, [100, 0]);
  assert.equal(h.store.all().filter((s) => s.type === 'length').length, 1, 'measured');
  h.tools.select([m!.id]);
  h.tools.setTool('scaleLength');
  click(h.tools, [101, 201]);
  click(h.tools, [259, 199]);
  assert.equal(asked.length, 1, 'asked for the new length');
  assert.equal(needed.length, 4);
  await h.store.destroy();
});

test('Offset: picks a markup with nothing selected, then makes copies at a typed distance on the clicked side', async () => {
  const h = await setup();
  await drawWith(h, 'rect'); // (100, 200) to (260, 300)
  const [m] = h.store.all();
  h.tools.select([]);
  h.tools.setTool('offset');
  assert.equal(h.tools.getState().painterSource, null);
  click(h.tools, [100, 250]);
  assert.equal(h.tools.getState().painterSource?.id, m!.id, 'the click picked the box');

  // A unit-free typed distance is in the page's units: three copies outward, each 2 units further.
  const scale = h.store.scaleFor(0);
  const step = (METERS_PER_UNIT[scale.unit] / scale.metersPerPoint) * 2;
  settings.set({ offsetDistance: '2', offsetCount: 3 });
  try {
    click(h.tools, [300, 250]);
    const copies = h.store.all().filter((x) => x.id !== m!.id);
    assert.equal(copies.length, 3);
    const lefts = copies.map((c) => boundsOf(c.points).x).sort((a, b) => b - a);
    lefts.forEach((x, k) => assert.ok(Math.abs(x - (100 - step * (k + 1))) < 1e-6));
    assert.equal(h.tools.getState().tool, 'offset', 'the tool stays on for the next pick');
    assert.equal(h.tools.getState().painterSource, null);
    h.store.undo();
    assert.equal(h.store.all().length, 1, 'one undo step');
  } finally {
    settings.set({ offsetDistance: '', offsetCount: 1 });
  }

  // No distance: the copy goes through the clicked point, here inside the box.
  click(h.tools, [100, 250]);
  click(h.tools, [120, 250]);
  const inner = h.store.all().find((x) => x.id !== m!.id)!;
  assert.deepEqual(inner.points, [[120, 220], [240, 280]]);
});

/** Puts a markup on page 1 directly, as if drawn. */
function put(h: Harness, type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  const m: Markup = { id: crypto.randomUUID(), type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: 'Tester', createdAt: 0, modifiedAt: 0, ...extra };
  h.store.add(m);
  return h.store.get(m.id)!;
}

test('Trim and Extend: cut a line at the lines crossing it, or carry it on to the next', async () => {
  const h = await setup();
  const line = put(h, 'line', [[0, 300], [400, 300]]);
  put(h, 'line', [[100, 200], [100, 400]]);
  put(h, 'line', [[300, 200], [300, 400]]);
  h.tools.setTool('trim');
  click(h.tools, [200, 301]);
  const pieces = h.store.all().filter((m) => m.points.every(([, y]) => y === 300));
  assert.deepEqual(pieces.map((m) => m.points).sort((a, b) => a[0]![0] - b[0]![0]), [[[0, 300], [100, 300]], [[300, 300], [400, 300]]]);
  assert.equal(h.tools.getState().tool, 'trim', 'stays on for the next cut');
  h.store.undo();
  assert.deepEqual(h.store.get(line.id)!.points, [[0, 300], [400, 300]], 'one undo step');

  // Clicking where nothing crosses says so and changes nothing.
  const short = put(h, 'line', [[150, 500], [250, 500]]);
  click(h.tools, [200, 500]);
  assert.match(h.tools.getState().cad?.error ?? '', /Nothing crosses/);
  h.tools.setTool('extend');
  click(h.tools, [245, 500]);
  assert.match(h.tools.getState().cad?.error ?? '', /Nothing lies ahead/);
  const stub = put(h, 'line', [[150, 250], [250, 250]]);
  click(h.tools, [245, 250]);
  assert.deepEqual(h.store.get(stub.id)!.points, [[150, 250], [300, 250]]);
  assert.ok(h.store.get(short.id));
});

test('Fillet: two lines meet at their corner, rounded by an arc when a radius is set', async () => {
  const h = await setup();
  const a = put(h, 'line', [[100, 100], [180, 100]]);
  const b = put(h, 'line', [[200, 200], [200, 120]]);
  h.tools.setTool('fillet');
  click(h.tools, [140, 100]);
  assert.equal(h.tools.getState().cad?.picks, 1);
  click(h.tools, [200, 160]);
  assert.deepEqual(h.store.get(a.id)!.points, [[100, 100], [200, 100]]);
  assert.deepEqual(h.store.get(b.id)!.points, [[200, 200], [200, 100]]);
  h.store.undo();
  settings.set({ filletRadius: '20' });
  try {
    // A unit-free radius is in the page's units; make it 20 pt whatever they are.
    const scale = h.store.scaleFor(0);
    settings.set({ filletRadius: String((20 * scale.metersPerPoint) / METERS_PER_UNIT[scale.unit]) });
    click(h.tools, [140, 100]);
    click(h.tools, [200, 160]);
    const arc = h.store.all().find((m) => m.type === 'arc')!;
    assert.ok(arc, 'an arc joins them');
    assert.ok(Math.abs(h.store.get(a.id)!.points[1]![0] - 180) < 1e-6);
    assert.ok(Math.abs(h.store.get(b.id)!.points[1]![1] - 120) < 1e-6);
  } finally {
    settings.set({ filletRadius: '' });
  }
});

test('Mirror copies the selection across a picked line; Escape steps back before leaving', async () => {
  const h = await setup();
  const r = put(h, 'polyline', [[100, 100], [150, 120], [120, 160]]);
  h.tools.setTool('mirror');
  // Nothing selected: the first click picks what to mirror.
  click(h.tools, [125, 110]);
  assert.deepEqual(h.tools.getState().selected, new Set([r.id]));
  click(h.tools, [200, 0]);
  h.tools.cancel();
  assert.equal(h.tools.getState().cad?.picks, 0, 'Escape dropped the first point');
  assert.equal(h.tools.getState().tool, 'mirror');
  click(h.tools, [200, 0]);
  click(h.tools, [200, 500]);
  const copy = h.store.all().find((m) => m.id !== r.id)!;
  assert.deepEqual(copy.points, [[300, 100], [250, 120], [280, 160]]);
  assert.equal(h.tools.getState().tool, 'select');
  assert.ok(h.tools.getState().selected.has(copy.id));
});

test('Rotate by a typed angle, Polar Array round a centre, Divide into a count', async () => {
  const h = await setup();
  const l = put(h, 'line', [[100, 100], [200, 100]]);
  h.tools.select([l.id]);
  settings.set({ rotateAngle: '90' });
  try {
    h.tools.setTool('rotateRef');
    click(h.tools, [100, 100]);
    // Counter-clockwise on paper: the far end goes up the page.
    const pts = h.store.get(l.id)!.points;
    assert.ok(Math.abs(pts[1]![0] - 100) < 1e-6 && Math.abs(pts[1]![1] - 0) < 1e-6);
  } finally {
    settings.set({ rotateAngle: '' });
  }
  h.tools.select([l.id]);
  settings.set({ arrayCount: 4, arrayAngle: 360 });
  h.tools.setTool('arrayPolar');
  click(h.tools, [100, 100]);
  assert.equal(h.store.all().filter((m) => m.type === 'line').length, 4);

  h.tools.setTool('divide');
  settings.set({ divideCount: 5 });
  try {
    const path = put(h, 'polyline', [[0, 600], [500, 600]]);
    click(h.tools, [250, 600]);
    const count = h.store.all().find((m) => m.type === 'count')!;
    assert.deepEqual(count.points, [[100, 600], [200, 600], [300, 600], [400, 600]]);
    assert.ok(h.store.get(path.id));
  } finally {
    settings.set({ divideCount: 4 });
  }
});

test('Stretch moves the points inside a crossing window', async () => {
  const h = await setup();
  const pl = put(h, 'polyline', [[100, 100], [200, 100], [200, 200]]);
  const box = put(h, 'rect', [[300, 100], [400, 200]]);
  h.tools.setTool('stretch');
  click(h.tools, [180, 80]);
  click(h.tools, [420, 220]);
  click(h.tools, [0, 0]);
  click(h.tools, [10, 0]);
  assert.deepEqual(h.store.get(pl.id)!.points, [[100, 100], [210, 100], [210, 200]]);
  assert.deepEqual(h.store.get(box.id)!.points, [[310, 100], [410, 200]], 'the box inside moved whole');
});

test('Join chains touching lines into a polyline or polygon; Explode splits it back into lines', async () => {
  const h = await setup();
  const a = put(h, 'line', [[0, 0], [100, 0]]);
  const b = put(h, 'line', [[100, 100], [100, 0]]);
  const c = put(h, 'polyline', [[100, 100], [0, 100], [0, 0]]);
  h.tools.select([a.id, b.id, c.id]);
  assert.equal(h.tools.joinSelected(), true);
  const all = h.store.all();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.type, 'polygon');
  assert.deepEqual(all[0]!.points, [[0, 0], [100, 0], [100, 100], [0, 100]]);
  assert.equal(h.tools.explodeSelected(), true);
  const lines = h.store.all();
  assert.equal(lines.length, 4);
  assert.ok(lines.every((m) => m.type === 'line' && m.points.length === 2));
  h.store.undo();
  assert.equal(h.store.all().length, 1, 'one undo step');
  // Lengths join into a measurement.
  const l1 = put(h, 'length', [[0, 300], [50, 300]]);
  const l2 = put(h, 'length', [[50, 300], [50, 350]]);
  h.tools.select([l1.id, l2.id]);
  h.tools.joinSelected();
  assert.equal(h.store.get(l1.id)!.type, 'polylength');
  assert.equal(h.store.get(l2.id), undefined);
});

test('Move and Copy by base point; Scale by a typed factor', async () => {
  const h = await setup();
  const l = put(h, 'line', [[100, 100], [200, 100]]);
  h.tools.select([l.id]);
  h.tools.setTool('move');
  click(h.tools, [100, 100]);
  click(h.tools, [150, 130]);
  assert.deepEqual(h.store.get(l.id)!.points, [[150, 130], [250, 130]]);
  assert.equal(h.tools.getState().tool, 'select');

  // Copy stays on from the same base, placing one copy per click.
  h.tools.setTool('copy');
  click(h.tools, [150, 130]);
  click(h.tools, [150, 200]);
  click(h.tools, [150, 300]);
  const copies = h.store.all().filter((m) => m.id !== l.id);
  assert.deepEqual(copies.map((m) => m.points[0]), [[150, 200], [150, 300]]);
  assert.deepEqual(h.tools.getState().selected, new Set([l.id]), 'the original stays selected');

  h.tools.setTool('scale');
  settings.set({ scaleFactor: '2' });
  try {
    click(h.tools, [150, 130]);
    assert.deepEqual(h.store.get(l.id)!.points, [[150, 130], [350, 130]]);
  } finally {
    settings.set({ scaleFactor: '' });
  }
});

test('Select Similar, Reverse and Convert to Cloud', async () => {
  const h = await setup();
  const a = put(h, 'arrow', [[0, 0], [10, 0]]);
  const b = put(h, 'arrow', [[0, 20], [10, 20]]);
  put(h, 'line', [[0, 40], [10, 40]]);
  const green = put(h, 'arrow', [[0, 60], [10, 60]], { style: { ...DEFAULT_STYLES.arrow, stroke: '#00ff00' } });
  h.tools.select([a.id]);
  h.tools.selectSimilar();
  assert.deepEqual(h.tools.getState().selected, new Set([a.id, b.id]), 'same type and colour only');
  assert.ok(!h.tools.getState().selected.has(green.id));

  h.tools.select([a.id]);
  assert.equal(h.tools.reverseSelected(), true);
  const rev = h.store.get(a.id)!;
  assert.deepEqual(rev.points, [[10, 0], [0, 0]]);
  assert.equal(rev.style.startCap, 'filledArrow');

  const poly = put(h, 'polygon', [[0, 100], [50, 100], [25, 150]]);
  const box = put(h, 'rect', [[100, 100], [150, 150]]);
  h.tools.select([poly.id, box.id]);
  assert.equal(h.tools.convertToCloud(), true);
  assert.equal(h.store.get(poly.id)!.type, 'polygonCloud');
  assert.equal(h.store.get(box.id)!.type, 'cloud');
  assert.ok(h.store.get(box.id)!.style.arcRadius! > 0);
  h.store.undo();
  assert.equal(h.store.get(poly.id)!.type, 'polygon', 'one undo step');
});

test('a Modify tool finishing clears its snap marker and tracking', async () => {
  const h = await setup();
  const l = put(h, 'line', [[100, 100], [200, 100]]);
  put(h, 'line', [[300, 300], [400, 300]]);
  h.tools.setSnap(true);
  h.tools.select([l.id]);
  h.tools.setTool('mirror');
  const internals = h.tools as unknown as { snapHit: unknown; tracking: { points: unknown[] }; tracked: unknown };
  click(h.tools, [100, 150]);
  // Hovering near an endpoint snaps to it.
  h.tools.hover([301, 301] as never, 0);
  assert.ok(internals.snapHit, 'snapped while picking');
  click(h.tools, [301, 301]);
  assert.equal(h.tools.getState().tool, 'select');
  assert.equal(internals.snapHit, null);
  assert.equal(internals.tracked, null);
  assert.equal(internals.tracking.points.length, 0);
});

test('Scale to Length handing back to Select clears its snap marker', async () => {
  const h = await setup();
  const l = put(h, 'line', [[100, 100], [200, 100]]);
  put(h, 'line', [[300, 300], [400, 300]]);
  h.tools.setSnap(true);
  h.tools.select([l.id]);
  h.tools.setTool('scaleLength');
  const internals = h.tools as unknown as { snapHit: unknown };
  click(h.tools, [100, 100]);
  click(h.tools, [200, 100]);
  h.tools.pickScaleTarget();
  click(h.tools, [300, 300]);
  h.tools.hover([399, 301] as never, 0);
  assert.ok(internals.snapHit, 'snapped to the end');
  // Finishing happens on the click, with no pointer move after it to redraw the marker away.
  click(h.tools, [399, 301]);
  assert.equal(h.tools.getState().tool, 'select');
  assert.equal(internals.snapHit, null);
});

test('the markup a tool would pick is highlighted under the pointer', async () => {
  const h = await setup();
  const l = put(h, 'line', [[100, 100], [200, 100]]);
  const box = put(h, 'rect', [[300, 300], [400, 400]]);
  const picked = () => (h.tools as unknown as { pickIds: string[] }).pickIds;
  h.tools.setTool('trim');
  h.tools.hover([150, 101] as never, 0);
  assert.deepEqual(picked(), [l.id], 'a line Trim can cut');
  h.tools.hover([300, 350] as never, 0);
  assert.deepEqual(picked(), [], 'a rectangle is not something Trim cuts');
  h.tools.setTool('divide');
  h.tools.hover([300, 350] as never, 0);
  assert.deepEqual(picked(), [box.id], 'but Divide can mark along it');
  // Mirror with nothing selected picks a markup; once one is selected it picks points instead.
  h.tools.setTool('mirror');
  h.tools.hover([150, 101] as never, 0);
  assert.deepEqual(picked(), [l.id]);
  click(h.tools, [150, 101]);
  h.tools.hover([150, 101] as never, 0);
  assert.deepEqual(picked(), []);
  h.tools.select([]);
  h.tools.setTool('offset');
  h.tools.hover([350, 300] as never, 0);
  assert.deepEqual(picked(), [box.id]);
  h.tools.hover(null, 0);
  assert.deepEqual(picked(), [], 'leaving the page clears it');
});

test('a connector segment drags across, as in Visio; bends are added and taken out; each is one undo step', async () => {
  const h = await setup();
  const shape = (id: string, x: number, y: number): Markup => ({ id, type: 'flowShape', flowShape: 'process', pageIndex: 0, points: [[x, y], [x + 100, y + 50]], style: { ...DEFAULT_STYLES.flowShape }, status: 'none', author: 'Tester', createdAt: 1, modifiedAt: 1 });
  h.store.add(shape('a', 0, 0));
  h.store.add(shape('b', 300, 200));
  h.store.add({ id: 'c', type: 'connector', pageIndex: 0, points: [[100, 25], [300, 225]], style: { ...DEFAULT_STYLES.connector }, status: 'none', author: 'Tester', createdAt: 2, modifiedAt: 2 });
  // Gluing it routes it: across, down at the middle, across.
  h.store.update('c', { connect: { from: { id: 'a', side: 'right' }, to: { id: 'b', side: 'left' }, route: 'elbow' } });
  const auto = h.store.get('c')!.points;
  assert.equal(auto.length, 4);
  h.tools.setTool('select');
  h.tools.select(['c']);
  h.store.checkpoint();
  // The handle is in the middle of the down segment; drag it to x = 140.
  const handle: Point = [auto[1]![0], (auto[1]![1] + auto[2]![1]) / 2];
  drag(h.tools, handle, [140, handle[1] + 30]);
  let c = h.store.get('c')!;
  assert.deepEqual(c.points, [[100, 25], [140, 25], [140, 225], [300, 225]]);
  assert.deepEqual(c.connect?.bends, { first: 'h', mids: [40] });
  // Moving b keeps the hand-set segment where it was.
  h.store.checkpoint();
  h.store.update('b', { points: [[300, 260], [400, 310]] });
  assert.deepEqual(h.store.get('c')!.points, [[100, 25], [140, 25], [140, 285], [300, 285]]);
  // A plain double-click is for the connector's text; Ctrl+double-click on the first segment adds a bend there.
  h.store.checkpoint();
  holdCtrl(true);
  h.tools.doubleClick([120, 25], 0);
  holdCtrl(false);
  c = h.store.get('c')!;
  assert.deepEqual(c.connect?.bends, { first: 'h', mids: [20, 0, 40] });
  // Its new across segment drags down into a step (the upright beside it has no length yet).
  h.store.checkpoint();
  drag(h.tools, [130, 25], [130, 60]);
  assert.deepEqual(h.store.get('c')!.points, [[100, 25], [120, 25], [120, 60], [140, 60], [140, 285], [300, 285]]);
  // Alt-click on the step's handle takes it out again.
  h.store.checkpoint();
  press(h.tools, [130, 60], { altKey: true });
  release(h.tools, [130, 60], { altKey: true });
  assert.deepEqual(h.store.get('c')!.connect?.bends, { first: 'h', mids: [20] });
  // One undo step each: the removal, the step, the bend, b's move, then the drag.
  h.store.undo();
  assert.equal(h.store.get('c')!.points.length, 6);
  h.store.undo();
  assert.deepEqual(h.store.get('c')!.connect?.bends, { first: 'h', mids: [20, 0, 40] });
  h.store.undo();
  h.store.undo();
  assert.deepEqual(h.store.get('c')!.connect?.bends, { first: 'h', mids: [40] });
  h.store.undo();
  assert.equal(h.store.get('c')!.connect?.bends, undefined);
  // Set on its own from the menu: straight, then back, then the hand-set route dropped.
  h.tools.setRouteOf('c', 'straight');
  assert.equal(h.store.get('c')!.points.length, 2);
  h.tools.setRouteOf('c', 'elbow');
  h.tools.setRouteOf('c', 'reset');
  assert.equal(h.store.get('c')!.connect?.bends, undefined);
});

test('a connector end dragged onto another shape drops the route set by hand', async () => {
  const h = await setup();
  const shape = (id: string, x: number, y: number): Markup => ({ id, type: 'flowShape', flowShape: 'process', pageIndex: 0, points: [[x, y], [x + 100, y + 50]], style: { ...DEFAULT_STYLES.flowShape }, status: 'none', author: 'Tester', createdAt: 1, modifiedAt: 1 });
  h.store.add(shape('a', 0, 0));
  h.store.add(shape('b', 300, 200));
  h.store.add(shape('c', 300, 400));
  h.store.add({ id: 'k', type: 'connector', pageIndex: 0, points: [[100, 25], [300, 225]], style: { ...DEFAULT_STYLES.connector }, status: 'none', author: 'Tester', createdAt: 2, modifiedAt: 2 });
  h.store.update('k', { connect: { from: { id: 'a', side: 'right' }, to: { id: 'b', side: 'left' }, route: 'elbow', bends: { first: 'h', mids: [40] } } });
  assert.deepEqual(h.store.get('k')!.connect?.bends, { first: 'h', mids: [40] });
  h.tools.setTool('select');
  h.tools.select(['k']);
  const end = h.store.get('k')!.points.at(-1)!;
  drag(h.tools, end, [350, 425]);
  const k = h.store.get('k')!;
  assert.equal(k.connect?.to?.id, 'c');
  assert.equal(k.connect?.bends, undefined);
});
