/**
 * Revu's Standard hatch set. Each pattern is one unit tile (y up, as authored). Page space is y
 * down, so drawing mirrors Y. A scale of 100 repeats the tile every quarter inch (18 pt) with a
 * 1 pt stroke; other scales multiply the tile and the stroke together.
 */

export type HatchPattern =
  | 'brick'
  | 'diagonalBrick'
  | 'horizontal'
  | 'vertical'
  | 'diagonalDown'
  | 'diagonalUp'
  | 'grid'
  | 'weave'
  | 'dots10'
  | 'dots20'
  | 'dots30';

/** Ids saved by the old angle hatches. They still draw; the dropdown does not list them. */
export type LegacyHatch = 'diagonal' | 'backDiagonal' | 'cross' | 'diagonalCross';

export type StoredHatch = HatchPattern | LegacyHatch;

/** Dropdown entries, including None. Legacy ids are absent. */
export const HATCH_PATTERNS: { value: 'none' | HatchPattern; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'brick', label: 'Brick' },
  { value: 'diagonalBrick', label: 'Diagonal Brick' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'diagonalDown', label: 'Diagonal Down' },
  { value: 'diagonalUp', label: 'Diagonal Up' },
  { value: 'grid', label: 'Grid' },
  { value: 'weave', label: 'Weave' },
  { value: 'dots10', label: '10% Dots' },
  { value: 'dots20', label: '20% Dots' },
  { value: 'dots30', label: '30% Dots' },
];

const QUARTER_INCH = 18;
/** Lines run this far past the unit square so neighbouring tiles meet without a gap. */
const LO = -0.05555556;
const HI = 1.055556;

export type HatchElement =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'dot'; x: number; y: number; size: 'small' | 'large' };

interface HatchDef {
  id: HatchPattern | 'diagonalCross';
  scaleX: number;
  scaleY: number;
  /** Tile edge in points at scale 100. */
  size: number;
  /** Stroke width in points at scale 100. Small dots are this wide. */
  lineWidth: number;
  /** Unit-cell elements, y up. */
  elements: HatchElement[];
}

const line = (s: readonly number[]): HatchElement => ({ type: 'line', x1: s[0]!, y1: s[1]!, x2: s[2]!, y2: s[3]! });

/** A square lattice plus the same lattice shifted by half a step. `divisions` is the step count from 0 to 1. */
function dotLattice(divisions: number): HatchElement[] {
  const dots: HatchElement[] = [];
  const n = divisions + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) dots.push({ type: 'dot', x: i / divisions, y: j / divisions, size: 'small' });
  }
  for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < divisions; j++) dots.push({ type: 'dot', x: (i + 0.5) / divisions, y: (j + 0.5) / divisions, size: 'small' });
  }
  return dots;
}

const DIAGONAL_DOWN: number[][] = [
  [LO, HI, HI, LO],
  [LO, 0.05555556, 0.05555556, LO],
  [0.9444444, HI, HI, 0.9444444],
];

const DIAGONAL_UP: number[][] = [
  [LO, 0.9444444, 0.05555556, HI],
  [LO, LO, HI, HI],
  [0.9444444, LO, HI, 0.05555556],
];

const STANDARD: HatchDef[] = [
  {
    id: 'brick',
    scaleX: 1,
    scaleY: 1,
    size: QUARTER_INCH,
    lineWidth: 1,
    elements: [
      [LO, 1, HI, 1],
      [0.5, 1, 0.5, 0.5],
      [LO, 0.5, HI, 0.5],
      [0, 0.5, 0, 0],
      [LO, 0, HI, 0],
      [1, 0, 1, 0.5],
    ].map(line),
  },
  {
    id: 'diagonalBrick',
    scaleX: 1,
    scaleY: 1,
    size: QUARTER_INCH,
    lineWidth: 1,
    elements: [
      [LO, LO, HI, HI],
      [0.5, 0.5, 0, 1],
      [LO, 0.9444444, 0.05555556, HI],
      [0.9444444, LO, HI, 0.05555556],
    ].map(line),
  },
  {
    id: 'horizontal',
    scaleX: 1,
    scaleY: 1,
    size: QUARTER_INCH,
    lineWidth: 1,
    elements: [
      [LO, 0.75, HI, 0.75],
      [LO, 0.25, HI, 0.25],
    ].map(line),
  },
  {
    id: 'vertical',
    scaleX: 1,
    scaleY: 1,
    size: QUARTER_INCH,
    lineWidth: 1,
    elements: [
      [0.25, HI, 0.25, LO],
      [0.75, HI, 0.75, LO],
    ].map(line),
  },
  {
    id: 'diagonalDown',
    scaleX: 1,
    scaleY: 1,
    size: QUARTER_INCH,
    lineWidth: 1,
    elements: DIAGONAL_DOWN.map(line),
  },
  {
    id: 'diagonalUp',
    scaleX: 1,
    scaleY: 1,
    size: QUARTER_INCH,
    lineWidth: 1,
    elements: DIAGONAL_UP.map(line),
  },
  {
    id: 'grid',
    scaleX: 1,
    scaleY: 1,
    size: QUARTER_INCH,
    lineWidth: 1,
    elements: [
      [0.25, HI, 0.25, LO],
      [0.75, HI, 0.75, LO],
      [LO, 0.75, HI, 0.75],
      [LO, 0.25, HI, 0.25],
    ].map(line),
  },
  {
    id: 'weave',
    scaleX: 1,
    scaleY: 1,
    size: QUARTER_INCH,
    lineWidth: 1,
    elements: [
      [LO, HI, 0.25, 0.75],
      [LO, 0.4444444, 0.5555556, HI],
      [0.4444444, HI, HI, 0.4444444],
      [0.9444444, HI, HI, 0.9444444],
      [LO, LO, 0.75, 0.75],
      [0.25, 0.25, 0.5555556, LO],
      [0.5, 0.5, HI, LO],
      [1, 0.5, 0.75, 0.25],
    ].map(line),
  },
  { id: 'dots10', scaleX: 1, scaleY: 1, size: QUARTER_INCH, lineWidth: 1, elements: dotLattice(4) },
  { id: 'dots20', scaleX: 1, scaleY: 1, size: QUARTER_INCH, lineWidth: 1, elements: dotLattice(6) },
  { id: 'dots30', scaleX: 1, scaleY: 1, size: QUARTER_INCH, lineWidth: 1, elements: dotLattice(7) },
];

/** Old diagonal-cross hatch: both diagonals, not offered in the dropdown. */
const DIAGONAL_CROSS: HatchDef = {
  id: 'diagonalCross',
  scaleX: 1,
  scaleY: 1,
  size: QUARTER_INCH,
  lineWidth: 1,
  elements: [...DIAGONAL_DOWN, ...DIAGONAL_UP].map(line),
};

const BY_ID = new Map<string, HatchDef>([...STANDARD, DIAGONAL_CROSS].map((d) => [d.id, d]));

const LEGACY: Record<string, string> = {
  diagonal: 'diagonalUp',
  backDiagonal: 'diagonalDown',
  cross: 'grid',
};

/** The pattern `id` draws, or null for none. Legacy angle names map onto the Standard set. */
export function resolveHatch(id: string | undefined | null): HatchDef | null {
  if (!id || id === 'none') return null;
  return BY_ID.get(LEGACY[id] ?? id) ?? null;
}

/** Scale percent clamped to Revu's 50–200. Unset is 100. */
export function hatchScaleOf(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return 100;
  return Math.min(200, Math.max(50, scale));
}

export interface HatchLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface HatchDot {
  x: number;
  y: number;
  r: number;
}

/** One tile in page points (y down), ready to stroke and repeat. */
export interface HatchDraw {
  id: HatchPattern | 'diagonalCross';
  metrics: { cellW: number; cellH: number; lineWidth: number; dotRadius: number };
  lines: HatchLine[];
  dots: HatchDot[];
}

/** Tile geometry for `id` at `scalePercent` (100 is the authored quarter-inch tile). */
export function hatchDraw(id: string | undefined | null, scalePercent?: number): HatchDraw | null {
  const def = resolveHatch(id);
  if (!def) return null;
  const user = hatchScaleOf(scalePercent) / 100;
  const cellW = def.size * def.scaleX * user;
  const cellH = def.size * def.scaleY * user;
  const lineWidth = def.lineWidth * user;
  const dotRadius = lineWidth / 2;
  const lines: HatchLine[] = [];
  const dots: HatchDot[] = [];
  for (const el of def.elements) {
    if (el.type === 'line') {
      lines.push({ x1: el.x1 * cellW, y1: (1 - el.y1) * cellH, x2: el.x2 * cellW, y2: (1 - el.y2) * cellH });
    } else {
      dots.push({ x: el.x * cellW, y: (1 - el.y) * cellH, r: el.size === 'large' ? dotRadius * 2 : dotRadius });
    }
  }
  return { id: def.id, metrics: { cellW, cellH, lineWidth, dotRadius }, lines, dots };
}

/** Strokes and fills one tile. The caller clips to the cell when a repeat must not overlap. */
export function paintHatchCell(ctx: CanvasRenderingContext2D, draw: HatchDraw, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = draw.metrics.lineWidth;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const l of draw.lines) {
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
  }
  if (draw.lines.length) ctx.stroke();
  for (const d of draw.dots) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
