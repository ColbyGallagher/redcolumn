import { DEFAULT_STYLES, estimatingFromJson, MARKUP_TYPES, type EstimatingFile, type Markup, type MarkupStyle, type MarkupType } from '@nb/markup';
import { exportStandard, parseStandardFile, type DrawingStandard } from '../sheets/standards';
import type { ToolChestItem, ToolSet } from '../workspace/profiles';

/**
 * A trade pack (`.rctrade`): one file carrying what one trade needs to start a takeoff — assemblies,
 * the items, product lists and takeoff templates they use, tool sets, and drawing standards.
 * Packs are shared by other people (the community library, a colleague), so reading one checks
 * every part and keeps only what redcolumn knows; anything else fails with a message for the user.
 */

export const PACK_FORMAT = 'redcolumn.trade-pack';
export const PACK_VERSION = 1;
export const PACK_EXTENSION = '.rctrade';

export interface TradePack {
  name: string;
  /** The trade it is for, as people say it: "Civil / Roads", "Interiors". */
  trade: string;
  description: string;
  author: string;
  /** The unit system its assemblies' variables are in. */
  units: 'metric' | 'imperial' | null;
  /** Words to find it by in the library: "kerb", "stormwater". */
  tags: string[];
  estimating: EstimatingFile;
  toolSets: ToolSet[];
  standards: DrawingStandard[];
}

const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOOL_SETS = 50;
const MAX_TOOLS = 500;
const MAX_TOOL_MARKUPS = 200;
const MAX_STANDARDS = 20;
const MAX_IMAGE = 1024 * 1024;

function fail(message: string): never {
  throw new Error(`This is not a trade pack redcolumn can read: ${message}.`);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const optText = (v: unknown, max: number, what: string): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') fail(`${what} is not text`);
  if (v.length > max) fail(`${what} is too long`);
  return v;
};
const isType = (v: unknown): v is MarkupType => typeof v === 'string' && (MARKUP_TYPES as readonly string[]).includes(v);

/** A style: the type's own defaults, with the pack's values where they are the same kind of value. */
function readStyle(v: unknown, type: MarkupType): MarkupStyle {
  const base = DEFAULT_STYLES[type];
  if (!isObject(v)) return { ...base };
  const out: Record<string, unknown> = { ...base };
  for (const [k, value] of Object.entries(v)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const was = (base as unknown as Record<string, unknown>)[k];
    if (was === null || (value === null && typeof was === 'string')) {
      // Nullable colours (a fill, or none).
      if (value === null || (typeof value === 'string' && value.length <= 200)) out[k] = value;
    } else if (was === undefined) {
      // Optional style fields: plain values only.
      if (Array.isArray(value)) {
        if (value.length <= 32 && value.every((n) => typeof n === 'number' && Number.isFinite(n))) out[k] = [...value];
      } else if (typeof value === 'string' ? value.length <= 200 : typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean') out[k] = value;
    } else if (typeof value === typeof was && (typeof value !== 'number' || Number.isFinite(value)) && (typeof value !== 'string' || value.length <= 200)) {
      out[k] = value;
    }
  }
  return out as unknown as MarkupStyle;
}

function readTool(v: unknown): ToolChestItem {
  if (!isObject(v) || !isType(v.type)) fail('a tool has no markup type redcolumn knows');
  const label = optText(v.label, 200, "a tool's name")?.trim();
  if (!label) fail("a tool's name is missing");
  const tool: ToolChestItem = { id: crypto.randomUUID(), type: v.type, style: readStyle(v.style, v.type), label };
  const subject = optText(v.subject, 200, "a tool's subject");
  if (subject) tool.subject = subject;
  const markupLabel = optText(v.markupLabel, 200, "a tool's label");
  if (markupLabel) tool.markupLabel = markupLabel;
  const comment = optText(v.comment, 2000, "a tool's comment");
  if (comment) tool.comment = comment;
  const layer = optText(v.layer, 200, "a tool's layer");
  if (layer) tool.layer = layer;
  if (v.image !== undefined) {
    const image = optText(v.image, MAX_IMAGE, "a tool's picture");
    if (image && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)) fail("a tool's picture is not an image");
    if (image) tool.image = image;
  }
  if (v.tool === 'cloudPlus') tool.tool = 'cloudPlus';
  if (isObject(v.sequence) && Number.isFinite(v.sequence.start) && Number.isFinite(v.sequence.increment)) tool.sequence = { start: Number(v.sequence.start), increment: Number(v.sequence.increment) };
  if (typeof v.metersPerPoint === 'number' && Number.isFinite(v.metersPerPoint) && v.metersPerPoint > 0) tool.metersPerPoint = v.metersPerPoint;
  if (v.markups !== undefined) {
    if (!Array.isArray(v.markups) || v.markups.length > MAX_TOOL_MARKUPS) fail("a tool's markups are not a list");
    // A tool that places copies of markups: each is checked for a known type and plain geometry.
    tool.markups = v.markups.map((m: unknown): Markup => {
      if (!isObject(m) || !isType(m.type)) fail("a tool's markup has no type redcolumn knows");
      if (JSON.stringify(m).length > MAX_IMAGE) fail("a tool's markup is too large");
      return { ...(structuredClone(m) as unknown as Markup), id: crypto.randomUUID(), style: readStyle(m.style, m.type) };
    });
  }
  return tool;
}

function readToolSet(v: unknown): ToolSet {
  if (!isObject(v)) fail('a tool set is missing');
  const name = optText(v.name, 200, "a tool set's name")?.trim();
  if (!name) fail("a tool set's name is missing");
  if (!Array.isArray(v.items) || v.items.length > MAX_TOOLS) fail(`the tool set "${name}" has no tools`);
  return {
    id: crypto.randomUUID(),
    name,
    collapsed: false,
    view: v.view === 'detail' ? 'detail' : 'icon',
    ...(v.scaleToPage === true ? { scaleToPage: true } : {}),
    items: v.items.map(readTool),
  };
}

/** Reads a `.rctrade` file. Throws with a message for the user on anything it cannot use. */
export function parseTradePack(content: string): TradePack {
  if (content.length > MAX_FILE) fail('the file is too large');
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    fail('the file is not JSON');
  }
  if (!isObject(data) || data.format !== PACK_FORMAT) fail('the file is another kind of file');
  if (typeof data.version !== 'number' || data.version > PACK_VERSION) fail('the file was made by a newer version of redcolumn');
  const name = optText(data.name, 200, 'the name')?.trim();
  if (!name) fail('the name is missing');
  const lists = ['assemblies', 'items', 'productLists', 'templates'] as const;
  const hasEstimating = lists.some((k) => Array.isArray(data[k]) && (data[k] as unknown[]).length);
  const estimating: EstimatingFile = hasEstimating ? estimatingFromJson(JSON.stringify(Object.fromEntries(lists.map((k) => [k, Array.isArray(data[k]) ? data[k] : []])))) : { assemblies: [], items: [], productLists: [], templates: [] };
  // A template's look is checked like a tool's: the known style values of its measuring tool.
  estimating.templates = estimating.templates.map((t) => {
    if (!t.preset.style) return t;
    const { style, ...preset } = t.preset;
    return { ...t, preset: isType(t.tool) ? { ...preset, style: readStyle(style, t.tool) } : preset };
  });
  if (data.toolSets !== undefined && (!Array.isArray(data.toolSets) || data.toolSets.length > MAX_TOOL_SETS)) fail('the tool sets are not a list');
  if (data.standards !== undefined && (!Array.isArray(data.standards) || data.standards.length > MAX_STANDARDS)) fail('the drawing standards are not a list');
  const toolSets = ((data.toolSets as unknown[] | undefined) ?? []).map(readToolSet);
  const standards = ((data.standards as unknown[] | undefined) ?? []).map((s) => parseStandardFile(JSON.stringify({ format: 'redcolumn.drawing-standard', version: 1, standard: s })));
  const pack: TradePack = {
    name,
    trade: optText(data.trade, 100, 'the trade')?.trim() || 'General',
    description: optText(data.description, 2000, 'the description')?.trim() ?? '',
    author: optText(data.author, 200, 'the author')?.trim() ?? '',
    units: data.units === 'metric' || data.units === 'imperial' ? data.units : null,
    tags: Array.isArray(data.tags) ? data.tags.slice(0, 20).flatMap((t) => (typeof t === 'string' && t.trim() && t.length <= 40 ? [t.trim()] : [])) : [],
    estimating,
    toolSets,
    standards,
  };
  if (!packCounts(pack).total) fail('it has nothing in it');
  return pack;
}

/** A pack as a `.rctrade` file's text, read back by `parseTradePack`. */
export function tradePackToJson(pack: TradePack): string {
  const { estimating: e } = pack;
  return JSON.stringify(
    {
      format: PACK_FORMAT,
      version: PACK_VERSION,
      name: pack.name,
      trade: pack.trade,
      description: pack.description,
      author: pack.author,
      ...(pack.units ? { units: pack.units } : {}),
      ...(pack.tags.length ? { tags: pack.tags } : {}),
      assemblies: e.assemblies,
      items: e.items,
      productLists: e.productLists,
      templates: e.templates,
      toolSets: pack.toolSets.map(({ id: _id, collapsed: _c, hidden: _h, pack: _p, ...set }) => ({ ...set, items: set.items.map(({ id: _i, revu: _r, ...tool }) => tool) })),
      standards: pack.standards.map((s) => (JSON.parse(exportStandard(s)) as { standard: unknown }).standard),
    },
    null,
    2,
  );
}

export interface PackCounts {
  assemblies: number;
  items: number;
  productLists: number;
  templates: number;
  toolSets: number;
  tools: number;
  standards: number;
  total: number;
}

export function packCounts(pack: TradePack): PackCounts {
  const e = pack.estimating;
  const c = {
    assemblies: e.assemblies.length,
    items: e.items.length,
    productLists: e.productLists.length,
    templates: e.templates.length,
    toolSets: pack.toolSets.length,
    tools: pack.toolSets.reduce((n, s) => n + s.items.length, 0),
    standards: pack.standards.length,
  };
  return { ...c, total: c.assemblies + c.items + c.productLists + c.templates + c.toolSets + c.standards };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a pack holds, in words: "4 assemblies, 1 tool set (6 tools), 1 drawing standard". */
export function describeCounts(c: Omit<PackCounts, 'total'> & { total?: number }): string {
  const parts = [
    c.assemblies && plural(c.assemblies, 'assembly', 'assemblies'),
    c.items && plural(c.items, 'item'),
    c.productLists && plural(c.productLists, 'product list'),
    c.templates && plural(c.templates, 'takeoff template'),
    c.toolSets && `${plural(c.toolSets, 'tool set')} (${plural(c.tools, 'tool')})`,
    c.standards && plural(c.standards, 'drawing standard'),
  ].filter(Boolean);
  return parts.join(', ') || 'nothing';
}
