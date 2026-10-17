import { isMeasureKind, type Assembly, type AssemblyItem, type CustomColumn, type Markup } from '@nb/markup';
import { evalFormula, formulaRefs, FormulaError, type Value } from '../columns/formula';
import { BUILT_IN_COLUMNS, cellsFor, customKey, formatNumber, type Cell, type CellContext } from '../columns/listColumns';

/**
 * Takeoff quantities from assemblies. Each item's formula is worked out per measurement from what
 * the Markups list shows for it (in the page's display units: feet and square feet on a feet scale,
 * metres on a metric one) and the assembly's variables; waste is added, then the quantity is
 * rounded up when the item says so. Totals round up once, on the total, as material is ordered.
 */

/** Names a formula can use besides the list's columns and the assembly's variables. */
export const MEASURED_NAMES: { name: string; hint: string }[] = [
  { name: 'Quantity', hint: 'The measurement itself: its length, area, volume or count' },
  { name: 'Length', hint: 'Length of a line or run; the perimeter of an area' },
  { name: 'Perimeter', hint: 'Same as Length' },
  { name: 'Area', hint: 'Area of an area or volume, cutouts taken off' },
  { name: 'Volume', hint: 'Volume (an area with a depth)' },
  { name: 'Wall Area', hint: 'Length × depth (a run with a height)' },
  { name: 'Depth', hint: 'The measurement’s depth or height' },
  { name: 'Count', hint: 'Items in a count; 1 for any other measurement' },
];

/** Every name a formula may refer to: measured values, list columns, then the assembly's variables. */
function lookupFor(m: Markup, cells: Readonly<Record<string, Cell>>, columns: readonly CustomColumn[], assembly: Assembly) {
  const byName = new Map<string, string>();
  for (const b of BUILT_IN_COLUMNS) byName.set(b.label.toLowerCase(), b.key);
  for (const c of columns) byName.set(c.name.trim().toLowerCase(), customKey(c.id));
  const special: Record<string, number | null> = {
    quantity: cells.measurement?.num ?? null,
    count: m.type === 'count' ? m.points.length : 1,
    perimeter: cells.length?.num ?? null,
  };
  return (name: string): Value | undefined => {
    const key = name.trim().toLowerCase();
    if (key in special) return special[key] ?? 0;
    const col = byName.get(key);
    if (col) {
      const c = cells[col];
      if (c?.error) throw new FormulaError(`[${name}]: ${c.error}`);
      return c?.num ?? c?.text ?? 0;
    }
    const v = assembly.variables.find((x) => x.name.trim().toLowerCase() === key);
    return v?.value;
  };
}

export interface ItemQuantity {
  item: AssemblyItem;
  /** The formula's result, before waste. */
  base: number | null;
  /** With waste added, before rounding. */
  quantity: number | null;
  /** With waste added and rounded up when the item rounds. */
  rounded: number | null;
  cost: number | null;
  error?: string;
}

/** `base` with the item's waste added, and rounded up when it rounds. */
export function withWaste(item: AssemblyItem, base: number): { quantity: number; rounded: number } {
  const quantity = base * (1 + (item.waste ?? 0) / 100);
  // A hair of tolerance, so 3.0000000001 sheets from floating point is still 3.
  return { quantity, rounded: item.roundUp ? Math.ceil(quantity - 1e-9) : quantity };
}

/** The quantities one measurement stands for under `assembly`. */
export function itemQuantities(m: Markup, assembly: Assembly, cells: Readonly<Record<string, Cell>>, columns: readonly CustomColumn[]): ItemQuantity[] {
  const lookup = lookupFor(m, cells, columns, assembly);
  return assembly.items.map((item) => {
    const res = item.formula.trim() ? evalFormula(item.formula, lookup) : { error: 'No formula' };
    if ('error' in res) return { item, base: null, quantity: null, rounded: null, cost: null, error: res.error };
    const base = typeof res.value === 'number' ? res.value : Number(res.value);
    if (!Number.isFinite(base)) return { item, base: null, quantity: null, rounded: null, cost: null, error: 'Not a number' };
    const { quantity, rounded } = withWaste(item, base);
    return { item, base, quantity, rounded, cost: item.unitCost !== undefined ? rounded * item.unitCost : null };
  });
}

/** A measurement's assembly and quantities; null when it has none (or it was deleted). */
export function markupQuantities(m: Markup, assemblies: readonly Assembly[], ctx: CellContext, cells?: Readonly<Record<string, Cell>>): { assembly: Assembly; items: ItemQuantity[] } | null {
  if (!m.assemblyId || !isMeasureKind(m.type)) return null;
  const assembly = assemblies.find((a) => a.id === m.assemblyId);
  if (!assembly) return null;
  return { assembly, items: itemQuantities(m, assembly, cells ?? cellsFor(m, ctx), ctx.columns) };
}

export type RollupBy = 'item' | 'assembly' | 'page';

export interface RollupRow {
  key: string;
  /** The assembly's name or the page's label; empty when rolling up by item. */
  group: string;
  item: string;
  unit: string;
  /** Measurements that contributed. */
  measurements: number;
  /** Before waste. */
  base: number;
  /** With waste. */
  quantity: number;
  /** With waste, rounded up once on the total when the item rounds. */
  total: number;
  /** The unit cost, when every contribution has the same one. */
  unitCost: number | null;
  cost: number | null;
  /** Measurements whose formula failed (left out of the totals). */
  errors: number;
}

/**
 * Totals of every measurement's assembly quantities. By item, the same item (name and unit) is
 * added up across assemblies, for ordering; by assembly or page, per assembly item.
 */
export function rollup(markups: readonly Markup[], assemblies: readonly Assembly[], ctx: CellContext, by: RollupBy, pageLabel: (pageIndex: number) => string = (i) => `Page ${i + 1}`): RollupRow[] {
  const rows = new Map<string, RollupRow & { rounds: boolean; costs: Set<number>; costSum: number }>();
  for (const m of markups) {
    const q = markupQuantities(m, assemblies, ctx);
    if (!q) continue;
    for (const r of q.items) {
      const itemKey = `${r.item.name.trim().toLowerCase()}\u0000${r.item.unit.trim().toLowerCase()}`;
      const group = by === 'assembly' ? q.assembly.name : by === 'page' ? pageLabel(m.pageIndex) : '';
      const key = by === 'assembly' ? `${q.assembly.id}\u0000${r.item.id}` : by === 'page' ? `${m.pageIndex}\u0000${itemKey}` : itemKey;
      let row = rows.get(key);
      if (!row) {
        row = { key, group, item: r.item.name, unit: r.item.unit, measurements: 0, base: 0, quantity: 0, total: 0, unitCost: null, cost: null, errors: 0, rounds: false, costs: new Set(), costSum: 0 };
        rows.set(key, row);
      }
      row.measurements++;
      if (r.base === null || r.quantity === null) {
        row.errors++;
        continue;
      }
      row.base += r.base;
      row.quantity += r.quantity;
      row.rounds ||= !!r.item.roundUp;
      if (r.item.unitCost !== undefined) {
        row.costs.add(r.item.unitCost);
        row.costSum += r.quantity * r.item.unitCost;
      }
    }
  }
  const out = [...rows.values()].map(({ rounds, costs, costSum, ...row }) => {
    const total = rounds ? Math.ceil(row.quantity - 1e-9) : row.quantity;
    const unitCost = costs.size === 1 ? [...costs][0]! : null;
    // One price: the ordered total at that price. Several: each contribution at its own.
    const cost = unitCost !== null ? total * unitCost : costs.size ? costSum : null;
    return { ...row, total, unitCost, cost };
  });
  // Pages in page order; groups otherwise in the order first seen.
  if (by === 'page') out.sort((a, b) => Number(a.key.split('\u0000')[0]) - Number(b.key.split('\u0000')[0]));
  return out;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Rolled-up quantities as CSV (the caller adds a BOM for Excel). */
export function rollupToCsv(rows: readonly RollupRow[], by: RollupBy): string {
  const head = [...(by === 'item' ? [] : [by === 'assembly' ? 'Assembly' : 'Page']), 'Item', 'Unit', 'Measurements', 'Measured', 'With waste', 'Total', 'Unit cost', 'Cost'];
  const n = (v: number | null, d = 2) => (v === null ? '' : formatNumber(v, d));
  const lines = rows.map((r) => [...(by === 'item' ? [] : [r.group]), r.item, r.unit, String(r.measurements), n(r.base), n(r.quantity), n(r.total), n(r.unitCost), n(r.cost)].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\r\n');
}

/** Problems with an assembly that would stop it working, keyed by `name`, `var:<index>` or `item:<id>`. */
export function assemblyProblems(a: Assembly, others: readonly Assembly[], columns: readonly CustomColumn[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!a.name.trim()) out.set('name', 'Give the assembly a name');
  else if (others.some((o) => o.id !== a.id && o.name.trim().toLowerCase() === a.name.trim().toLowerCase())) out.set('name', 'Another assembly has this name');
  const measured = new Set([...MEASURED_NAMES.map((x) => x.name), ...BUILT_IN_COLUMNS.map((b) => b.label), ...columns.map((c) => c.name.trim())].map((x) => x.toLowerCase()));
  const seen = new Set<string>();
  a.variables.forEach((v, i) => {
    const key = v.name.trim().toLowerCase();
    if (!key) out.set(`var:${i}`, 'Name the variable');
    else if (/[[\]]/.test(key)) out.set(`var:${i}`, 'Names cannot contain [ or ]');
    else if (measured.has(key)) out.set(`var:${i}`, `[${v.name.trim()}] is already a measured value or column`);
    else if (seen.has(key)) out.set(`var:${i}`, 'Two variables have this name');
    else if (!Number.isFinite(v.value)) out.set(`var:${i}`, 'Enter a number');
    seen.add(key);
  });
  for (const item of a.items) {
    const key = `item:${item.id}`;
    if (!item.name.trim()) {
      out.set(key, 'Name the item');
      continue;
    }
    if (!item.formula.trim()) {
      out.set(key, 'Enter a formula, e.g. [Length] / [Spacing] + 1');
      continue;
    }
    try {
      const unknown = formulaRefs(item.formula).filter((r) => !measured.has(r.trim().toLowerCase()) && !seen.has(r.trim().toLowerCase()));
      if (unknown.length) out.set(key, `No measured value, column or variable named ${unknown.map((u) => `[${u}]`).join(', ')}`);
    } catch (err) {
      out.set(key, err instanceof Error ? err.message : String(err));
    }
    if (item.waste !== undefined && (!Number.isFinite(item.waste) || item.waste < -100 || item.waste > 1000)) out.set(key, 'Waste is a percentage between -100 and 1000');
  }
  return out;
}

/** What the Assembly column and pickers call an assembly a measurement uses (or why it has none). */
export function assemblyName(m: Pick<Markup, 'assemblyId'>, assemblies: readonly Assembly[]): string {
  if (!m.assemblyId) return '';
  return assemblies.find((a) => a.id === m.assemblyId)?.name ?? '(deleted assembly)';
}
