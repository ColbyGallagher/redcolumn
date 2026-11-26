import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setNumberLocale } from '@nb/i18n';
import { matchesFilter } from '../columns/listColumns';
import { parseRotationInput } from '../markup/rotationInput';

/** Runs `fn` with numbers in `locale`, then back to US English. */
function inLocale(locale: string, fn: () => void) {
  setNumberLocale(locale);
  try {
    fn();
  } finally {
    setNumberLocale('en-US');
  }
}

test('Markups list filters read numbers in the chosen format', () => {
  const cell = { text: '2,54 m', num: 2.54 };
  inLocale('de-DE', () => {
    assert.equal(matchesFilter(cell, '>2,5'), true);
    assert.equal(matchesFilter(cell, '<2,5'), false);
    assert.equal(matchesFilter({ text: '1.250,00 m', num: 1250 }, '>=1.000'), true);
  });
  assert.equal(matchesFilter({ text: '2.54 m', num: 2.54 }, '>2.5'), true);
  assert.equal(matchesFilter({ text: '$1,250', num: 1250 }, '>$1,000'), true);
});

test('rotation fields read decimal commas', () => {
  inLocale('de-DE', () => {
    const deg = parseRotationInput('45,5', 'ccw');
    assert.ok(deg.ok && Math.abs(deg.degrees - 45.5) < 1e-9);
    const pct = parseRotationInput('2,5%');
    assert.ok(pct.ok && pct.unit === 'percent');
  });
  const en = parseRotationInput('45.5', 'ccw');
  assert.ok(en.ok && Math.abs(en.degrees - 45.5) < 1e-9);
});

test('number fields read the JavaScript way and show in the chosen format; text fields read as typed', async () => {
  const { cellsFor, customKey } = await import('../columns/listColumns');
  const columns = [
    { id: 'n', name: 'Count', type: 'number' as const, decimals: 3 },
    { id: 't', name: 'Note', type: 'text' as const },
  ];
  const markup = {
    id: 'm1', type: 'rect', pageIndex: 0, points: [[0, 0], [10, 10]], style: { stroke: '#000', fill: 'none', width: 1, opacity: 1 },
    status: 'none', author: 'me', createdAt: 0, modifiedAt: 0, fields: { n: '1.125', t: '2,5' },
  } as never;
  const ctx = { scaleOf: () => ({ metersPerPoint: 1, unit: 'm', feetInches: false, precision: 2, label: '' }), sheets: {}, statuses: [], columns } as never;
  inLocale('de-DE', () => {
    const cells = cellsFor(markup, ctx);
    assert.deepEqual(cells[customKey('n')], { text: '1,125', num: 1.125 });
    assert.equal(cells[customKey('t')]!.num, 2.5);
    assert.equal(matchesFilter(cells[customKey('n')]!, '=1,125'), true);
  });
});
