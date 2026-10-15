import type { CustomLine } from './lineStyle';
import type { LineSet } from './lineSet';

/**
 * Line styles every profile starts with, in Bluebeam's own pattern format (see lineStyle.ts), so a
 * markup drawn with one carries a /LineStyle that Revu draws the same. Lengths are in multiples of
 * the line width, so a pattern keeps its proportions as the line gets thicker.
 */

type Part = number | unknown[];

/** A pattern of lines (each `[offset, ...parts]`) that scales with the line width. */
const style = (name: string, ...lines: Part[][]): CustomLine => ({ name, spec: [true, ...lines] });

/** One line of dashes (positive) and gaps (negative). */
const dashes = (name: string, ...parts: number[]): CustomLine => style(name, [0, ...parts]);

/** A solid line with no pattern, for building multiples. */
const solid = (offset: number): Part[] => [offset];

/** Text on the line, with a dash before and after it. */
const labelled = (name: string, text: string, dash = 9): CustomLine => style(name, [0, dash, -2, [text, 'Helvetica', 5, true, false, true], -2]);

/** A symbol `width` along the line, drawn from `path` ([type, x, y] triples; 0 starts, 1 draws to). */
const symbol = (width: number, filled: boolean, ...path: number[]): unknown[] => [width / 2, width / 2, 1, filled, ...path];

const TICK = symbol(1, false, 0, 0, -3, 1, 0, 3);
const CROSS = symbol(6, false, 0, -3, -3, 1, 3, 3, 0, -3, 3, 1, 3, -3);
const CHEVRON = symbol(4, false, 0, -2, -2.5, 1, 2, 0, 1, -2, 2.5);
const ZIGZAG = [0, 6, 1, false, 0, 0, 0, 1, 1.5, 3, 1, 4.5, -3, 1, 6, 0];
/** Two arches, one either side of the line. */
const WAVE = [0, 12, 1, false, 0, 0, 0, 2, 1.5, 5, 2, 4.5, 5, 2, 6, 0, 2, 7.5, -5, 2, 10.5, -5, 2, 12, 0];

const dashLines: CustomLine[] = [
  dashes('Long Dash', 12, -5),
  dashes('Short Dash', 5, -3),
  dashes('Fine Dash', 3, -2),
  dashes('Sparse Dash', 6, -10),
  dashes('Dot', 1, -2),
  dashes('Sparse Dot', 1, -5),
  dashes('Dash Dot', 8, -3, 1, -3),
  dashes('Dash Dot Dot', 8, -3, 1, -3, 1, -3),
  dashes('Center Line', 14, -3, 4, -3),
  dashes('Phantom', 14, -3, 4, -3, 4, -3),
  dashes('Hidden', 4, -2.5),
  dashes('Property Line', 16, -3, 1.5, -3, 1.5, -3),
  style('Double Line', solid(1.2), solid(-1.2)),
  style('Triple Line', solid(2.5), solid(0), solid(-2.5)),
  style('Double Dashed', [1.2, 8, -4], [-1.2, 8, -4]),
  style('Double Dashed Staggered', [1.2, 8, -8], [-1.2, -8, 8]),
];

const symbolLines: CustomLine[] = [
  style('Railway', solid(0), [0, TICK, -5]),
  style('Fence', solid(0), [0, CROSS, -6]),
  style('Direction Arrows', solid(0), [0, CHEVRON, -8]),
  style('Zigzag', [0, ZIGZAG]),
  style('Wave', [0, WAVE]),
  style('Demolition', [0, 7, -3, CROSS, -3]),
  style('Tick Marks', [0, TICK, -4]),
];

const serviceLines: CustomLine[] = [
  labelled('Gas', 'G'),
  labelled('Water', 'W'),
  labelled('Sewer', 'S'),
  labelled('Storm Drain', 'SD', 8),
  labelled('Electric', 'E'),
  labelled('Overhead Power', 'OHP', 8),
  labelled('Underground Power', 'UGP', 8),
  labelled('Telecom', 'T'),
  labelled('Fibre Optic', 'FO', 8),
  labelled('Fire Water', 'FW', 8),
  labelled('Chilled Water', 'CHW', 8),
  labelled('Hot Water', 'HW', 8),
  labelled('Supply Air', 'SA', 8),
  labelled('Return Air', 'RA', 8),
  labelled('Exhaust Air', 'EA', 8),
  labelled('Existing', 'EX', 8),
  labelled('Proposed', 'PR', 8),
  labelled('To Be Removed', 'TBR', 8),
  labelled('Boundary', 'BDY', 8),
];

export const DEFAULT_LINE_SETS: readonly LineSet[] = [
  { title: 'Dashes and Patterns', styles: dashLines },
  { title: 'Symbols', styles: symbolLines },
  { title: 'Services and Utilities', styles: serviceLines },
];
