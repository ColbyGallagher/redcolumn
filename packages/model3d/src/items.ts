/**
 * Element data as the fragments worker returns it (attributes as { value }, relations as arrays of
 * related items), turned into what the 3D sidebar shows. Plain data, no three.js.
 */
import { BY_CLASS, type PropertyGroup, type SearchSet } from './controls.ts';

/** One element's data: attributes are `{ value, type? }`, relations are arrays of related elements' data. */
export type RawItem = Record<string, unknown>;

/** The value of an attribute as text ('' when missing). */
export function attrText(a: unknown): string {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !('value' in a)) return '';
  const v = (a as { value: unknown }).value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}

const isRelation = (v: unknown): v is RawItem[] => Array.isArray(v);
/** Built-in keys the worker adds (_localId, _category, _guid). */
const internal = (k: string) => k.startsWith('_');

/** The value a property or quantity holds, whichever kind it is. */
const VALUE_KEYS = ['NominalValue', 'LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue', 'TimeValue', 'Value'];

function propertyRow(p: RawItem): [string, string] | null {
  const name = attrText(p.Name);
  if (!name) return null;
  for (const k of VALUE_KEYS) if (k in p) return [name, attrText(p[k])];
  // Enumerated and list properties: their values side by side.
  const other = Object.entries(p).find(([k, v]) => k !== 'Name' && k !== 'Description' && !internal(k) && !isRelation(v) && attrText(v));
  return [name, other ? attrText(other[1]) : ''];
}

/**
 * An element's attributes, then each property and quantity set it is defined by (IsDefinedBy), as
 * name and value rows; sets come in name order.
 */
export function propertyGroups(item: RawItem): PropertyGroup[] {
  const attributes: [string, string][] = Object.entries(item)
    .filter(([k, v]) => !internal(k) && !isRelation(v))
    .map(([k, v]) => [k, attrText(v)] as [string, string])
    .filter(([, v]) => v !== '');
  const sets: PropertyGroup[] = [];
  const defs = item.IsDefinedBy;
  if (isRelation(defs)) {
    for (const set of defs) {
      const quantities = isRelation(set.Quantities);
      const props = quantities ? set.Quantities : set.HasProperties;
      if (!isRelation(props)) continue;
      const rows = props.map(propertyRow).filter((r): r is [string, string] => r !== null);
      if (rows.length) sets.push({ title: attrText(set.Name) || 'Properties', rows, ...(quantities ? { quantities } : {}) });
    }
  }
  sets.sort((a, b) => a.title.localeCompare(b.title));
  return [{ title: 'Attributes', rows: attributes }, ...sets];
}

/**
 * Whether an element's properties pass a search set's property test: some attribute or property
 * named `property` (whole name, any case) whose value contains `value` (any case; empty: any value).
 */
export function matchesProperty(set: SearchSet, groups: PropertyGroup[]): boolean {
  const name = set.property.trim().toLowerCase();
  if (!name) return true;
  const value = set.value.trim().toLowerCase();
  return groups.some((g) => g.rows.some(([n, v]) => n.toLowerCase() === name && (!value || v.toLowerCase().includes(value))));
}

/** An element's properties as "set.name" to value, to compare revisions by. */
export function flatProperties(groups: readonly PropertyGroup[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups) for (const [n, v] of g.rows) out[`${g.title}.${n}`] = v;
  return out;
}

/** Preferred quantity names, best first: net before gross, then any of the kind. */
const QUANTITY_NAMES = {
  length: [/^length$/i, /^netlength$/i, /^grosslength$/i, /length$/i],
  area: [/^netarea$/i, /^area$/i, /^net.*area$/i, /^grossarea$/i, /^gross.*area$/i, /area$/i],
  volume: [/^netvolume$/i, /^volume$/i, /^net.*volume$/i, /^grossvolume$/i, /volume$/i],
};

/**
 * An element's length, area and volume from its quantity sets (0 when it has none of a kind):
 * for each kind, the first name in order of preference that it has.
 */
export function quantitiesOf(groups: readonly PropertyGroup[]): { length: number; area: number; volume: number } {
  const rows = groups.filter((g) => g.quantities).flatMap((g) => g.rows);
  const pick = (names: RegExp[]) => {
    for (const re of names) {
      const row = rows.find(([n, v]) => re.test(n) && Number.isFinite(Number.parseFloat(v)));
      if (row) return Number.parseFloat(row[1]);
    }
    return 0;
  };
  return { length: pick(QUANTITY_NAMES.length), area: pick(QUANTITY_NAMES.area), volume: pick(QUANTITY_NAMES.volume) };
}

/** What an element is grouped under: its class, or the value of a property (any set, any case; '' when it has none). */
export function groupKey(groups: readonly PropertyGroup[], category: string, groupBy: string): string {
  const want = groupBy.trim().toLowerCase();
  if (!want || want === BY_CLASS.toLowerCase()) return category;
  for (const g of groups) for (const [n, v] of g.rows) if (n.toLowerCase() === want) return v;
  return '';
}
