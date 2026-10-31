/** A word on a page in page space (points, top-left origin, y down). Matches pdf-core's TextWord. */
export interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
  /** Reading direction in radians, clockwise in page space. */
  angle: number;
}

export interface PageText {
  width: number;
  height: number;
  words: Word[];
}

/**
 * Where sheet info came from: the page's text, the PDF's own page labels, AI, the drawing standard
 * chosen for the set (its title-block boxes), or a person. Later sources win.
 */
export type SheetSource = 'text' | 'pdf' | 'ai' | 'standard' | 'manual';

export interface SheetInfo {
  /** Sheet number as printed, e.g. `C-101` or `A2.01`. */
  number: string | null;
  /** Sheet title, e.g. `GRADING AND DRAINAGE PLAN`. */
  title: string | null;
  /** Discipline name derived from the number prefix or read by AI, e.g. `Civil`. */
  discipline: string | null;
  /** Scale text from the title block (e.g. `1" = 20'`), if found. */
  scaleText: string | null;
  revision: string | null;
  /** Custom fields a drawing standard's boxes read (Status, Drawn by), by name. */
  fields?: Record<string, string>;
  source: SheetSource;
  /** 0..1 */
  confidence: number;
}

export const SOURCE_RANK: Record<SheetSource, number> = { text: 0, pdf: 1, ai: 2, standard: 3, manual: 4 };
