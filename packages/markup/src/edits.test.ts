import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSizedPoints, canAutoSize, canRoundCorners, defaultCornerRadius, markupColours, recolouredStyle } from './edits.ts';
import { markupShape } from './geometry.ts';
import { legendRows } from './legend.ts';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';
import { MarkupStore } from './store.ts';

function mk(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  return { id: `${type}-${points.length}`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt: 1, modifiedAt: 1, ...extra };
}

test('Change Colours lists each colour once and swaps line, fill and text colours', () => {
  const a = mk('rect', [[0, 0], [10, 10]], { style: { ...DEFAULT_STYLES.rect, stroke: '#FF0000', fill: '#00ff00' } });
  const b = mk('text', [[0, 0], [10, 10]], { style: { ...DEFAULT_STYLES.text, stroke: '#ff0000', fill: null, textColor: '#0000ff' } });
  assert.deepEqual(markupColours([a, b]), ['#ff0000', '#00ff00', '#0000ff']);
  const map = { '#ff0000': '#123456' };
  assert.deepEqual([recolouredStyle(a.style, map)?.stroke, recolouredStyle(a.style, map)?.fill], ['#123456', '#00ff00']);
  assert.equal(recolouredStyle(b.style, { '#0000ff': '#ffffff' })?.textColor, '#ffffff');
  assert.equal(recolouredStyle(a.style, { '#abcdef': '#000000' }), null);
});

test('rounded corners curve rectangles, polygons and polylines, but not text boxes', () => {
  const curves = (m: Markup) => markupShape(m)[0]!.path.filter((c) => c[0] === 'C').length;
  const rect = mk('rect', [[0, 0], [100, 50]]);
  assert.equal(curves(rect), 0);
  assert.equal(curves({ ...rect, style: { ...rect.style, cornerRadius: 10 } }), 4);
  const poly = mk('polygon', [[0, 0], [100, 0], [50, 80]], { style: { ...DEFAULT_STYLES.polygon, cornerRadius: 8 } });
  assert.equal(curves(poly), 3);
  // A polyline's ends stay sharp: only its inner corners round.
  const line = mk('polyline', [[0, 0], [50, 0], [50, 50], [100, 50]], { style: { ...DEFAULT_STYLES.polyline, cornerRadius: 8 } });
  assert.equal(curves(line), 2);
  assert.deepEqual([canRoundCorners(rect), canRoundCorners({ type: 'text' }), canRoundCorners({ type: 'polygon' })], [true, false, true]);
  assert.equal(defaultCornerRadius(rect), 5);
});

test('Auto-size fits a text box to its text and keeps its top-left corner', () => {
  const measure = (s: string) => s.length * 6;
  const box = mk('text', [[20, 30], [400, 300]], { text: 'Hello\nwide world line', style: { ...DEFAULT_STYLES.text, fontSize: 10 } });
  const pts = autoSizedPoints(box, measure)!;
  // 15 characters × 6 + padding; 2 lines × 12 + padding.
  assert.deepEqual(pts, [[20, 30], [20 + Math.ceil(90 + 8 + 1), 30 + Math.ceil(24 + 8)]]);
  const callout = mk('callout', [[0, 0], [10, 10], [50, 50], [300, 200]], { text: 'ab', style: { ...DEFAULT_STYLES.callout, fontSize: 10 } });
  const c = autoSizedPoints(callout, measure)!;
  assert.deepEqual(c.slice(0, 3), [[0, 0], [10, 10], [50, 50]], 'the leader stays where it was');
  assert.equal(canAutoSize({ type: 'rect', text: 'x' }), false);
  assert.equal(canAutoSize({ type: 'text', text: '' }), false);
});

test('markups left out of legends are not listed', () => {
  const legend = mk('legend', [[0, 0], [100, 100]]);
  const shown = mk('rect', [[0, 0], [10, 10]], { id: 'a' });
  const left = mk('cloud', [[0, 0], [10, 10]], { id: 'b', legendHidden: true });
  assert.deepEqual(legendRows(legend, [legend, shown, left]).map((r) => r.sample.id), ['a']);
});

test('flattening some markups moves the remaining imported ones to their annotations’ new places', async () => {
  const store = await MarkupStore.open('flat', { persist: false });
  const imported = (id: string, index: number, owned?: number[]): Markup => ({ ...mk('rect', [[0, 0], [1, 1]]), id, pdfAnnot: { index, digest: 'x', ...(owned ? { owned } : {}) } });
  store.importAnnotations([imported('a', 0, [1]), imported('b', 2, [3, 4]), imported('c', 5), { ...mk('rect', [[0, 0], [1, 1]]), id: 'mine' }], [], { 0: [0, 1, 2, 3, 4, 5] });
  // "a" (with its reply at 1) and "mine" are flattened.
  store.removeFlattened(['a', 'mine'], { 0: [0, 1] });
  assert.deepEqual(store.all().map((m) => [m.id, m.pdfAnnot?.index, m.pdfAnnot?.owned]), [['b', 0, [1, 2]], ['c', 3, undefined]]);
  assert.deepEqual(store.importedAnnotations(), { 0: [0, 1, 2, 3] });
  assert.equal(store.undoHistory().length, 0);
  await store.destroy();
});
