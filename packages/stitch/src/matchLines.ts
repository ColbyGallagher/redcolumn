import { SheetLookup, type Word } from '@nb/sheets';
import { cross, dot, len, perp, sub, unit, type Vec } from './affine.ts';

/** Everything stitching needs from one sheet. */
export interface StitchPage {
  width: number;
  height: number;
  words: Word[];
  /** Vector line work, flat [x1, y1, x2, y2, ...] in page space (from pdf-core's geometry()). */
  segments: Float32Array;
}

export interface MatchLine {
  pageIndex: number;
  /** Ends of the drawn match line in page space; `u` runs from p0 to p1. */
  p0: [number, number];
  p1: [number, number];
  /** Station text as printed, e.g. `12+00`, or null. */
  station: string | null;
  /** Page the label says to continue on, or null. */
  targetPage: number | null;
  /**
   * Which side of the line the sheet's drawing is on: +1 along perp(u), -1 against it. The other
   * side is the neighbouring sheet's territory.
   */
  contentSide: 1 | -1;
  /** Where the label sits, for display. */
  label: [number, number];
}

const STATION = /STA(?:TION)?\.?\s*[:=]?\s*(\d+\s*\+\s*\d+(?:\.\d+)?)/;
/** Minimum drawn length for a match line, as a fraction of the sheet's shorter side. */
const MIN_LINE_FRACTION = 0.15;
/** Match lines are drawn parallel to their label within this angle. */
const PARALLEL_SIN = Math.sin((3 * Math.PI) / 180);

function wordCenter(w: Word): [number, number] {
  return [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2];
}

/** Reading direction in page space; PDFium angles are clockwise in y-down page space. */
function wordDir(w: Word): [number, number] {
  return [Math.cos(w.angle), Math.sin(w.angle)];
}

/** The label's text: nearby words of similar size and direction, in reading order. */
function labelText(words: Word[], anchor: Word): string {
  const c = wordCenter(anchor);
  const d = wordDir(anchor);
  const n = perp(d);
  const r = anchor.size * 14;
  const near = words.filter((w) => {
    if (Math.abs(w.angle - anchor.angle) > 0.05 || Math.abs(w.size - anchor.size) > anchor.size * 0.3) return false;
    const v = sub(wordCenter(w), c);
    return Math.abs(dot(v, d)) < r * 2 && Math.abs(dot(v, n)) < anchor.size * 5;
  });
  // Lines across the label (perpendicular offset), then along it.
  near.sort((a, b) => {
    const va = sub(wordCenter(a), c);
    const vb = sub(wordCenter(b), c);
    const la = Math.round(dot(va, n) / (anchor.size * 1.2));
    const lb = Math.round(dot(vb, n) / (anchor.size * 1.2));
    return la - lb || dot(va, d) - dot(vb, d);
  });
  return near.map((w) => w.text).join(' ').toUpperCase();
}

interface LineCandidate {
  dir: [number, number];
  /** Perpendicular offset of the line from the page origin (along perp(dir)). */
  offset: number;
  tMin: number;
  tMax: number;
}

/**
 * The drawn match line next to a label: long line work parallel to the label and close to it.
 * Match lines are often dashed, so collinear pieces are merged by their perpendicular offset.
 */
function findLine(page: StitchPage, anchor: Word): LineCandidate | null {
  const dir = wordDir(anchor);
  const n = perp(dir);
  const c = wordCenter(anchor);
  const maxDist = Math.max(anchor.size * 8, 40);
  const groups = new Map<number, LineCandidate>();
  const s = page.segments;
  for (let i = 0; i < s.length; i += 4) {
    const a: Vec = [s[i]!, s[i + 1]!];
    const b: Vec = [s[i + 2]!, s[i + 3]!];
    const v = sub(b, a);
    const l = len(v);
    if (l < 2 || Math.abs(cross(unit(v), dir)) > PARALLEL_SIN) continue;
    const offset = dot(a, n);
    if (Math.abs(offset - dot(c, n)) > maxDist) continue;
    const key = Math.round(offset * 2);
    const t0 = Math.min(dot(a, dir), dot(b, dir));
    const t1 = Math.max(dot(a, dir), dot(b, dir));
    const g = groups.get(key);
    if (g) {
      g.tMin = Math.min(g.tMin, t0);
      g.tMax = Math.max(g.tMax, t1);
    } else {
      groups.set(key, { dir, offset, tMin: t0, tMax: t1 });
    }
  }
  const minLen = Math.min(page.width, page.height) * MIN_LINE_FRACTION;
  const tc = dot(c, dir);
  // A match line is where the sheet's drawing stops: line work ends on it and nothing passes
  // through. That tells it apart from streets, walls or property lines running parallel nearby,
  // which the drawing crosses.
  let best: { g: LineCandidate; passRatio: number; dist: number } | null = null;
  for (const g of groups.values()) {
    if (g.tMax - g.tMin < minLen || tc < g.tMin - maxDist || tc > g.tMax + maxDist) continue;
    const p0: [number, number] = [dir[0] * g.tMin + n[0] * g.offset, dir[1] * g.tMin + n[1] * g.offset];
    const { pass, endPlus, endMinus } = lineProfile(page, p0, dir, g.tMax - g.tMin);
    const passRatio = pass / (pass + endPlus + endMinus + 1);
    const dist = Math.abs(g.offset - dot(c, n));
    if (!best || passRatio < best.passRatio - 0.05 || (Math.abs(passRatio - best.passRatio) <= 0.05 && dist < best.dist)) best = { g, passRatio, dist };
  }
  return best?.g ?? null;
}

/** Distance (points) within which a segment end counts as ending on the line. */
const TOUCH = 1.5;
/** How far past the line a segment must continue to count as passing through. */
const THROUGH = 3;

/**
 * How line work meets a candidate line along its extent: segments passing through it, and
 * segments ending on it from each side (+1 along perp(u), -1 against it).
 */
function lineProfile(page: StitchPage, p0: Vec, u: Vec, extent: number): { pass: number; endPlus: number; endMinus: number } {
  const n = perp(u);
  let pass = 0;
  let endPlus = 0;
  let endMinus = 0;
  const s = page.segments;
  for (let i = 0; i < s.length; i += 4) {
    const a = sub([s[i]!, s[i + 1]!], p0);
    const b = sub([s[i + 2]!, s[i + 3]!], p0);
    const da = dot(a, n);
    const db = dot(b, n);
    // Line work along the candidate itself (its own dashes) says nothing.
    if (Math.abs(da - db) < 0.5) continue;
    const touchA = Math.abs(da) <= TOUCH;
    const touchB = Math.abs(db) <= TOUCH;
    if (touchA !== touchB) {
      const at = touchA ? a : b;
      const t = dot(at, u);
      if (t < -TOUCH || t > extent + TOUCH) continue;
      if ((touchA ? db : da) > 0) endPlus++;
      else endMinus++;
    } else if (da * db < 0 && Math.abs(da) > THROUGH && Math.abs(db) > THROUGH) {
      const t = dot(a, u) + ((dot(b, u) - dot(a, u)) * da) / (da - db);
      if (t >= 0 && t <= extent) pass++;
    }
  }
  return { pass, endPlus, endMinus };
}

/** The sheet's side of a match line: where the line work ending on it comes from. */
function contentSide(page: StitchPage, p0: Vec, u: Vec, extent: number): 1 | -1 {
  const { endPlus, endMinus } = lineProfile(page, p0, u, extent);
  return endPlus >= endMinus ? 1 : -1;
}

/** Match lines on one sheet: "MATCH LINE" labels, their station and next sheet, and the drawn line. */
export function findMatchLines(page: StitchPage, pageIndex: number, lookup: SheetLookup): MatchLine[] {
  const out: MatchLine[] = [];
  const anchors = page.words.filter((w) => w.text.toUpperCase().replace(/[^A-Z]/g, '') === 'MATCH');
  for (const anchor of anchors) {
    const text = labelText(page.words, anchor);
    if (!/MATCH\s*LINE/.test(text)) continue;
    const line = findLine(page, anchor);
    if (!line) continue;
    const n = perp(line.dir);
    const p0: [number, number] = [line.dir[0] * line.tMin + n[0] * line.offset, line.dir[1] * line.tMin + n[1] * line.offset];
    const p1: [number, number] = [line.dir[0] * line.tMax + n[0] * line.offset, line.dir[1] * line.tMax + n[1] * line.offset];
    // Two labels on the same drawn line (one per side, or repeated) describe one match line.
    if (out.some((m) => Math.abs(dot(sub(m.p0, p0), n)) < 1 && Math.abs(cross(unit(sub(m.p1, m.p0)), line.dir)) < PARALLEL_SIN)) continue;
    const station = STATION.exec(text)?.[1]?.replace(/\s+/g, '') ?? null;
    let targetPage: number | null = null;
    for (const token of text.split(/\s+/)) {
      const p = lookup.find(token);
      if (p !== null && p !== pageIndex) targetPage = p;
    }
    out.push({ pageIndex, p0, p1, station, targetPage, contentSide: contentSide(page, p0, line.dir, line.tMax - line.tMin), label: wordCenter(anchor) });
  }
  return out;
}
