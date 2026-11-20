import { DEFAULT_STYLES, type CustomLine, type LineDash, type Markup, type MarkupStyle } from '@nb/markup';

/** What a swatch shows: a plain dash, a custom dash array, or a line style (with its symbols and text). */
export interface SwatchSpec {
  dash?: LineDash;
  dashArray?: number[];
  line?: CustomLine;
}

export const SWATCH_WIDTH = 64;
export const SWATCH_HEIGHT = 14;

/**
 * The markup a swatch draws: a straight run centred in the swatch, styled exactly as a polyline of that
 * style would be on the page, so the preview goes through the same drawing code as the canvas.
 */
export function swatchMarkup(spec: SwatchSpec, width = SWATCH_WIDTH, height = SWATCH_HEIGHT, color = '#000', lineWidth = 1.5): Markup {
  const pad = 3;
  const style: MarkupStyle = {
    ...DEFAULT_STYLES.polyline,
    stroke: color,
    width: lineWidth,
    dash: spec.line ? undefined : spec.dash,
    dashArray: spec.line ? undefined : spec.dashArray,
    lineStyle: spec.line,
  };
  return {
    id: 'swatch',
    type: 'polyline',
    pageIndex: 0,
    points: [
      [pad, height / 2],
      [width - pad, height / 2],
    ],
    style,
    status: 'none',
    author: '',
    createdAt: 0,
    modifiedAt: 0,
  };
}

/** The swatch's line width in points. */
export const SWATCH_LINE_WIDTH = 1.5;

/**
 * How much to shrink a swatch so a style reaching `reach` points to either side of its line fits the
 * swatch height; 1 when it already fits. Never below 0.4, where a symbol would be unreadable anyway.
 */
export function swatchScale(reach: number, height = SWATCH_HEIGHT): number {
  if (!(reach > 0)) return 1;
  return Math.max(0.4, Math.min(1, (height - 2) / (2 * reach)));
}

/** The key a swatch is cached under: one string per style, made once where the options are built. */
export function swatchKey(spec: SwatchSpec): string {
  return JSON.stringify([spec.dash ?? null, spec.dashArray ?? null, spec.line ? [spec.line.name, spec.line.spec] : null]);
}
