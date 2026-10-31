import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Assembly, Markup } from '@nb/markup';
import type { Scale } from '@nb/measure';
import type { CellContext } from '../columns/listColumns';
import { assemblyProblems, markupQuantities, rollup, rollupToCsv, withWaste } from './quantities';
import { starterAssemblies, starterGroups } from './starters';

/** One PDF point is one foot. */
const FEET: Scale = { metersPerPoint: 0.3048, unit: 'ft', feetInches: false, precision: 2, label: 'test' };
const ctx = (assemblies: Assembly[]): CellContext => ({ scaleOf: () => FEET, sheets: {}, statuses: [], columns: [], assemblies });
const near = (a: number | null | undefined, b: number) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);

const wall: Assembly = {
  id: 'wall',
  name: 'Wall',
  variables: [
    { name: 'Spacing', value: 2 },
    { name: 'Wall Height', value: 10 },
  ],
  items: [
    { id: 'studs', name: 'Studs', unit: 'ea', formula: '[Length] / [Spacing] + 1', roundUp: true, waste: 10 },
    { id: 'board', name: 'Board', unit: 'sheets', formula: '[Length] * IF([Depth] > 0, [Depth], [Wall Height]) / 32', roundUp: true, unitCost: 12 },
  ],
};

let seq = 0;
const markup = (type: Markup['type'], points: [number, number][], extra: Partial<Markup> = {}): Markup => ({
  id: `m${++seq}`,
  type,
  pageIndex: 0,
  points,
  style: { stroke: '#f00', fill: null, width: 1, opacity: 1 },
  status: 'none',
  author: 'me',
  createdAt: 0,
  modifiedAt: 0,
  ...extra,
});

test('a length works out each item, with waste and rounding up', () => {
  const m = markup('length', [[0, 0], [20, 0]], { assemblyId: 'wall' });
  const q = markupQuantities(m, [wall], ctx([wall]))!;
  assert.equal(q.assembly.name, 'Wall');
  const [studs, board] = q.items;
  near(studs!.base, 11);
  near(studs!.quantity, 12.1);
  assert.equal(studs!.rounded, 13);
  // No depth: the Wall Height variable is used. 20 × 10 / 32 = 6.25 sheets, so 7 at 12 each.
  assert.equal(board!.rounded, 7);
  assert.equal(board!.cost, 84);
});

test('the measurement’s own depth is used when it has one', () => {
  const m = markup('length', [[0, 0], [32, 0]], { assemblyId: 'wall', depth: 8 * 0.3048 });
  near(markupQuantities(m, [wall], ctx([wall]))!.items[1]!.base, 8);
});

test('rounding up has a tolerance for floating point', () => {
  assert.equal(withWaste({ id: 'x', name: 'x', unit: '', formula: '', roundUp: true }, 3.0000000000001).rounded, 3);
});

test('rounds up to the multiple the item sets', () => {
  const to = (roundTo: number | undefined, base: number) => withWaste({ id: 'x', name: 'x', unit: '', formula: '', roundUp: true, roundTo }, base).rounded;
  assert.equal(to(10, 41), 50);
  assert.equal(to(10, 40), 40);
  assert.equal(to(10, 40.0000000001), 40);
  assert.equal(to(0.5, 2.1), 2.5);
  assert.equal(to(0.1, 0.3), 0.3);
  assert.equal(to(undefined, 2.1), 3);
  assert.equal(to(0, 2.1), 3, 'a zero step falls back to whole numbers');
  assert.equal(withWaste({ id: 'x', name: 'x', unit: '', formula: '', roundTo: 10 }, 41).rounded, 41, 'roundTo does nothing without roundUp');
});

test('totals round up once, to the item’s multiple', () => {
  const pipe: Assembly = { id: 'p', name: 'Pipe', variables: [], items: [{ id: 'pipe', name: 'Pipe', unit: 'ft', formula: '[Length]', roundUp: true, roundTo: 20, unitCost: 2 }] };
  const ms = [markup('length', [[0, 0], [25, 0]], { assemblyId: 'p' }), markup('length', [[0, 0], [30, 0]], { assemblyId: 'p' })];
  const row = rollup(ms, [pipe], ctx([pipe]), 'item')[0]!;
  near(row.quantity, 55);
  assert.equal(row.total, 60);
  assert.equal(row.cost, 120);
});

test('counts, areas and perimeters', () => {
  const doors: Assembly = { id: 'd', name: 'Doors', variables: [], items: [{ id: 'h', name: 'Hinges', unit: 'ea', formula: '[Count] * 3' }] };
  const slab: Assembly = {
    id: 's',
    name: 'Slab',
    variables: [{ name: 'Thickness', value: 0.5 }],
    items: [
      { id: 'c', name: 'Concrete', unit: 'cy', formula: '[Area] * [Thickness] / 27' },
      { id: 'e', name: 'Edge', unit: 'lf', formula: '[Perimeter]' },
    ],
  };
  const count = markup('count', [[0, 0], [1, 1], [2, 2]], { assemblyId: 'd' });
  assert.equal(markupQuantities(count, [doors], ctx([doors]))!.items[0]!.rounded, 9);
  const area = markup('area', [[0, 0], [54, 0], [54, 10], [0, 10]], { assemblyId: 's' });
  const [concrete, edge] = markupQuantities(area, [slab], ctx([slab]))!.items;
  near(concrete!.rounded, 10);
  near(edge!.rounded, 128);
});

test('no quantities without an assembly, or for one that was deleted', () => {
  assert.equal(markupQuantities(markup('length', [[0, 0], [1, 0]]), [wall], ctx([wall])), null);
  assert.equal(markupQuantities(markup('length', [[0, 0], [1, 0]], { assemblyId: 'gone' }), [wall], ctx([wall])), null);
});

test('a formula problem is reported on its item, not thrown', () => {
  const bad: Assembly = { id: 'b', name: 'Bad', variables: [], items: [{ id: 'i', name: 'X', unit: '', formula: '[Nope] * 2' }] };
  const r = markupQuantities(markup('length', [[0, 0], [1, 0]], { assemblyId: 'b' }), [bad], ctx([bad]))!.items[0]!;
  assert.equal(r.rounded, null);
  assert.match(r.error!, /Nope/);
});

test('rolling up by item rounds once, on the total', () => {
  const a = markup('length', [[0, 0], [10, 0]], { assemblyId: 'wall' });
  const b = markup('length', [[0, 0], [10, 0]], { assemblyId: 'wall', pageIndex: 1 });
  const rows = rollup([a, b], [wall], ctx([wall]), 'item');
  const board = rows.find((r) => r.item === 'Board')!;
  // Each wall is 3.125 sheets: ordered together that is 7 sheets, not 4 + 4.
  assert.equal(board.measurements, 2);
  near(board.quantity, 6.25);
  assert.equal(board.total, 7);
  assert.equal(board.cost, 84);
  const byPage = rollup([a, b], [wall], ctx([wall]), 'page');
  assert.deepEqual(
    byPage.filter((r) => r.item === 'Board').map((r) => [r.group, r.total]),
    [
      ['Page 1', 4],
      ['Page 2', 4],
    ],
  );
  const csv = rollupToCsv(rows, 'item');
  assert.match(csv.split('\r\n')[0]!, /^Item,Unit,Measurements/);
  assert.match(csv, /Board,sheets,2,6\.25,6\.25,7\.00,12\.00,84\.00/);
});

test('the same item in two assemblies adds up by item, and stays apart by assembly', () => {
  const other: Assembly = { ...wall, id: 'wall2', name: 'Wall 2' };
  const a = markup('length', [[0, 0], [10, 0]], { assemblyId: 'wall' });
  const b = markup('length', [[0, 0], [10, 0]], { assemblyId: 'wall2' });
  assert.equal(rollup([a, b], [wall, other], ctx([wall, other]), 'item').filter((r) => r.item === 'Studs').length, 1);
  assert.equal(rollup([a, b], [wall, other], ctx([wall, other]), 'assembly').filter((r) => r.item === 'Studs').length, 2);
});

test('problems: names, variables and unknown references', () => {
  assert.equal(assemblyProblems(wall, [wall], []).size, 0);
  const p = assemblyProblems(
    {
      id: 'x',
      name: 'wall',
      variables: [
        { name: 'Length', value: 1 },
        { name: 'A', value: 1 },
        { name: 'a', value: 2 },
      ],
      items: [
        { id: 'i', name: 'I', unit: '', formula: '[Missing] +' },
        { id: 'j', name: 'J', unit: '', formula: '[Missing] + 1' },
      ],
    },
    [wall],
    [],
  );
  assert.match(p.get('name')!, /Another assembly/);
  assert.match(p.get('var:0')!, /already/);
  assert.match(p.get('var:2')!, /Two variables/);
  assert.ok(p.get('item:i'));
  assert.match(p.get('item:j')!, /\[Missing\]/);
});

test('starter assemblies have no problems in either unit system', () => {
  for (const system of ['imperial', 'metric'] as const) {
    const list = starterAssemblies(system);
    for (const a of list) assert.deepEqual([...assemblyProblems(a, list, [])], [], `${system}: ${a.name}`);
  }
});

test('every starter is worked out to sensible quantities by some kind of measurement, and none carries a price', () => {
  const sample = (assemblyId: string): Markup[] => [
    markup('length', [[0, 0], [50, 0]], { assemblyId, depth: 6 }),
    markup('area', [[0, 0], [20, 0], [20, 10], [0, 10]], { assemblyId, depth: 1 }),
    markup('count', [[0, 0], [5, 5], [9, 9]], { assemblyId }),
  ];
  for (const system of ['imperial', 'metric'] as const) {
    const groups = starterGroups(system);
    assert.deepEqual(groups.map((g) => g.discipline), ['Architectural', 'Civil and site', 'Structural', 'Mechanical', 'Electrical']);
    const list = groups.flatMap((g) => g.assemblies);
    assert.equal(new Set(list.map((a) => a.name)).size, list.length, 'names are unique');
    for (const a of list) {
      const worked = sample(a.id).some((m) => markupQuantities(m, [a], ctx([a]))!.items.every((r) => r.rounded !== null && Number.isFinite(r.rounded) && r.rounded >= 0));
      assert.ok(worked, `${system}: ${a.name} is not worked out by a length, an area or a count`);
      for (const i of a.items) assert.equal(i.unitCost, undefined, `${a.name}: ${i.name} has a price`);
    }
  }
});

test('a quantity set by hand stands in for the formula, with waste and rounding still applied', () => {
  const m = markup('length', [[0, 0], [20, 0]], { assemblyId: 'wall', assemblyOverrides: { studs: 20 } });
  const [studs, board] = markupQuantities(m, [wall], ctx([wall]))!.items;
  near(studs!.base, 20);
  assert.equal(studs!.rounded, 22, '20 + 10% waste');
  assert.equal(board!.rounded, 7, 'the other item still uses its formula');
  assert.equal(studs!.set, true);
  assert.equal(board!.set, undefined);
  // Reshaped, the hand-set quantity stays; the totals say how many were set by hand.
  const longer = { ...m, points: [[0, 0], [40, 0]] as [number, number][] };
  near(markupQuantities(longer, [wall], ctx([wall]))!.items[0]!.base, 20);
  const plain = markup('length', [[0, 0], [20, 0]], { assemblyId: 'wall' });
  const rows = rollup([longer, plain], [wall], ctx([wall]), 'item');
  assert.deepEqual(rows.map((r) => [r.item, r.setByHand, r.measurements]), [['Studs', 1, 2], ['Board', 0, 2]]);
  assert.match(rollupToCsv(rows, 'item').split('\r\n')[0]!, /,Set by hand$/);
});
