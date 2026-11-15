import { isMeasureKind, ITEM_CATEGORIES, markupLabel, MARKUP_LABELS, measureProps, type Assembly, type Item, type Markup } from '@nb/markup';
import type { ReportColumn, ReportRow, ReportTable } from '@nb/markup/report';
import { areaUnitOf, DEFAULT_SCALE, formatSlope, measureDetails, measureValue, METERS_PER_UNIT, quantityOf, scaleEquation, slopeApplies, slopeIsFlat, toDisplayQuantity, type Scale } from '@nb/measure';
import { ceilTo, markupQuantities, roundStep, type ItemQuantity } from '../assemblies/quantities';
import { cellsFor, type CellContext } from '../columns/listColumns';

/**
 * Takeoff reports: the measurements' quantities laid out the way an estimator reads them. Each
 * builder is a pure function from the measurements, the assemblies (with their catalog links
 * filled in) and the catalog to a `ReportTable`, which the PDF, Excel and CSV writers then show.
 * Quantities are in each page's display units; quantities in different units are never added.
 */

export type ReportId = 'byItem' | 'byAssembly' | 'bySheet' | 'detail' | 'counts';

export const REPORTS: { id: ReportId; title: string; hint: string }[] = [
  { id: 'byItem', title: 'Quantity Summary by Item', hint: 'Each item once, with waste, the quantity to order and its cost, grouped by category' },
  { id: 'byAssembly', title: 'Quantities by Assembly', hint: 'Each assembly’s items, with a cost subtotal per assembly' },
  { id: 'bySheet', title: 'Quantities by Sheet', hint: 'The items on each sheet, with a cost subtotal per sheet' },
  { id: 'detail', title: 'Measurement Detail', hint: 'One row per measurement: plan and sloped quantity, cutouts, depth and assembly' },
  { id: 'counts', title: 'Count Schedule', hint: 'Counts by subject and sheet, with totals' },
];

export type ReportScope = 'all' | 'page' | 'selection' | 'list';

export interface ReportInput {
  /** The measurements to report on (already limited to the scope). Other markups are ignored. */
  markups: readonly Markup[];
  /** The document's assemblies with their items' catalog links filled in (`store.resolvedAssemblies()`). */
  assemblies: readonly Assembly[];
  /** The catalog, for item numbers, categories and descriptions. */
  items: readonly Item[];
  ctx: CellContext;
  /** A page's name: its sheet number, else "Page N". */
  pageLabel: (pageIndex: number) => string;
}

/** The markups a scope stands for. `listIds` are the ones the Markups list shows (its filter applied). */
export function scopeMarkups(markups: readonly Markup[], scope: ReportScope, o: { pageIndex: number; selected: ReadonlySet<string>; listIds?: ReadonlySet<string> }): Markup[] {
  switch (scope) {
    case 'page':
      return markups.filter((m) => m.pageIndex === o.pageIndex);
    case 'selection':
      return markups.filter((m) => o.selected.has(m.id));
    case 'list':
      return markups.filter((m) => o.listIds?.has(m.id));
    default:
      return [...markups];
  }
}

/** A page's name in reports: its sheet number, else "Page N". */
export function reportPageLabel(sheets: Readonly<Record<number, { number: string | null }>>): (pageIndex: number) => string {
  return (i) => sheets[i]?.number || `Page ${i + 1}`;
}

export function scopeLabel(scope: ReportScope, o: { pageLabel: string; count: number }): string {
  switch (scope) {
    case 'page':
      return `Page ${o.pageLabel}`;
    case 'selection':
      return `Selection (${o.count} markup${o.count === 1 ? '' : 's'})`;
    case 'list':
      return 'Markups list, as filtered';
    default:
      return 'All pages';
  }
}

/** Set when the measurements are on pages with different scales: each is then in its own page's units. */
export function scaleNote(markups: readonly Markup[], ctx: Pick<CellContext, 'scaleOf'>, pageLabel: (i: number) => string): string | undefined {
  const byScale = new Map<string, Set<number>>();
  for (const m of markups) {
    if (!isMeasureKind(m.type) || m.type === 'manual') continue;
    const scale = ctx.scaleOf(m) ?? DEFAULT_SCALE;
    const label = scaleEquation(scale);
    const pages = byScale.get(label) ?? new Set<number>();
    pages.add(m.pageIndex);
    byScale.set(label, pages);
  }
  if (byScale.size < 2) return undefined;
  const parts = [...byScale].map(([label, pages]) => `${label} (${[...pages].sort((a, b) => a - b).map(pageLabel).join(', ')})`);
  return `Pages use different scales: ${parts.join('; ')}. Each measurement is in its own page's units.`;
}

const col = (key: string, label: string, format: ReportColumn['format'] = 'text'): ReportColumn => ({ key, label, align: format === 'text' ? 'left' : 'right', format });

const UNCATEGORISED = 'Uncategorised';

/** One report row's worth of figures, added up over measurements. */
interface Bucket {
  itemNo: string;
  description: string;
  category: string;
  unit: string;
  net: number;
  gross: number;
  measurements: number;
  step: number;
  costs: Set<number>;
  costSum: number;
  wastes: Set<number>;
}

function categoryOf(item: Item | undefined): string {
  return item ? (ITEM_CATEGORIES.find((c) => c.value === item.category)?.label ?? item.category) : UNCATEGORISED;
}

/** Adds one measurement's item quantity into a bucket (created from the item on first use). */
function addTo(buckets: Map<string, Bucket>, key: string, r: ItemQuantity, catalog: Item | undefined) {
  let b = buckets.get(key);
  if (!b) {
    const name = r.item.name.trim() || catalog?.name || '(unnamed)';
    b = {
      itemNo: catalog?.itemNo ?? catalog?.sku ?? '',
      description: catalog?.description?.trim() && catalog.description.trim() !== name ? `${name} - ${catalog.description.trim()}` : name,
      category: categoryOf(catalog),
      unit: r.item.unit,
      net: 0,
      gross: 0,
      measurements: 0,
      step: 0,
      costs: new Set(),
      costSum: 0,
      wastes: new Set(),
    };
    buckets.set(key, b);
  }
  if (r.base === null || r.quantity === null) return;
  b.measurements++;
  b.net += r.base;
  b.gross += r.quantity;
  b.wastes.add(r.item.waste ?? 0);
  if (r.item.roundUp) b.step = Math.max(b.step, roundStep(r.item));
  if (r.item.unitCost !== undefined) {
    b.costs.add(r.item.unitCost);
    b.costSum += r.quantity * r.item.unitCost;
  }
}

/** A bucket as a row: the order quantity rounds up once, on the total; one unit cost prices the order, several price each contribution. */
function bucketRow(b: Bucket): ReportRow & { cost: number | null } {
  const order = b.step > 0 ? ceilTo(b.gross, b.step) : b.gross;
  const unitCost = b.costs.size === 1 ? [...b.costs][0]! : null;
  const cost = unitCost !== null ? order * unitCost : b.costs.size ? b.costSum : null;
  // One waste for every contribution reads as that percentage; mixed ones as what they came to.
  const waste = b.wastes.size === 1 ? [...b.wastes][0]! : b.net ? (b.gross / b.net - 1) * 100 : 0;
  return { itemNo: b.itemNo, description: b.description, category: b.category, unit: b.unit, net: b.net, waste, gross: b.gross, order, unitCost, cost };
}

const QUANTITY_COLUMNS: ReportColumn[] = [
  col('itemNo', 'Item No'),
  col('description', 'Description'),
  col('category', 'Category'),
  col('unit', 'Unit'),
  col('net', 'Net Qty', 'qty'),
  col('waste', 'Waste %', 'pct'),
  col('gross', 'Gross Qty', 'qty'),
  col('order', 'Order Qty', 'qty'),
  col('unitCost', 'Unit Cost', 'money'),
  col('cost', 'Extended Cost', 'money'),
];

const sum = (rows: readonly { cost?: ReportRow[string] }[]): number | null => {
  const costs = rows.map((r) => r.cost).filter((c): c is number => typeof c === 'number');
  return costs.length ? costs.reduce((a, b) => a + b, 0) : null;
};

interface Quantified {
  m: Markup;
  assembly: Assembly;
  items: ItemQuantity[];
}

function quantified(input: ReportInput): Quantified[] {
  const out: Quantified[] = [];
  for (const m of input.markups) {
    const q = markupQuantities(m, input.assemblies, input.ctx);
    if (q) out.push({ m, ...q });
  }
  return out;
}

/** Notes every quantity report carries: measurements left out, and quantities set by hand. */
function quantityNotes(rows: readonly Quantified[]): string[] {
  const failed = rows.filter((q) => q.items.some((i) => i.base === null)).length;
  const notes = ['Quantities in different units are listed on separate rows and never added together. Costs are added.'];
  if (failed) notes.push(`${failed} measurement${failed === 1 ? ' has' : 's have'} an item whose formula does not work, and ${failed === 1 ? 'is' : 'are'} left out of those items.`);
  return notes;
}

function itemKey(r: ItemQuantity): string {
  return r.item.itemId ? `i:${r.item.itemId}\u0000${r.item.unit.trim().toLowerCase()}` : `n:${r.item.name.trim().toLowerCase()}\u0000${r.item.unit.trim().toLowerCase()}`;
}

function byItem(input: ReportInput): ReportTable {
  const qs = quantified(input);
  const buckets = new Map<string, Bucket>();
  for (const q of qs) for (const r of q.items) addTo(buckets, itemKey(r), r, input.items.find((i) => i.id === r.item.itemId));
  const rows = [...buckets.values()].map(bucketRow);
  const order = [...ITEM_CATEGORIES.map((c) => c.label), UNCATEGORISED];
  const groups = order
    .map((category) => {
      const inGroup = rows.filter((r) => r.category === category).sort((a, b) => String(a.description).localeCompare(String(b.description), undefined, { numeric: true, sensitivity: 'base' }));
      return { heading: category, rows: inGroup, subtotal: { description: `Subtotal - ${category}`, cost: sum(inGroup) } };
    })
    .filter((g) => g.rows.length);
  return { title: 'Quantity Summary by Item', columns: QUANTITY_COLUMNS, groups, grandTotal: { description: 'Total', cost: sum(rows) }, notes: quantityNotes(qs) };
}

function byAssembly(input: ReportInput): ReportTable {
  const qs = quantified(input);
  const byId = new Map<string, { assembly: Assembly; buckets: Map<string, Bucket> }>();
  for (const q of qs) {
    const g = byId.get(q.assembly.id) ?? { assembly: q.assembly, buckets: new Map() };
    byId.set(q.assembly.id, g);
    for (const r of q.items) addTo(g.buckets, r.item.id, r, input.items.find((i) => i.id === r.item.itemId));
  }
  const groups = [...byId.values()]
    .sort((a, b) => a.assembly.name.localeCompare(b.assembly.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map(({ assembly, buckets }) => {
      const rows = [...buckets.values()].map(bucketRow);
      return { heading: assembly.name, rows, subtotal: { description: `Subtotal - ${assembly.name}`, cost: sum(rows) } };
    });
  return { title: 'Quantities by Assembly', columns: QUANTITY_COLUMNS, groups, grandTotal: { description: 'Total', cost: sum(groups.flatMap((g) => g.rows)) }, notes: quantityNotes(qs) };
}

function bySheet(input: ReportInput): ReportTable {
  const qs = quantified(input);
  const pages = new Map<number, Map<string, Bucket>>();
  for (const q of qs) {
    const buckets = pages.get(q.m.pageIndex) ?? new Map<string, Bucket>();
    pages.set(q.m.pageIndex, buckets);
    for (const r of q.items) addTo(buckets, itemKey(r), r, input.items.find((i) => i.id === r.item.itemId));
  }
  const groups = [...pages]
    .sort((a, b) => a[0] - b[0])
    .map(([pageIndex, buckets]) => {
      const label = input.pageLabel(pageIndex);
      const rows = [...buckets.values()].map(bucketRow);
      return { heading: label, rows, subtotal: { description: `Subtotal - ${label}`, cost: sum(rows) } };
    });
  return { title: 'Quantities by Sheet', columns: QUANTITY_COLUMNS, groups, grandTotal: { description: 'Total', cost: sum(groups.flatMap((g) => g.rows)) }, notes: quantityNotes(qs) };
}

function detail(input: ReportInput): ReportTable {
  const rows: ReportRow[] = [];
  const ordered = input.markups.filter((m) => isMeasureKind(m.type)).sort((a, b) => a.pageIndex - b.pageIndex || (a.seq ?? 0) - (b.seq ?? 0) || a.createdAt - b.createdAt);
  for (const m of ordered) {
    if (!isMeasureKind(m.type)) continue;
    const scale: Scale = input.ctx.scaleOf(m) ?? DEFAULT_SCALE;
    const props = measureProps(m);
    const cells = cellsFor(m, input.ctx);
    const value = measureValue(m.type, m.points, scale.metersPerPoint, props, scale.yMetersPerPoint);
    const shown = toDisplayQuantity(m.type, value, scale, props);
    const q = quantityOf(m.type, props);
    // The quantity before its slope (a flat or unsloped measurement is its own plan quantity).
    const plan = q === 'length' ? cells.planLength?.num : q === 'area' ? cells.planArea?.num : null;
    const sloped = (q === 'length' || q === 'area') && m.slope && slopeApplies(m.type, m.slope) && !slopeIsFlat(m.slope);
    const holes = q === 'area' || q === 'volume' ? (m.holes?.length ?? 0) : 0;
    let cutoutArea: number | null = null;
    if (holes) {
      const net = measureDetails(m.type, m.points, scale.metersPerPoint, props, scale.yMetersPerPoint).area;
      const gross = measureDetails(m.type, m.points, scale.metersPerPoint, { ...props, holes: undefined, holeBulges: undefined }, scale.yMetersPerPoint).area;
      const perArea = METERS_PER_UNIT[areaUnitOf(scale)];
      if (net !== undefined && gross !== undefined) cutoutArea = (gross - net) / (perArea * perArea);
    }
    rows.push({
      page: input.pageLabel(m.pageIndex),
      subject: m.subject || MARKUP_LABELS[m.type] || 'Markup',
      label: markupLabel(m),
      type: MARKUP_LABELS[m.type] ?? m.type,
      planQty: plan ?? shown.value,
      unit: shown.unit,
      slope: sloped ? formatSlope(m.slope!) : '',
      slopeFactor: q === 'length' || q === 'area' ? (cells.slopeFactor?.num ?? 1) : null,
      trueQty: shown.value,
      cutouts: holes || null,
      cutoutArea,
      depth: m.depth ? (cells.depth?.num ?? null) : null,
      manual: m.manual ? 'Yes' : '',
      assembly: cells.assembly?.text ?? '',
    });
  }
  return {
    title: 'Measurement Detail',
    columns: [
      col('page', 'Page'),
      col('subject', 'Subject'),
      col('label', 'Label'),
      col('type', 'Type'),
      col('planQty', 'Plan Qty', 'qty'),
      col('unit', 'Unit'),
      col('slope', 'Slope'),
      col('slopeFactor', 'Slope Factor', 'qty'),
      col('trueQty', 'True Qty', 'qty'),
      { ...col('cutouts', 'Cutouts'), align: 'right' },
      col('cutoutArea', 'Cutout Area', 'qty'),
      col('depth', 'Depth', 'qty'),
      col('manual', 'Manual'),
      col('assembly', 'Assembly'),
    ],
    groups: [{ rows }],
    notes: ['Plan Qty is before the slope and True Qty after it; both are in the page’s display units. Cutout Area is the area taken off (in the page’s area unit). Depth is in the page’s length unit.'],
  };
}

function counts(input: ReportInput): ReportTable {
  const counted = input.markups.filter((m) => isMeasureKind(m.type) && quantityOf(m.type, measureProps(m)) === 'count');
  const pages = [...new Set(counted.map((m) => m.pageIndex))].sort((a, b) => a - b);
  const subjects = new Map<string, Map<number, number>>();
  for (const m of counted) {
    if (!isMeasureKind(m.type)) continue;
    const subject = m.subject?.trim() || (m.type === 'manual' ? 'Manual count' : (MARKUP_LABELS[m.type] ?? 'Count'));
    const scale = input.ctx.scaleOf(m) ?? DEFAULT_SCALE;
    const n = measureValue(m.type, m.points, scale.metersPerPoint, measureProps(m), scale.yMetersPerPoint);
    const perPage = subjects.get(subject) ?? new Map<number, number>();
    perPage.set(m.pageIndex, (perPage.get(m.pageIndex) ?? 0) + n);
    subjects.set(subject, perPage);
  }
  const columns: ReportColumn[] = [col('subject', 'Subject'), ...pages.map((p) => col(`p${p}`, input.pageLabel(p), 'qty')), col('total', 'Total', 'qty')];
  const rows: ReportRow[] = [...subjects]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
    .map(([subject, perPage]) => ({ subject, ...Object.fromEntries(pages.map((p) => [`p${p}`, perPage.get(p) ?? null])), total: [...perPage.values()].reduce((a, b) => a + b, 0) }));
  const total: ReportRow = { subject: 'Total', ...Object.fromEntries(pages.map((p) => [`p${p}`, rows.reduce((n, r) => n + (Number(r[`p${p}`]) || 0), 0)])), total: rows.reduce((n, r) => n + (Number(r.total) || 0), 0) };
  return { title: 'Count Schedule', columns, groups: [{ rows }], grandTotal: rows.length ? total : undefined, notes: ['Counts include typed (manual) counts.'] };
}

export function buildReport(id: ReportId, input: ReportInput): ReportTable {
  switch (id) {
    case 'byItem':
      return byItem(input);
    case 'byAssembly':
      return byAssembly(input);
    case 'bySheet':
      return bySheet(input);
    case 'detail':
      return detail(input);
    case 'counts':
      return counts(input);
  }
}

export function buildReports(ids: readonly ReportId[], input: ReportInput): ReportTable[] {
  return REPORTS.filter((r) => ids.includes(r.id)).map((r) => buildReport(r.id, input));
}
