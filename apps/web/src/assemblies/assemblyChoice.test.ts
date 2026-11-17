import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Assembly, Markup } from '@nb/markup';
import type { Scale } from '@nb/measure';
import type { CellContext } from '../columns/listColumns';
import { appliesTo, assemblyChoice, inputValues, withInput } from './assemblyChoice';
import { markupQuantities } from './quantities';

/** One PDF point is one foot. */
const FEET: Scale = { metersPerPoint: 0.3048, unit: 'ft', feetInches: false, precision: 2, label: 'test' };
const ctx = (assemblies: Assembly[]): CellContext => ({ scaleOf: () => FEET, sheets: {}, statuses: [], columns: [], assemblies });

const footing: Assembly = {
  id: 'ftg',
  name: 'Strip footing',
  variables: [
    { name: 'Width', value: 2, unit: 'ft' },
    { name: 'Thickness', value: 1, unit: 'ft' },
    { name: 'Extra', value: 5, unit: '%' },
  ],
  items: [{ id: 'conc', name: 'Concrete', unit: 'cf', formula: '[Length] * [Width] * [Thickness] * (1 + [Extra] / 100)' }],
};

let seq = 0;
const run = (extra: Partial<Markup> = {}): Markup => ({
  id: `m${++seq}`,
  type: 'length',
  pageIndex: 0,
  points: [
    [0, 0],
    [10, 0],
  ],
  style: { stroke: '#f00', fill: null, width: 1, opacity: 1 },
  status: 'none',
  author: 'me',
  createdAt: 0,
  modifiedAt: 0,
  assemblyId: 'ftg',
  ...extra,
});
const concrete = (m: Markup) => markupQuantities(m, [footing], ctx([footing]))!.items[0]!.base;

test('with nothing selected the choice is the next markups’, at their defaults', () => {
  const c = assemblyChoice([], { assemblyId: 'ftg', assemblyInputs: { Thickness: 1.5 } }, [footing]);
  assert.equal(c.target, 'next');
  assert.equal(appliesTo(c), 'Next markups');
  assert.equal(c.assembly?.id, 'ftg');
  assert.deepEqual(c.values, { Width: 2, Thickness: 1.5, Extra: 5 });
  assert.equal(c.varies.size, 0);
  // No assembly picked: nothing to edit.
  assert.equal(assemblyChoice([], {}, [footing]).assembly, undefined);
});

test('selected measurements: their own inputs, falling back to the defaults, and which ones vary', () => {
  const a = run({ assemblyInputs: { Width: 3 } });
  const b = run();
  const c = assemblyChoice([a, b], {}, [footing]);
  assert.equal(c.target, 'selected');
  assert.equal(appliesTo(c), '2 selected');
  assert.deepEqual(c.values, { Width: 3, Thickness: 1, Extra: 5 });
  assert.deepEqual([...c.varies], ['Width']);
  // Two assemblies: several, nothing to edit.
  const other = run({ assemblyId: 'x' });
  assert.equal(assemblyChoice([a, other], {}, [footing]).value, '*');
  assert.equal(assemblyChoice([a, other], {}, [footing]).assembly, undefined);
});

test('setting one variable keeps the others, and drops values back at the default', () => {
  assert.deepEqual(withInput(footing, { Width: 3 }, 'Thickness', 2), { Width: 3, Thickness: 2 });
  assert.deepEqual(withInput(footing, { Width: 3 }, 'Width', 2), undefined);
  assert.deepEqual(inputValues(footing, { width: 4 }), { Width: 4, Thickness: 1, Extra: 5 }, 'matched ignoring case');
});

test('the values feed the formula: overrides per measurement, defaults otherwise', () => {
  // 10 ft x 2 x 1 x 1.05 = 21 cf at the defaults.
  const plain = run();
  assert.ok(Math.abs(concrete(plain)! - 21) < 1e-9);
  // Thickness set on this measurement only: 10 x 2 x 1.5 x 1.05 = 31.5.
  const deeper = run({ assemblyInputs: withInput(footing, undefined, 'Thickness', 1.5) });
  assert.ok(Math.abs(concrete(deeper)! - 31.5) < 1e-9);
  // Changing the assembly's default moves the measurement that has no input of its own.
  const wider: Assembly = { ...footing, variables: footing.variables.map((v) => (v.name === 'Width' ? { ...v, value: 3 } : v)) };
  assert.ok(Math.abs(markupQuantities(plain, [wider], ctx([wider]))!.items[0]!.base! - 31.5) < 1e-9);
  assert.ok(Math.abs(markupQuantities(deeper, [wider], ctx([wider]))!.items[0]!.base! - 47.25) < 1e-9);
});
