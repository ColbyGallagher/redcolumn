import { disciplineFor } from './detect.ts';
import type { LinkKind } from './links.ts';
import type { SheetInfo } from './types.ts';

/** What the graph needs of a link. A stored link has all of it; a link fresh from detection has no status. */
export interface GraphLink {
  pageIndex: number;
  targetPage: number;
  kind: LinkKind;
  /** Rejected links are left out. Review links count, and are counted apart so they can be shown as unsure. */
  status?: 'auto' | 'review' | 'accepted' | 'rejected';
}

/** One sheet of the set. */
export interface GraphNode {
  pageIndex: number;
  number: string | null;
  title: string | null;
  discipline: string | null;
  /** Links on this sheet that go to another sheet. */
  out: number;
  /** Links on other sheets that come here. */
  in: number;
}

/** Every link from one sheet to another, as one edge. */
export interface GraphEdge {
  from: number;
  to: number;
  /** How many links make up the edge. */
  links: number;
  byKind: Partial<Record<LinkKind, number>>;
  /** How many of them still wait for review. */
  review: number;
}

/** The sheets of one discipline, in set order. `discipline` is null for sheets that have none. */
export interface GraphGroup {
  discipline: string | null;
  pages: number[];
}

export interface SheetGraph {
  /** One per page, in page order. */
  nodes: GraphNode[];
  /** Sorted by `from`, then `to`. */
  edges: GraphEdge[];
  /** Disciplines in the order the set first uses them; sheets with none come last. */
  groups: GraphGroup[];
  /** Pages that are a sheet index: they list the set, so their links say nothing about how it hangs together. */
  indexPages: number[];
  /** Pages nothing links to or from, apart from a sheet index. An index page is never in this list. */
  unlinked: number[];
}

export interface GraphOptions {
  /** Only these kinds of link. All kinds when absent or empty. */
  kinds?: readonly LinkKind[];
}

/** A sheet index lists at least this many sheets... */
const INDEX_MIN_SHEETS = 10;
/** ...or, in a small set, this many (never fewer)... */
const INDEX_FLOOR_SHEETS = 5;
/** ...as long as it points at this share of the other sheets. */
const INDEX_SET_SHARE = 0.8;
/** This share of the sheets a page points at must be listed the way an index lists them, and must not point back. */
const INDEX_SHARE = 0.8;

/**
 * The pages that are a sheet index (the cover sheet's list of drawings). An index points at many
 * sheets, each once, by a plain sheet reference, in runs that follow the order of the set, and the
 * sheets it lists do not point back at it. A plan that calls up a dozen detail sheets is not one:
 * its references are bubbles, or repeat, or jump about. Neither is a key plan: it lists its
 * enlarged plans the way an index would, but each of them refers back to it.
 */
function findIndexPages(links: readonly GraphLink[], pageCount: number): number[] {
  const minSheets = Math.min(INDEX_MIN_SHEETS, Math.max(INDEX_FLOOR_SHEETS, Math.ceil((pageCount - 1) * INDEX_SET_SHARE)));
  // Per target: how many plain sheet links, and how many links of other kinds that are not waiting for review.
  const bySource = new Map<number, Map<number, { sheet: number; other: number }>>();
  for (const l of links) {
    let targets = bySource.get(l.pageIndex);
    if (!targets) bySource.set(l.pageIndex, (targets = new Map()));
    let t = targets.get(l.targetPage);
    if (!t) targets.set(l.targetPage, (t = { sheet: 0, other: 0 }));
    // A station range or detail reference read out of an index's title column waits in review; it does not unmake the row.
    if (l.kind === 'sheet') t.sheet++;
    else if (l.status !== 'review') t.other++;
  }
  const pages: number[] = [];
  for (const [from, targets] of bySource) {
    if (targets.size < minSheets) continue;
    const listedNextTo = (page: number) => page === from || targets.has(page);
    let listed = 0;
    let oneWay = 0;
    for (const [to, t] of targets) {
      if (t.sheet === 1 && t.other === 0 && (listedNextTo(to - 1) || listedNextTo(to + 1))) listed++;
      if (!bySource.get(to)?.has(from)) oneWay++;
    }
    if (listed >= targets.size * INDEX_SHARE && oneWay >= targets.size * INDEX_SHARE) pages.push(from);
  }
  return pages.sort((a, b) => a - b);
}

/**
 * The set as a graph: a node per sheet and an edge per pair of sheets that reference each other,
 * one way. A link that stays on its own sheet (a detail drawn beside its callout) is not an edge,
 * and neither is a rejected link or one that goes off the end of the set.
 *
 * A sheet index points at every sheet, so its edges would make every sheet look linked. They stay
 * in `edges`, the index is named in `indexPages` (whatever `kinds` asks for), and `unlinked` is
 * worked out without them.
 */
export function buildSheetGraph(
  pageCount: number,
  sheets: Readonly<Record<number, Pick<SheetInfo, 'number' | 'title' | 'discipline'> | null | undefined>>,
  links: readonly GraphLink[],
  options: GraphOptions = {},
): SheetGraph {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < pageCount; i++) {
    const s = sheets[i];
    const number = s?.number ?? null;
    nodes.push({ pageIndex: i, number, title: s?.title ?? null, discipline: s?.discipline ?? (number ? disciplineFor(number) : null), out: 0, in: 0 });
  }

  const between = links.filter((l) => l.status !== 'rejected' && l.pageIndex !== l.targetPage && nodes[l.pageIndex] && nodes[l.targetPage]);
  const indexPages = findIndexPages(between, pageCount);

  const kinds = options.kinds?.length ? new Set<LinkKind>(options.kinds) : null;
  const byPair = new Map<number, GraphEdge>();
  for (const l of between) {
    if (kinds && !kinds.has(l.kind)) continue;
    const from = nodes[l.pageIndex]!;
    const to = nodes[l.targetPage]!;
    const key = l.pageIndex * pageCount + l.targetPage;
    let edge = byPair.get(key);
    if (!edge) byPair.set(key, (edge = { from: l.pageIndex, to: l.targetPage, links: 0, byKind: {}, review: 0 }));
    edge.links++;
    edge.byKind[l.kind] = (edge.byKind[l.kind] ?? 0) + 1;
    if (l.status === 'review') edge.review++;
    from.out++;
    to.in++;
  }
  const edges = [...byPair.values()].sort((a, b) => a.from - b.from || a.to - b.to);

  const groups: GraphGroup[] = [];
  const byDiscipline = new Map<string, GraphGroup>();
  const none: GraphGroup = { discipline: null, pages: [] };
  for (const n of nodes) {
    if (n.discipline === null) {
      none.pages.push(n.pageIndex);
      continue;
    }
    let g = byDiscipline.get(n.discipline);
    if (!g) {
      byDiscipline.set(n.discipline, (g = { discipline: n.discipline, pages: [] }));
      groups.push(g);
    }
    g.pages.push(n.pageIndex);
  }
  if (none.pages.length) groups.push(none);

  const index = new Set(indexPages);
  const linked = new Set<number>(indexPages);
  for (const e of edges) if (!index.has(e.from)) linked.add(e.from).add(e.to);

  return { nodes, edges, groups, indexPages, unlinked: nodes.filter((n) => !linked.has(n.pageIndex)).map((n) => n.pageIndex) };
}
