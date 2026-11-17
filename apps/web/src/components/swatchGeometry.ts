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
