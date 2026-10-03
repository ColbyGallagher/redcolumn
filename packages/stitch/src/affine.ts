export type Vec = readonly [number, number];

/** Affine map [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f (PDF/canvas order). */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function apply(m: Affine, [x, y]: Vec): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** The map that applies `first`, then `second`. */
export function compose(second: Affine, first: Affine): Affine {
  return [
    second[0] * first[0] + second[2] * first[1],
    second[1] * first[0] + second[3] * first[1],
    second[0] * first[2] + second[2] * first[3],
    second[1] * first[2] + second[3] * first[3],
    second[0] * first[4] + second[2] * first[5] + second[4],
    second[1] * first[4] + second[3] * first[5] + second[5],
  ];
}

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Rotation by `angle` radians about the origin, then translation by (tx, ty). */
export function rigid(angle: number, tx: number, ty: number): Affine {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, tx, ty];
}

/** Uniform scale factor of a similarity transform. */
export function scaleOf(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export const sub = (a: Vec, b: Vec): [number, number] => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec, b: Vec): [number, number] => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Vec, k: number): [number, number] => [a[0] * k, a[1] * k];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec) => Math.hypot(a[0], a[1]);
export const unit = (a: Vec): [number, number] => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
/** Left-hand normal in a y-down frame (rotates +90° on screen). */
export const perp = (a: Vec): [number, number] => [-a[1], a[0]];
