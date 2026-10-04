import { IDENTITY, type Affine } from '@nb/stitch';

export { apply as applyAffine, compose as composeAffine, invert as invertAffine, IDENTITY, type Affine } from '@nb/stitch';

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
