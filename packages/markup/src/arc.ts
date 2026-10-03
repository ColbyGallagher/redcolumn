type Pt = readonly [number, number];

/** Circle through three points, or null when they are (nearly) in a line. */
export function circleThrough(a: Pt, b: Pt, c: Pt): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const span = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]), 1e-9);
  // Collinear, or so close that the radius would be absurd: treat as a straight line.
  if (Math.abs(d) < 1e-6 * span * span) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

/**
 * Points along the arc that starts at `points[0]`, passes through `points[1]` and ends at
 * `points[2]`. Fewer than three points, or three in a line, give the points themselves.
 */
export function arcPoints(points: readonly Pt[], segments = 48): [number, number][] {
  const copy = points.map((p) => [p[0], p[1]] as [number, number]);
  if (points.length < 3) return copy;
  const [a, m, b] = points as [Pt, Pt, Pt];
  const circle = circleThrough(a, m, b);
  if (!circle) return [copy[0]!, copy[2]!];
  const { cx, cy, r } = circle;
  const t0 = Math.atan2(a[1] - cy, a[0] - cx);
  const tm = Math.atan2(m[1] - cy, m[0] - cx);
  const t1 = Math.atan2(b[1] - cy, b[0] - cx);
  // Sweep counter-clockwise from a to b; if the middle point is not on that side, go the other way.
  const ccw = (from: number, to: number) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = ccw(t0, t1);
  if (ccw(t0, tm) > sweep) sweep -= 2 * Math.PI;
  const out: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = t0 + (sweep * i) / segments;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  // Land exactly on the defining end points.
  out[0] = copy[0]!;
  out[segments] = copy[2]!;
  return out;
}
