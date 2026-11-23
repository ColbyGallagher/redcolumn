import { boundsOf, mapGeometry, type CountShape, type Markup, type MarkupStyle, type Point } from './model';
import { resolveStamp, stampAspect, stampColor, type StampDef } from './stamp';
import { TYPE_INFO } from './types';

/**
 * Custom count symbols: reusable vector or picture markers placed at each point of a Count
 * measurement. Vector symbols are stored as markups normalized around (0, 0) within
 * [-COUNT_SYMBOL_REF, COUNT_SYMBOL_REF] on their longer half-axis, so drawing at marker radius `r`
 * simply translates to the point and scales by `r / COUNT_SYMBOL_REF`.
 */
export interface CountSymbol {
  id: string;
  name: string;
  /** Vector markups normalized around (0, 0) inside [-10, 10] (longer half-axis = 10). */
  markups?: Markup[];
  /** Picture symbol (PNG or JPEG data URL), fitted inside 2r × 2r preserving `aspect`. */
  image?: string;
  /** Width / height ratio for picture symbols (1 when square). */
  aspect?: number;
}

/** Reference half-size (in points) for normalized vector count symbols. */
export const COUNT_SYMBOL_REF = 10;

/** Maximum longer-side pixel size for imported count symbol pictures. */
export const MAX_COUNT_SYMBOL_SIDE = 256;

/** Maximum data-URL character length for one count symbol picture (keeps localStorage lean). */
export const COUNT_SYMBOL_BUDGET = 128_000;

/** Side sizes to try when encoding a count symbol picture until it fits `COUNT_SYMBOL_BUDGET`. */
export const COUNT_SYMBOL_SIDES = [MAX_COUNT_SYMBOL_SIDE, 192, 128, 96, 64] as const;

/** Standard count marker shapes, in picker order. */
export const COUNT_SHAPE_OPTIONS: readonly { value: CountShape; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'cross', label: 'Cross' },
  { value: 'check', label: 'Checkmark' },
];

/** Bluebeam's PDF /CountStyle name for each standard count shape. */
export const COUNT_STYLE_TO_PDF: Record<CountShape, string> = {
  circle: 'Circle',
  check: 'Checkmark',
  square: 'Square',
  diamond: 'Diamond',
  triangle: 'Triangle',
  cross: 'Cross',
};

/** Standard count shape for a Bluebeam PDF /CountStyle name. */
export const COUNT_STYLE_FROM_PDF: Record<string, CountShape> = {
  Checkmark: 'check',
  Check: 'check',
  Circle: 'circle',
  Square: 'square',
  Diamond: 'diamond',
  Triangle: 'triangle',
  Cross: 'cross',
  X: 'cross',
};

/** Bluebeam /BSILegend CountStyle integer for each standard count shape. */
export const COUNT_STYLE_BSI: Record<CountShape, number> = {
  check: 0,
  circle: 4,
  diamond: 2,
  square: 3,
  triangle: 1,
  cross: 5,
};

/** Markup types that cannot be captured inside a custom count symbol. */
const SKIP_TYPES = new Set<Markup['type']>(['legend', 'space', 'redaction', 'hyperlink', 'attachment', 'manual']);

/** Whether a markup can be saved into a custom count symbol. */
export function canBeCountSymbol(m: Pick<Markup, 'type'>): boolean {
  return !SKIP_TYPES.has(m.type);
}

/** Stable key comparing two custom count symbols by their visual content and name. */
export function countSymbolKey(s: CountSymbol): string {
  return JSON.stringify({ name: s.name, image: s.image ?? null, aspect: s.aspect ?? null, markups: s.markups ?? null });
}

/** Whether two custom count symbols represent the same symbol. */
export function sameCountSymbol(a: CountSymbol | undefined, b: CountSymbol | undefined): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id || countSymbolKey(a) === countSymbolKey(b);
}

/**
 * Strips document-specific metadata and normalizes one or more markups around (0, 0) within
 * [-COUNT_SYMBOL_REF, COUNT_SYMBOL_REF] on the longer half-axis. Returns null if no usable
 * markups remain.
 */
export function symbolFromMarkups(source: readonly Markup[], name: string, id: string): CountSymbol | null {
  const usable = source.filter(canBeCountSymbol);
  if (!usable.length) return null;
  const allPts = usable.flatMap((m) => m.points);
  if (!allPts.length) return null;
  const b = boundsOf(allPts);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const half = Math.max(b.w / 2, b.h / 2, 1);
  const scale = COUNT_SYMBOL_REF / half;
  const mapPt = ([x, y]: Point): Point => [round((x - cx) * scale), round((y - cy) * scale)];
  const markups: Markup[] = usable.map((raw, i) => {
    const geom = mapGeometry(raw, mapPt);
    const style: MarkupStyle = { ...raw.style, showLabel: false };
    if (style.width > 0) style.width = round(Math.max(0.4, Math.min(4, style.width * scale)));
    if (style.fontSize !== undefined) style.fontSize = round(Math.max(3, Math.min(24, style.fontSize * scale)));
    if (style.arcRadius !== undefined) style.arcRadius = round(Math.max(0.5, style.arcRadius * scale));
    if (style.cornerRadius !== undefined) style.cornerRadius = round(Math.max(0.25, style.cornerRadius * scale));
    if (style.leader !== undefined) style.leader = round(style.leader * scale);
    if (style.labelOffset !== undefined) style.labelOffset = round(style.labelOffset * scale);
    if (style.textMargin !== undefined) style.textMargin = round(Math.max(0.5, style.textMargin * scale));
    // Nested custom count symbols are dropped to avoid recursion.
    delete style.countSymbol;
    return {
      id: `sym-${i}`,
      type: raw.type,
      pageIndex: 0,
      points: geom.points,
      ...(geom.holes ? { holes: geom.holes } : {}),
      ...(raw.bulges ? { bulges: [...raw.bulges] } : {}),
      ...(raw.holeBulges ? { holeBulges: raw.holeBulges.map((h) => (h ? [...h] : null)) } : {}),
      ...(raw.arcAngles ? { arcAngles: [...raw.arcAngles] as [number, number] } : {}),
      ...(raw.rotation ? { rotation: raw.rotation } : {}),
      ...(raw.text !== undefined ? { text: raw.text } : {}),
      ...(raw.spans ? { spans: raw.spans.map((sp) => ({ ...sp })) } : {}),
      ...(raw.image ? { image: raw.image } : {}),
      ...(raw.crop ? { crop: { ...raw.crop } } : {}),
      ...(raw.stamp ? { stamp: structuredClone(raw.stamp) } : {}),
      ...(raw.flowShape ? { flowShape: raw.flowShape } : {}),
      ...(raw.table ? { table: structuredClone(raw.table) } : {}),
      style,
      status: 'none',
      author: '',
      createdAt: i,
      modifiedAt: i,
    };
  });
  return { id, name: name.trim() || 'Custom Symbol', markups };
}

/** Converts a picture data URL (PNG or JPEG) into a custom count symbol. */
export function imageCountSymbol(image: string, width: number, height: number, name: string, id: string): CountSymbol {
  if (!/^data:image\/(png|jpe?g);base64,/i.test(image)) throw new Error('the picture must be a PNG or JPEG');
  if (!(width > 0) || !(height > 0)) throw new Error('the picture has no size');
  return { id, name: name.trim() || 'Image Symbol', image, aspect: round(width / height) };
}

/** Converts a library stamp into a custom count symbol (picture stamps keep their image; text stamps stay vector). */
export function symbolFromStamp(stamp: StampDef, author: string, id: string): CountSymbol {
  if (stamp.art && stamp.art.texts.length === 0) {
    return { id, name: stamp.name, image: stamp.art.image, aspect: round(stamp.art.aspect || 1) };
  }
  const content = resolveStamp(stamp, { user: author, file: '', page: '', now: new Date() });
  const aspect = Math.max(0.25, Math.min(4, stampAspect(content)));
  const w = aspect >= 1 ? COUNT_SYMBOL_REF * 2 : COUNT_SYMBOL_REF * 2 * aspect;
  const h = aspect >= 1 ? (COUNT_SYMBOL_REF * 2) / aspect : COUNT_SYMBOL_REF * 2;
  const m: Markup = {
    id: 'sym-0',
    type: 'stamp',
    pageIndex: 0,
    points: [[-w / 2, -h / 2], [w / 2, h / 2]],
    style: { ...TYPE_INFO.stamp.style, stroke: stampColor(stamp), width: 1.5, opacity: 1 },
    stamp: content,
    status: 'none',
    author: '',
    createdAt: 0,
    modifiedAt: 0,
  };
  return { id, name: stamp.name, markups: [m] };
}

export type BadgeFrame = 'circle' | 'square' | 'diamond' | 'triangle' | 'none';

export interface BadgeSymbolOptions {
  id: string;
  name: string;
  text: string;
  frame: BadgeFrame;
  stroke: string;
  fill: string | null;
  textColor?: string;
}

/** Builds a crisp vector badge count symbol (short text like D1, SD, C inside an optional frame). */
export function badgeCountSymbol(opts: BadgeSymbolOptions): CountSymbol {
  const r = COUNT_SYMBOL_REF;
  const markups: Markup[] = [];
  const base = { pageIndex: 0, status: 'none', author: '', createdAt: 0, modifiedAt: 0 };
  if (opts.frame === 'circle') {
    markups.push({
      ...base,
      id: 'sym-frame',
      type: 'ellipse',
      points: [[-r, -r], [r, r]],
      style: { stroke: opts.stroke, fill: opts.fill, width: 1.6, opacity: 1 },
    });
  } else if (opts.frame === 'square') {
    markups.push({
      ...base,
      id: 'sym-frame',
      type: 'rect',
      points: [[-r, -r], [r, r]],
      style: { stroke: opts.stroke, fill: opts.fill, width: 1.6, opacity: 1 },
    });
  } else if (opts.frame === 'diamond') {
    markups.push({
      ...base,
      id: 'sym-frame',
      type: 'polygon',
      points: [[0, -r], [r, 0], [0, r], [-r, 0]],
      style: { stroke: opts.stroke, fill: opts.fill, width: 1.6, opacity: 1 },
    });
  } else if (opts.frame === 'triangle') {
    markups.push({
      ...base,
      id: 'sym-frame',
      type: 'polygon',
      points: [[0, -r], [round(r * 0.9), round(r * 0.78)], [round(-r * 0.9), round(r * 0.78)]],
      style: { stroke: opts.stroke, fill: opts.fill, width: 1.6, opacity: 1 },
    });
  }
  const label = opts.text.trim();
  if (label) {
    const len = [...label].length;
    const fontSize = opts.frame === 'none' ? (len <= 1 ? 16 : len === 2 ? 12 : 9) : opts.frame === 'triangle' ? (len <= 1 ? 9.5 : len === 2 ? 7.5 : 6) : len <= 1 ? 13 : len === 2 ? 10 : len === 3 ? 7.5 : 6;
    const yShift = opts.frame === 'triangle' ? 2.2 : 0;
    markups.push({
      ...base,
      id: 'sym-text',
      type: 'text',
      points: [[-r, -r + yShift], [r, r + yShift]],
      text: label,
      style: {
        stroke: opts.stroke,
        fill: null,
        width: 0,
        opacity: 1,
        noBox: true,
        fontSize,
        bold: true,
        textColor: opts.textColor ?? opts.stroke,
        textAlign: 'center',
        verticalAlign: 'middle',
        textMargin: 0.5,
      },
      createdAt: 1,
      modifiedAt: 1,
    });
  }
  return { id: opts.id, name: opts.name.trim() || label || 'Badge', markups };
}

/** Custom count symbols present on the document's markups that are not already in `library`. */
export function documentCountSymbols(markups: readonly Markup[], library: readonly CountSymbol[]): CountSymbol[] {
  const out: CountSymbol[] = [];
  for (const m of markups) {
    const sym = m.type === 'count' ? m.style.countSymbol : undefined;
    if (!sym) continue;
    if (library.some((s) => sameCountSymbol(s, sym)) || out.some((s) => sameCountSymbol(s, sym))) continue;
    out.push(sym);
  }
  return out;
}

/** Width and height of a picture count symbol fitted inside a 2r × 2r box. */
export function countSymbolImageBox(aspect: number | undefined, r: number): { w: number; h: number } {
  const a = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return a >= 1 ? { w: r * 2, h: (r * 2) / a } : { w: r * 2 * a, h: r * 2 };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
