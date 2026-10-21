import type { StoredStitchGroup } from '@nb/markup';
import { apply, invert, IDENTITY, type Affine } from '@nb/stitch';
import type { Box } from './align';

type Pt = [number, number];

/**
 * The sheets a model is aligned over, each with where it sits in a shared "world": one sheet in
 * its own page space, or every sheet of a stitch in the stitched view's space. The model is
 * placed once in that world; each sheet's registration then follows through its own transform.
 */
export interface GeoSheet {
  pageIndex: number;
  toWorld: Affine;
  fromWorld: Affine;
  /** The part of the sheet that is registered: the drawing region of a stitched sheet, else the page. */
  bounds: Pt[];
}

const pageRect = (size: { width: number; height: number }): Pt[] => [
  [0, 0],
  [size.width, 0],
  [size.width, size.height],
  [0, size.height],
];

export function singleSheet(pageIndex: number, size: { width: number; height: number }): GeoSheet {
  return { pageIndex, toWorld: IDENTITY, fromWorld: IDENTITY, bounds: pageRect(size) };
}

/** Every sheet of a stitch, in the stitched view's world. */
export function stitchedSheets(group: StoredStitchGroup, pageSize: (pageIndex: number) => { width: number; height: number } | null): GeoSheet[] {
  return group.placements.flatMap((p) => {
    const size = pageSize(p.pageIndex);
    const bounds = p.region?.length ? p.region.map((q): Pt => [q[0], q[1]]) : size ? pageRect(size) : null;
    return bounds ? [{ pageIndex: p.pageIndex, toWorld: p.toWorld, fromWorld: invert(p.toWorld), bounds }] : [];
  });
}

/** A vector (not a point) through an affine map's linear part. */
export function mapVector(m: Affine, [dx, dy]: readonly [number, number]): Pt {
  const o = apply(m, [0, 0]);
  const v = apply(m, [dx, dy]);
  return [v[0] - o[0], v[1] - o[1]];
}

/** World units per page point on a sheet (its stitch scale). */
export function worldPerPoint(m: Affine): number {
  const [ux, uy] = mapVector(m, [1, 0]);
  const [vx, vy] = mapVector(m, [0, 1]);
  return Math.sqrt(Math.abs(ux * vy - uy * vx));
}

/** The sheets' extent in the world. */
export function worldBox(sheets: readonly GeoSheet[]): Box {
  const pts = sheets.flatMap((s) => s.bounds.map((p) => apply(s.toWorld, p)));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The world's points per grid metre, from a sheet's calibrated scale (metres per page point);
 * null when the sheet has none.
 */
export function worldScale(sheet: GeoSheet, metersPerPoint: number | null): number | null {
  return metersPerPoint && metersPerPoint > 0 ? worldPerPoint(sheet.toWorld) / metersPerPoint : null;
}

/**
 * Sheets whose own scale disagrees with the world's (by more than 1%), or that have none: their
 * registration would not match what they measure.
 */
export function scaleProblems(sheets: readonly GeoSheet[], scale: number, metersPerPoint: (pageIndex: number) => number | null): { pageIndex: number; problem: 'none' | 'differs'; ratio?: number }[] {
  type Problem = { pageIndex: number; problem: 'none' | 'differs'; ratio?: number };
  return sheets.flatMap((s): Problem[] => {
    const own = worldScale(s, metersPerPoint(s.pageIndex));
    if (own === null) return [{ pageIndex: s.pageIndex, problem: 'none' }];
    const ratio = own / scale;
    return Math.abs(ratio - 1) > 0.01 ? [{ pageIndex: s.pageIndex, problem: 'differs', ratio }] : [];
  });
}
