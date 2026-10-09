import { boundsOf, contentBox, flagTip, isTextType, type Markup, type MarkupStyle, type Point } from './model';
import { TEXT_LINE_HEIGHT, TEXT_PADDING } from './geometry';
import { TYPE_INFO } from './types';

// ---- Change Colours -------------------------------------------------------------------------------

/** The colours markups are drawn in (line, fill and text), each once, as lower-case hex. */
export function markupColours(ms: readonly Markup[]): string[] {
  const out = new Set<string>();
  for (const m of ms) for (const c of [m.style.stroke, m.style.fill, m.style.textColor]) if (c) out.add(c.toLowerCase());
  return [...out];
}

/** A style with each colour in `map` (lower-case hex → new colour) replaced, or null when none applies. */
export function recolouredStyle(style: MarkupStyle, map: Readonly<Record<string, string>>): MarkupStyle | null {
  const swap = (c: string | null | undefined) => (c ? map[c.toLowerCase()] : undefined);
  const stroke = swap(style.stroke);
  const fill = swap(style.fill);
  const text = swap(style.textColor);
  if (!stroke && !fill && !text) return null;
  return { ...style, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}), ...(text ? { textColor: text } : {}) };
}

// ---- Round All Corners ----------------------------------------------------------------------------

/** Markups whose corners can be rounded. */
export function canRoundCorners(m: Pick<Markup, 'type'>): boolean {
  return m.type === 'rect' || m.type === 'polygon' || m.type === 'polyline';
}

/** A corner radius that suits a markup: a tenth of its smaller side, within 2 to 24 points. */
export function defaultCornerRadius(m: Pick<Markup, 'points'>): number {
  const b = boundsOf(m.points);
  return Math.round(Math.max(2, Math.min(24, Math.min(b.w, b.h) / 10)) * 10) / 10;
}

// ---- Auto-size Text Box ---------------------------------------------------------------------------

/** Text boxes that Auto-size can fit to their text. */
export function canAutoSize(m: Pick<Markup, 'type' | 'text'>): boolean {
  return isTextType(m.type) && m.type !== 'typewriter' && !!m.text;
}

/**
 * The points of a text box resized to fit its text exactly: as wide as its longest line (no
 * wrapping), as tall as its lines, with the usual padding. The box keeps its top-left corner (a
 * callout keeps its leader). `measure` gives a string's width at the markup's font size. Null when
 * the markup cannot be auto-sized.
 */
export function autoSizedPoints(m: Markup, measure: (s: string) => number): Point[] | null {
  if (!canAutoSize(m) || TYPE_INFO[m.type].content !== 'text') return null;
  const size = m.style.fontSize ?? 12;
  const lines = (m.text ?? '').split('\n');
  const textW = Math.max(...lines.map((l) => measure(l.trimEnd())));
  const w = Math.ceil(textW + TEXT_PADDING * 2 + 1);
  const h = Math.ceil(lines.length * size * TEXT_LINE_HEIGHT + TEXT_PADDING * 2);
  const box = contentBox(m);
  if (m.type === 'callout') {
    if (m.points.length < 4) return null;
    const pts = m.points.map((p) => [p[0], p[1]] as Point);
    pts[2] = [box.x, box.y];
    pts[3] = [box.x + w, box.y + h];
    return pts;
  }
  if (m.type === 'flagLabel') {
    // The pointed end grows with the box's height; solve for the outer width that leaves `w` for text.
    const b = boundsOf(m.points);
    let outer = w + h / 2;
    for (let i = 0; i < 4; i++) outer = w + flagTip({ x: 0, y: 0, w: outer, h });
    return [[b.x, b.y], [b.x + outer, b.y + h]];
  }
  return [[box.x, box.y], [box.x + w, box.y + h]];
}
