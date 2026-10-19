import { apply, compose, len, perp, rigid, scaleOf, similarityFromSegments, sub, unit, type Vec } from './affine.ts';
import { alignPair } from './align.ts';
import { chainGroups, clipFor, type HalfPlane, type Placement, type StitchEdge, type StitchGroup } from './layout.ts';
import type { MatchLine, StitchPage } from './matchLines.ts';

/** A match line the user placed by clicking its two ends. */
export interface ManualMatchLine {
  id: string;
  pageIndex: number;
  p0: [number, number];
  p1: [number, number];
  /** Which side of the line holds this sheet's drawing: +1 along perp(p1 - p0), -1 against it. */
  contentSide: 1 | -1;
  name: string;
  /** The line on another sheet this one joins, or null while unpaired. */
  matchTo: string | null;
  /**
   * A hand adjustment of where this line's sheet sits, in points of the pair's frame (see
   * `pairFrame`): along the reference line, and across it. On the pair's other line, +across
   * moves the sheet apart from the reference sheet; on the reference line, it moves it closer.
   */
  offset?: [number, number];
}

/** Shorter match lines than this (points) are ignored: their ends fix no direction. */
export const MIN_LINE_LENGTH = 1;

/**
 * The line of a pair that its adjustments are measured against. Chosen by ID, which page edits
 * never change, so stored adjustments keep their meaning when pages are reordered.
 */
export function referenceLine<L extends Pick<ManualMatchLine, 'id'>>(a: L, b: L): L {
  return a.id < b.id ? a : b;
}

/**
 * The frame a pair's adjustments are measured in, in the reference line's page space: `along`
 * runs the way that line was clicked, `across` points out of its sheet's drawing, into the other.
 */
export function pairFrame(ref: Pick<ManualMatchLine, 'p0' | 'p1' | 'contentSide'>): { along: Vec; across: Vec } {
  const along = unit(sub(ref.p1, ref.p0));
  const n = perp(along);
  return { along, across: [-n[0] * ref.contentSide, -n[1] * ref.contentSide] };
}

/** How far the other line's sheet is slid relative to the reference line's, in the reference sheet's page space. */
function adjustment(ref: ManualMatchLine, other: ManualMatchLine): [number, number] {
  const { along, across } = pairFrame(ref);
  // Sliding the reference sheet one way is sliding the other the opposite way.
  const [da, dc] = [(other.offset?.[0] ?? 0) - (ref.offset?.[0] ?? 0), (other.offset?.[1] ?? 0) - (ref.offset?.[1] ?? 0)];
  return [along[0] * da + across[0] * dc, along[1] * da + across[1] * dc];
}

/** Keeps the part of `poly` on the kept side of `h` (Sutherland–Hodgman against one half-plane). */
export function clipToHalfPlane(poly: readonly Vec[], h: HalfPlane): [number, number][] {
  const side = (p: Vec) => (p[0] - h.point[0]) * h.normal[0] + (p[1] - h.point[1]) * h.normal[1];
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push([a[0], a[1]]);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function polygonArea(poly: readonly Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** The part of a placed sheet that shows (page space): its region, cut at each of its match lines. */
export function visiblePolygon(placement: Pick<Placement, 'clips' | 'region'>, width: number, height: number): [number, number][] {
  let poly: [number, number][] = placement.region?.length
    ? placement.region.map((p) => [p[0], p[1]])
    : [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ];
  for (const c of placement.clips) poly = clipToHalfPlane(poly, c);
  return poly;
}

/**
 * The side of a line holding more of the sheet (or of its region): drawings usually continue
 * across the bigger part of the sheet, and the neighbouring sheet takes over beyond the line.
 */
export function defaultContentSide(width: number, height: number, p0: Vec, p1: Vec, region?: readonly Vec[]): 1 | -1 {
  const line = { p0: [p0[0], p0[1]] as [number, number], p1: [p1[0], p1[1]] as [number, number] };
  const area = (side: 1 | -1) => polygonArea(visiblePolygon({ clips: [clipFor({ ...line, contentSide: side })], region: region?.map((p) => [p[0], p[1]]) }, width, height));
  return area(1) >= area(-1) ? 1 : -1;
}

/** Scale ratios this close to 1 count as "the same scale", where the drawings can refine the join. */
const SAME_SCALE = 0.01;

function asMatchLine(m: ManualMatchLine): MatchLine {
  return { pageIndex: m.pageIndex, p0: m.p0, p1: m.p1, station: m.name || null, targetPage: null, contentSide: m.contentSide, label: [(m.p0[0] + m.p1[0]) / 2, (m.p0[1] + m.p1[1]) / 2] };
}

/**
 * Places sheet B so its match line lies on A's, with B's drawing on the far side of A's. The
 * line ends fix rotation, scale and position; which end meets which follows from the content
 * sides, so the order the user clicked the ends in does not matter.
 */
export function fitPair(a: ManualMatchLine, b: ManualMatchLine): StitchEdge['alignment'] {
  // A similarity keeps orientation, so B's content side carries over relative to the line's
  // direction: run B's line the same way as A's only when their content sides already differ.
  const bToA = a.contentSide !== b.contentSide ? similarityFromSegments(a.p0, a.p1, b.p0, b.p1) : similarityFromSegments(a.p0, a.p1, b.p1, b.p0);
  return { bToA, votes: 0, confidence: 1 };
}

/**
 * Like `fitPair`, then, when both sheets are at the same scale and their line work is known,
 * lets features crossing the match line (road edges, pipes) slide B along it into place. The
 * clicked ends win when the drawings disagree with them by more than a few percent of the line.
 */
export function alignManualPair(a: ManualMatchLine, b: ManualMatchLine, pageA?: StitchPage, pageB?: StitchPage): StitchEdge['alignment'] {
  const fit = fitPair(a, b);
  if (!pageA || !pageB || Math.abs(scaleOf(fit.bToA) - 1) > SAME_SCALE) return fit;
  const refined = alignPair(pageA, asMatchLine(a), pageB, asMatchLine(b));
  if (refined.votes < 3) return fit;
  const mid: Vec = [(b.p0[0] + b.p1[0]) / 2, (b.p0[1] + b.p1[1]) / 2];
  const off = len(sub(apply(refined.bToA, mid), apply(fit.bToA, mid)));
  const ends = Math.max(len(sub(apply(refined.bToA, b.p0), apply(fit.bToA, b.p0))), len(sub(apply(refined.bToA, b.p1), apply(fit.bToA, b.p1))));
  const lineLength = len(sub(a.p1, a.p0));
  if (off > lineLength * 0.05 || ends > lineLength * 0.1) return fit;
  return { bToA: refined.bToA, votes: refined.votes, confidence: refined.confidence };
}

export interface ManualStitchInput {
  lines: readonly ManualMatchLine[];
  /** Drawing regions by page (page space). */
  regions?: ReadonlyMap<number, [number, number][]>;
  /** Line work by page, for refining same-scale joins. */
  pages?: ReadonlyMap<number, StitchPage>;
  /** Further joins to chain in with the user's (e.g. detected joins of sheets the user left alone). */
  extra?: { edges: readonly StitchEdge[]; clips: ReadonlyMap<number, readonly HalfPlane[]> };
}

/** A line too short to fix a direction (an end dragged onto the other, say). */
export const tooShort = (l: Pick<ManualMatchLine, 'p0' | 'p1'>) => len(sub(l.p1, l.p0)) < MIN_LINE_LENGTH;

/** The joins the user's paired match lines make, and where each sheet is cut. */
export function manualEdges({ lines, pages }: Pick<ManualStitchInput, 'lines' | 'pages'>): { edges: StitchEdge[]; clips: Map<number, HalfPlane[]> } {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const edges: StitchEdge[] = [];
  const clips = new Map<number, HalfPlane[]>();
  const done = new Set<string>();
  for (const a of lines) {
    const b = a.matchTo ? byId.get(a.matchTo) : undefined;
    if (!b || b.pageIndex === a.pageIndex || done.has(a.id) || done.has(b.id) || tooShort(a) || tooShort(b)) continue;
    // A pairing counts once, from either end.
    done.add(a.id);
    done.add(b.id);
    const [first, second] = a.pageIndex < b.pageIndex ? [a, b] : [b, a];
    const alignment = alignManualPair(first, second, pages?.get(first.pageIndex), pages?.get(second.pageIndex));
    const ref = referenceLine(a, b);
    const [dx, dy] = adjustment(ref, ref === first ? second : first);
    if (dx || dy) {
      // In the reference sheet's space: slide the second sheet, or the first one (which is the
      // second sheet sliding the other way, in its own space).
      alignment.bToA = ref === first ? compose(rigid(0, dx, dy), alignment.bToA) : compose(alignment.bToA, rigid(0, -dx, -dy));
    }
    edges.push({ a: first.pageIndex, b: second.pageIndex, station: first.name || second.name || null, alignment, line: first });
    for (const l of [a, b]) clips.set(l.pageIndex, [...(clips.get(l.pageIndex) ?? []), clipFor(l)]);
  }
  return { edges, clips };
}

/** Groups of sheets joined at the user's paired match lines (and any `extra` joins). */
export function stitchManual({ lines, regions, pages, extra }: ManualStitchInput): StitchGroup[] {
  const { edges, clips } = manualEdges({ lines, pages });
  if (extra) {
    edges.push(...extra.edges);
    for (const [page, list] of extra.clips) clips.set(page, [...(clips.get(page) ?? []), ...list]);
  }
  const groups = chainGroups(edges, clips);
  if (regions) for (const g of groups) for (const p of g.placements) p.region = regions.get(p.pageIndex);
  return groups;
}
