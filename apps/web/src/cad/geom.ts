/** 2D geometry for the CAD renderer: affine matrices, paths, arcs as Béziers, splines. */

export type P = [number, number];

/** PDF-style affine matrix: x' = a x + c y + e, y' = b x + d y + f. */
export type M = [number, number, number, number, number, number];

export const I: M = [1, 0, 0, 1, 0, 0];

/** a then b: the matrix applying `a` first, then `b`. */
export function then(a: M, b: M): M {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export const translate = (x: number, y: number): M => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): M => [sx, 0, 0, sy, 0, 0];
export function rotate(rad: number): M {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function apply(m: M, p: P): P {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** The matrix's linear part applied to a vector. */
export function applyV(m: M, v: P): P {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

/** Mean scale of a matrix (square root of its determinant's magnitude). */
export function meanScale(m: M): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/**
 * Object coordinate system to world, in plan (x, y): the DXF "arbitrary axis algorithm" for an
 * extrusion direction. Identity for (0, 0, 1); mirrors x for (0, 0, -1).
 */
export function ocs(n: readonly [number, number, number]): M {
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const N: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
  if (Math.abs(N[0]) < 1e-12 && Math.abs(N[1]) < 1e-12 && N[2] > 0) return I;
  const cross = (u: readonly number[], v: readonly number[]): [number, number, number] => [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  let ax = Math.abs(N[0]) < 1 / 64 && Math.abs(N[1]) < 1 / 64 ? cross([0, 1, 0], N) : cross([0, 0, 1], N);
  const al = Math.hypot(...ax) || 1;
  ax = [ax[0] / al, ax[1] / al, ax[2] / al];
  const ay = cross(N, ax);
  return [ax[0], ax[1], ay[0], ay[1], 0, 0];
}

// ---- paths --------------------------------------------------------------------------------

export type Cmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export function mapPath(m: M, d: readonly Cmd[]): Cmd[] {
  return d.map((c): Cmd => {
    switch (c[0]) {
      case 'M':
      case 'L': {
        const [x, y] = apply(m, [c[1], c[2]]);
        return [c[0], x, y];
      }
      case 'C': {
        const a = apply(m, [c[1], c[2]]);
        const b = apply(m, [c[3], c[4]]);
        const e = apply(m, [c[5], c[6]]);
        return ['C', a[0], a[1], b[0], b[1], e[0], e[1]];
      }
      default:
        return c;
    }
  });
}

export function polyPath(pts: readonly P[], closed = false): Cmd[] {
  if (!pts.length) return [];
  const d: Cmd[] = [['M', pts[0]![0], pts[0]![1]]];
  for (let i = 1; i < pts.length; i++) d.push(['L', pts[i]![0], pts[i]![1]]);
  if (closed) d.push(['Z']);
  return d;
}

/** Bounding box of a path's points (control points included: a safe over-estimate). */
export function pathBox(d: readonly Cmd[], box: Box = emptyBox()): Box {
  for (const c of d) {
    if (c[0] === 'Z') continue;
    for (let i = 1; i < c.length; i += 2) grow(box, c[i] as number, c[i + 1] as number);
  }
  return box;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export function grow(b: Box, x: number, y: number) {
  if (x < b.x0) b.x0 = x;
  if (y < b.y0) b.y0 = y;
  if (x > b.x1) b.x1 = x;
  if (y > b.y1) b.y1 = y;
}
export const boxEmpty = (b: Box) => !(b.x1 >= b.x0 && b.y1 >= b.y0);

// ---- arcs ---------------------------------------------------------------------------------

/**
 * Cubic Béziers for the unit-circle arc from angle a0 to a1 (radians, counter-clockwise when
 * a1 > a0), mapped by `m` (which can make it any ellipse). Starts with a move when `move`.
 */
/** One directed turn, without loops that can stall on huge or non-finite angles. */
export function arcInterval(start: number, end: number, ccw = true): [number, number] {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Invalid CAD arc angle.');
  const turn = 2 * Math.PI;
  const wrap = (n: number) => ((n % turn) + turn) % turn;
  const a = wrap(start), b = wrap(end);
  const span = wrap(ccw ? b - a : a - b) || turn;
  return [a, a + (ccw ? span : -span)];
}

export function arcCmds(m: M, a0: number, a1: number, move: boolean): Cmd[] {
  if (![...m, a0, a1].every(Number.isFinite) || Math.abs(a1 - a0) > 2 * Math.PI + 1e-8) throw new Error('Invalid CAD curve geometry.');
  const out: Cmd[] = [];
  const sweep = a1 - a0;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const p0 = apply(m, [Math.cos(a0), Math.sin(a0)]);
  if (move) out.push(['M', p0[0], p0[1]]);
  for (let i = 0; i < n; i++) {
    const t0 = a0 + i * step;
    const t1 = t0 + step;
    const c0 = Math.cos(t0);
    const s0 = Math.sin(t0);
    const c1 = Math.cos(t1);
    const s1 = Math.sin(t1);
    const q1 = apply(m, [c0 - k * s0, s0 + k * c0]);
    const q2 = apply(m, [c1 + k * s1, s1 - k * c1]);
    const q3 = apply(m, [c1, s1]);
    out.push(['C', q1[0], q1[1], q2[0], q2[1], q3[0], q3[1]]);
  }
  return out;
}

/** Matrix mapping the unit circle to the circle at c with radius r. */
export const circleM = (c: P, r: number): M => [r, 0, 0, r, c[0], c[1]];

/** Path segment for a polyline bulge from p to q (bulge = tan(sweep / 4)), without the move. */
export function bulgeCmds(p: P, q: P, bulge: number): Cmd[] {
  if (!bulge || (p[0] === q[0] && p[1] === q[1])) return [['L', q[0], q[1]]];
  const sweep = 4 * Math.atan(bulge);
  const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  // Centre: from the chord midpoint along its normal, on the side the bulge turns towards.
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  const h = r * Math.cos(sweep / 2) * Math.sign(bulge);
  const nx = -(q[1] - p[1]) / chord;
  const ny = (q[0] - p[0]) / chord;
  const c: P = [mx + nx * h, my + ny * h];
  const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  return arcCmds(circleM(c, r), a0, a0 + sweep, false);
}

// ---- splines ------------------------------------------------------------------------------

/** Points along a (rational) B-spline, by de Boor evaluation. */
export function bspline(degree: number, ctrl: readonly P[], knots: readonly number[], weights: readonly number[] | null, samples: number): P[] {
  const n = ctrl.length;
  const p = Math.min(degree, n - 1);
  if (n < 2 || p < 1) return ctrl.slice();
  let k = knots.slice();
  if (k.length !== n + p + 1) {
    // Missing or wrong knots: a clamped uniform vector.
    k = [];
    for (let i = 0; i <= n + p; i++) k.push(Math.min(Math.max(i - p, 0), n - p));
  }
  const w = weights && weights.length === n ? weights : null;
  const t0 = k[p]!;
  const t1 = k[n]!;
  const out: P[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? t1 : t0 + ((t1 - t0) * s) / samples;
    let span = p;
    while (span < n - 1 && t >= k[span + 1]!) span++;
    const dx: number[] = [];
    const dy: number[] = [];
    const dw: number[] = [];
    for (let j = 0; j <= p; j++) {
      const i = span - p + j;
      const wi = w ? w[i]! : 1;
      dx.push(ctrl[i]![0] * wi);
      dy.push(ctrl[i]![1] * wi);
      dw.push(wi);
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = span - p + j;
        const den = k[i + p - r + 1]! - k[i]!;
        const a = den === 0 ? 0 : (t - k[i]!) / den;
        dx[j] = (1 - a) * dx[j - 1]! + a * dx[j]!;
        dy[j] = (1 - a) * dy[j - 1]! + a * dy[j]!;
        dw[j] = (1 - a) * dw[j - 1]! + a * dw[j]!;
      }
    }
    out.push([dx[p]! / dw[p]!, dy[p]! / dw[p]!]);
  }
  return out;
}

/** A smooth path through points (Catmull-Rom as cubic Béziers), for fit-point splines. */
export function throughPoints(pts: readonly P[], closed: boolean): Cmd[] {
  if (pts.length < 3) return polyPath(pts, closed);
  const at = (i: number) => (closed ? pts[(i + pts.length) % pts.length]! : pts[Math.max(0, Math.min(pts.length - 1, i))]!);
  const d: Cmd[] = [['M', pts[0]![0], pts[0]![1]]];
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d.push(['C', p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]]);
  }
  if (closed) d.push(['Z']);
  return d;
}
