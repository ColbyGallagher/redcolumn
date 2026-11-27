/**
 * Placement suggestions for carrying a comment's geometry from an old revision of a page onto a
 * new one. Applies the page alignment and, when alignment evidence is available, checks that local
 * ink and text around the comment still correspond before suggesting a position.
 */

import { affineRotationDegrees, affineScale, applyAffine, type Box } from './affine.ts';
import { alignPages, matchWordRatio, type PageAlignment, type PageAlignInput, type PageAlignOptions } from './align.ts';
import { overlapMetricsFromDilated } from './mask.ts';

/** Point in page space: PDF points, origin at top-left of the displayed page, y down. */
export type Point = [x: number, y: number];

/** Comment geometry on a page. */
export interface CommentGeometry {
  points: readonly Point[];
  /** Optional cutout polygons (area/perimeter/volume markups). */
  holes?: readonly (readonly Point[])[];
  /** Optional clockwise rotation in degrees (box-shaped markups). */
  rotation?: number;
}

export interface PlacementOptions {
  /** Minimum combined confidence (0..1) required to emit a suggestion. Default 0.45. */
  minConfidence?: number;
  /** Minimum page-level alignment confidence required before placing anything. Default 0.35. */
  minPageConfidence?: number;
  /** Margin (points) added around the comment's bounding box for local verification. Default 24. */
  localPadding?: number;
  /** Minimum side length (points) of the local verification window. Default 48. */
  minWindow?: number;
  /** Text matching tolerance (points) when checking nearby words. Default 4. */
  wordTolerance?: number;
}

export const DEFAULT_PLACEMENT_OPTIONS: Required<PlacementOptions> = {
  minConfidence: 0.45,
  minPageConfidence: 0.35,
  localPadding: 24,
  minWindow: 48,
  wordTolerance: 4,
};

export type PlacementNoReason =
  | 'empty-geometry'
  | 'low-page-confidence'
  | 'out-of-bounds'
  | 'content-missing'
  | 'content-changed';

export interface PlacementLocalMetrics {
  inkRecall: number;
  inkPrecision: number;
  inkF1: number;
  oldInk: number;
  newInk: number;
  wordRecall: number | null;
  oldWordCount: number;
}

export type PlacementSuggestion =
  | {
      kind: 'suggested';
      geometry: CommentGeometry;
      confidence: number;
      pageConfidence: number;
      local: PlacementLocalMetrics | null;
    }
  | {
      kind: 'none';
      reason: PlacementNoReason;
      confidence: number;
      pageConfidence: number;
      local: PlacementLocalMetrics | null;
    };

function isPageAlignment(source: PageAlignment | PageAlignInput): source is PageAlignment {
  return 'transform' in source;
}

function geometryBounds(points: readonly Point[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function normalizeDegrees(deg: number): number {
  const n = ((deg % 360) + 360) % 360;
  return n > 180 ? n - 360 : n;
}

function rotatedBoxBounds(box: Box, rotationDeg: number): Box {
  if (rotationDeg === 0) return box;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rawCorners: Point[] = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
  const corners: Point[] = rawCorners.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
  return geometryBounds(corners);
}

/**
 * Given a page alignment (or the inputs to compute one) and a comment's geometry on the old
 * revision, returns either a suggested geometry on the new revision with a confidence score or
 * `{ kind: 'none', reason, ... }` when alignment cannot place it reliably.
 */
export function suggestPlacement(
  alignmentOrInput: PageAlignment | PageAlignInput,
  geometry: CommentGeometry,
  options: PageAlignOptions & PlacementOptions = {},
): PlacementSuggestion {
  const alignment = isPageAlignment(alignmentOrInput)
    ? alignmentOrInput
    : alignPages(alignmentOrInput, { retainEvidence: true, ...options });
  const minConfidence = options.minConfidence ?? DEFAULT_PLACEMENT_OPTIONS.minConfidence;
  const minPageConfidence = options.minPageConfidence ?? DEFAULT_PLACEMENT_OPTIONS.minPageConfidence;
  const localPadding = options.localPadding ?? DEFAULT_PLACEMENT_OPTIONS.localPadding;
  const minWindow = options.minWindow ?? DEFAULT_PLACEMENT_OPTIONS.minWindow;
  const wordTolerance = options.wordTolerance ?? DEFAULT_PLACEMENT_OPTIONS.wordTolerance;

  const pageConfidence = Math.max(0, Math.min(1, alignment.confidence));

  if (!geometry.points.length) {
    return { kind: 'none', reason: 'empty-geometry', confidence: 0, pageConfidence, local: null };
  }

  if (pageConfidence < minPageConfidence) {
    return { kind: 'none', reason: 'low-page-confidence', confidence: pageConfidence, pageConfidence, local: null };
  }

  const deltaRot = affineRotationDegrees(alignment.transform);
  let mappedPoints: Point[];
  let mappedHoles: Point[][] | undefined;
  let mappedRotation: number | undefined;

  if (geometry.rotation !== undefined) {
    // Box-shaped markups store unrotated corner coordinates plus a clockwise `rotation` about the
    // box centre. Map the centre and scale the box dimensions rather than rotating the corners
    // through `alignment.transform`, so the transform's rotation is only applied once via `rotation`.
    const oldBounds = geometryBounds(geometry.points);
    const oldCx = oldBounds.x + oldBounds.w / 2;
    const oldCy = oldBounds.y + oldBounds.h / 2;
    const [newCx, newCy] = applyAffine(alignment.transform, [oldCx, oldCy]);
    const scale = affineScale(alignment.transform);
    if (geometry.points.length === 2) {
      const halfW = (oldBounds.w * scale) / 2;
      const halfH = (oldBounds.h * scale) / 2;
      mappedPoints = [
        [newCx - halfW, newCy - halfH],
        [newCx + halfW, newCy + halfH],
      ];
    } else {
      mappedPoints = geometry.points.map(([x, y]) => [newCx + (x - oldCx) * scale, newCy + (y - oldCy) * scale]);
    }
    mappedHoles = geometry.holes?.map((ring) => ring.map(([x, y]) => [newCx + (x - oldCx) * scale, newCy + (y - oldCy) * scale]));
    mappedRotation = normalizeDegrees(geometry.rotation + deltaRot);
  } else {
    mappedPoints = geometry.points.map((p) => applyAffine(alignment.transform, p));
    mappedHoles = geometry.holes?.map((ring) => ring.map((p) => applyAffine(alignment.transform, p)));
  }

  const mapped: CommentGeometry = {
    points: mappedPoints,
    ...(mappedHoles ? { holes: mappedHoles } : {}),
    ...(mappedRotation !== undefined ? { rotation: mappedRotation } : {}),
  };

  const unrotatedBounds = geometryBounds(mappedPoints);
  const bounds = mappedRotation !== undefined ? rotatedBoxBounds(unrotatedBounds, mappedRotation) : unrotatedBounds;
  const margin = 2;
  const { width: newW, height: newH } = alignment.newSize;
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const insidePage = cx >= -margin && cx <= newW + margin && cy >= -margin && cy <= newH + margin;

  if (!insidePage) {
    return { kind: 'none', reason: 'out-of-bounds', confidence: 0, pageConfidence, local: null };
  }

  const evidence = alignment.evidence;
  if (!evidence) {
    if (pageConfidence < minConfidence) {
      return { kind: 'none', reason: 'low-page-confidence', confidence: pageConfidence, pageConfidence, local: null };
    }
    return { kind: 'suggested', geometry: mapped, confidence: pageConfidence, pageConfidence, local: null };
  }

  // Build local verification window in new-page points around the mapped comment.
  const winW = Math.max(minWindow, bounds.w + localPadding * 2);
  const winH = Math.max(minWindow, bounds.h + localPadding * 2);
  const wx0 = Math.max(0, cx - winW / 2);
  const wy0 = Math.max(0, cy - winH / 2);
  const wx1 = Math.min(newW, cx + winW / 2);
  const wy1 = Math.min(newH, cy + winH / 2);
  const winPt: Box = { x: wx0, y: wy0, w: Math.max(1, wx1 - wx0), h: Math.max(1, wy1 - wy0) };

  const winPx: Box = {
    x: winPt.x * evidence.scale,
    y: winPt.y * evidence.scale,
    w: winPt.w * evidence.scale,
    h: winPt.h * evidence.scale,
  };

  const ink = overlapMetricsFromDilated(evidence.warpedOld, evidence.newMask, evidence.dilatedOld, evidence.dilatedNew, winPx);

  const wordStats =
    evidence.oldWords && evidence.newWords
      ? matchWordRatio(evidence.oldWords, evidence.newWords, alignment.transform, wordTolerance, winPt)
      : null;
  const wordRecall = wordStats?.ratio ?? null;
  const oldWordCount = wordStats?.total ?? 0;

  const local: PlacementLocalMetrics = {
    inkRecall: ink.recall,
    inkPrecision: ink.precision,
    inkF1: ink.f1,
    oldInk: ink.oldInk,
    newInk: ink.newInk,
    wordRecall,
    oldWordCount,
  };

  const missing = ink.oldInk > 0 && (ink.newInk === 0 || (ink.newInk < ink.oldInk * 0.15 && ink.recall < 0.15));

  let localScore: number;
  if (ink.oldInk === 0 && ink.newInk === 0) {
    // Comment sat in whitespace on both revisions: no local contradiction, but lower certainty.
    localScore = 0.75 * pageConfidence;
  } else if (ink.oldInk === 0 && ink.newInk > 0) {
    // Whitespace on old revision now has drawn content.
    localScore = 0.45 * pageConfidence;
  } else if (missing) {
    // Content that used to be under the comment is gone.
    localScore = ink.f1;
  } else if (wordRecall !== null) {
    localScore = 0.65 * ink.f1 + 0.35 * wordRecall;
  } else {
    localScore = ink.f1;
  }

  const confidence = Math.max(0, Math.min(1, Math.sqrt(pageConfidence * Math.max(0, localScore))));

  if (confidence < minConfidence) {
    return {
      kind: 'none',
      reason: missing ? 'content-missing' : 'content-changed',
      confidence,
      pageConfidence,
      local,
    };
  }

  return {
    kind: 'suggested',
    geometry: mapped,
    confidence,
    pageConfidence,
    local,
  };
}
