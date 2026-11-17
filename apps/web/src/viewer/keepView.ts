type PagePoint = [x: number, y: number];

export interface PageSize {
  width: number;
  height: number;
}

/**
 * Keep View Between Pages: the page point to centre on the new page, given the point at the centre of
 * the view on the old one. The same page coordinate (the same part of the sheet), clamped to the new
 * page so a smaller page never opens on empty space.
 */
export function keptCentre(centre: PagePoint, to: PageSize): PagePoint {
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Number.isFinite(v) ? v : hi / 2));
  return [clamp(centre[0], to.width), clamp(centre[1], to.height)];
}
