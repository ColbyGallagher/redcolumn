import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Assembly, Markup } from '@nb/markup';
import type { ManualQuantity, Scale } from '@nb/measure';
import { cellsFor, type CellContext } from '../columns/listColumns';
import { defaultManualUnit, makeManual, manualEditValue, manualFromBase, manualToBase } from '../measure/manualQuantity';
import { markupQuantities } from './quantities';

/** One PDF point is one foot. */
const FEET: Scale = { metersPerPoint: 0.3048, unit: 'ft', feetInches: false, precision: 2, label: 'test' };
const SQ_FT = 0.3048 ** 2;
const assembly: Assembly = {
  id: 'a',
  name: 'Finish',
  variables: [],
  items: [
    { id: 'area', name: 'Paint', unit: 'sf', formula: '[Area]' },
    { id: 'qty', name: 'Qty', unit: 'ea', formula: '[Quantity]' },
    { id: 'len', name: 'Trim', unit: 'ft', formula: '[Length]' },
    { id: 'vol', name: 'Fill', unit: 'cf', formula: '[Volume]' },
    { id: 'cnt', name: 'Fixtures', unit: 'ea', formula: '[Count]' },
  ],
};
const ctx: CellContext = { scaleOf: () => FEET, sheets: {}, statuses: [], columns: [], assemblies: [assembly] };

const manualMarkup = (manual: ManualQuantity): Markup => ({
  id: 'm1',
  type: 'manual',
  pageIndex: 0,
  points: [[10, 10]],
  style: { stroke: '#0f766e', fill: '#f0fdfa', width: 1, opacity: 1 },
  manual,
  assemblyId: 'a',
  status: 'none',
  author: 'me',
  createdAt: 0,
  modifiedAt: 0,
});
const quantities = (manual: ManualQuantity) => Object.fromEntries(markupQuantities(manualMarkup(manual), [assembly], ctx)!.items.map((i) => [i.item.id, i.base]));
const near = (a: number | null | undefined, b: number) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);

test('a manual area is [Area] and [Quantity] in the page’s units, with no length or count of its own', () => {
  const q = quantities({ kind: 'area', value: 24 });
  near(q.area, 24 / SQ_FT);
  near(q.qty, 24 / SQ_FT);
  assert.equal(q.len, 0);
  assert.equal(q.vol, 0);
  assert.equal(q.cnt, 1);
  assert.equal(cellsFor(manualMarkup({ kind: 'area', value: 24 }), ctx).measurement!.text, '258.33 sf');
});

test('a manual length is [Length] and [Quantity]; a volume is [Volume]; a count is [Count] and [Quantity]', () => {
  const length = quantities({ kind: 'length', value: 3.048 });
  near(length.len, 10);
  near(length.qty, 10);
  assert.equal(length.area, 0);
  const volume = quantities({ kind: 'volume', value: 0.3048 ** 3 * 5 });
  near(volume.vol, 5);
  near(volume.qty, 5);
  const count = quantities({ kind: 'count', value: 7 });
  near(count.cnt, 7);
  near(count.qty, 7);
});

test('typed values convert to base units and back', () => {
  assert.equal(manualToBase('area', 30, 'm'), 30);
  near(manualToBase('area', 100, 'ft'), 100 * SQ_FT);
  near(manualToBase('length', 10, 'ft'), 3.048);
  near(manualToBase('volume', 1000, 'L'), 1);
  near(manualFromBase('area', 10000, 'ha'), 1);
  const q = makeManual('area', 12.5, 'ft', '  Level 2  ')!;
  assert.equal(q.unit, 'ft');
  assert.equal(q.note, 'Level 2');
  near(manualEditValue(q), 12.5);
  assert.equal(makeManual('area', -1, 'm'), null);
  assert.equal(makeManual('area', Number.NaN, 'm'), null);
  assert.deepEqual(makeManual('count', 4, 'whatever'), { kind: 'count', value: 4, unit: 'ea' });
  assert.equal(defaultManualUnit('area', FEET), 'ft');
  assert.equal(defaultManualUnit('count', FEET), 'ea');
});

test('the slope columns read a manual quantity as flat: plan value is the typed value, factor 1', () => {
  const area = cellsFor({ ...manualMarkup({ kind: 'area', value: 10 * SQ_FT }), slope: { kind: 'pitch', value: 12 } }, ctx);
  near(area.planArea?.num, 10);
  assert.equal(area.planLength?.text, '');
  near(area.slopeFactor?.num, 1);
  near(area.pitch?.num, 0);
  near(area.measurement?.num, 10);
  const run = cellsFor(manualMarkup({ kind: 'length', value: 4 * 0.3048 }), ctx);
  near(run.planLength?.num, 4);
  assert.equal(run.planArea?.text, '');
  near(run.slopeFactor?.num, 1);
  const vol = cellsFor(manualMarkup({ kind: 'volume', value: 1 }), ctx);
  assert.equal(vol.planLength?.text, '');
  assert.equal(vol.planArea?.text, '');
  near(vol.slopeFactor?.num, 1);
  assert.equal(cellsFor(manualMarkup({ kind: 'count', value: 3 }), ctx).slopeFactor?.text, '');
});
