/**
 * One in-memory model of a CAD drawing, read from DXF (and, later, DWG). It keeps what a plot
 * needs: tables, blocks, entities per space and the paper-space layouts. Entities keep their raw
 * group codes; the renderer reads the ones it needs.
 */

/** DXF group codes and values, in file order. */
export type Groups = [number, string][];

export interface Entity {
  type: string;
  handle: string;
  /** Handle of the block record that owns it ('' when the file has no handles). */
  owner: string;
  layer: string;
  /** ACI colour: 0 BYBLOCK, 256 BYLAYER (the default), negative is not used on entities. */
  color: number;
  /** 0x00RRGGBB, or null. */
  trueColor: number | null;
  linetype: string;
  ltscale: number;
  /** Hundredths of a millimetre; -1 BYLAYER, -2 BYBLOCK, -3 DEFAULT. */
  lineweight: number;
  paperSpace: boolean;
  invisible: boolean;
  extrusion: [number, number, number];
  /** The entity's own groups, without the common ones above, reactors or extension dictionaries. */
  g: Groups;
  /** ATTRIBs following an INSERT, VERTEXes following a POLYLINE. */
  children: Entity[];
}

export interface Layer {
  name: string;
  handle: string;
  color: number;
  trueColor: number | null;
  linetype: string;
  lineweight: number;
  plot: boolean;
  frozen: boolean;
  off: boolean;
}

export interface Linetype {
  name: string;
  /** Dash lengths in drawing units: positive dash, negative gap, zero dot. */
  pattern: number[];
}

export interface TextStyle {
  name: string;
  font: string;
  bigFont: string;
  /** Font family name a TrueType style records (xdata), or ''. */
  family: string;
  height: number;
  widthFactor: number;
  /** Degrees. */
  oblique: number;
  /** 2 backwards, 4 upside down. */
  generation: number;
}

export interface Block {
  name: string;
  /** Handle of its block record ('' when the file has none). */
  record: string;
  base: [number, number];
  flags: number;
  /** Path of an external reference, '' for an ordinary block. */
  xrefPath: string;
  entities: Entity[];
}

export interface Layout {
  name: string;
  tabOrder: number;
  /** Handle of the block record holding its entities. */
  record: string;
  /** Paper size in millimetres, as the layout stores it (before plot rotation). */
  paperWidth: number;
  paperHeight: number;
  /** Unprintable margins in mm: left, bottom, right, top. */
  margins: [number, number, number, number];
  /** Plot origin offset in mm. */
  origin: [number, number];
  /** Paper units: true for millimetres, false for inches. */
  mm: boolean;
  /** Plot rotation in quarter turns counter-clockwise. */
  rotation: number;
  /** Paper units per drawing unit when plotting paper space (normally 1). */
  printScale: number;
  isModel: boolean;
}

export interface ImageDef {
  path: string;
}

export interface Drawing {
  /** $ACADVER, e.g. AC1032. */
  version: string;
  header: Map<string, Groups>;
  layers: Map<string, Layer>;
  /** Layer names by table handle (viewports name frozen layers by handle). */
  layerByHandle: Map<string, string>;
  linetypes: Map<string, Linetype>;
  styles: Map<string, TextStyle>;
  blocks: Map<string, Block>;
  blockByRecord: Map<string, Block>;
  /** Paper-space layouts and the model layout, in tab order. */
  layouts: Layout[];
  modelSpace: Entity[];
  /** Entities by handle, for clip boundaries. */
  byHandle: Map<string, Entity>;
  imageDefs: Map<string, ImageDef>;
}

// ---- group access ---------------------------------------------------------------------------

export function num(g: Groups, code: number, fallback = 0): number {
  for (const [c, v] of g) if (c === code) return Number(v);
  return fallback;
}

export function str(g: Groups, code: number, fallback = ''): string {
  for (const [c, v] of g) if (c === code) return v;
  return fallback;
}

export function has(g: Groups, code: number): boolean {
  return g.some(([c]) => c === code);
}

export function nums(g: Groups, code: number): number[] {
  const out: number[] = [];
  for (const [c, v] of g) if (c === code) out.push(Number(v));
  return out;
}

/** The point in groups code, code + 10 (x, y). */
export function pt(g: Groups, code: number, fallback: [number, number] = [0, 0]): [number, number] {
  return has(g, code) ? [num(g, code), num(g, code + 10)] : fallback;
}

/** Header variable's first value, as a number. */
export function headerNum(d: Pick<Drawing, 'header'>, name: string, fallback: number): number {
  const g = d.header.get(name);
  if (!g?.length) return fallback;
  const n = Number(g[0]![1]);
  return Number.isFinite(n) ? n : fallback;
}

export function headerStr(d: Pick<Drawing, 'header'>, name: string, fallback = ''): string {
  return d.header.get(name)?.[0]?.[1] ?? fallback;
}

/** Metres per drawing unit for $INSUNITS; 0 when unitless. */
export const INSUNITS_M: Record<number, number> = {
  1: 0.0254, // inches
  2: 0.3048, // feet
  3: 1609.344, // miles
  4: 0.001, // mm
  5: 0.01, // cm
  6: 1, // m
  7: 1000, // km
  8: 0.0000000254, // microinches
  9: 0.0000254, // mils
  10: 0.9144, // yards
  14: 0.1, // decimetres
  21: 1200 / 3937, // US survey feet
};
