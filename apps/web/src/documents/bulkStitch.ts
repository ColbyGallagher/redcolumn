import { PT_PER_MM, refineCopiedLine, segmentsNear, type SheetPair } from '@nb/stitch';
import type { Point, StoredManualStitch, StoredMatchLine } from '@nb/markup';
import { inked } from '../sheets/marks';

/**
 * Apply Stitching to Other Sheets: copies the match lines and regions set up on one
 * discipline's plan sheets onto another's (same document or another open one), paired sheet by
 * sheet, then nudges each copied line onto the drawn match line close by on its new sheet.
 */

/** Sheets with a matched match line: the ones a stitch can be copied from. */
export function stitchSourceSheets(manual: StoredManualStitch): number[] {
  const ids = new Set(manual.lines.map((l) => l.id));
  return [...new Set(manual.lines.filter((l) => l.matchTo && ids.has(l.matchTo)).map((l) => l.pageIndex))].sort((a, b) => a - b);
}

/** Copied lines whose partner is not copied with them (its sheet was skipped), so they won't join. */
export function unpartneredLines(source: StoredManualStitch, pairs: readonly SheetPair[]): number {
  const copied = new Set(pairs.filter((p) => p.target !== null).map((p) => p.source));
  const page = new Map(source.lines.map((l) => [l.id, l.pageIndex]));
  return source.lines.filter((l) => copied.has(l.pageIndex) && l.matchTo && page.has(l.matchTo) && !copied.has(page.get(l.matchTo)!)).length;
}

/** What copying onto `targets` would replace in the target's stitching. */
export function replacementSummary(target: StoredManualStitch, targets: readonly number[]): { lines: number; regions: number; sheets: number; broken: number } {
  const on = new Set(targets);
  const removed = target.lines.filter((l) => on.has(l.pageIndex));
  const ids = new Set(removed.map((l) => l.id));
  const regions = Object.keys(target.regions).filter((k) => on.has(Number(k)));
  return {
    lines: removed.length,
    regions: regions.length,
    sheets: new Set([...removed.map((l) => l.pageIndex), ...regions.map(Number)]).size,
    broken: target.lines.filter((l) => !on.has(l.pageIndex) && l.matchTo && ids.has(l.matchTo)).length,
  };
}

/** Pages this much apart in width or height (points) are not the same sheet size. */
const SIZE_SLACK = 2;
/** Whether a target page is the source page's size (rotation is applied in both sizes). */
export const sameSize = (a: { width: number; height: number }, b: { width: number; height: number }) => Math.abs(a.width - b.width) <= SIZE_SLACK && Math.abs(a.height - b.height) <= SIZE_SLACK;

/** How one target sheet came out. */
export interface SheetResult {
  source: number;
  target: number;
  /** Match lines copied onto it. */
  lines: number;
  /** Of those, how many were nudged onto the sheet's own drawn match line. */
  snapped: number;
  /** Of those, how many have no partner (its sheet was skipped). */
  unpartnered: number;
  /** The least sure of its lines, 0..1. */
  confidence: number;
  /** The farthest any of its lines moved (paper mm). */
  movedMm: number;
  /** Why a line was left where it was copied to, when one was. */
  problem: string | null;
}

/** The copied stitching, ready to be placed onto the target's (see `placeCopies`). */
export interface BulkCopy {
  lines: StoredMatchLine[];
  regions: Record<number, Point[]>;
  /** Every target sheet; whatever stitching they had gives way. */
  targets: number[];
}

export interface BulkStitchInput {
  /** The stitching the lines are copied from. */
  source: StoredManualStitch;
  pairs: readonly SheetPair[];
  /** How far (paper mm) a copy may be nudged to land on the target's drawn line. */
  toleranceMm: number;
  /** Line work of a source and of a target sheet (flat x1, y1, x2, y2...), or null when it can't be read. */
  sourceSegments: (page: number) => Promise<ArrayLike<number> | null>;
  targetSegments: (page: number) => Promise<ArrayLike<number> | null>;
  /** Target sheets to copy onto without snapping (a different page size from their source, say), with the reason. */
  copyOnly?: ReadonlyMap<number, string>;
  /** Called after each pair: pairs done, of how many. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

let counter = 0;
const newId = () => `ml-${Date.now().toString(36)}-b${(counter++).toString(36)}`;

/**
 * Copies `source`'s match lines and regions onto the paired sheets and nudges each copy onto its
 * new sheet's drawn match line. Works one pair at a time, reading only that pair's line work.
 */
export async function bulkStitch({ source, pairs, toleranceMm, sourceSegments, targetSegments, copyOnly, onProgress, signal }: BulkStitchInput): Promise<{ copy: BulkCopy; results: SheetResult[] }> {
  const live = pairs.filter((p): p is { source: number; target: number } => p.target !== null);
  const toTarget = new Map(live.map((p) => [p.source, p.target]));
  const tolerance = Math.max(0, toleranceMm) * PT_PER_MM;
  const copied = source.lines.filter((l) => toTarget.has(l.pageIndex));
  const ids = new Map(copied.map((l) => [l.id, newId()]));
  const lines: StoredMatchLine[] = [];
  const results: SheetResult[] = [];

  for (const [k, { source: from, target: page }] of live.entries()) {
    signal?.throwIfAborted();
    const mine = copied.filter((l) => l.pageIndex === from);
    const r: SheetResult = { source: from, target: page, lines: 0, snapped: 0, unpartnered: 0, confidence: 1, movedMm: 0, problem: null };
    if (mine.length) results.push(r);
    const skipWhy = copyOnly?.get(page) ?? (tolerance > 0 ? null : 'Not checked (tolerance 0)');
    // Only this pair's line work is held, cut down to what lies near its lines.
    let src: Float32Array | null = null;
    let tgt: Float32Array | null = null;
    if (mine.length && !skipWhy) {
      const [s, t] = await Promise.all([sourceSegments(from).catch(() => null), targetSegments(page).catch(() => null)]);
      src = s ? segmentsNear(s, mine, tolerance) : null;
      tgt = t ? segmentsNear(t, mine, tolerance) : null;
    }
    for (const l of mine) {
      const refine = tgt ? refineCopiedLine(l, src, tgt, tolerance) : null;
      r.lines++;
      if (refine?.snapped) {
        r.snapped++;
        r.movedMm = Math.max(r.movedMm, Math.hypot(refine.shift[0], refine.shift[1]) / PT_PER_MM);
      } else r.problem ??= refine?.reason ?? skipWhy ?? 'The target sheet’s line work could not be read';
      r.confidence = Math.min(r.confidence, refine?.confidence ?? 0);
      const matchTo = l.matchTo ? (ids.get(l.matchTo) ?? null) : null;
      if (l.matchTo && !matchTo) r.unpartnered++;
      const { offset, ...rest } = l;
      // A hand adjustment corrects how the source drawings sit; a snapped copy already sits on
      // its own sheet's line, so it starts without one. It carries over only with its pair.
      const keepOffset = matchTo && offset && !refine?.snapped;
      lines.push({ ...rest, id: ids.get(l.id)!, pageIndex: page, p0: refine?.p0 ?? l.p0, p1: refine?.p1 ?? l.p1, matchTo, ...(keepOffset ? { offset } : {}) });
    }
    src = tgt = null;
    onProgress?.(k + 1, live.length);
  }
  const regions: Record<number, Point[]> = {};
  for (const [from, to] of toTarget) {
    const region = source.regions[from];
    if (region) regions[to] = region.map((p): Point => [p[0], p[1]]);
  }
  return { copy: { lines, regions, targets: [...new Set(toTarget.values())] }, results: results.sort((a, b) => a.target - b.target) };
}

/**
 * The target's stitching with `copy` placed on it. Whatever stitching the target sheets had is
 * replaced; lines elsewhere that were matched to replaced ones are left unmatched.
 */
export function placeCopies(target: StoredManualStitch, copy: BulkCopy): StoredManualStitch {
  const on = new Set(copy.targets);
  const removed = new Set(target.lines.filter((l) => on.has(l.pageIndex)).map((l) => l.id));
  const kept = target.lines
    .filter((l) => !removed.has(l.id))
    .map((l): StoredMatchLine => {
      if (!l.matchTo || !removed.has(l.matchTo)) return l;
      const { offset: _, ...rest } = l;
      return { ...rest, matchTo: null };
    });
  const regions: StoredManualStitch['regions'] = {};
  for (const [k, v] of Object.entries(target.regions)) if (!on.has(Number(k))) regions[Number(k)] = v;
  return { lines: [...kept, ...copy.lines], regions: { ...regions, ...copy.regions } };
}

/** What applying needs of an open document. */
export interface StitchDocument {
  store: { manualStitch(): StoredManualStitch; setManualStitch(next: StoredManualStitch): void };
  doc: { geometry(pageIndex: number): Promise<{ segments: Float32Array; paper?: Uint8Array }> };
}

/**
 * Copies `source`'s stitching onto `target`'s paired sheets (one undo step in `target`). The
 * target's stitching is read again once the slow part is done, so changes made meanwhile stay.
 */
export async function applyStitching(source: StitchDocument, target: StitchDocument, pairs: readonly SheetPair[], toleranceMm: number, options: Pick<BulkStitchInput, 'copyOnly' | 'onProgress' | 'signal'> = {}): Promise<SheetResult[]> {
  const read = (d: StitchDocument) => async (page: number) => {
    const g = await d.doc.geometry(page);
    return inked(g.segments, g.paper);
  };
  const { copy, results } = await bulkStitch({ source: source.store.manualStitch(), pairs, toleranceMm, sourceSegments: read(source), targetSegments: read(target), ...options });
  options.signal?.throwIfAborted();
  target.store.setManualStitch(placeCopies(target.store.manualStitch(), copy));
  return results;
}
