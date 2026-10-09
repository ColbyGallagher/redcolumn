/**
 * What a PDF's own annotation dictionaries say beyond what PDFium reports: Bluebeam Revu's
 * measurement data, custom columns, Spaces, viewports, review states and replies. `readPdfExtras`
 * (pdfExtras.ts, which needs pdf-lib) reads the raw values; this module interprets them and has
 * no pdf-lib dependency, so the importer can use it without loading pdf-lib.
 */
import { METERS_PER_UNIT, type LengthUnit, type Scale } from '@nb/measure';
import type { ColumnType, CustomColumn, MarkupStatusDef } from './columns';
import type { Markup, MarkupStyle, Point, Rect } from './model';
import type { FontFamily, LineEnding, TextAlign, VerticalAlign } from './style';
import type { Viewport } from './viewports';

/** A PDF name (without its slash). */
export class PdfName {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}

/** An indirect reference that was not followed (to an annotation, page or stream). */
export class PdfRefNum {
  readonly num: number;
  constructor(num: number) {
    this.num = num;
  }
}

export type PdfValue = null | boolean | number | string | PdfName | PdfRefNum | PdfValue[] | PdfDictValue;
/** A PDF dictionary as plain values, keyed by name without the slash. */
export interface PdfDictValue {
  readonly [key: string]: PdfValue;
}

/** Affine [a b c d e f] mapping page space (top-left, y down, rotated) to PDF user space. */
export type PageMatrix = [number, number, number, number, number, number];

export interface PdfPageExtras {
  /** Page space → user space, as export's pageMatrix. */
  matrix: PageMatrix;
  /** Page size in page space (rotation applied). */
  width: number;
  height: number;
  /** The /Annots entries in order (null where an entry is not a dictionary). */
  annots: (PdfDictValue | null)[];
  /** Object number of each /Annots entry (0 for direct dictionaries). */
  objectNumbers: number[];
  /** Bluebeam's measurement viewports (/VP). */
  viewports: PdfDictValue[];
  /** Bluebeam Spaces (/BSISpaces). */
  spaces: PdfDictValue[];
}

export interface PdfExtras {
  pages: PdfPageExtras[];
  /** Optional content group (layer) names by object number. */
  ocgNames: ReadonlyMap<number, string>;
  /** Bluebeam custom column definitions (/BSIAnnotColumns), in the order their values are stored. */
  columns: PdfDictValue[];
  /** Bluebeam custom status sets' states (/BSIStatus): model id /M, state /S, colour /C. */
  statusDefs?: PdfDictValue[];
  /** Image XObjects used by image markups, as PNG or JPEG data URLs, by object number. */
  images: ReadonlyMap<number, string>;
  /** Other tools' stamps drawn to pictures (PNG data URLs), by `pageIndex:annotIndex`. */
  appearances?: Map<string, string>;
}

// ---- Reading values -------------------------------------------------------------------------

export const num = (v: PdfValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const str = (v: PdfValue | undefined): string | null => (typeof v === 'string' ? v : null);
export const nameOf = (v: PdfValue | undefined): string | null => (v instanceof PdfName ? v.name : null);
export const arr = (v: PdfValue | undefined): PdfValue[] => (Array.isArray(v) ? v : []);
export const dict = (v: PdfValue | undefined): PdfDictValue | null =>
  v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PdfName) && !(v instanceof PdfRefNum) ? (v as PdfDictValue) : null;
export const refNum = (v: PdfValue | undefined): number | null => (v instanceof PdfRefNum ? v.num : null);
export const nums = (v: PdfValue | undefined): number[] => arr(v).flatMap((x) => (typeof x === 'number' ? [x] : []));

/** Inverse of a page matrix: user space → page space. */
export function userToPage(m: PageMatrix): (x: number, y: number) => Point {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1;
  return (x, y) => {
    const u = x - e;
    const v = y - f;
    return [(d * u - c * v) / det, (-b * u + a * v) / det];
  };
}

/** Flat [x0 y0 x1 y1 ...] user-space numbers as page-space points. */
export function pagePoints(flat: readonly number[], toPage: (x: number, y: number) => Point): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(toPage(flat[i]!, flat[i + 1]!));
  return out;
}

/** A PDF colour array (gray, RGB or CMYK, 0..1) as #rrggbb; null for an empty or missing one. */
export function colorHex(v: PdfValue | undefined): string | null {
  const c = nums(v);
  let rgb: number[];
  if (c.length === 1) rgb = [c[0]!, c[0]!, c[0]!];
  else if (c.length === 3) rgb = c;
  else if (c.length === 4) rgb = [0, 1, 2].map((i) => (1 - c[i]!) * (1 - c[3]!));
  else return null;
  return '#' + rgb.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}

/** A PDF date (`D:YYYYMMDDHHmmSS+HH'mm'`) as epoch milliseconds, or null. */
export function parsePdfDate(s: string | null | undefined): number | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(?:([Zz])|([+-])(\d{2})'?(\d{2})?'?)?/.exec(s ?? '');
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', , sign, oh, om] = m;
  let t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  if (sign) t -= (sign === '+' ? 1 : -1) * (Number(oh) * 60 + Number(om ?? 0)) * 60_000;
  return Number.isFinite(t) ? t : null;
}

/** Annotation text as typed: Bluebeam ends paragraphs with \r. */
export function cleanText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

/** Style bits from a /DS default-style string (CSS-like, as Acrobat and Bluebeam write it). */
export function parseDefaultStyle(ds: string): Partial<MarkupStyle> {
  const out: Partial<MarkupStyle> = {};
  for (const decl of ds.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const key = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (key === 'font') {
      // e.g. "Helvetica 12pt", "bold italic Arial 10pt", "Times New Roman,Bold 9pt"
      const size = /([\d.]+)\s*pt/.exec(value);
      if (size) out.fontSize = Number(size[1]);
      const family = fontFamilyOf(value);
      if (family !== 'sans') out.fontFamily = family;
      if (/\bbold\b/i.test(value)) out.bold = true;
      if (/\b(italic|oblique)\b/i.test(value)) out.italic = true;
    } else if (key === 'font-family') {
      const family = fontFamilyOf(value);
      if (family !== 'sans') out.fontFamily = family;
    } else if (key === 'font-size') {
      const n = parseFloat(value);
      if (n > 0) out.fontSize = n;
    } else if (key === 'font-weight' && /bold|[6-9]00/.test(value)) out.bold = true;
    else if (key === 'font-style' && /italic|oblique/.test(value)) out.italic = true;
    else if (key === 'text-decoration' && /underline/.test(value)) out.underline = true;
    else if (key === 'color') {
      const c = cssColor(value);
      if (c) out.textColor = c;
    } else if (key === 'text-align' && /^(left|center|right)$/.test(value)) out.textAlign = value as TextAlign;
    else if (key === 'text-valign' || key === 'vertical-align') {
      const v = value === 'middle' || value === 'center' ? 'middle' : value === 'bottom' ? 'bottom' : value === 'top' ? 'top' : null;
      if (v) out.verticalAlign = v as VerticalAlign;
    }
  }
  return out;
}

function fontFamilyOf(s: string): FontFamily {
  if (/times|serif(?!-)|roman|georgia|garamond/i.test(s) && !/sans/i.test(s)) return 'serif';
  if (/cour|mono|consol/i.test(s)) return 'mono';
  return 'sans';
}

function cssColor(s: string): string | null {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(s.trim());
  if (hex) return hex[1]!.length === 3 ? '#' + [...hex[1]!].map((c) => c + c).join('').toLowerCase() : `#${hex[1]!.toLowerCase()}`;
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(s.trim());
  if (rgb) return '#' + rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  return null;
}

/** Text colour from a /DA string (`r g b rg`, `g g`, `c m y k k`). */
export function daTextColor(da: string): string | null {
  const rgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  if (rgb) return colorHex([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]);
  const g = /([\d.]+)\s+g(?:\s|$)/.exec(da);
  if (g) return colorHex([Number(g[1])]);
  return null;
}

/** PDF line ending names → ours; `filled` when the annotation has an interior colour. */
export function lineEndingOf(name: string | null, filled: boolean): LineEnding {
  switch (name) {
    case 'OpenArrow':
    case 'ROpenArrow':
      return 'openArrow';
    case 'ClosedArrow':
    case 'RClosedArrow':
      return filled ? 'filledArrow' : 'closedArrow';
    case 'Circle':
      return filled ? 'filledCircle' : 'circle';
    case 'Square':
      return filled ? 'filledSquare' : 'square';
    case 'Diamond':
      return filled ? 'filledDiamond' : 'diamond';
    case 'Butt':
      return 'tick';
    case 'Slash':
      return 'slash';
    default:
      return 'none';
  }
}

// ---- Scales and viewports ---------------------------------------------------------------------

const UNIT_NAMES: Record<string, LengthUnit> = {
  mm: 'mm',
  millimeter: 'mm',
  millimeters: 'mm',
  cm: 'cm',
  m: 'm',
  meter: 'm',
  meters: 'm',
  km: 'km',
  in: 'in',
  '"': 'in',
  inch: 'in',
  inches: 'in',
  ft: 'ft',
  "'": 'ft',
  feet: 'ft',
  foot: 'ft',
  yd: 'yd',
  yard: 'yd',
  yards: 'yd',
  mi: 'mi',
  mile: 'mi',
  miles: 'mi',
};

function unitOf(u: string | null): LengthUnit | null {
  if (!u) return null;
  return UNIT_NAMES[u.trim().toLowerCase().replace(/\.$/, '')] ?? null;
}

const SQUARE_SHORT: Record<string, LengthUnit> = { sf: 'ft', sy: 'yd', cf: 'ft', cy: 'yd' };

/** The length unit of an area or volume unit name ("sq m", "m²", "sf", "cu ft", "m3"). */
function powerUnitOf(u: string | null): LengthUnit | null {
  if (!u) return null;
  const t = u.trim().toLowerCase();
  return SQUARE_SHORT[t] ?? unitOf(t.replace(/^(sq|cu|square|cubic)\.?\s*/, '').replace(/[²³23]$/, ''));
}

/** A /Measure dictionary (rectilinear) as a drawing scale; null when it cannot be read. */
export function scaleFromMeasure(measure: PdfDictValue | null): Scale | null {
  if (!measure) return null;
  const x = arr(measure.X).map(dict);
  const f0 = x[0];
  const unit = unitOf(str(f0?.U));
  const c = num(f0?.C);
  if (!f0 || !unit || !c || c <= 0) return null;
  const f1 = x[1];
  const feetInches = unit === 'ft' && unitOf(str(f1?.U)) === 'in';
  const d = num(feetInches ? f1?.D : f0.D) ?? 100;
  const precision = feetInches ? d : Math.max(0, Math.min(6, Math.round(Math.log10(d))));
  const r = (str(measure.R) ?? '').trim();
  // "1 mm = 20 mm" is a plain ratio: show it the usual way.
  const ratio = /^1\s*([a-z]+)\s*=\s*([\d.]+)\s*\1$/i.exec(r);
  const areaName = str(dict(arr(measure.A)[0])?.U)?.trim() ?? '';
  const volumeName = str(dict(arr(measure.V)[0])?.U)?.trim() ?? '';
  const areaUnit = powerUnitOf(areaName);
  const volumeUnit = powerUnitOf(volumeName);
  const angleD = num(dict(arr(measure.T)[0])?.D);
  return {
    metersPerPoint: c * METERS_PER_UNIT[unit],
    unit,
    ...(areaUnit && areaUnit !== unit ? { areaUnit } : {}),
    ...(volumeUnit && volumeUnit !== (areaUnit ?? unit) ? { volumeUnit } : {}),
    // Bluebeam's own wording for the units ("sq m", "cu m"), kept with the unit it names.
    ...(areaUnit && areaName ? { areaLabel: { unit: areaUnit, label: areaName } } : {}),
    ...(volumeUnit && volumeName ? { volumeLabel: { unit: volumeUnit, label: volumeName } } : {}),
    ...(angleD ? { anglePrecision: Math.max(0, Math.min(4, Math.round(Math.log10(angleD)))) } : {}),
    feetInches,
    precision,
    label: ratio ? `1:${Number(ratio[2])}` : r || 'Calibrated',
  };
}

/** Page bounds from a user-space [x0 y0 x1 y1] box. */
function pageRect(box: readonly number[], toPage: (x: number, y: number) => Point): Rect | null {
  if (box.length < 4) return null;
  const a = toPage(box[0]!, box[1]!);
  const b = toPage(box[2]!, box[3]!);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

/**
 * The page's scale and viewports from Bluebeam's /VP: one covering (nearly) the whole page sets
 * the page's scale; smaller ones become viewports.
 */
export function importViewports(pageIndex: number, page: PdfPageExtras): { scale: Scale | null; viewports: Viewport[] } {
  const toPage = userToPage(page.matrix);
  let scale: Scale | null = null;
  const viewports: Viewport[] = [];
  page.viewports.forEach((vp, i) => {
    const s = scaleFromMeasure(dict(vp.Measure));
    const rect = pageRect(nums(vp.BBox), toPage);
    if (!s || !rect) return;
    if (rect.w * rect.h >= 0.95 * page.width * page.height) {
      scale ??= s;
      return;
    }
    viewports.push({ id: `pdf-vp-${pageIndex}-${str(vp.NM) || i}`, pageIndex, name: str(vp.Name) || `Viewport ${viewports.length + 1}`, rect, scale: s });
  });
  return { scale, viewports };
}

// ---- Spaces ---------------------------------------------------------------------------------

/** Bluebeam Spaces as Space markups; each remembers its place in /BSISpaces for saving. */
export function importSpaces(pageIndex: number, page: PdfPageExtras, now: number): Markup[] {
  const toPage = userToPage(page.matrix);
  const out: Markup[] = [];
  page.spaces.forEach((s, i) => {
    const points = arr(s.Path).flatMap((p) => {
      const xy = nums(p);
      return xy.length >= 2 ? [toPage(xy[0]!, xy[1]!)] : [];
    });
    if (points.length < 3) return;
    const color = colorHex(s.C) ?? '#0369a1';
    out.push({
      id: `pdf-space-${pageIndex}-${i}`,
      type: 'space',
      pageIndex,
      points,
      subject: str(s.Title) ?? 'Space',
      style: { stroke: color, fill: color, width: 1, opacity: 1, fillOpacity: num(s.CA) ?? 0.1 },
      status: 'none',
      author: '',
      createdAt: now,
      modifiedAt: now,
      pdfAnnot: { index: i, digest: '', space: true },
    });
  });
  return out;
}

// ---- Custom columns ---------------------------------------------------------------------------

const COLUMN_TYPES: Record<string, ColumnType> = {
  Text: 'text',
  Number: 'number',
  Date: 'date',
  Checkmark: 'checkmark',
  Formula: 'formula',
  Choice: 'choice',
  Dropdown: 'choice',
  List: 'choice',
};

/** Id of an imported Bluebeam column: its name, so the same column in other files lines up. */
export const bluebeamColumnId = (name: string) => `bluebeam:${name.trim()}`;

/**
 * Bluebeam keeps a column removed from a file in its list, marked /Deleted, so the values stored
 * for it keep their place. It is not one of the file's columns any more.
 */
const isDeletedColumn = (c: PdfDictValue) => c.Deleted === true;

/** Bluebeam's custom columns, in display order. */
export function importColumns(raw: readonly PdfDictValue[]): CustomColumn[] {
  const cols = raw.flatMap((c, i) => {
    const name = str(c.Name)?.trim();
    const subtype = nameOf(c.Subtype) ?? '';
    if (!name || isDeletedColumn(c)) return [];
    let type: ColumnType = COLUMN_TYPES[subtype] ?? 'text';
    if (type === 'text' && c.Multiline === true) type = 'multiline';
    const col: CustomColumn = { id: bluebeamColumnId(name), name, type };
    const def = str(c.DefaultValue);
    if (def) col.defaultValue = type === 'checkmark' ? String(def.toLowerCase() === 'true') : def;
    const precision = num(c.Precision);
    if (precision !== null && (type === 'number' || type === 'formula')) col.decimals = precision;
    const expr = str(c.Expression);
    if (type === 'formula' && expr) col.formula = expr;
    if (type === 'choice') col.options = arr(c.Items ?? c.Options ?? c.Choices).flatMap((o) => (typeof o === 'string' ? [o] : arr(o).filter((x): x is string => typeof x === 'string').slice(-1)));
    return [{ col, order: num(c.DisplayOrder) ?? i }];
  });
  // A PDF can list the same column more than once; they share an id, so keep the first.
  const seen = new Set<string>();
  return cols
    .sort((a, b) => a.order - b.order)
    .map((c) => c.col)
    .filter((c) => !seen.has(c.id) && !!seen.add(c.id));
}

/** A markup's column values from its /BSIColumnData (stored in /BSIAnnotColumns order). */
export function importColumnData(data: PdfValue | undefined, raw: readonly PdfDictValue[]): Record<string, string> | undefined {
  const values = arr(data);
  if (!values.length) return undefined;
  const fields: Record<string, string> = {};
  raw.forEach((c, i) => {
    const name = str(c.Name)?.trim();
    const v = values[i];
    if (!name || isDeletedColumn(c) || typeof v !== 'string' || v === '') return;
    const type = COLUMN_TYPES[nameOf(c.Subtype) ?? ''] ?? 'text';
    // Calculations are worked out here from their formula.
    if (type === 'formula') return;
    if (type === 'checkmark') fields[bluebeamColumnId(name)] = String(v.toLowerCase() === 'true');
    else if (type === 'date') {
      const d = /^(?:D:)?(\d{4})(\d{2})(\d{2})/.exec(v);
      fields[bluebeamColumnId(name)] = d ? `${d[1]}-${d[2]}-${d[3]}` : v;
    } else fields[bluebeamColumnId(name)] = v;
  });
  return Object.keys(fields).length ? fields : undefined;
}

// ---- Review states --------------------------------------------------------------------------

/** A review state's name ("Accepted") as a status id ("accepted"). */
export function statusIdOf(state: string): string {
  return state.trim().toLowerCase() || 'none';
}

/** The states of a file's custom status sets (/BSIStatus), as statuses. */
export function importStatuses(raw: readonly PdfDictValue[]): MarkupStatusDef[] {
  const seen = new Set<string>();
  return raw.flatMap((d) => {
    const name = str(d.S)?.trim();
    const model = str(d.M)?.trim();
    if (!name || !model || seen.has(statusIdOf(name))) return [];
    seen.add(statusIdOf(name));
    return [{ id: statusIdOf(name), name, color: colorHex(d.C) ?? '#9aa1a9', model }];
  });
}
