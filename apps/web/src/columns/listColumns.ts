import { isMeasureKind, isTextType, MARKUP_LABELS, measureProps, spacePath, threadReplies, type CustomColumn, type Markup, type MarkupStatusDef, type Reply } from '@nb/markup';
import { areaUnitOf, DEFAULT_SCALE, formatArea, formatLength, formatMeasure, formatSlope, formatVolume, measureDetails, measureValue, METERS_PER_UNIT, toDisplayQuantity, volumeUnitOf, type Scale } from '@nb/measure';
import type { SheetInfo } from '@nb/sheets';
import { evalFormula, FormulaError, type Value } from './formula';

/** One cell: what is shown, and what it sorts, filters and calculates by. */
export interface Cell {
  text: string;
  /** Numeric value when the cell is a number (sorting, comparisons, formulas). */
  num: number | null;
  /** Formula problem, shown instead of a value. */
  error?: string;
}

export interface ListColumn {
  key: string;
  label: string;
  /** Custom column definition (custom columns only). */
  custom?: CustomColumn;
  align?: 'right';
  defaultWidth: number;
}

/** Built-in columns, in their default order. */
export const BUILT_IN_COLUMNS: ListColumn[] = [
  { key: 'seq', label: 'ID', align: 'right', defaultWidth: 48 },
  { key: 'subject', label: 'Subject', defaultWidth: 130 },
  { key: 'page', label: 'Page', align: 'right', defaultWidth: 56 },
  { key: 'sheet', label: 'Page Label', defaultWidth: 90 },
  { key: 'space', label: 'Space', defaultWidth: 130 },
  { key: 'measurement', label: 'Measurement', align: 'right', defaultWidth: 110 },
  { key: 'length', label: 'Length', align: 'right', defaultWidth: 100 },
  { key: 'area', label: 'Area', align: 'right', defaultWidth: 100 },
  { key: 'volume', label: 'Volume', align: 'right', defaultWidth: 100 },
  { key: 'wallArea', label: 'Wall Area', align: 'right', defaultWidth: 100 },
  { key: 'depth', label: 'Depth', align: 'right', defaultWidth: 90 },
  { key: 'slope', label: 'Slope', align: 'right', defaultWidth: 70 },
  { key: 'author', label: 'Author', defaultWidth: 100 },
  { key: 'date', label: 'Date', defaultWidth: 140 },
  { key: 'status', label: 'Status', defaultWidth: 220 },
  { key: 'checked', label: 'Checkmark', defaultWidth: 50 },
  { key: 'comment', label: 'Comments', defaultWidth: 220 },
  { key: 'type', label: 'Type', defaultWidth: 90 },
  { key: 'color', label: 'Colour', defaultWidth: 70 },
  { key: 'capture', label: 'Capture', defaultWidth: 70 },
];

/** Shown until the user changes the layout. */
const DEFAULT_VISIBLE = new Set(['seq', 'subject', 'page', 'measurement', 'author', 'date', 'status', 'comment']);

export const customKey = (id: string) => `custom:${id}`;

export function listColumns(custom: readonly CustomColumn[]): ListColumn[] {
  return [
    ...BUILT_IN_COLUMNS,
    ...custom.map((c) => ({
      key: customKey(c.id),
      label: c.name,
      custom: c,
      align: c.type === 'number' || c.type === 'formula' ? ('right' as const) : undefined,
      defaultWidth: c.type === 'multiline' ? 200 : 120,
    })),
  ];
}

/** Saved order, width and visibility of one column. */
export interface ColumnLayout {
  key: string;
  width: number;
  hidden: boolean;
}

/**
 * The columns to show, in the saved order. Columns the layout does not know yet (new custom
 * columns) are added visible at the end; saved columns that no longer exist are dropped.
 */
export function resolveLayout(layout: readonly ColumnLayout[], columns: readonly ListColumn[]): (ListColumn & ColumnLayout)[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const out: (ListColumn & ColumnLayout)[] = [];
  const seen = new Set<string>();
  for (const l of layout) {
    const c = byKey.get(l.key);
    if (!c || seen.has(l.key)) continue;
    seen.add(l.key);
    out.push({ ...c, ...l });
  }
  const fresh = !layout.length;
  for (const c of columns) {
    if (seen.has(c.key)) continue;
    const col = { ...c, width: c.defaultWidth, hidden: fresh ? !DEFAULT_VISIBLE.has(c.key) && !c.custom : false };
    // The markup ID leads the list, also in layouts saved before it existed.
    if (c.key === 'seq') out.unshift(col);
    else out.push(col);
  }
  return out;
}

export interface CellContext {
  /** The scale a markup is measured at (its viewport's, else its page's). */
  scaleOf: (m: Markup) => Scale;
  sheets: Readonly<Record<number, SheetInfo>>;
  /** The document's Spaces, for the Space column. */
  spaces?: readonly Markup[];
  statuses: readonly MarkupStatusDef[];
  columns: readonly CustomColumn[];
}

const cell = (text: string, num: number | null = null): Cell => ({ text, num });

function parseNumber(s: string): number | null {
  const n = Number(s.replace(/[,$\s]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
}

export function formatNumber(n: number, decimals?: number): string {
  return decimals !== undefined ? n.toFixed(decimals) : String(Math.round(n * 1e6) / 1e6);
}

export function statusName(id: string, statuses: readonly MarkupStatusDef[]): string {
  if (id === 'none' || !id) return '';
  return statuses.find((s) => s.id === id)?.name ?? id;
}

/** Every column's cell for one markup, calculation columns included. */
export function cellsFor(m: Markup, ctx: CellContext): Record<string, Cell> {
  const scale = ctx.scaleOf(m) ?? DEFAULT_SCALE;
  const props = measureProps(m);
  const value = isMeasureKind(m.type) ? measureValue(m.type, m.points, scale.metersPerPoint, props) : null;
  const qty = value !== null && isMeasureKind(m.type) ? toDisplayQuantity(m.type, value, scale) : null;
  const details = isMeasureKind(m.type) ? measureDetails(m.type, m.points, scale.metersPerPoint, props) : {};
  const per = METERS_PER_UNIT[scale.unit];
  const perArea = METERS_PER_UNIT[areaUnitOf(scale)];
  const perVolume = METERS_PER_UNIT[volumeUnitOf(scale)];
  // Secondary quantities: text as shown, numbers in the page's display units for sorting and formulas.
  const q = (v: number | undefined, fmt: (v: number, s: Scale) => string, div: number) => (v === undefined ? cell('') : cell(fmt(v, scale), v / div));
  const out: Record<string, Cell> = {
    seq: cell(m.seq ? String(m.seq) : '', m.seq ?? null),
    subject: cell(m.subject || MARKUP_LABELS[m.type] || 'Markup'),
    page: cell(String(m.pageIndex + 1), m.pageIndex + 1),
    sheet: cell(ctx.sheets[m.pageIndex]?.number ?? ''),
    space: cell(ctx.spaces?.length ? spacePath(m, ctx.spaces) : ''),
    measurement: cell(value !== null && isMeasureKind(m.type) ? formatMeasure(m.type, value, scale) : '', qty ? qty.value : null),
    length: q(details.length, formatLength, per),
    area: q(details.area, formatArea, perArea * perArea),
    volume: q(details.volume, formatVolume, perVolume * perVolume * perVolume),
    wallArea: q(details.wallArea, formatArea, perArea * perArea),
    depth: q(m.depth, formatLength, per),
    slope: cell(m.slope?.value ? formatSlope(m.slope) : ''),
    author: cell(m.author),
    date: { text: new Date(m.modifiedAt).toLocaleString(), num: m.modifiedAt },
    status: cell(statusName(m.status, ctx.statuses)),
    checked: { text: m.checked ? '✓' : '', num: m.checked ? 1 : 0 },
    comment: cell((isTextType(m.type) ? m.text : m.comment) ?? ''),
    type: cell(MARKUP_LABELS[m.type] ?? m.type),
    color: cell(m.style.stroke),
    capture: cell(m.capture ? 'Yes' : ''),
  };
  const formulas: CustomColumn[] = [];
  for (const c of ctx.columns) {
    const raw = m.fields?.[c.id] ?? '';
    if (c.type === 'formula') formulas.push(c);
    else if (c.type === 'number') {
      const n = parseNumber(raw);
      out[customKey(c.id)] = cell(n !== null ? formatNumber(n, c.decimals) : raw, n);
    } else if (c.type === 'checkmark') {
      const on = raw === 'true';
      out[customKey(c.id)] = { text: on ? '✓' : '', num: on ? 1 : 0 };
    } else if (c.type === 'date') {
      const t = raw ? Date.parse(raw) : Number.NaN;
      out[customKey(c.id)] = { text: raw && !Number.isNaN(t) ? new Date(t).toLocaleDateString(undefined, { timeZone: 'UTC' }) : raw, num: Number.isNaN(t) ? null : t };
    } else {
      out[customKey(c.id)] = cell(raw, parseNumber(raw));
    }
  }

  // Formulas refer to columns by their display name. Calculation columns can use each other;
  // `visiting` catches circular references.
  const byName = new Map<string, string>();
  for (const b of BUILT_IN_COLUMNS) byName.set(b.label.toLowerCase(), b.key);
  byName.set('comment', 'comment');
  byName.set('color', 'color');
  for (const c of ctx.columns) byName.set(c.name.trim().toLowerCase(), customKey(c.id));
  const visiting = new Set<string>();
  const computeFormula = (c: CustomColumn): Cell => {
    const key = customKey(c.id);
    if (out[key]) return out[key];
    if (visiting.has(key)) return { text: '', num: null, error: 'Circular reference' };
    visiting.add(key);
    const res = evalFormula(c.formula ?? '', (name): Value | undefined => {
      const k = byName.get(name.trim().toLowerCase());
      if (!k) return undefined;
      const target = ctx.columns.find((x) => customKey(x.id) === k && x.type === 'formula');
      const v = target ? computeFormula(target) : out[k];
      if (!v) return undefined;
      if (v.error) throw new FormulaError(`[${name}]: ${v.error}`);
      return v.num ?? v.text;
    });
    visiting.delete(key);
    const result: Cell =
      'error' in res
        ? { text: '', num: null, error: res.error }
        : typeof res.value === 'number'
          ? { text: formatNumber(res.value, c.decimals), num: res.value }
          : { text: String(res.value), num: null };
    out[key] = result;
    return result;
  };
  for (const c of formulas) computeFormula(c);
  return out;
}

/** Markups missing a value in a required column, with the columns they are missing. */
export function missingRequired(m: Markup, columns: readonly CustomColumn[]): CustomColumn[] {
  return columns.filter((c) => c.required && c.type !== 'formula' && !(m.fields?.[c.id] ?? '').trim());
}

/**
 * Whether a cell matches a column filter. Filters are typed the way people think about them:
 * `plan` contains "plan", `!plan` does not, `=Accepted` is exact, `>10` / `<=5` compare numbers,
 * and `(blank)` / `(not blank)` match empty or filled cells.
 */
export function matchesFilter(c: Cell | undefined, filter: string): boolean {
  const f = filter.trim();
  if (!f) return true;
  const text = (c?.text ?? '').toLowerCase();
  const lower = f.toLowerCase();
  if (lower === '(blank)') return text === '';
  if (lower === '(not blank)') return text !== '';
  const cmp = /^(>=|<=|<>|>|<|=)\s*(.*)$/.exec(f);
  if (cmp) {
    const [, op, rhs] = cmp as unknown as [string, string, string];
    const n = parseNumber(rhs);
    if (n !== null && c?.num !== null && c?.num !== undefined && op !== '=' && op !== '<>') {
      const v = c.num;
      return op === '>' ? v > n : op === '<' ? v < n : op === '>=' ? v >= n : v <= n;
    }
    if (op === '=') return n !== null && c?.num != null ? c.num === n : text === rhs.toLowerCase();
    if (op === '<>') return n !== null && c?.num != null ? c.num !== n : text !== rhs.toLowerCase();
    return false;
  }
  if (lower.startsWith('!')) return !text.includes(lower.slice(1));
  return text.includes(lower);
}

export function compareCells(a: Cell | undefined, b: Cell | undefined): number {
  const an = a?.num ?? null;
  const bn = b?.num ?? null;
  if (an !== null && bn !== null) return an - bn;
  if (an !== null) return -1;
  if (bn !== null) return 1;
  const at = a?.text ?? '';
  const bt = b?.text ?? '';
  // Empty cells sort last either way round.
  if (!at && bt) return 1;
  if (at && !bt) return -1;
  return at.localeCompare(bt, undefined, { numeric: true, sensitivity: 'base' });
}

/** Filter builder conditions, each written as a column filter (see `matchesFilter`). */
export type FilterOp = 'contains' | 'notContains' | 'equals' | 'notEquals' | 'gt' | 'lt' | 'gte' | 'lte' | 'blank' | 'notBlank';

export const FILTER_OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'notContains', label: 'does not contain', needsValue: true },
  { value: 'equals', label: 'is', needsValue: true },
  { value: 'notEquals', label: 'is not', needsValue: true },
  { value: 'gt', label: 'is greater than', needsValue: true },
  { value: 'gte', label: 'is at least', needsValue: true },
  { value: 'lt', label: 'is less than', needsValue: true },
  { value: 'lte', label: 'is at most', needsValue: true },
  { value: 'blank', label: 'is empty', needsValue: false },
  { value: 'notBlank', label: 'is not empty', needsValue: false },
];

export interface FilterRule {
  key: string;
  op: FilterOp;
  value: string;
}

/** Filter builder: rules that must all match, or any one of them. */
export interface AdvancedFilter {
  match: 'all' | 'any';
  rules: FilterRule[];
}

/** A rule as column filter text. */
export function ruleFilter(r: FilterRule): string {
  const v = r.value.trim();
  switch (r.op) {
    case 'contains':
      return v;
    case 'notContains':
      return v ? `!${v}` : '';
    case 'equals':
      return `=${v}`;
    case 'notEquals':
      return `<>${v}`;
    case 'gt':
      return `>${v}`;
    case 'gte':
      return `>=${v}`;
    case 'lt':
      return `<${v}`;
    case 'lte':
      return `<=${v}`;
    case 'blank':
      return '(blank)';
    case 'notBlank':
      return '(not blank)';
  }
}

/** Whether a row's cells pass the filter builder's rules (rules on unknown columns are ignored). */
export function matchesAdvanced(cells: Readonly<Record<string, Cell>>, f: AdvancedFilter | null | undefined): boolean {
  // Rules on columns this document does not have, or still waiting for a value, are left out.
  const rules = (f?.rules ?? []).filter((r) => r.key in cells && (r.value.trim() || !FILTER_OPS.find((o) => o.value === r.op)?.needsValue));
  if (!f || !rules.length) return true;
  const test = (r: FilterRule) => matchesFilter(cells[r.key], ruleFilter(r));
  return f.match === 'all' ? rules.every(test) : rules.some(test);
}

export interface ListRowData {
  markup: Markup;
  cells: Record<string, Cell>;
  /** Set when this row is a reply: which comment it answers, how deep, and when it was written. */
  reply?: { id: string; parentId: string; depth: number; at: number };
}

/** A reply as its own list row: the same columns as a markup, with the reply in Comments. */
export function replyCells(m: Markup, reply: Reply, ctx: CellContext): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const c of BUILT_IN_COLUMNS) out[c.key] = cell('');
  for (const c of ctx.columns) out[customKey(c.id)] = cell('');
  out.seq = cell(m.seq ? String(m.seq) : '', m.seq ?? null);
  out.subject = cell('Reply');
  out.page = cell(String(m.pageIndex + 1), m.pageIndex + 1);
  out.sheet = cell(ctx.sheets[m.pageIndex]?.number ?? '');
  out.space = cell(ctx.spaces?.length ? spacePath(m, ctx.spaces) : '');
  out.author = cell(reply.author);
  out.date = { text: new Date(reply.createdAt).toLocaleString(), num: reply.createdAt };
  out.comment = cell(reply.text);
  out.type = cell('Reply');
  return out;
}

/** Markup rows with each one's replies after it, in thread order. */
export function withThreads(rows: readonly ListRowData[], ctx: CellContext): ListRowData[] {
  const out: ListRowData[] = [];
  for (const row of rows) {
    out.push(row);
    const all = row.markup.replies ?? [];
    const ids = new Set(all.map((r) => r.id));
    for (const { reply, depth } of threadReplies(all)) {
      const parentId = reply.parentId && ids.has(reply.parentId) ? reply.parentId : row.markup.id;
      out.push({ markup: row.markup, cells: replyCells(row.markup, reply, ctx), reply: { id: reply.id, parentId, depth, at: reply.createdAt } });
    }
  }
  return out;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

/**
 * A Cloud+ is a cloud grouped with the callout that holds its comment. The cloud has nothing of its
 * own to say, so the list shows the callout (and the replies under it) without an empty row above.
 */
export function commentListMarkups(markups: readonly Markup[]): Markup[] {
  const byGroup = new Map<string, Markup[]>();
  for (const m of markups) {
    if (!m.groupId) continue;
    const list = byGroup.get(m.groupId) ?? [];
    list.push(m);
    byGroup.set(m.groupId, list);
  }
  const skip = new Set<string>();
  for (const members of byGroup.values()) {
    const note = members.some((m) => isTextType(m.type) && !!(m.text?.trim() || m.comment?.trim() || m.replies?.length));
    if (!note) continue;
    for (const m of members) {
      if ((m.type === 'cloud' || m.type === 'polygonCloud') && !(m.text?.trim() || m.comment?.trim() || m.replies?.length)) skip.add(m.id);
    }
  }
  return markups.filter((m) => !skip.has(m.id));
}

/** Rows filtered and sorted as the list shows them. */
export function buildRows(
  markups: readonly Markup[],
  ctx: CellContext,
  filters: Readonly<Record<string, string>>,
  sort: SortState | null,
  advanced: AdvancedFilter | null = null,
): ListRowData[] {
  const rows = commentListMarkups(markups).map((m) => ({ markup: m, cells: cellsFor(m, ctx) }));
  const active = Object.entries(filters).filter(([, f]) => f.trim());
  const shown = active.length || advanced?.rules.length ? rows.filter((r) => active.every(([k, f]) => matchesFilter(r.cells[k], f)) && matchesAdvanced(r.cells, advanced)) : rows;
  const base = (a: ListRowData, b: ListRowData) => a.markup.pageIndex - b.markup.pageIndex || a.markup.createdAt - b.markup.createdAt;
  return shown.sort((a, b) => {
    if (!sort) return base(a, b);
    // Blank cells sort last whichever way round.
    const blank = (r: ListRowData) => (r.cells[sort.key]?.text ?? '') === '' && r.cells[sort.key]?.num == null;
    const ab = blank(a);
    const bb = blank(b);
    if (ab !== bb) return ab ? 1 : -1;
    const c = compareCells(a.cells[sort.key], b.cells[sort.key]);
    return (sort.dir === 'asc' ? c : -c) || base(a, b);
  });
}

/** Rows gathered by the text of one column, groups in first-seen order (which follows the sort). */
export function groupRows(rows: readonly ListRowData[], key: string): { label: string; rows: ListRowData[] }[] {
  const groups = new Map<string, ListRowData[]>();
  for (const r of rows) {
    const label = r.cells[key]?.text || '(blank)';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(r);
  }
  return [...groups].map(([label, rows]) => ({ label, rows }));
}

function csvCell(v: string) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One exported cell. A reply's subject is indented with `>` so the thread reads without the Parent column. */
function exportedCell(r: ListRowData, key: string): string {
  if (key === '__id') return r.reply?.id ?? r.markup.id;
  if (key === '__parent') return r.reply?.parentId ?? '';
  if (key === 'date') return new Date(r.reply?.at ?? r.markup.modifiedAt).toISOString();
  const v = r.cells[key];
  let text = v?.error ? `#${v.error}` : (v?.text ?? '');
  if (key === 'subject' && r.reply) text = `${'> '.repeat(r.reply.depth)}${text}`;
  return text;
}

/**
 * Rows as CSV with the given columns (BOM is added by the caller for Excel).
 * `relationship` adds Bluebeam's ID and Parent columns, so a reply row names the comment it answers.
 */
export function rowsToCsv(rows: readonly ListRowData[], columns: readonly ListColumn[], relationship = false): string {
  const keys = [...(relationship ? ['__id', '__parent'] : []), ...columns.map((c) => c.key)];
  const header = [...(relationship ? ['ID', 'Parent'] : []), ...columns.map((c) => csvCell(c.label))].join(',');
  const lines = rows.map((r) => keys.map((k) => csvCell(exportedCell(r, k))).join(','));
  return [header, ...lines].join('\r\n');
}
