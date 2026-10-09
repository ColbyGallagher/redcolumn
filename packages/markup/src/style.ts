import type { Markup, MarkupStyle, MarkupType } from './model';
import { TYPE_INFO } from './types';

/**
 * Line endings, chosen from the Start/End dropdowns. Hollow shapes are outlined in the line color;
 * `filled*` variants are solid. `tick` is a dimension-style perpendicular bar, `slash` an
 * architectural 45° tick.
 */
export type LineEnding =
  | 'none'
  | 'openArrow'
  | 'closedArrow'
  | 'filledArrow'
  | 'circle'
  | 'filledCircle'
  | 'square'
  | 'filledSquare'
  | 'diamond'
  | 'filledDiamond'
  | 'tick'
  | 'slash';

export const LINE_ENDINGS: { value: LineEnding; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'openArrow', label: 'Open arrow' },
  { value: 'closedArrow', label: 'Closed arrow' },
  { value: 'filledArrow', label: 'Filled arrow' },
  { value: 'circle', label: 'Circle' },
  { value: 'filledCircle', label: 'Filled circle' },
  { value: 'square', label: 'Square' },
  { value: 'filledSquare', label: 'Filled square' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'filledDiamond', label: 'Filled diamond' },
  { value: 'tick', label: 'Tick (dimension)' },
  { value: 'slash', label: 'Slash (architectural)' },
];

export type LineDash = 'solid' | 'dashed' | 'longDash' | 'dotted' | 'dashDot' | 'dashDotDot';

export const LINE_DASHES: { value: LineDash; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'longDash', label: 'Long dash' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'dashDot', label: 'Dash dot' },
  { value: 'dashDotDot', label: 'Dash dot dot' },
];

/** Dash lengths in multiples of the line width (round caps turn zero-length dashes into dots). */
const DASH_UNITS: Record<LineDash, number[]> = {
  solid: [],
  dashed: [4, 3],
  longDash: [9, 4],
  dotted: [0, 2.5],
  dashDot: [6, 3, 0, 3],
  dashDotDot: [6, 3, 0, 3, 0, 3],
};

/** Dash array in points for a line style at `width`; empty for solid. */
export function dashPattern(dash: LineDash | undefined, width: number): number[] {
  const w = Math.max(width, 0.5);
  return (DASH_UNITS[dash ?? 'solid'] ?? []).map((u) => u * w);
}

export { HATCH_PATTERNS, hatchDraw, hatchScaleOf, paintHatchCell, resolveHatch } from './hatches';
export type { HatchDraw, HatchPattern, LegacyHatch, StoredHatch } from './hatches';

/** Families map to the PDF standard fonts so exported markups look the same in every viewer. */
export type FontFamily = 'sans' | 'serif' | 'mono';

export const FONT_FAMILIES: { value: FontFamily; label: string; css: string }[] = [
  { value: 'sans', label: 'Helvetica / Arial', css: 'Helvetica, Arial, sans-serif' },
  { value: 'serif', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { value: 'mono', label: 'Courier New', css: '"Courier New", Courier, monospace' },
];

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/** Which style properties mean something for a markup type (drives the Properties panel). */
export interface StyleCapabilities {
  fill: boolean;
  hatch: boolean;
  dash: boolean;
  lineEnds: boolean;
  font: boolean;
  /** Text box layout: alignment and underline. */
  textLayout: boolean;
  /** Measurement value label options. */
  label: boolean;
  /** Dimension offset with extension lines (length). */
  leader: boolean;
  /** What `arcRadius` controls, if it is user-facing for this type. */
  arcRadius: 'Arc size' | 'Marker size' | null;
}

export function styleCapabilities(type: MarkupType): StyleCapabilities {
  return TYPE_INFO[type].caps;
}

/** The markup's start and end line endings, falling back to the type's natural look. */
export function lineEnds(m: Pick<Markup, 'type' | 'style'>): [LineEnding, LineEnding] {
  const natural = TYPE_INFO[m.type].ends;
  if (!natural) return ['none', 'none'];
  return [m.style.startCap ?? natural[0], m.style.endCap ?? natural[1]];
}

/** CSS font shorthand for a style at `size` points. Measurement labels default to bold. */
export function cssFont(style: MarkupStyle, size: number, measure = false): string {
  const family = FONT_FAMILIES.find((f) => f.value === style.fontFamily) ?? FONT_FAMILIES[0]!;
  const bold = style.bold ?? measure;
  return `${style.italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family.css}`;
}

/** Color used for text and labels. */
export function textColor(style: MarkupStyle): string {
  return style.textColor ?? style.stroke;
}

/** Style fields a measurement label draws with, resolved to defaults. */
export function labelStyle(m: Markup): { show: boolean; background: string | null; size: number } {
  return {
    show: m.style.showLabel ?? true,
    background: m.style.labelBackground === undefined ? '#ffffff' : m.style.labelBackground,
    size: m.style.fontSize ?? 10,
  };
}
