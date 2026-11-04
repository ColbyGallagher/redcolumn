import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScaleText } from '@nb/measure';
import type { Word } from '@nb/sheets';
import { drawingArea, proposeViews, viewLabels } from './viewScales.ts';

const W = 1000;
const H = 700;
/** Words for a line of text starting at (x, baseline y). */
function line(text: string, x: number, y: number, size = 6): Word[] {
  const out: Word[] = [];
  for (const t of text.split(' ')) {
    const w = t.length * size * 0.55;
    out.push({ text: t, x0: x, y0: y - size, x1: x + w, y1: y, size, angle: 0 });
    x += w + size * 0.55;
  }
  return out;
}
const box = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
/** A sheet: frame, a title-block strip down the right with the number in it, and two drawings. */
const frame = [...box(10, 10, 990, 690), 850, 10, 850, 690];
const number = line('C-301', 870, 650, 20);
const drawings = [...box(100, 100, 400, 300), 150, 200, 350, 200, ...box(500, 100, 800, 300), 550, 150, 750, 250];
const titles = [...line('DETAIL 1 SCALE 1:20', 200, 330), ...line('SECTION A SCALE 1:50', 600, 330)];
const rectOf = (w: Word) => ({ x: w.x0, y: w.y0, w: w.x1 - w.x0, h: w.y1 - w.y0 });

test('view titles give scales, with H and V axes', () => {
  const labels = viewLabels([...titles, ...line('HORIZONTAL SCALE 1:500', 100, 500), ...line('VERTICAL SCALE 1:100', 100, 520), ...line('H 1:250 V 1:50', 100, 560), ...line('DETAIL 4 1:5', 300, 600), ...line('SCALE @ A1', 900, 400)]);
  assert.deepEqual(
    labels.map((l) => [l.scale.label, l.axis ?? '']),
    [['1:20', ''], ['1:50', ''], ['1:500', 'x'], ['1:100', 'y'], ['1:250', 'x'], ['1:50', 'y'], ['1:5', '']],
  );
});

test('the drawing area stops at the title-block strip beside the number', () => {
  assert.deepEqual(drawingArea({ width: W, height: H }, frame, rectOf(number[0]!)), { x: 10, y: 10, w: 840, h: 680 });
  assert.deepEqual(drawingArea({ width: W, height: H }, frame, null), { x: 10, y: 10, w: 980, h: 680 });
});

test('each view title gets a viewport fitted to the drawing above it', () => {
  const views = proposeViews({ width: W, height: H }, [...titles, ...number, ...line('SCALE: 1:20', 900, 600)], [...frame, ...drawings], null, rectOf(number[0]!));
  assert.equal(views.length, 2);
  assert.deepEqual(views.map((v) => v.scale.label), ['1:20', '1:50']);
  const [a, b] = views.map((v) => v.rect);
  assert.ok(a!.x <= 100 && a!.x + a!.w >= 400 && a!.x + a!.w < 500, `detail 1 covers its drawing only: ${JSON.stringify(a)}`);
  assert.ok(b!.x <= 500 && b!.x + b!.w >= 800 && b!.x + b!.w <= 850, `section A stops at the title block: ${JSON.stringify(b)}`);
  // Views at the page's own scale need no viewport.
  assert.deepEqual(proposeViews({ width: W, height: H }, titles, [...frame, ...drawings], parseScaleText('1:20'), rectOf(number[0]!)).map((v) => v.scale.label), ['1:50']);
});

test('a long section with horizontal and vertical scales gets one viewport over the drawing area', () => {
  const words = [...line('HORIZONTAL SCALE 1:500', 300, 600), ...line('VERTICAL SCALE 1:100', 300, 625), ...number];
  const [v, ...rest] = proposeViews({ width: W, height: H }, words, [...frame, ...drawings], null, rectOf(number[0]!));
  assert.equal(rest.length, 0);
  assert.equal(v!.scale.label, 'H 1:500 V 1:100');
  assert.ok(Math.abs(v!.scale.yMetersPerPoint! / v!.scale.metersPerPoint - 0.2) < 1e-9);
  assert.deepEqual(v!.rect, { x: 10, y: 10, w: 840, h: 680 });
});
