// Every markup tool, checked the same way: it draws, renders, can be grabbed, moved, resized,
// restyled, undone and redone, and survives saving to PDF and XFDF with all its properties. The
// tests loop over the type table, so a new tool is covered as soon as it is added there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { DEFAULT_SCALE, measureValue, type MeasureKind } from '@nb/measure';
import { exportWithAnnotations, type Matrix } from './export.ts';
import { flatten, hitTest, markupShape, moved, resizedBox } from './geometry.ts';
import { importAnnotations, type ImportableAnnotation } from './import.ts';
import { boundsOf, DEFAULT_STYLES, isMeasureKind, markupBounds, MARKUP_TYPES, ROTATABLE, type Markup, type MarkupStyle, type MarkupType, type Point } from './model.ts';
import { drawMarkup, drawSelection, handlePositions, measurementLabel } from './render.ts';
import { MarkupStore } from './store.ts';
import { TYPE_INFO } from './types.ts';
import { invertMatrix, markupsFromXfdf, markupsToXfdf } from './xfdf.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Points as the tool would place them: dragged boxes, freehand strokes, or clicks. */
function sample(type: MarkupType): Point[] {
  const info = TYPE_INFO[type];
  if (type === 'callout') return [[20, 20], [60, 60], [100, 60], [180, 100]];
  if (info.draw === 'click') return ([[40, 40], [140, 50], [120, 150], [30, 130]] as Point[]).slice(0, info.click?.fixed ?? Math.max(info.click?.min ?? 2, 3));
  if (info.draw === 'freehand') return [[40, 40], [70, 55], [100, 45], [130, 60]];
  return [[40, 40], [160, 110]];
}

function markup(type: MarkupType, extra: Partial<Markup> = {}): Markup {
  return {
    id: `m-${type}`,
    type,
    pageIndex: 0,
    points: sample(type),
    style: { ...DEFAULT_STYLES[type] },
    ...(TYPE_INFO[type].content === 'text' ? { text: 'Revise per RFI 12' } : {}),
    ...(TYPE_INFO[type].content === 'image' ? { image: PNG } : {}),
    ...(type === 'ellipticalArc' ? { arcAngles: [0, 180] as [number, number] } : {}),
    ...(type === 'hyperlink' ? { link: { kind: 'url' as const, url: 'https://example.com/' } } : {}),
    ...(type === 'legend' ? { legend: { scope: 'page' as const } } : {}),
    ...(type === 'space' ? { subject: 'ROOM 101' } : {}),
    status: 'none',
    author: 'Tester',
    createdAt: 1000,
    modifiedAt: 1000,
    ...extra,
  };
}

/** Every style property the type's Properties panel offers, set away from its default. */
function restyled(type: MarkupType): MarkupStyle {
  const { caps } = TYPE_INFO[type];
  const s: MarkupStyle = { ...DEFAULT_STYLES[type], stroke: '#123456', opacity: 0.75 };
  if (TYPE_INFO[type].style.width > 0) s.width = 2.5;
  if (caps.fill) s.fill = '#abcdef';
  if (caps.hatch) s.hatch = 'brick';
  if (caps.dash) s.dash = 'dashDot';
  if (caps.lineEnds) Object.assign(s, { startCap: 'openArrow', endCap: 'filledDiamond', capScale: 1.5 });
  if (caps.font) Object.assign(s, { fontSize: 14, fontFamily: 'serif', bold: true, italic: true, textColor: '#ff0000' });
  if (caps.textLayout) Object.assign(s, { textAlign: 'center', verticalAlign: 'bottom', underline: true });
  if (caps.label) Object.assign(s, { showLabel: true, labelBackground: null });
  if (caps.leader) s.leader = 12;
  if (caps.arcRadius) s.arcRadius = 7;
  return s;
}

/** A canvas context that accepts every call and records which were made. */
function fakeContext() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (s: string) => ({ width: s.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (key === 'getLineDash') return () => [];
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (key === 'createPattern' || key === 'createLinearGradient') return () => ({ addColorStop() {}, setTransform() {} });
      return (...args: unknown[]) => {
        calls.push(String(key));
        return args.length ? undefined : undefined;
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

// Markup images decode through HTMLImageElement, which Node lacks.
(globalThis as { Image?: unknown }).Image ??= class {
  complete = true;
  naturalWidth = 1;
  naturalHeight = 1;
  onload: (() => void) | null = null;
  src = '';
};

/** A point on the markup's drawn outline. */
function onOutline(m: Markup): Point {
  for (const part of markupShape(m)) {
    if (part.clip || !part.stroke) continue;
    const line = flatten(part.path).find((l) => l.length > 1);
    if (line) return line[0]!;
  }
  // Shapes drawn only as fills (highlights): their middle.
  const b = boundsOf(m.points);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

for (const type of MARKUP_TYPES) {
  const info = TYPE_INFO[type];

  test(`${type}: draws a shape and renders on a canvas`, () => {
    const m = markup(type);
    const parts = markupShape(m);
    assert.ok(parts.length > 0, 'has a shape');
    for (const p of parts) for (const c of p.path) for (const n of c.slice(1) as number[]) assert.ok(Number.isFinite(n), `finite path: ${JSON.stringify(c)}`);
    const b = markupBounds(m);
    assert.ok([b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w >= 0 && b.h >= 0, 'finite bounds');
    for (const [x, y] of m.points) assert.ok(x >= b.x - 1e-9 && x <= b.x + b.w + 1e-9 && y >= b.y - 1e-9 && y <= b.y + b.h + 1e-9, 'bounds hold its points');

    const { ctx, calls } = fakeContext();
    drawMarkup(ctx, m, 1, DEFAULT_SCALE);
    assert.ok(calls.length > 0, 'drawing touches the canvas');
    drawSelection(ctx, m, 1);
    const handles = handlePositions(m);
    if (info.handles === 'none') assert.equal(handles.length, 0);
    else if (info.handles === 'ends') assert.deepEqual(handles, m.points.slice(0, 2));
    else assert.deepEqual(handles, m.points);
  });

  test(`${type}: is grabbed on its outline and not far away`, () => {
    const m = markup(type);
    assert.equal(hitTest(m, onOutline(m), 2), true, 'grabbed on the outline');
    assert.equal(hitTest(m, [900, 900], 2), false, 'not grabbed far away');
    if (info.solid && info.draw !== 'text') {
      const b = boundsOf(m.type === 'callout' ? m.points.slice(2) : m.points);
      assert.equal(hitTest(m, [b.x + b.w * 0.6, b.y + b.h / 2], 1), true, 'solid: grabbed inside');
    }
  });

  test(`${type}: moves exactly with the pointer`, () => {
    const m = markup(type);
    const before = markupBounds(m);
    const after = markupBounds({ ...m, ...moved(m, 25, -10) });
    assert.ok(close(after.x, before.x + 25) && close(after.y, before.y - 10), `moved bounds ${JSON.stringify(after)}`);
    assert.ok(close(after.w, before.w) && close(after.h, before.h), 'same size');
  });

  if (info.handles === 'ends' && sample(type).length === 2) {
    test(`${type}: resizes from its first corner`, () => {
      const m = markup(type);
      const box = boundsOf(resizedBox(m, 200, 50));
      assert.deepEqual([box.x, box.y, box.w, box.h], [40, 40, 200, 50]);
    });
  }

  if (ROTATABLE.has(type)) {
    test(`${type}: rotates about its centre`, () => {
      const m = markup(type, { rotation: 90 });
      const flat = markupBounds(markup(type));
      const turned = markupBounds(m);
      assert.ok(close(turned.w, flat.h, 1e-6) && close(turned.h, flat.w, 1e-6), 'a quarter turn swaps width and height');
      assert.equal(hitTest(m, [900, 900], 2), false);
    });
  }

  test(`${type}: add, restyle and delete undo and redo step by step`, async () => {
    const store = await MarkupStore.open(`tools-${type}`, { persist: false });
    const m = markup(type);
    store.add(m);
    store.checkpoint();
    store.update(m.id, { style: restyled(type), comment: 'Check this' });
    store.checkpoint();
    store.remove([m.id]);
    store.checkpoint();
    assert.equal(store.get(m.id), undefined, 'deleted');

    store.undo();
    assert.equal(store.get(m.id)?.comment, 'Check this', 'undo delete');
    assert.deepEqual(store.get(m.id)?.style, restyled(type));
    store.undo();
    assert.deepEqual(store.get(m.id)?.style, m.style, 'undo restyle');
    assert.equal(store.get(m.id)?.comment, undefined);
    store.undo();
    assert.equal(store.all().length, 0, 'undo add');

    store.redo();
    store.redo();
    assert.deepEqual(store.get(m.id)?.style, restyled(type), 'redo restyle');
    store.redo();
    assert.equal(store.get(m.id), undefined, 'redo delete');
    await store.destroy();
  });

  test(`${type}: a read-only document refuses new markups of this kind`, async () => {
    const store = await MarkupStore.open(`tools-ro-${type}`, { persist: false });
    store.setReadOnly(true);
    store.add(markup(type));
    assert.equal(store.all().length, 0);
    await store.destroy();
  });
}

/** Markups as the app writes them, with every property a user can set on each type. */
function everything(): Markup[] {
  return MARKUP_TYPES.map((t, i) =>
    markup(t, {
      id: `full-${t}`,
      style: restyled(t),
      comment: `Comment on ${t} & <friends>`,
      subject: t === 'space' ? 'ROOM 101' : `${TYPE_INFO[t].label} (custom)`,
      status: i % 2 ? 'accepted' : 'none',
      checked: i % 3 === 0,
      locked: i % 4 === 0,
      hidden: i % 5 === 0,
      layer: i % 2 ? 'Electrical' : undefined,
      groupId: i < 4 ? 'g1' : undefined,
      fields: { trade: 'Electrical', cost: String(i * 10) },
      replies: [{ id: `r-${t}`, author: 'Lee', text: 'Agreed', createdAt: 2000 }],
      ...(ROTATABLE.has(t) ? { rotation: 30 } : {}),
      ...(t === 'area' || t === 'volume' ? { holes: [[[60, 60], [80, 60], [80, 80], [60, 80]]] as Point[][] } : {}),
      ...(t === 'volume' ? { depth: 2.5 } : {}),
      ...(t === 'length' || t === 'area' ? { slope: { kind: 'percent' as const, value: 25 } } : {}),
      createdAt: 1000 + i,
      modifiedAt: 5000 + i,
    }),
  ).map((m) => JSON.parse(JSON.stringify(m)) as Markup);
}

test('every tool with every property set survives saving to PDF and opening again', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const original = await doc.save();
  const markups = everything();
  const bytes = await exportWithAnnotations(original.buffer as ArrayBuffer, markups);

  const out = await PDFDocument.load(bytes);
  const found: ImportableAnnotation[] = out
    .getPage(0)
    .node.Annots()!
    .asArray()
    .flatMap((ref, index) => {
      const data = out.context.lookup(ref, PDFDict).lookupMaybe(PDFName.of('NBData'), PDFString, PDFHexString);
      if (!data) return [];
      return [{ index, subtype: '', rect: { x: 0, y: 0, w: 0, h: 0 }, color: null, interior: null, opacity: 1, borderWidth: 1, contents: '', author: '', intent: '', cloudy: false, da: '', appData: data.decodeText(), flags: 4, vertices: [], ink: [], line: null, link: null }];
    });
  const { markups: back } = importAnnotations(0, found);
  const byId = new Map(back.map(({ pdfAnnot: _link, ...m }) => [m.id, m]));
  for (const m of markups) assert.deepEqual(byId.get(m.id), m, `${m.type} came back changed`);
});

test('every tool survives an XFDF export and import', () => {
  // A US Letter page: page space is y down from the top, user space y up.
  const matrix: Matrix = [1, 0, 0, -1, 0, 792];
  const markups = MARKUP_TYPES.map((t) => markup(t, { comment: 'Check', replies: [{ id: `r-${t}`, author: 'Bo', text: 'Done', createdAt: 5000 }] }));
  const xml = markupsToXfdf(markups, () => matrix, 'plan.pdf');
  const back = new Map(markupsFromXfdf(xml, () => invertMatrix(matrix)).map((m) => [m.id, m]));
  for (const m of markups) {
    const b = back.get(m.id);
    assert.ok(b, `${m.type} is in the XFDF`);
    assert.equal(b.type, m.type, `${m.type} keeps its type`);
    assert.equal(b.comment, 'Check', `${m.type} keeps its comment`);
    assert.equal(b.replies?.[0]?.text, 'Done', `${m.type} keeps its reply`);
    const [p, q] = [boundsOf(m.points), boundsOf(b.points)];
    assert.ok(close(p.x, q.x, 0.01) && close(p.y, q.y, 0.01) && close(p.w, q.w, 0.01) && close(p.h, q.h, 0.01), `${m.type} keeps its place: ${JSON.stringify(q)}`);
  }
});

test('measurement tools report the right quantities', () => {
  // 1 point = 1 cm.
  const mpp = 0.01;
  const square: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const cases: [MeasureKind, Point[], number, object?][] = [
    ['length', [[0, 0], [300, 400]], 5],
    ['polylength', [[0, 0], [100, 0], [100, 100]], 2],
    ['perimeter', square, 4],
    ['area', square, 1],
    ['area', square, 0.75, { holes: [[[0, 0], [50, 0], [50, 50], [0, 50]]] }],
    ['volume', square, 2.5, { depth: 2.5 }],
    ['count', [[1, 1], [2, 2], [3, 3]], 3],
    ['angle', [[100, 0], [0, 0], [0, 100]], 90],
    ['diameter', [[0, 0], [200, 0]], 2],
    ['radius', [[0, 0], [0, 50]], 0.5],
    ['arcLength', [[0, 0], [100, 100], [200, 0]], Math.PI],
  ];
  for (const [kind, points, expected, props] of cases) {
    const v = measureValue(kind, points, mpp, props);
    assert.ok(close(v, expected, 1e-6), `${kind}: ${v} ≠ ${expected}`);
  }
  // Every measurement tool shows a label with a number in it.
  for (const t of MARKUP_TYPES.filter(isMeasureKind)) {
    const label = measurementLabel(markup(t, t === 'volume' ? { depth: 1 } : {}));
    assert.match(label?.text ?? '', /\d/, `${t} label`);
  }
  assert.equal(measurementLabel(markup('length', { style: { ...DEFAULT_STYLES.length, showLabel: false } })), null, 'hidden label');
});

test('click-drawn tools know when they are finished', () => {
  for (const t of MARKUP_TYPES) {
    const rule = TYPE_INFO[t].click;
    if (!rule) continue;
    assert.ok(rule.min >= 1, `${t} needs a point`);
    if (rule.fixed) assert.ok(rule.fixed >= rule.min, `${t} finishes after its minimum`);
    if (rule.closes) assert.ok(TYPE_INFO[t].closed && rule.min >= 3, `${t} closes into a shape`);
  }
});
