type PagePoint = [x: number, y: number];

export interface PageSize {
  width: number;
  height: number;
}

/** Page sizes within this many points count as the same size. */
const SAME_SIZE_PT = 1;

/**
 * The page point to centre on a page of the same size, given the point at the centre of the view on
 * the old one: the same page coordinate, clamped to the page (a non-finite value falls back to the middle).
 */
export function keptCentre(centre: PagePoint, to: PageSize): PagePoint {
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Number.isFinite(v) ? v : hi / 2));
  return [clamp(centre[0], to.width), clamp(centre[1], to.height)];
}

export function sameSize(a: PageSize, b: PageSize) {
  return Math.abs(a.width - b.width) <= SAME_SIZE_PT && Math.abs(a.height - b.height) <= SAME_SIZE_PT;
}

export type KeepPlan = { refit: true } | { refit: false; zoom: number; centre: PagePoint };

/**
 * Keep View Between Pages: what to show on the new page.
 *
 * - Same size: the same zoom and the same page point.
 * - Different sizes, view at fit: fit the new page too (an A3 sheet to an A1 sheet stays a whole sheet).
 * - Different sizes, zoomed in: the same fractional position, with the zoom scaled by the shown-width
 *   ratio so the same part of the drawing fills the view on a copy at another sheet size.
 *
 * `centre` is the view centre in the old page's own space (as the viewer reports it, so a rotated view
 * needs no special handling there); `turns` (view quarter turns) only decides which side is the width
 * on screen when sizes differ.
 */
export function keepView(i: { centre: PagePoint; zoom: number; from: PageSize; to: PageSize; atFit: boolean; turns: number }): KeepPlan {
  if (sameSize(i.from, i.to)) return { refit: false, zoom: i.zoom, centre: keptCentre(i.centre, i.to) };
  if (i.atFit) return { refit: true };
  const shownWidth = (p: PageSize) => (i.turns % 2 ? p.height : p.width);
  const frac = (v: number, from: number) => (Number.isFinite(v) && from > 0 ? v / from : 0.5);
  const fx = frac(i.centre[0], i.from.width);
  const fy = frac(i.centre[1], i.from.height);
  const centre = keptCentre([fx * i.to.width, fy * i.to.height], i.to);
  return { refit: false, zoom: (i.zoom * shownWidth(i.from)) / shownWidth(i.to), centre };
}
