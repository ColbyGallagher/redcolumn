import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legendRows, legendSymbol } from './legend.ts';
import { DEFAULT_STYLES, type Markup, type MarkupType, type Point } from './model.ts';

let n = 0;
function markup(type: MarkupType, points: Point[], extra: Partial<Markup> = {}): Markup {
  n++;
  return { id: `m${n}`, type, pageIndex: 0, points, style: { ...DEFAULT_STYLES[type] }, status: 'none', author: '', createdAt: n, modifiedAt: n, ...extra };
}
// 1 point per metre, so lengths read directly in metres.
const scale = { metersPerPoint: 1, unit: 'm' as const, feetInches: false, precision: 1, label: '1:1' };

test('a legend lists each kind of markup on its page with a quantity and total', () => {
  const legend = markup('legend', [[0, 0], [100, 60]]);
  const all = [
    legend,
    markup('cloud', [[0, 0], [10, 10]]),
    markup('cloud', [[20, 0], [30, 10]]),
    markup('cloud', [[0, 0], [10, 10]], { subject: 'RFI' }),
    markup('count', [[1, 1], [2, 2], [3, 3]]),
    markup('length', [[0, 0], [3, 4]]),
    markup('length', [[0, 0], [6, 8]]),
    markup('rect', [[0, 0], [1, 1]], { pageIndex: 1 }),
    markup('signature', [[0, 0], [1, 1]]),
  ];
  const rows = legendRows(legend, all, () => scale);
  assert.deepEqual(
    rows.map((r) => [r.label, r.count, r.measure]),
    [
      ['Cloud', 2, ''],
      ['RFI', 1, ''],
      ['Count', 3, ''],
      ['Length', 2, '15.0 m'],
    ],
  );
  // A document-wide legend picks up other pages too.
  assert.equal(legendRows({ ...legend, legend: { scope: 'document' } }, all, () => scale).length, 5);
});

test('legend symbols are small copies of the markup inside the symbol cell', () => {
  const cell = { x: 10, y: 10, w: 20, h: 8 };
  for (const t of ['cloud', 'count', 'polylength', 'pen', 'callout', 'textHighlight', 'arrow'] as MarkupType[]) {
    const s = legendSymbol(markup(t, [[0, 0], [500, 500]]), cell);
    assert.ok(s.points.every(([x, y]) => x >= 10 - 1e-9 && x <= 30 + 1e-9 && y >= 10 - 1e-9 && y <= 18 + 1e-9), t);
  }
});
