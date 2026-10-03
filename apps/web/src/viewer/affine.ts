/** Affine [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** `outer` applied after `inner`. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

/**
 * Turns a w × h page clockwise by quarter turns about its origin, then shifts it back into the
 * positive quadrant, so its top-left corner stays at (0, 0).
 */
export function rotationAffine(quarterTurns: number, w: number, h: number): Affine {
  switch (((quarterTurns % 4) + 4) % 4) {
    case 1:
      return [0, 1, -1, 0, h, 0];
    case 2:
      return [-1, 0, 0, -1, w, h];
    case 3:
      return [0, -1, 1, 0, 0, w];
    default:
      return IDENTITY;
  }
}

