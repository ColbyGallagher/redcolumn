/**
 * Assemblies: what a measurement stands for in materials and labour. One assembly turns a
 * measured length, area, volume or count into several quantities, each worked out by a formula
 * (studs at 16" centres, two layers of board, tape and mud), with a waste allowance, rounding up to
 * whole units, and a unit cost. Defined per document (so everyone in a Live Session sees the same
 * ones) and saved in the PDF; a measurement names its assembly in `Markup.assemblyId`.
 */

/** A named number an assembly's formulas can use, such as `Stud Spacing` or `Layers`. */
export interface AssemblyVariable {
  name: string;
  value: number;
}

/** One quantity an assembly produces from each measurement. */
export interface AssemblyItem {
  /** Stable id, so renaming an item keeps its place. */
  id: string;
  name: string;
  /** The unit it is counted in, as shown: `ea`, `sheets`, `lf`, `m²`. */
  unit: string;
  /**
   * How much per measurement, from the measurement and the assembly's variables, e.g.
   * `[Length] / [Stud Spacing] + 1` or `[Wall Area] * [Layers] / 32`.
   */
  formula: string;
  /** Waste allowance in percent, added before rounding. */
  waste?: number;
  /** Round the quantity up (sheets, boxes, lengths of pipe), to a whole number unless `roundTo` says otherwise. */
  roundUp?: boolean;
  /** With `roundUp`, round up to a multiple of this instead of 1: 10 for pipe sold in 10 ft lengths, 0.5 for half-sheets. */
  roundTo?: number;
  /** Price per unit, for the cost. */
  unitCost?: number;
}

export interface Assembly {
  /** Stable id: measurements refer to it, so renaming an assembly keeps them. */
  id: string;
  name: string;
  description?: string;
  variables: AssemblyVariable[];
  items: AssemblyItem[];
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const newId = () => crypto.randomUUID();

/**
 * Assemblies from untrusted data (a PDF, a file, local storage): anything that is not an
 * assembly is dropped, missing ids are made up, and duplicate ids are given new ones.
 */
export function sanitizeAssemblies(raw: unknown): Assembly[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const unique = (id: string | null) => {
    const out = id && !ids.has(id) ? id : newId();
    ids.add(out);
    return out;
  };
  const out: Assembly[] = [];
  for (const a of raw.slice(0, 1000)) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    const name = text(r.name)?.trim();
    if (!name) continue;
    const itemIds = new Set<string>();
    const items: AssemblyItem[] = [];
    for (const i of Array.isArray(r.items) ? r.items.slice(0, 200) : []) {
      if (!i || typeof i !== 'object') continue;
      const x = i as Record<string, unknown>;
      const itemName = text(x.name)?.trim();
      if (!itemName) continue;
      let id = text(x.id) || newId();
      if (itemIds.has(id)) id = newId();
      itemIds.add(id);
      const waste = finite(x.waste);
      const unitCost = finite(x.unitCost);
      const roundTo = finite(x.roundTo);
      items.push({
        id,
        name: itemName,
        unit: text(x.unit) ?? '',
        formula: text(x.formula) ?? '',
        ...(waste !== null && waste !== 0 ? { waste } : {}),
        ...(x.roundUp === true ? { roundUp: true } : {}),
        ...(x.roundUp === true && roundTo !== null && roundTo > 0 && roundTo !== 1 ? { roundTo } : {}),
        ...(unitCost !== null ? { unitCost } : {}),
      });
    }
    const variables: AssemblyVariable[] = [];
    for (const v of Array.isArray(r.variables) ? r.variables.slice(0, 100) : []) {
      if (!v || typeof v !== 'object') continue;
      const x = v as Record<string, unknown>;
      const vName = text(x.name)?.trim();
      const value = finite(x.value);
      if (vName && value !== null) variables.push({ name: vName, value });
    }
    const description = text(r.description)?.trim();
    out.push({ id: unique(text(r.id)), name, ...(description ? { description } : {}), variables, items });
  }
  return out;
}

/** Assemblies as a file to share between documents and people. */
export function assembliesToJson(list: readonly Assembly[]): string {
  return JSON.stringify({ format: 'redcolumn-assemblies', version: 1, assemblies: list }, null, 2);
}

/** Reads a file written by `assembliesToJson`. Throws with a readable message on anything else. */
export function assembliesFromJson(json: string): Assembly[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('This is not an assemblies file (it is not JSON).');
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as { assemblies?: unknown }).assemblies : undefined;
  if (!Array.isArray(list)) throw new Error('This is not an assemblies file (expected a list of assemblies).');
  const out = sanitizeAssemblies(list);
  if (list.length && !out.length) throw new Error('The file has no assemblies this app can read.');
  return out;
}

/**
 * `incoming` added to `current`: one with the id of an existing assembly replaces it, one with a
 * new id but an existing name replaces that one (keeping its id, so measurements stay linked),
 * and the rest are added at the end.
 */
export function mergeAssemblies(current: readonly Assembly[], incoming: readonly Assembly[]): Assembly[] {
  const out = [...current];
  for (const a of incoming) {
    const at = out.findIndex((x) => x.id === a.id);
    const byName = at < 0 ? out.findIndex((x) => x.name.trim().toLowerCase() === a.name.trim().toLowerCase()) : -1;
    if (at >= 0) out[at] = a;
    else if (byName >= 0) out[byName] = { ...a, id: out[byName]!.id };
    else out.push(a);
  }
  return out;
}
