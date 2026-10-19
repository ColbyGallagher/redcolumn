import { SheetLookup } from '@nb/sheets';
import { compose, invert, perp, sub, unit, IDENTITY, type Affine } from './affine.ts';
import { alignPair, type PairAlignment } from './align.ts';
import { findMatchLines, type MatchLine, type StitchPage } from './matchLines.ts';

/** Keeps the part of a sheet on its own side of a match line (page space). */
export interface HalfPlane {
  point: [number, number];
  /** Points p with dot(p - point, normal) >= 0 are kept. */
  normal: [number, number];
}

export interface Placement {
  pageIndex: number;
  /** Page space → the group's world space (the root sheet's page space). */
  toWorld: Affine;
  clips: HalfPlane[];
  /** The part of the sheet holding the drawing (page space); the whole page when absent. */
  region?: [number, number][];
}

export interface StitchEdge {
  a: number;
  b: number;
  station: string | null;
  alignment: PairAlignment;
  /** The match line on sheet `a`, when known (so the join can be taken over and edited by hand). */
  line?: Pick<MatchLine, 'p0' | 'p1' | 'contentSide'>;
}

export interface StitchGroup {
  /** Sheets in the order they chain, starting from the lowest page index. */
  placements: Placement[];
  edges: StitchEdge[];
}

export interface StitchResult {
  groups: StitchGroup[];
  matchLines: MatchLine[];
}

export function clipFor(line: Pick<MatchLine, 'p0' | 'p1' | 'contentSide'>): HalfPlane {
  const n = perp(unit(sub(line.p1, line.p0)));
  return { point: line.p0, normal: [n[0] * line.contentSide, n[1] * line.contentSide] };
}

/**
 * Chains paired sheets into groups placed in one coordinate system each, walking the pairs
 * outward from each group's lowest page (which keeps its own page space).
 */
export function chainGroups(edges: StitchEdge[], clips: ReadonlyMap<number, HalfPlane[]>): StitchGroup[] {
  const placed = new Map<number, Affine>();
  const groups: StitchGroup[] = [];
  const pagesInEdges = [...new Set(edges.flatMap((e) => [e.a, e.b]))].sort((x, y) => x - y);
  for (const root of pagesInEdges) {
    if (placed.has(root)) continue;
    const group: StitchGroup = { placements: [], edges: [] };
    const queue = [root];
    placed.set(root, IDENTITY);
    while (queue.length) {
      const p = queue.shift()!;
      group.placements.push({ pageIndex: p, toWorld: placed.get(p)!, clips: clips.get(p) ?? [] });
      for (const e of edges) {
        if (e.a !== p && e.b !== p) continue;
        if (!group.edges.includes(e)) group.edges.push(e);
        const other = e.a === p ? e.b : e.a;
        if (placed.has(other)) continue;
        // bToA maps B into A; going from A to B needs the inverse.
        const otherToP = e.a === p ? e.alignment.bToA : invert(e.alignment.bToA);
        placed.set(other, compose(placed.get(p)!, otherToP));
        queue.push(other);
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Finds match lines on every sheet, pairs sheets that point at each other (by sheet reference,
 * falling back to a shared station), aligns each pair and chains the pairs into groups of sheets
 * placed in one continuous coordinate system.
 */
export function stitchSet(pages: StitchPage[], sheetNumbers: readonly (string | null)[]): StitchResult {
  const lookup = new SheetLookup(sheetNumbers);
  const matchLines = pages.flatMap((p, i) => findMatchLines(p, i, lookup));

  // Pair match lines: A's line pointing at B with B's line pointing back (or the same station).
  const edges: StitchEdge[] = [];
  const used = new Set<MatchLine>();
  for (const a of matchLines) {
    if (used.has(a)) continue;
    const candidates = matchLines.filter((b) => b !== a && !used.has(b) && b.pageIndex !== a.pageIndex);
    const b =
      candidates.find((b) => a.targetPage === b.pageIndex && b.targetPage === a.pageIndex) ??
      candidates.find((b) => a.station && b.station === a.station && (a.targetPage === null || a.targetPage === b.pageIndex));
    if (!b) continue;
    used.add(a);
    used.add(b);
    edges.push({ a: a.pageIndex, b: b.pageIndex, station: a.station ?? b.station, alignment: alignPair(pages[a.pageIndex]!, a, pages[b.pageIndex]!, b), line: { p0: a.p0, p1: a.p1, contentSide: a.contentSide } });
  }

  const clips = new Map<number, HalfPlane[]>();
  for (const line of matchLines) if (used.has(line)) clips.set(line.pageIndex, [...(clips.get(line.pageIndex) ?? []), clipFor(line)]);
  const groups = chainGroups(edges, clips);
  return { groups, matchLines };
}
