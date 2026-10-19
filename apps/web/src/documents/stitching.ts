import { defaultContentSide, pairFrame, stitchManual, type StitchPage } from '@nb/stitch';
import type { Point, StoredManualStitch, StoredMatchLine, StoredStitchGroup, Viewport } from '@nb/markup';

/**
 * The stitched groups to show: the user's paired match lines, plus the groups found from the
 * drawings' own match-line labels for sheets the user has not joined by hand. A drawing region
 * the user set on a sheet applies to whichever group the sheet is in.
 */
export function mergeStitch(auto: readonly StoredStitchGroup[], manual: StoredManualStitch, pages?: ReadonlyMap<number, StitchPage>): StoredStitchGroup[] {
  const regions = new Map(Object.entries(manual.regions).map(([k, v]) => [Number(k), v.map((p): [number, number] => [p[0], p[1]])]));
  const own = stitchManual({ lines: manual.lines, regions, pages }).map(
    (g): StoredStitchGroup => ({
      placements: g.placements.map((p) => ({ pageIndex: p.pageIndex, toWorld: [...p.toWorld] as StoredStitchGroup['placements'][number]['toWorld'], clips: p.clips, ...(p.region ? { region: p.region } : {}) })),
      edges: g.edges.map((e) => ({ a: e.a, b: e.b, station: e.station, votes: e.alignment.votes, confidence: e.alignment.confidence, ...(e.line ? { line: { p0: e.line.p0, p1: e.line.p1, contentSide: e.line.contentSide } } : {}) })),
    }),
  );
  if (!own.length && !regions.size) return auto as StoredStitchGroup[];
  const joined = new Set(own.flatMap((g) => g.placements.map((p) => p.pageIndex)));
  const rest = auto
    .filter((g) => !g.placements.some((p) => joined.has(p.pageIndex)))
    .map((g) => (g.placements.some((p) => regions.has(p.pageIndex)) ? { ...g, placements: g.placements.map((p) => (regions.has(p.pageIndex) ? { ...p, region: regions.get(p.pageIndex) } : p)) } : g));
  return [...own, ...rest];
}

/**
 * Regions to stitch with: those the user drew, and for other sheets with match lines, the
 * outline of the sheet's biggest viewport (which usually frames the drawing, not the title block).
 */
export function withViewportRegions(manual: StoredManualStitch, viewports: readonly Viewport[]): StoredManualStitch {
  let regions = manual.regions;
  for (const page of new Set(manual.lines.map((l) => l.pageIndex))) {
    if (regions[page]) continue;
    const biggest = viewports.filter((v) => v.pageIndex === page).sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
    if (!biggest) continue;
    const { x, y, w, h } = biggest.rect;
    regions = { ...regions, [page]: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
  }
  return regions === manual.regions ? manual : { ...manual, regions };
}

type Affine6 = readonly [number, number, number, number, number, number];

function invert(m: Affine6): Affine6 {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const applyTo = (m: Affine6, p: Point): Point => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

/**
 * Takes over a detected stitched group as hand-placed match lines, so its joins can be edited.
 * Each pair keeps exactly the placement detection found: the line on the second sheet is the
 * first sheet's line carried across by that placement. Groups stored before detection kept its
 * lines give nothing.
 */
export function adoptDetected(group: StoredStitchGroup, existing: readonly StoredMatchLine[]): StoredMatchLine[] {
  const out: StoredMatchLine[] = [];
  const toWorld = new Map(group.placements.map((p) => [p.pageIndex, p.toWorld as Affine6]));
  let k = 0;
  for (const e of group.edges) {
    const wa = toWorld.get(e.a);
    const wb = toWorld.get(e.b);
    if (!e.line || !wa || !wb) continue;
    // Sheet a's page space → world → sheet b's page space.
    const aToB = (p: Point) => applyTo(invert(wb), applyTo(wa, p));
    const stamp = `${Date.now().toString(36)}-${k++}`;
    const used = [...existing, ...out];
    const name = e.station ?? nextLineName(used);
    const a: StoredMatchLine = { id: `ml-${stamp}-a`, pageIndex: e.a, p0: e.line.p0, p1: e.line.p1, contentSide: e.line.contentSide, name, matchTo: `ml-${stamp}-b` };
    // Same direction, drawing on the other side: the fit maps one line's ends exactly onto the other's.
    const b: StoredMatchLine = { id: `ml-${stamp}-b`, pageIndex: e.b, p0: aToB(e.line.p0), p1: aToB(e.line.p1), contentSide: e.line.contentSide === 1 ? -1 : 1, name: e.station ?? nextLineName([...used, a]), matchTo: a.id };
    out.push(a, b);
  }
  return out;
}

/**
 * Which of a pair's two lines to adjust so the sheet that moves on screen is the one placed
 * from the other (later in the group's order), not the one the group is laid out from.
 */
export function moverLine(lines: readonly StoredMatchLine[], id: string, group: StoredStitchGroup | null): StoredMatchLine | null {
  const line = lines.find((l) => l.id === id);
  const partner = line?.matchTo ? lines.find((l) => l.id === line.matchTo) : undefined;
  if (!line || !partner) return null;
  const order = (l: StoredMatchLine) => group?.placements.findIndex((p) => p.pageIndex === l.pageIndex) ?? -1;
  const [oi, op] = [order(line), order(partner)];
  if (oi >= 0 && op >= 0) return oi > op ? line : partner;
  return line.pageIndex > partner.pageIndex ? line : partner;
}

/** Adds `along` and `across` (points, in the pair's frame) to a line's adjustment. */
export function shiftLine(lines: readonly StoredMatchLine[], id: string, along: number, across: number): StoredMatchLine[] {
  return lines.map((l) => {
    if (l.id !== id) return l;
    const o: [number, number] = [(l.offset?.[0] ?? 0) + along, (l.offset?.[1] ?? 0) + across];
    const { offset: _, ...rest } = l;
    return Math.abs(o[0]) < 1e-6 && Math.abs(o[1]) < 1e-6 ? rest : { ...rest, offset: o };
  });
}

/**
 * A drag of `delta` (the stitched view's world space) on the sheet of line `id`, as an adjustment
 * of that line in its pair's frame. With `lockAlong`, only the slide along the match line counts.
 */
export function dragToShift(lines: readonly StoredMatchLine[], id: string, group: StoredStitchGroup, delta: Point, lockAlong: boolean): [number, number] {
  const line = lines.find((l) => l.id === id);
  const partner = line?.matchTo ? lines.find((l) => l.id === line.matchTo) : undefined;
  if (!line || !partner) return [0, 0];
  const first = line.pageIndex < partner.pageIndex ? line : partner;
  const w = group.placements.find((p) => p.pageIndex === first.pageIndex)?.toWorld;
  if (!w) return [0, 0];
  // World motion of either sheet is the first sheet's frame turned and scaled into the world.
  const inv = invert([w[0], w[1], w[2], w[3], 0, 0]);
  const d = applyTo(inv, delta);
  const { along, across } = pairFrame(first);
  const a = d[0] * along[0] + d[1] * along[1];
  const c = d[0] * across[0] + d[1] * across[1];
  return [a, lockAlong ? 0 : c];
}

/** Labels new match lines ML-1, ML-2... skipping names in use. */
export function nextLineName(lines: readonly StoredMatchLine[]): string {
  const used = new Set(lines.map((l) => l.name));
  for (let i = 1; ; i++) if (!used.has(`ML-${i}`)) return `ML-${i}`;
}

/** A new hand-placed match line, kept on the side of it that holds more of the sheet (or its region). */
export function newMatchLine(lines: readonly StoredMatchLine[], pageIndex: number, p0: Point, p1: Point, size: { width: number; height: number }, region?: readonly Point[]): StoredMatchLine {
  return {
    id: `ml-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    pageIndex,
    p0,
    p1,
    contentSide: defaultContentSide(size.width, size.height, p0, p1, region),
    name: nextLineName(lines),
    matchTo: null,
  };
}

/** Pairs `id` with `to` (or unpairs it, with null), unpairing whatever either was joined to before. */
export function pairLines(lines: readonly StoredMatchLine[], id: string, to: string | null): StoredMatchLine[] {
  // The lines the two were joined to before lose their partner.
  const dropped = new Set([lines.find((l) => l.id === id)?.matchTo, to ? lines.find((l) => l.id === to)?.matchTo : null]);
  return lines.map((l) => {
    if (l.id === id) return { ...l, matchTo: to };
    if (to && l.id === to) return { ...l, matchTo: id };
    return dropped.has(l.id) ? { ...l, matchTo: null } : l;
  });
}

/**
 * Pairs unpaired lines on different sheets that share a name (as when both are named after
 * the station printed on the drawing). Returns the lines and how many pairs were made.
 */
export function autoPair(lines: readonly StoredMatchLine[]): { lines: StoredMatchLine[]; paired: number } {
  let out = [...lines];
  let paired = 0;
  for (const a of lines) {
    const cur = out.find((l) => l.id === a.id)!;
    if (cur.matchTo || !cur.name.trim()) continue;
    const key = cur.name.trim().toLowerCase();
    const b = out.find((l) => l.id !== cur.id && !l.matchTo && l.pageIndex !== cur.pageIndex && l.name.trim().toLowerCase() === key);
    if (!b) continue;
    out = pairLines(out, cur.id, b.id);
    paired++;
  }
  return { lines: out, paired };
}

/** What is wrong with a line, for the panel: an end outside its sheet's region, or no partner. */
export function lineProblem(line: StoredMatchLine, regions: StoredManualStitch['regions']): string | null {
  const region = regions[line.pageIndex];
  // A click may land a little outside the outline (snapped to a border line, say).
  if (region && region.length >= 3 && (!nearPolygon(line.p0, region, 2) || !nearPolygon(line.p1, region, 2))) return 'An end is outside the region';
  return line.matchTo ? null : 'Not matched to a line on another sheet';
}

function nearPolygon(p: Point, poly: readonly Point[], tol: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!;
    const [bx, by] = poly[i]!;
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t)) <= tol) return true;
  }
  return false;
}
