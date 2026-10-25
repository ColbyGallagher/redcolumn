import type { CustomLine } from './lineStyle';

/**
 * A custom line style in a shape the editor can change field by field, and back. The stored
 * pattern (see lineStyle.ts) stays the source of truth: `toDraft` reads one, `fromDraft` writes it.
 */

export type SymbolPointType = 'start' | 'line' | 'curve';

export interface SymbolPoint {
  type: SymbolPointType;
  x: number;
  y: number;
}

export type DraftComponent =
  | { kind: 'dash'; width: number }
  | { kind: 'space'; width: number }
  | { kind: 'text'; text: string; font: string; size: number; bold: boolean; italic: boolean; upright: boolean }
  /** A symbol `left + right` long along the line, its origin `left` in; points have y to the left of the line. */
  | { kind: 'vector'; left: number; right: number; scale: number; fill: boolean; points: SymbolPoint[] };

export interface DraftLine {
  /** How far to the left of the path this line runs (negative: to the right). */
  offset: number;
  /** Repeated along the line; none at all is a solid line. */
  components: DraftComponent[];
}

export interface LineStyleDraft {
  name: string;
  /** Lengths are multiples of the markup's line width, rather than points. */
  scaleWithWidth: boolean;
  lines: DraftLine[];
}

export const DRAFT_COMPONENT_KINDS: { kind: DraftComponent['kind']; label: string }[] = [
  { kind: 'dash', label: 'Dash' },
  { kind: 'space', label: 'Gap' },
  { kind: 'text', label: 'Text' },
  { kind: 'vector', label: 'Symbol' },
];

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A new component of a kind, with sizes that read well at the default line width. */
export function newComponent(kind: DraftComponent['kind']): DraftComponent {
  switch (kind) {
    case 'dash':
      return { kind, width: 6 };
    case 'space':
      return { kind, width: 3 };
    case 'text':
      return { kind, text: 'A', font: 'Helvetica', size: 6, bold: false, italic: false, upright: true };
    case 'vector':
      return {
        kind,
        left: 2,
        right: 2,
        scale: 1,
        fill: false,
        points: [
          { type: 'start', x: 0, y: -2 },
          { type: 'line', x: 0, y: 2 },
        ],
      };
  }
}

function readComponent(c: unknown): DraftComponent | null {
  if (typeof c === 'number') return c > 0 ? { kind: 'dash', width: c } : c < 0 ? { kind: 'space', width: -c } : null;
  if (!Array.isArray(c)) return null;
  if (typeof c[0] === 'string') {
    return { kind: 'text', text: c[0], font: typeof c[1] === 'string' ? c[1] : 'Helvetica', size: num(c[2], 6), bold: c[3] === true, italic: c[4] === true, upright: c[5] !== false };
  }
  if (c.length < 4) return null;
  const points: SymbolPoint[] = [];
  for (let i = 4; i + 2 < c.length; i += 3) points.push({ type: c[i] === 0 ? 'start' : c[i] === 2 ? 'curve' : 'line', x: num(c[i + 1]), y: num(c[i + 2]) });
  return { kind: 'vector', left: num(c[0]), right: num(c[1]), scale: num(c[2], 1), fill: c[3] === true, points };
}

/** A stored line style as an editable draft. Parts it cannot read are left out. */
export function toDraft(style: CustomLine): LineStyleDraft {
  const [scaled, ...lines] = Array.isArray(style.spec) ? style.spec : [];
  return {
    name: style.name,
    scaleWithWidth: scaled !== false,
    lines: lines.filter(Array.isArray).map((l: unknown[]) => ({
      offset: num(l[0]),
      components: l.slice(1).flatMap((c) => readComponent(c) ?? []),
    })),
  };
}

function writeComponent(c: DraftComponent): unknown | null {
  switch (c.kind) {
    case 'dash':
      return c.width > 0 ? c.width : null;
    case 'space':
      return c.width > 0 ? -c.width : null;
    case 'text':
      return c.text ? [c.text, c.font || 'Helvetica', c.size > 0 ? c.size : 6, c.bold, c.italic, c.upright] : null;
    case 'vector': {
      if (!c.points.length) return null;
      const pts = c.points.flatMap((p, i) => [i === 0 ? 0 : p.type === 'start' ? 0 : p.type === 'curve' ? 2 : 1, p.x, p.y]);
      return [c.left, c.right, c.scale > 0 ? c.scale : 1, c.fill, ...pts];
    }
  }
}

/** A draft as a stored line style. Components with nothing to draw (no size, no text) are left out. */
export function fromDraft(d: LineStyleDraft): CustomLine {
  return {
    name: d.name.trim(),
    // Not flatMap: text and symbols are arrays themselves.
    spec: [d.scaleWithWidth, ...d.lines.map((l) => [l.offset, ...l.components.map(writeComponent).filter((c) => c !== null)])],
  };
}

/** What is wrong with a draft that would stop it drawing, or null when it is fine. */
export function draftProblem(d: LineStyleDraft): string | null {
  if (!d.name.trim()) return 'Give the line style a name.';
  if (!d.lines.length) return 'Add at least one line.';
  for (const [i, l] of d.lines.entries()) {
    const at = d.lines.length > 1 ? ` on line ${i + 1}` : '';
    if (l.components.length && !l.components.some((c) => (c.kind === 'dash' ? c.width > 0 : c.kind === 'text' ? !!c.text : c.kind === 'vector' ? c.points.length > 0 : false))) {
      return `Nothing would be drawn${at}: add a dash, text or symbol, or remove the gaps to draw it solid.`;
    }
    for (const c of l.components) {
      if (c.kind === 'vector') {
        // Curve points come in threes: two control points and an end point.
        let run = 0;
        for (const p of c.points.slice(1)) {
          if (p.type === 'curve') run++;
          else if (run % 3) return `A symbol${at} has a curve without all three of its points.`;
          else run = 0;
        }
        if (run % 3) return `A symbol${at} has a curve without all three of its points.`;
      }
    }
    // A pattern that takes no room along the line draws once and stops.
    const advance = l.components.reduce((s, c) => s + (c.kind === 'text' ? (c.text ? 1 : 0) : c.kind === 'vector' ? (c.left + c.right) * c.scale : c.width), 0);
    if (l.components.length && advance <= 0) return `The pattern${at} takes no length along the line: give a symbol a left or right length, or add a gap.`;
  }
  return null;
}

/** A name not already among `taken`: `Name`, then `Name (2)`, `Name (3)`... */
export function uniqueName(name: string, taken: readonly string[]): string {
  const base = name.trim() || 'Line Style';
  if (!taken.includes(base)) return base;
  const stem = base.replace(/ \(\d+\)$/, '');
  for (let n = 2; ; n++) if (!taken.includes(`${stem} (${n})`)) return `${stem} (${n})`;
}
