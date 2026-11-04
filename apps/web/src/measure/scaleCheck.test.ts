import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScaleText } from '@nb/measure';
import type { Word } from '@nb/sheets';
import { checkScale, dimensionScale, pageReadings, scaleBars } from './scaleCheck.ts';

const PT_PER_MM = 72 / 25.4;
/** A word of `size` points centred at (x, y) along `angle`. */
function word(text: string, x: number, y: number, size = 6.5, angle = 0): Word {
  const half = (text.length * size * 0.55) / 2;
  const [dx, dy] = [Math.cos(angle) * half, Math.sin(angle) * half];
  return { text, x0: Math.min(x - dx, x + dx), y0: Math.min(y - dy, y + dy) - (angle ? 0 : size), x1: Math.max(x - dx, x + dx), y1: Math.max(y - dy, y + dy) + (angle ? size : 0), size, angle };
}
/** The Kestrel plan's bar: 0 10 20 40m at 1:500 (10 m is 20 mm), shrunk by `k`. */
const bar = (k = 1, x = 80, y = 1610) => [0, 10, 20, 40].map((v, i, all) => word(i === all.length - 1 ? `${v}m` : `${v}`, x + v * 2 * PT_PER_MM * k, y * k, 6.5 * k));
const at500 = parseScaleText('1:500')!;
const at1000 = parseScaleText('1:1000')!;

test('a scale bar is read from its tick labels, unit run on to the last', () => {
  const [r] = scaleBars(bar());
  assert.equal(r!.kind, 'bar');
  assert.equal(r!.text, '0 10 20 40m');
  assert.equal(r!.assumed, undefined);
  assert.ok(Math.abs(r!.metersPerPoint / at500.metersPerPoint - 1) < 0.01);
  // Shrunk to half size the same bar says 1:1000 per point of page.
  assert.ok(Math.abs(scaleBars(bar(0.5))[0]!.metersPerPoint / at1000.metersPerPoint - 1) < 0.01);
});

test('rows of numbers that are not evenly spaced, or do not start at 0, are not scale bars', () => {
  assert.deepEqual(scaleBars([word('0', 80, 100), word('10', 120, 100), word('20', 200, 100)]), []);
  assert.deepEqual(scaleBars([word('100', 80, 100), word('200', 120, 100), word('300', 160, 100)]), []);
  const feet = scaleBars([word('0', 80, 100), word('20', 152, 100), word('40', 224, 100), word('FEET', 242, 100)]);
  assert.equal(feet.length, 1);
  assert.ok(Math.abs(feet[0]!.metersPerPoint - (40 * 0.3048) / 144) < 1e-6, '1" = 20\'');
});

test('dimension strings agree on a scale, and stray labels over lines do not', () => {
  const words: Word[] = [];
  const segs: number[] = [];
  // At 1:100, 1 mm of paper is 100 mm: lane widths in mm over their dimension lines.
  for (const [i, mm] of [3500, 3500, 3000, 2500, 1200].entries()) {
    const len = (mm / 100) * PT_PER_MM;
    const y = 200 + i * 40;
    segs.push(100, y, 100 + len, y);
    words.push(word(String(mm), 100 + len / 2, y - 2));
  }
  // A road label over an unrelated edge, and a vertical dimension.
  segs.push(400, 600, 900, 600);
  words.push(word('250', 650, 598));
  segs.push(700, 100, 700, 100 + 60 * PT_PER_MM);
  words.push(word('6000', 703, 100 + 30 * PT_PER_MM, 6.5, Math.PI / 2));
  const r = dimensionScale(words, segs)!;
  assert.equal(r.count, 6);
  assert.ok(Math.abs(r.metersPerPoint / parseScaleText('1:100')!.metersPerPoint - 1) < 0.01);
  assert.equal(dimensionScale(words.slice(0, 2), segs), null, 'two dimensions are not enough');
});

test('checkScale says whether the page agrees with a proposal', () => {
  assert.equal(checkScale(at500, scaleBars(bar())).result, 'agrees');
  const wrong = checkScale(at500, scaleBars(bar(0.5)));
  assert.equal(wrong.result, 'disagrees');
  assert.ok(Math.abs(wrong.ratio! - 2) < 0.02);
  assert.equal(checkScale(at500, []).result, 'none');
  // Imperial pages look for feet bars and skip dimensions.
  assert.equal(pageReadings(bar(), [], 'ft')[0]!.metersPerPoint > 0, true);
});
