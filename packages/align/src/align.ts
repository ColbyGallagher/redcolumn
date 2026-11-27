/**
 * Page-level revision alignment: combines pre-alignment (manual 3-point transform or proportional
 * scale-to-fit), coarse-to-fine ink-mask offset search, and alignment quality scoring.
 */

import { applyOffset, isIdentityAffine, mapBox, preAlignTransform, type Affine, type Box, type PageDimensions } from './affine.ts';
import { dilate, findOffset, overlapMetricsFromDilated, shiftMask, warpMask, type Mask, type MaskOverlapMetrics } from './mask.ts';

/** A word with its page-space bounding box (points, y down). */
export interface TextWordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Inputs needed to align two revisions of a page without any UI or PDF-renderer dependency. */
export interface PageAlignInput {
  oldSize: PageDimensions;
  newSize: PageDimensions;
  /** Ink mask of the old page rendered at `oldScale` (defaults to `scale`) px/pt. */
  oldMask: Mask;
  /** Ink mask of the new page rendered at `scale` px/pt. */
  newMask: Mask;
  /** Pixels per PDF point of `newMask` (and `oldMask` when `oldScale` is omitted). */
  scale: number;
  /** Pixels per PDF point of `oldMask` when rendered at a different scale from `newMask`. */
  oldScale?: number;
  /** Optional text words on the old page (points, y down). */
  oldWords?: readonly TextWordBox[];
  /** Optional text words on the new page (points, y down). */
  newWords?: readonly TextWordBox[];
}

export interface PageAlignOptions {
  /** Run coarse-to-fine translation alignment after pre-alignment. Default true. */
  align?: boolean;
  /** Largest shift searched when aligning, in points. Default 72. */
  maxShift?: number;
  /** Uniformly scale the old page to the new page when aspect ratios agree. Default true. */
  scaleToFit?: boolean;
  /** Optional manual/prior affine transform (old page points -> new page points). */
  transform?: Affine | null;
  /** Ink proximity tolerance in points when scoring overlap. Default 1.5. */
  proximity?: number;
  /**
   * Fraction of page width/height inset from each edge when scoring interior overlap, so
   * identical outer sheet borders do not mask mismatched drawing interiors. Default 0.06.
   */
  borderInset?: number;
  /** Tolerance in points when matching page text words. Default 4. */
  wordTolerance?: number;
  /**
   * Retain aligned full-page masks and words on the result so placement suggestions can verify
   * local regions. Keeps four full-page masks (up to ~200 MB per page pair at the 7000 px cap),
   * so this defaults to `false` — opt in only when running local placement checks.
   */
  retainEvidence?: boolean;
}

export const DEFAULT_ALIGN_OPTIONS: Required<Omit<PageAlignOptions, 'transform'>> = {
  align: true,
  maxShift: 72,
  scaleToFit: true,
  proximity: 1.5,
  borderInset: 0.06,
  wordTolerance: 4,
  retainEvidence: false,
};

/** Aligned masks and text retained for local verification around individual comments. */
export interface AlignmentEvidence {
  scale: number;
  proximityPx: number;
  warpedOld: Mask;
  newMask: Mask;
  dilatedOld: Mask;
  dilatedNew: Mask;
  oldWords?: readonly TextWordBox[];
  newWords?: readonly TextWordBox[];
}

/** Result of aligning an old revision page to a new revision page. */
export interface PageAlignment {
  /** Old page space (points) -> new page space (points). */
  transform: Affine;
  /** Translation offset found after pre-alignment, in new-page points. */
  offset: [number, number];
  /** Pre-alignment transform (manual or scale-to-fit) before offset. */
  preTransform: Affine;
  /** Ink overlap metrics over the whole page. */
  overlap: MaskOverlapMetrics;
  /** Ink overlap inside the sheet interior (excluding outer border frame). */
  interiorOverlap: MaskOverlapMetrics;
  /** Fraction of old words matched near their aligned location on the new page, or null if no words. */
  wordMatchRatio: number | null;
  /** Overall page-level alignment confidence in [0, 1]. */
  confidence: number;
  oldSize: PageDimensions;
  newSize: PageDimensions;
  /** Optional aligned masks/words for local verification during placement suggestion. */
  evidence?: AlignmentEvidence;
}

/** Normalizes a word token for loose comparison across revisions. */
export function normWord(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * Fraction of `oldWords` (within optional `region` in new-page space) that find a matching word
 * in `newWords` within `tolerance` points after applying `transform`.
 */
export function matchWordRatio(
  oldWords: readonly TextWordBox[],
  newWords: readonly TextWordBox[],
  transform: Affine,
  tolerance: number,
  region?: Box | null,
): { matched: number; total: number; ratio: number | null } {
  const cellSize = Math.max(tolerance, 1);
  const cellOf = (v: number) => Math.floor(v / cellSize);
  const newCells = new Map<string, TextWordBox[]>();
  for (const w of newWords) {
    const key = normWord(w.text);
    if (!key) continue;
    const cx = (w.x0 + w.x1) / 2;
    const cy = (w.y0 + w.y1) / 2;
    const id = `${cellOf(cx)},${cellOf(cy)},${key}`;
    const list = newCells.get(id);
    if (list) list.push(w);
    else newCells.set(id, [w]);
  }
  const used = new Set<TextWordBox>();
  let total = 0;
  let matched = 0;
  for (const w of oldWords) {
    const key = normWord(w.text);
    if (!key) continue;
    const mapped = mapBox(transform, { x: w.x0, y: w.y0, w: w.x1 - w.x0, h: w.y1 - w.y0 });
    const mx = mapped.x + mapped.w / 2;
    const my = mapped.y + mapped.h / 2;
    if (region) {
      const overlaps =
        mapped.x <= region.x + region.w &&
        region.x <= mapped.x + mapped.w &&
        mapped.y <= region.y + region.h &&
        region.y <= mapped.y + mapped.h;
      if (!overlaps) continue;
    }
    total++;
    const gx = cellOf(mx);
    const gy = cellOf(my);
    let hit: TextWordBox | null = null;
    let bestDist = Infinity;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (const cand of newCells.get(`${gx + ox},${gy + oy},${key}`) ?? []) {
          if (used.has(cand)) continue;
          const cx = (cand.x0 + cand.x1) / 2;
          const cy = (cand.y0 + cand.y1) / 2;
          const d = Math.hypot(cx - mx, cy - my);
          if (d <= tolerance && d < bestDist) {
            bestDist = d;
            hit = cand;
          }
        }
      }
    }
    if (hit) {
      used.add(hit);
      matched++;
    }
  }
  return { matched, total, ratio: total > 0 ? matched / total : null };
}

/**
 * Aligns an old revision page onto a new revision page and scores how well their content matches.
 * Runs purely on ink masks and optional word lists with no browser or PDF-engine dependency.
 */
export function alignPages(input: PageAlignInput, options: PageAlignOptions = {}): PageAlignment {
  const align = options.align ?? DEFAULT_ALIGN_OPTIONS.align;
  const maxShift = options.maxShift ?? DEFAULT_ALIGN_OPTIONS.maxShift;
  const scaleToFit = options.scaleToFit ?? DEFAULT_ALIGN_OPTIONS.scaleToFit;
  const proximity = options.proximity ?? DEFAULT_ALIGN_OPTIONS.proximity;
  const borderInset = Math.min(0.25, Math.max(0, options.borderInset ?? DEFAULT_ALIGN_OPTIONS.borderInset));
  const wordTolerance = options.wordTolerance ?? DEFAULT_ALIGN_OPTIONS.wordTolerance;
  const retainEvidence = options.retainEvidence ?? DEFAULT_ALIGN_OPTIONS.retainEvidence;

  const { oldSize, newSize, oldMask, newMask, scale } = input;
  const oldScale = input.oldScale ?? scale;
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(oldScale) || oldScale <= 0) {
    throw new RangeError(`alignPages requires positive finite scale and oldScale (got scale=${scale}, oldScale=${oldScale})`);
  }
  const pre = preAlignTransform(oldSize, newSize, { transform: options.transform, scaleToFit });

  const preMask =
    isIdentityAffine(pre) && Math.abs(oldScale - scale) < 1e-9
      ? oldMask
      : warpMask(oldMask, oldScale, pre, scale, newMask.width, newMask.height);

  const maxShiftPx = align ? Math.max(0, Math.round(maxShift * scale)) : 0;
  const pxOffset: [number, number] = maxShiftPx > 0 ? findOffset(preMask, newMask, maxShiftPx) : [0, 0];
  const offset: [number, number] = [pxOffset[0] / scale, pxOffset[1] / scale];
  const transform = applyOffset(pre, offset);

  const warpedOld =
    pxOffset[0] === 0 && pxOffset[1] === 0 && preMask.width === newMask.width && preMask.height === newMask.height
      ? preMask
      : shiftMask(preMask, pxOffset[0], pxOffset[1], newMask.width, newMask.height);

  const proximityPx = Math.max(1, Math.round(proximity * scale));
  const dilatedOld = dilate(warpedOld, proximityPx);
  const dilatedNew = dilate(newMask, proximityPx);

  const overlap = overlapMetricsFromDilated(warpedOld, newMask, dilatedOld, dilatedNew, null);
  const ix = Math.floor(newMask.width * borderInset);
  const iy = Math.floor(newMask.height * borderInset);
  const interiorBox: Box = {
    x: ix,
    y: iy,
    w: Math.max(1, newMask.width - ix * 2),
    h: Math.max(1, newMask.height - iy * 2),
  };
  const interiorOverlap = overlapMetricsFromDilated(warpedOld, newMask, dilatedOld, dilatedNew, interiorBox);

  const wordStats =
    input.oldWords && input.newWords && input.oldWords.length > 0
      ? matchWordRatio(input.oldWords, input.newWords, transform, wordTolerance)
      : null;
  const wordMatchRatio = wordStats?.ratio ?? null;

  // Prefer interior overlap when the interior has ink, so identical borders alone cannot carry a mismatch.
  const inkScore = interiorOverlap.oldInk > 0 && interiorOverlap.newInk > 0 ? interiorOverlap.f1 : overlap.f1;
  const confidence =
    wordMatchRatio !== null
      ? Math.max(0, Math.min(1, 0.7 * inkScore + 0.3 * wordMatchRatio))
      : Math.max(0, Math.min(1, inkScore));

  return {
    transform,
    offset,
    preTransform: pre,
    overlap,
    interiorOverlap,
    wordMatchRatio,
    confidence,
    oldSize,
    newSize,
    ...(retainEvidence
      ? {
          evidence: {
            scale,
            proximityPx,
            warpedOld,
            newMask,
            dilatedOld,
            dilatedNew,
            ...(input.oldWords ? { oldWords: input.oldWords } : {}),
            ...(input.newWords ? { newWords: input.newWords } : {}),
          },
        }
      : {}),
  };
}
