/**
 * Estimating: the catalog an assembly's items price from. An `Item` is one cost line (a material,
 * labour, equipment, subcontract or other line) with its unit, cost, price, SKU and item number; a
 * `ProductList` is a table of products (a supplier's price list) an item can link to so its cost
 * follows the list; a `TakeoffTemplate` is a measuring tool set up with a subject, layer, style,
 * slope, depth and an assembly with its inputs, to arm in one click. All of them are kept per
 * document (saved in the PDF's catalog under /NBEstimating) and in an app-wide library, and travel
 * between people as a `redcolumn-estimating` file.
 */

import { mergeAssemblies, sanitizeAssemblies, type Assembly, type AssemblyItem } from './assemblies';
import type { MarkupStyle } from './model';
import type { Slope } from '@nb/measure';

export type ItemCategory = 'material' | 'labor' | 'equipment' | 'subcontract' | 'other';

export const ITEM_CATEGORIES: { value: ItemCategory; label: string }[] = [
  { value: 'material', label: 'Material' },
  { value: 'labor', label: 'Labour' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'subcontract', label: 'Subcontract' },
  { value: 'other', label: 'Other' },
];

/** One cost line in the catalog. An assembly item that names it takes its name, unit, cost, waste and rounding unless it sets its own. */
export interface Item {
  id: string;
  name: string;
  itemNo?: string;
  sku?: string;
  description?: string;
  category: ItemCategory;
  /** The unit it is bought and counted in: `ea`, `sheets`, `lf`, `m²`, `hr`. */
  unit: string;
  /** What it costs per unit. */
  unitCost?: number;
  /** What it is sold for per unit. */
  unitPrice?: number;
  /** Waste allowance in percent. */
  waste?: number;
  /** Round quantities up to a multiple of this (with `roundUp`). */
  roundTo?: number;
  roundUp?: boolean;
  /** The product list record its cost and price come from (see `listCost`). */
  listRef?: { listId: string; recordId: string };
}

export interface ProductListColumn {
  key: string;
  label: string;
  type: 'text' | 'number';
}

export interface ProductListRecord {
  id: string;
  values: Record<string, string | number>;
}

/** A table of products, such as a supplier's price list. */
export interface ProductList {
  id: string;
  name: string;
  columns: ProductListColumn[];
  records: ProductListRecord[];
  /** The column linked items take their unit cost from; unset, the column named Cost or Unit Cost. */
  costColumn?: string;
  /** Likewise the unit price; unset, the column named Price or Unit Price. */
  priceColumn?: string;
}

/** A measuring tool set up for one kind of takeoff (see the module comment). */
export interface TakeoffTemplate {
  id: string;
  name: string;
  /** The measuring tool it arms: `length`, `polylength`, `area`, `count`... */
  tool: string;
  preset: { subject?: string; layer?: string; style?: MarkupStyle; slope?: Slope; depth?: number };
  assemblyId?: string;
  /** The assembly's inputs (variable name to value) the measurements it places get. */
  inputs?: Record<string, number>;
}

export interface Estimating {
  items: Item[];
  productLists: ProductList[];
  templates: TakeoffTemplate[];
}

export const EMPTY_ESTIMATING: Estimating = { items: [], productLists: [], templates: [] };

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const trimmed = (v: unknown): string | undefined => text(v)?.trim() || undefined;
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const newId = () => crypto.randomUUID();
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function uniqueIds() {
  const ids = new Set<string>();
  return (id: string | null | undefined) => {
    const out = id && !ids.has(id) ? id : newId();
    ids.add(out);
    return out;
  };
}

const CATEGORIES = new Set<string>(ITEM_CATEGORIES.map((c) => c.value));

/** Items from untrusted data: anything that is not one is dropped, ids are made unique. */
export function sanitizeItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  const unique = uniqueIds();
  const out: Item[] = [];
  for (const r of raw.slice(0, 5000)) {
    if (!isObj(r)) continue;
    const name = trimmed(r.name);
    if (!name) continue;
    const num = (k: string) => finite(r[k]);
    const unitCost = num('unitCost');
    const unitPrice = num('unitPrice');
    const waste = num('waste');
    const roundTo = num('roundTo');
    const ref = isObj(r.listRef) && text(r.listRef.listId) && text(r.listRef.recordId) ? { listId: r.listRef.listId as string, recordId: r.listRef.recordId as string } : null;
    const opt = (k: 'itemNo' | 'sku' | 'description') => {
      const v = trimmed(r[k]);
      return v ? { [k]: v } : {};
    };
    out.push({
      id: unique(text(r.id)),
      name,
      ...opt('itemNo'),
      ...opt('sku'),
      ...opt('description'),
      category: CATEGORIES.has(r.category as string) ? (r.category as ItemCategory) : 'material',
      unit: text(r.unit)?.trim() ?? '',
      ...(unitCost !== null ? { unitCost } : {}),
      ...(unitPrice !== null ? { unitPrice } : {}),
      ...(waste !== null && waste !== 0 ? { waste } : {}),
      ...(r.roundUp === true ? { roundUp: true } : {}),
      ...(r.roundUp === true && roundTo !== null && roundTo > 0 && roundTo !== 1 ? { roundTo } : {}),
      ...(ref ? { listRef: ref } : {}),
    });
  }
  return out;
}

/** Product lists from untrusted data. Values of number columns are kept as numbers when they read as one. */
export function sanitizeProductLists(raw: unknown): ProductList[] {
  if (!Array.isArray(raw)) return [];
  const unique = uniqueIds();
  const out: ProductList[] = [];
  for (const r of raw.slice(0, 200)) {
    if (!isObj(r)) continue;
    const name = trimmed(r.name);
    if (!name) continue;
    const keys = new Set<string>();
    const columns: ProductListColumn[] = [];
    for (const c of Array.isArray(r.columns) ? r.columns.slice(0, 100) : []) {
      if (!isObj(c)) continue;
      const key = trimmed(c.key);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      columns.push({ key, label: trimmed(c.label) ?? key, type: c.type === 'number' ? 'number' : 'text' });
    }
    const recordId = uniqueIds();
    const records: ProductListRecord[] = [];
    for (const x of Array.isArray(r.records) ? r.records.slice(0, 50000) : []) {
      if (!isObj(x) || !isObj(x.values)) continue;
      const values: Record<string, string | number> = {};
      for (const c of columns) {
        const v = x.values[c.key];
        if (typeof v === 'number' && Number.isFinite(v)) values[c.key] = v;
        else if (typeof v === 'string') values[c.key] = c.type === 'number' && v.trim() !== '' && Number.isFinite(parseNumber(v)) ? parseNumber(v) : v;
      }
      records.push({ id: recordId(text(x.id)), values });
    }
    const costColumn = trimmed(r.costColumn);
    const priceColumn = trimmed(r.priceColumn);
    out.push({ id: unique(text(r.id)), name, columns, records, ...(costColumn && keys.has(costColumn) ? { costColumn } : {}), ...(priceColumn && keys.has(priceColumn) ? { priceColumn } : {}) });
  }
  return out;
}

/** Takeoff templates from untrusted data. */
export function sanitizeTemplates(raw: unknown): TakeoffTemplate[] {
  if (!Array.isArray(raw)) return [];
  const unique = uniqueIds();
  const out: TakeoffTemplate[] = [];
  for (const r of raw.slice(0, 1000)) {
    if (!isObj(r)) continue;
    const name = trimmed(r.name);
    const tool = trimmed(r.tool);
    if (!name || !tool || !/^[A-Za-z]+$/.test(tool)) continue;
    const p = isObj(r.preset) ? r.preset : {};
    const depth = finite(p.depth);
    const preset: TakeoffTemplate['preset'] = {
      ...(trimmed(p.subject) ? { subject: trimmed(p.subject) } : {}),
      ...(trimmed(p.layer) ? { layer: trimmed(p.layer) } : {}),
      ...(isObj(p.style) && typeof p.style.stroke === 'string' && typeof p.style.width === 'number' ? { style: p.style as unknown as MarkupStyle } : {}),
      ...(isObj(p.slope) && typeof p.slope.kind === 'string' ? { slope: p.slope as unknown as Slope } : {}),
      ...(depth !== null && depth > 0 ? { depth } : {}),
    };
    const inputs = sanitizeInputs(r.inputs);
    const assemblyId = trimmed(r.assemblyId);
    out.push({ id: unique(text(r.id)), name, tool, preset, ...(assemblyId ? { assemblyId } : {}), ...(inputs ? { inputs } : {}) });
  }
  return out;
}

/** A measurement's assembly inputs from untrusted data: finite numbers by name; undefined when none. */
export function sanitizeInputs(raw: unknown): Record<string, number> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw).slice(0, 100)) if (k.trim() && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeEstimating(raw: unknown): Estimating {
  const r = isObj(raw) ? raw : {};
  return { items: sanitizeItems(r.items), productLists: sanitizeProductLists(r.productLists), templates: sanitizeTemplates(r.templates) };
}

/** "$1,234.50" or "12" as a number; NaN when it is not one. */
export function parseNumber(s: string): number {
  const t = s.replace(/[,$\s£€]/g, '');
  return t === '' ? Number.NaN : Number(t);
}

/**
 * `incoming` added to `current`, as `mergeAssemblies` does: by id, then by name (keeping the
 * existing id, so links stay), the rest added at the end.
 */
export function mergeById<T extends { id: string; name: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const out = [...current];
  for (const x of incoming) {
    const at = out.findIndex((o) => o.id === x.id);
    const byName = at < 0 ? out.findIndex((o) => o.name.trim().toLowerCase() === x.name.trim().toLowerCase()) : -1;
    if (at >= 0) out[at] = x;
    else if (byName >= 0) out[byName] = { ...x, id: out[byName]!.id };
    else out.push(x);
  }
  return out;
}

export function mergeEstimating(current: Estimating, incoming: Partial<Estimating>): Estimating {
  return {
    items: mergeById(current.items, incoming.items ?? []),
    productLists: mergeById(current.productLists, incoming.productLists ?? []),
    templates: mergeById(current.templates, incoming.templates ?? []),
  };
}

const COST_NAMES = ['unit cost', 'cost'];
const PRICE_NAMES = ['unit price', 'price'];

/** The key of a list's column named one of `names` (by label or key, ignoring case), or of `explicit`. */
function columnFor(list: ProductList, explicit: string | undefined, names: readonly string[]): string | undefined {
  if (explicit && list.columns.some((c) => c.key === explicit)) return explicit;
  for (const n of names) {
    const c = list.columns.find((c) => c.label.trim().toLowerCase() === n || c.key.trim().toLowerCase() === n);
    if (c) return c.key;
  }
  return undefined;
}

/**
 * An item's unit cost and price. A linked item takes them from its list record: the list's
 * `costColumn` / `priceColumn`, else its column named "Unit Cost" or "Cost" ("Unit Price" or
 * "Price"). A record value that is not a number, or a missing record, falls back to the item's own.
 */
export function listCost(item: Item, lists: readonly ProductList[]): { unitCost?: number; unitPrice?: number } {
  const own = { ...(item.unitCost !== undefined ? { unitCost: item.unitCost } : {}), ...(item.unitPrice !== undefined ? { unitPrice: item.unitPrice } : {}) };
  if (!item.listRef) return own;
  const list = lists.find((l) => l.id === item.listRef!.listId);
  const rec = list?.records.find((r) => r.id === item.listRef!.recordId);
  if (!list || !rec) return own;
  const read = (key: string | undefined) => {
    if (!key) return undefined;
    const v = rec.values[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseNumber(v) : Number.NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const cost = read(columnFor(list, list.costColumn, COST_NAMES));
  const price = read(columnFor(list, list.priceColumn, PRICE_NAMES));
  return { ...own, ...(cost !== undefined ? { unitCost: cost } : {}), ...(price !== undefined ? { unitPrice: price } : {}) };
}

/** What a list record is called in pickers: its first text value (else its first value). */
export function recordLabel(list: ProductList, rec: ProductListRecord): string {
  const first = list.columns.find((c) => c.type === 'text' && String(rec.values[c.key] ?? '').trim()) ?? list.columns[0];
  return first ? String(rec.values[first.key] ?? '') || '(blank)' : '(blank)';
}

/**
 * An assembly item with its linked catalog item filled in: the item's name, unit, unit cost,
 * waste and rounding where the assembly item leaves them unset (an empty name or unit, no waste,
 * no cost, `roundUp` unset). An item that is not in the catalog leaves it as it is.
 */
export function resolveAssemblyItem(ai: AssemblyItem, items: readonly Item[], lists: readonly ProductList[]): AssemblyItem {
  if (!ai.itemId) return ai;
  const item = items.find((i) => i.id === ai.itemId);
  if (!item) return ai;
  const { unitCost } = listCost(item, lists);
  const rounding = ai.roundUp !== undefined ? { roundUp: ai.roundUp, roundTo: ai.roundTo } : { roundUp: item.roundUp, roundTo: item.roundTo };
  const out: AssemblyItem = {
    ...ai,
    name: ai.name.trim() || item.name,
    unit: ai.unit.trim() || item.unit,
    ...(ai.waste === undefined && item.waste !== undefined ? { waste: item.waste } : {}),
    ...(ai.unitCost === undefined && unitCost !== undefined ? { unitCost } : {}),
  };
  delete out.roundUp;
  delete out.roundTo;
  if (rounding.roundUp) {
    out.roundUp = true;
    if (rounding.roundTo !== undefined) out.roundTo = rounding.roundTo;
  }
  return out;
}

/** Assemblies with their items' catalog links filled in (see `resolveAssemblyItem`); unchanged when nothing links. */
export function resolveAssemblies(list: readonly Assembly[], items: readonly Item[], lists: readonly ProductList[]): Assembly[] {
  if (!items.length || !list.some((a) => a.items.some((i) => i.itemId))) return list as Assembly[];
  return list.map((a) => (a.items.some((i) => i.itemId) ? { ...a, items: a.items.map((i) => resolveAssemblyItem(i, items, lists)) } : a));
}

/** Everything an estimating file carries. */
export interface EstimatingFile extends Estimating {
  assemblies: Assembly[];
}

/** Assemblies, items, product lists and templates as one file to share company-wide. */
export function estimatingToJson(data: EstimatingFile): string {
  return JSON.stringify({ format: 'redcolumn-estimating', version: 1, assemblies: data.assemblies, items: data.items, productLists: data.productLists, templates: data.templates }, null, 2);
}

/**
 * Reads a `redcolumn-estimating` file, or an older `redcolumn-assemblies` one (or a bare list of
 * assemblies). Throws with a readable message on anything else.
 */
export function estimatingFromJson(json: string): EstimatingFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('This is not an estimating file (it is not JSON).');
  }
  if (Array.isArray(data)) data = { assemblies: data };
  if (!isObj(data)) throw new Error('This is not an estimating file.');
  const lists = ['assemblies', 'items', 'productLists', 'templates'] as const;
  if (!lists.some((k) => Array.isArray(data[k]))) throw new Error('This is not an estimating file (it has no assemblies, items, product lists or templates).');
  const out: EstimatingFile = { assemblies: sanitizeAssemblies(data.assemblies), ...sanitizeEstimating(data) };
  const had = lists.reduce((n, k) => n + (Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0), 0);
  if (had && !lists.some((k) => out[k].length)) throw new Error('The file has nothing this app can read.');
  return out;
}

/** An estimating file merged into what is there (see `mergeById`). */
export function mergeEstimatingFile(current: EstimatingFile, incoming: Partial<EstimatingFile>): EstimatingFile {
  return { assemblies: mergeAssemblies(current.assemblies, incoming.assemblies ?? []), ...mergeEstimating(current, incoming) };
}

/**
 * What a document needs from `from` to use `assemblyIds` and `itemIds`: those assemblies, the
 * catalog items they (and `itemIds`) link to, and the product lists those items price from.
 */
export function referencedRecords(from: EstimatingFile, assemblyIds: Iterable<string>, itemIds: Iterable<string> = []): Pick<EstimatingFile, 'assemblies' | 'items' | 'productLists'> {
  const aIds = new Set(assemblyIds);
  const assemblies = from.assemblies.filter((a) => aIds.has(a.id));
  const iIds = new Set([...itemIds, ...assemblies.flatMap((a) => a.items.flatMap((i) => (i.itemId ? [i.itemId] : [])))]);
  const items = from.items.filter((i) => iIds.has(i.id));
  const lIds = new Set(items.flatMap((i) => (i.listRef ? [i.listRef.listId] : [])));
  return { assemblies, items, productLists: from.productLists.filter((l) => lIds.has(l.id)) };
}
