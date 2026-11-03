import { parseScaleText, type Scale } from './scale.ts';

/** A standard drawing sheet size, portrait, in millimetres. */
export interface PaperSize {
  name: string;
  family: 'ISO A' | 'ISO B' | 'ANSI' | 'ARCH';
  widthMm: number;
  heightMm: number;
}

const iso = (family: 'ISO A' | 'ISO B', prefix: string, w0: number, h0: number): PaperSize[] => {
  const sizes: PaperSize[] = [];
  let [w, h] = [w0, h0];
  for (let n = 0; n <= 6; n++) {
    sizes.push({ name: `${prefix}${n}`, family, widthMm: w, heightMm: h });
    [w, h] = [Math.floor(h / 2), w];
  }
  return sizes;
};

const inches = (family: 'ANSI' | 'ARCH', name: string, w: number, h: number): PaperSize => ({ name, family, widthMm: w * 25.4, heightMm: h * 25.4 });

export const PAPER_SIZES: PaperSize[] = [
  ...iso('ISO A', 'A', 841, 1189),
  ...iso('ISO B', 'B', 1000, 1414),
  inches('ANSI', 'ANSI A', 8.5, 11),
  inches('ANSI', 'ANSI B', 11, 17),
  inches('ANSI', 'ANSI C', 17, 22),
  inches('ANSI', 'ANSI D', 22, 34),
  inches('ANSI', 'ANSI E', 34, 44),
  inches('ARCH', 'ARCH A', 9, 12),
  inches('ARCH', 'ARCH B', 12, 18),
  inches('ARCH', 'ARCH C', 18, 24),
  inches('ARCH', 'ARCH D', 24, 36),
  inches('ARCH', 'ARCH E1', 30, 42),
  inches('ARCH', 'ARCH E', 36, 48),
];

const POINTS_PER_MM = 72 / 25.4;

export interface PaperMatch {
  paper: PaperSize;
  landscape: boolean;
  /** Largest relative difference of either side from the standard size. */
  error: number;
}

/**
 * The standard sheet a page of `width` × `height` PDF points was made at, in either orientation.
 * `tolerance` is the largest relative difference allowed on either side (1.5% by default, which
 * covers CAD plot margins and rounding but not a neighbouring size).
 */
export function matchPaper(width: number, height: number, tolerance = 0.015): PaperMatch | null {
  const short = Math.min(width, height) / POINTS_PER_MM;
  const long = Math.max(width, height) / POINTS_PER_MM;
  let best: PaperMatch | null = null;
  for (const paper of PAPER_SIZES) {
    const error = Math.max(Math.abs(short / paper.widthMm - 1), Math.abs(long / paper.heightMm - 1));
    if (error <= tolerance && (!best || error < best.error)) best = { paper, landscape: width > height, error };
  }
  return best;
}

/**
 * Upper case, curly quotes made straight, and each run of white space made one space, so the
 * patterns below need at most one space between parts (and cannot backtrack over long runs of it).
 */
function tidy(text: string): string {
  return text.toUpperCase().replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'").replace(/\s+/g, ' ');
}

/** The paper size named in text such as `A1`, `@ A3`, `ANSI D`, `ARCH D` or `24x36`. */
export function paperFromText(text: string): PaperSize | null {
  const t = tidy(text);
  const named = /\b(ANSI|ARCH)[ -]{0,3}(E1|[A-E])\b/.exec(t);
  if (named) return PAPER_SIZES.find((p) => p.name === `${named[1]} ${named[2]}`) ?? null;
  const iso = /\b([AB]) ?([0-6])\b/.exec(t);
  if (iso) return PAPER_SIZES.find((p) => p.name === `${iso[1]}${iso[2]}`) ?? null;
  const dims = /\b(\d{1,3}(?:\.\d{1,3})?) ?(?:"|IN)? ?[X×] ?(\d{1,3}(?:\.\d{1,3})?)(?!\d)/.exec(t);
  if (dims) {
    const [a, b] = [Number(dims[1]), Number(dims[2])].sort((x, y) => x - y) as [number, number];
    return PAPER_SIZES.find((p) => (p.family === 'ARCH' || p.family === 'ANSI') && Math.abs(p.widthMm / 25.4 - a) < 0.01 && Math.abs(p.heightMm / 25.4 - b) < 0.01) ?? null;
  }
  return null;
}

/** One scale statement from a title block, with the sheet size it was written for when given. */
export interface ScaleStatement {
  scale: Scale;
  paper: PaperSize | null;
  /** The text the statement was read from. */
  text: string;
}

/**
 * Reads every scale statement in title-block text, keeping the sheet size each is for:
 * `1:100 @ A1`, `1:500 (A1)`, `SCALE 1:200 AT A3`, and dual statements such as
 * `1:100 AT A1 / 1:200 AT A3`. A plain `1:100` gives one statement with no paper. Empty for NTS.
 */
export function parseScaleStatements(text: string): ScaleStatement[] {
  // Split dual statements, but not the slash inside an inch fraction such as 1/4". A piece without
  // a scale of its own (`1:100, A1`) belongs to the statement before it.
  const parts: string[] = [];
  for (const piece of tidy(text).split(/ \/ |\/(?= ?1 ?:)| ?(?:[;|,]|\bOR\b) ?/)) {
    if (parts.length && !/\d ?: ?\d|\d ?" ?=/.test(piece)) parts[parts.length - 1] += ` ${piece}`;
    else parts.push(piece);
  }
  const statements: ScaleStatement[] = [];
  for (const part of parts) {
    const scale = parseScaleText(part);
    if (!scale) continue;
    const after = /(?:@|\bAT\b|\bON\b|\(|\bFOR\b) ?((?:ANSI|ARCH)[ -]{0,3}(?:E1|[A-E])|[AB] ?[0-6]|\d{1,3}(?:\.\d{1,3})? ?"? ?[X×] ?\d{1,3}(?:\.\d{1,3})?)/.exec(part);
    statements.push({ scale, paper: after ? paperFromText(after[1]!) : null, text: part.trim() });
  }
  return statements;
}

export interface EffectiveScale {
  /** The scale to measure with on this page. */
  scale: Scale;
  /** The statement it came from. */
  statement: ScaleStatement;
  /** The sheet the page was actually made at, when it is a standard size. */
  actual: PaperMatch | null;
  /** Page length ÷ stated sheet length; 1 when printed at the stated size or no size was stated. */
  printRatio: number;
  /**
   * The page's proportions differ from the stated sheet's by more than 3%, so it was cropped or
   * padded rather than only resized, and the corrected scale should be checked before use.
   */
  aspectMismatch: boolean;
  /**
   * The page is a different length from the stated sheet but not a standard sheet of the same
   * family (an A1 drawing exported with a border, or put on an ANSI sheet), so it may have been
   * padded rather than resized, and the corrected scale should be checked before use.
   */
  unknownSize: boolean;
}

/**
 * The scale to measure with on a page of `width` × `height` points, from title-block scale text.
 * A drawing stated `1:100 @ A1` but saved at A3 is half size, so it measures as 1:200. With dual
 * statements the one for the page's own sheet size wins; otherwise the first one. Null when the
 * text holds no scale. `paperText` is a sheet size printed in its own box (`SIZE A1`), used for
 * statements that do not name one.
 */
export function effectiveScale(scaleText: string, width: number, height: number, paperText?: string | null): EffectiveScale | null {
  const boxPaper = paperText ? paperFromText(paperText) : null;
  const statements = parseScaleStatements(scaleText).map((s) => (s.paper || !boxPaper ? s : { ...s, paper: boxPaper }));
  if (!statements.length) return null;
  const actual = matchPaper(width, height);
  const statement = (actual && statements.find((s) => s.paper?.name === actual.paper.name)) ?? statements[0]!;
  if (!statement.paper) return { scale: statement.scale, statement, actual, printRatio: 1, aspectMismatch: false, unknownSize: false };
  const pageLong = Math.max(width, height) / POINTS_PER_MM;
  const pageShort = Math.min(width, height) / POINTS_PER_MM;
  const printRatio = pageLong / statement.paper.heightMm;
  const aspectMismatch = Math.abs(pageLong / pageShort / (statement.paper.heightMm / statement.paper.widthMm) - 1) > 0.03;
  if (Math.abs(printRatio - 1) < 0.015) return { scale: statement.scale, statement, actual, printRatio: 1, aspectMismatch, unknownSize: false };
  const scale: Scale = {
    ...statement.scale,
    metersPerPoint: statement.scale.metersPerPoint / printRatio,
    ...(statement.scale.yMetersPerPoint ? { yMetersPerPoint: statement.scale.yMetersPerPoint / printRatio } : {}),
    label: `${statement.scale.label} @ ${statement.paper.name} (on ${actual?.paper.name ?? `${Math.round(pageLong)} mm sheet`})`,
  };
  const unknownSize = !actual || actual.paper.family !== statement.paper.family;
  return { scale, statement, actual, printRatio, aspectMismatch, unknownSize };
}
