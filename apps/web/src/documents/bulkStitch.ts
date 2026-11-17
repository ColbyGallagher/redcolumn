import { PT_PER_MM, refineCopiedLine, type SheetPair } from '@nb/stitch';
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

/** How one target sheet came out. */
export interface SheetResult {
  source: number;
  target: number;
  /** Match lines copied onto it. */
  lines: number;
  /** Of those, how many were nudged onto the sheet's own drawn match line. */
  snapped: number;
  /** The least sure of its lines, 0..1. */
  confidence: number;
  /** The farthest any of its lines moved (paper mm). */
  movedMm: number;
  /** Why a line was left where it was copied to, when one was. */
  problem: string | null;
}

export interface BulkStitchInput {
  /** The stitching the lines are copied from. */
  source: StoredManualStitch;
  /** The target document's stitching now (the same object as `source` within one document). */
  target: StoredManualStitch;
  pairs: readonly SheetPair[];
  /** How far (paper mm) a copy may be nudged to land on the target's drawn line. */
  toleranceMm: number;
  /** Line work of a source and of a target sheet (flat x1, y1, x2, y2...), or null when it can't be read. */
  sourceSegments: (page: number) => Promise<ArrayLike<number> | null>;
  targetSegments: (page: number) => Promise<ArrayLike<number> | null>;
}

let counter = 0;
const newId = () => `ml-${Date.now().toString(36)}-b${(counter++).toString(36)}`;

/**
 * The target's stitching with the source's copied onto the paired sheets. Whatever stitching
 * the target sheets had is replaced; lines elsewhere that were matched to replaced ones are
 * left unmatched.
 */
export async function bulkStitch({ source, target, pairs, toleranceMm, sourceSegments, targetSegments }: BulkStitchInput): Promise<{ next: StoredManualStitch; results: SheetResult[] }> {
  const toTarget = new Map<number, number>();
  for (const p of pairs) if (p.target !== null) toTarget.set(p.source, p.target);
  const targets = new Set(toTarget.values());
  const tolerance = Math.max(0, toleranceMm) * PT_PER_MM;

  const copied = source.lines.filter((l) => toTarget.has(l.pageIndex));
  const ids = new Map(copied.map((l) => [l.id, newId()]));
  const results = new Map<number, SheetResult>();
  const lines: StoredMatchLine[] = [];
  const segCache = new Map<string, Promise<ArrayLike<number> | null>>();
  const segs = (side: 's' | 't', page: number) => {
    const key = `${side}${page}`;
    if (!segCache.has(key)) segCache.set(key, (side === 's' ? sourceSegments : targetSegments)(page).catch(() => null));
    return segCache.get(key)!;
  };
  for (const l of copied) {
    const page = toTarget.get(l.pageIndex)!;
    const r = results.get(page) ?? { source: l.pageIndex, target: page, lines: 0, snapped: 0, confidence: 1, movedMm: 0, problem: null };
    results.set(page, r);
    const targetSegs = tolerance > 0 ? await segs('t', page) : null;
    const refine = targetSegs ? refineCopiedLine(l, await segs('s', l.pageIndex), targetSegs, tolerance) : null;
    r.lines++;
    if (refine?.snapped) {
      r.snapped++;
      r.movedMm = Math.max(r.movedMm, Math.hypot(refine.shift[0], refine.shift[1]) / PT_PER_MM);
    } else r.problem ??= refine?.reason ?? (tolerance > 0 ? 'The target sheet’s line work could not be read' : 'Not checked (tolerance 0)');
    r.confidence = Math.min(r.confidence, refine?.confidence ?? 0);
    const matchTo = l.matchTo ? (ids.get(l.matchTo) ?? null) : null;
    const { offset, ...rest } = l;
    const p0: Point = refine ? refine.p0 : l.p0;
    const p1: Point = refine ? refine.p1 : l.p1;
    // A sheet adjustment belongs to its pair: it carries over only while the pair does.
    lines.push({ ...rest, id: ids.get(l.id)!, pageIndex: page, p0, p1, matchTo, ...(matchTo && offset ? { offset } : {}) });
  }

  // The target sheets' old stitching gives way.
  const removed = new Set(target.lines.filter((l) => targets.has(l.pageIndex)).map((l) => l.id));
  const kept = target.lines
    .filter((l) => !removed.has(l.id))
    .map((l): StoredMatchLine => {
      if (!l.matchTo || !removed.has(l.matchTo)) return l;
      const { offset: _, ...rest } = l;
      return { ...rest, matchTo: null };
    });
  const regions: StoredManualStitch['regions'] = {};
  for (const [k, v] of Object.entries(target.regions)) if (!targets.has(Number(k))) regions[Number(k)] = v;
  for (const [from, to] of toTarget) {
    const region = source.regions[from];
    if (region) regions[to] = region.map((p): Point => [p[0], p[1]]);
  }
  return { next: { lines: [...kept, ...lines], regions }, results: [...results.values()].sort((a, b) => a.target - b.target) };
}

/** What applying needs of an open document. */
export interface StitchDocument {
  store: { manualStitch(): StoredManualStitch; setManualStitch(next: StoredManualStitch): void };
  doc: { geometry(pageIndex: number): Promise<{ segments: Float32Array; paper?: Uint8Array }> };
}

/** Copies `source`'s stitching onto `target`'s paired sheets (one undo step in `target`). */
export async function applyStitching(source: StitchDocument, target: StitchDocument, pairs: readonly SheetPair[], toleranceMm: number): Promise<SheetResult[]> {
  const read = (d: StitchDocument) => async (page: number) => {
    const g = await d.doc.geometry(page);
    return inked(g.segments, g.paper);
  };
  const { next, results } = await bulkStitch({ source: source.store.manualStitch(), target: target.store.manualStitch(), pairs, toleranceMm, sourceSegments: read(source), targetSegments: read(target) });
  target.store.setManualStitch(next);
  return results;
}
