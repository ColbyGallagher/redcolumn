import { add, apply, compose, dot, mul, perp, rigid, sub, unit, type Affine, type Vec } from './affine.ts';
import type { MatchLine, StitchPage } from './matchLines.ts';

export interface PairAlignment {
  /** Maps page-space points of sheet B into sheet A's page space. */
  bToA: Affine;
  /** Crossing features that agreed on the placement; 0 means it fell back to line midpoints. */
  votes: number;
  /** 0..1 */
  confidence: number;
}

interface Crossing {
  /** Position along the match line (points from A's p0 in A's frame). */
  t: number;
  /** Crossing direction relative to the line, 0..π. */
  angle: number;
}

/** Where line work crosses the match line, as positions along it and crossing angles. */
function crossings(page: StitchPage, line: MatchLine, toFrame: Affine, origin: Vec, u: Vec): Crossing[] {
  const n = perp(u);
  const out: Crossing[] = [];
  const s = page.segments;
  const lineDirAngle = Math.atan2(u[1], u[0]);
  const p0 = apply(toFrame, line.p0);
  const p1 = apply(toFrame, line.p1);
  const tMin = Math.min(dot(sub(p0, origin), u), dot(sub(p1, origin), u)) - 2;
  const tMax = Math.max(dot(sub(p0, origin), u), dot(sub(p1, origin), u)) + 2;
  const seen = new Set<string>();
  for (let i = 0; i < s.length; i += 4) {
    const a = apply(toFrame, [s[i]!, s[i + 1]!]);
    const b = apply(toFrame, [s[i + 2]!, s[i + 3]!]);
    const da = dot(sub(a, origin), n);
    const db = dot(sub(b, origin), n);
    // Segments lying along the match line itself say nothing about the shift.
    if (Math.abs(da - db) < 0.5) continue;
    let at: Vec;
    if (Math.abs(da) <= TOUCH) at = a;
    else if (Math.abs(db) <= TOUCH) at = b;
    // Drawings are usually cut off at the match line, so line work ends on it rather than crossing.
    else if (da * db < 0) at = add(a, mul(sub(b, a), da / (da - db)));
    else continue;
    const t = dot(sub(at, origin), u);
    if (t < tMin || t > tMax) continue;
    let angle = Math.atan2(b[1] - a[1], b[0] - a[0]) - lineDirAngle;
    angle = ((angle % Math.PI) + Math.PI) % Math.PI;
    // Joined polyline pieces meet at the same point; count each crossing once.
    const key = `${Math.round(t * 4)}:${Math.round(angle * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ t, angle });
  }
  return out;
}

/** Endpoints this close to the match line (points) count as meeting it. */
const TOUCH = 1;

const ANGLE_TOL = (2 * Math.PI) / 180;
const SHIFT_TOL = 0.75;

/**
 * Places sheet B against sheet A so their match lines coincide with the drawings on opposite
 * sides, then slides B along the line until the features crossing it (road edges, pipes,
 * property lines) meet the same features on A. Assumes both sheets are drawn at the same scale.
 */
export function alignPair(pageA: StitchPage, lineA: MatchLine, pageB: StitchPage, lineB: MatchLine): PairAlignment {
  const u = unit(sub(lineA.p1, lineA.p0));
  const uB = unit(sub(lineB.p1, lineB.p0));
  // Rotation takes uB to ±u; the sign puts B's drawing on the far side of A's.
  const flip = -lineA.contentSide * lineB.contentSide;
  const angle = Math.atan2(u[1] * flip, u[0] * flip) - Math.atan2(uB[1], uB[0]);
  // Base placement: rotate about B's p0 and put it on A's p0.
  const rot = rigid(angle, 0, 0);
  const moved = apply(rot, lineB.p0);
  const base = compose(rigid(0, lineA.p0[0] - moved[0], lineA.p0[1] - moved[1]), rot);

  const ca = crossings(pageA, lineA, [1, 0, 0, 1, 0, 0], lineA.p0, u);
  const cb = crossings(pageB, lineB, base, lineA.p0, u);

  // Vote for the shift along the line that makes crossings coincide.
  const shifts: { s: number; i: number }[] = [];
  for (let i = 0; i < ca.length; i++) {
    for (const b of cb) {
      const da = Math.abs(ca[i]!.angle - b.angle);
      if (Math.min(da, Math.PI - da) < ANGLE_TOL) shifts.push({ s: ca[i]!.t - b.t, i });
    }
  }
  shifts.sort((x, y) => x.s - y.s);
  let bestVotes = 0;
  let bestShift = 0;
  for (let lo = 0, hi = 0; lo < shifts.length; lo++) {
    while (hi < shifts.length && shifts[hi]!.s - shifts[lo]!.s <= SHIFT_TOL * 2) hi++;
    const window = shifts.slice(lo, hi);
    const votes = new Set(window.map((w) => w.i)).size;
    if (votes > bestVotes) {
      bestVotes = votes;
      bestShift = window.reduce((sum, w) => sum + w.s, 0) / window.length;
    }
  }

  let shift = bestShift;
  let votes = bestVotes;
  if (bestVotes < 3) {
    // Too little evidence: centre the two drawn match lines on each other.
    const midA = (dot(sub(lineA.p1, lineA.p0), u) / 2) as number;
    const bp0 = apply(base, lineB.p0);
    const bp1 = apply(base, lineB.p1);
    const midB = (dot(sub(bp0, lineA.p0), u) + dot(sub(bp1, lineA.p0), u)) / 2;
    shift = midA - midB;
    votes = 0;
  }
  const bToA = compose(rigid(0, u[0] * shift, u[1] * shift), base);
  const confidence = votes === 0 ? 0.2 : Math.min(0.95, 0.4 + votes * 0.08);
  return { bToA, votes, confidence: Math.round(confidence * 100) / 100 };
}
