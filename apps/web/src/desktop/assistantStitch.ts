import { apply, compose, defaultContentSide, scaleOf, tooShort, visiblePolygon, type Affine } from '@nb/stitch';
import type { Point, StoredManualStitch, StoredMatchLine, StoredStitchGroup } from '@nb/markup';
import type { PageRegion } from '@nb/pdf-core';
import { lineProblem, mergeStitch, moverLine, newMatchLine, nextLineName, nudgeToShift, pairLines, shiftLine, withViewportRegions } from '../documents/stitching';
import { ask, bounded, findDocument, finite, pageIndexOf, record, round1, type AssistantDocument, type AssistantEnv } from './assistant';

/**
 * The stitching tools: everything the Stitching panel does (regions, match lines, pairing,
 * nudging), a picture of the joined sheets, the stitched view, and Stitch to New Page. Pages are
 * 1-based and points are PDF points from the page's top-left, y down, as in the markup tools.
 */
export const STITCH_METHODS = ['get_stitching', 'set_stitch_region', 'place_match_lines', 'update_match_lines', 'delete_match_lines', 'get_stitch_image', 'show_stitched_view', 'stitch_to_page'] as const;

export type StitchMethod = (typeof STITCH_METHODS)[number];

/** The most match-line pairs or edits one call takes. */
const MAX_LINES = 100;
/** A picture of the joined sheets fits this many pixels on its longer side unless the call says otherwise. */
const DEFAULT_IMAGE_SIZE = 2000;
const MAX_IMAGE_SIZE = 4096;
const DEFAULT_IMAGE_DPI = 100;
/** How far outside the page a click may land (a border line, say) before it is refused. */
const PAGE_SLACK = 2;

const round2 = (n: number) => Math.round(n * 100) / 100;
const pt = (p: readonly number[]): [number, number] => [round2(p[0]!), round2(p[1]!)];

/** The stitched groups the drawing shows: hand-placed match lines, then the joins found on the sheets. */
export function stitchGroupsOf(doc: AssistantDocument): StoredStitchGroup[] {
  return mergeStitch(doc.store.stitchGroups(), withViewportRegions(doc.store.manualStitch(), doc.store.allViewports()));
}

function effectiveRegions(doc: AssistantDocument, manual: StoredManualStitch): StoredManualStitch['regions'] {
  return withViewportRegions(manual, doc.store.allViewports()).regions;
}

function sizeOf(doc: AssistantDocument, pageIndex: number) {
  const size = doc.pageSize?.(pageIndex) ?? null;
  if (!size) throw new Error(`Page size is not available for page ${pageIndex + 1} of ${doc.name}.`);
  return size;
}

function writable(doc: AssistantDocument) {
  if (doc.store.readOnly) throw new Error(`${doc.name} is read-only.`);
}

function pointOf(raw: unknown, name: string): Point {
  if (!Array.isArray(raw) || raw.length < 2) throw new Error(`${name} has to be an x and a y.`);
  return [finite(raw[0], `${name} x`), finite(raw[1], `${name} y`)];
}

function onPage(doc: AssistantDocument, pageIndex: number, p: Point, name: string) {
  const { width, height } = sizeOf(doc, pageIndex);
  if (p[0] < -PAGE_SLACK || p[1] < -PAGE_SLACK || p[0] > width + PAGE_SLACK || p[1] > height + PAGE_SLACK) {
    throw new Error(`${name} (${round1(p[0])}, ${round1(p[1])}) is off page ${pageIndex + 1} (${Math.round(width)} × ${Math.round(height)} points).`);
  }
}

/** +1 keeps the right-hand side walking from p0 to p1 as the page shows (y down), -1 the left. */
function sideFrom(args: Record<string, unknown>, p0: Point, p1: Point): 1 | -1 | null {
  if (args.keepSide !== undefined) {
    if (args.keepSide === 'right') return 1;
    if (args.keepSide === 'left') return -1;
    throw new Error('keepSide is "right" or "left" (walking from p0 to p1).');
  }
  if (args.keepPoint !== undefined) {
    const k = pointOf(args.keepPoint, 'keepPoint');
    const [dx, dy] = [p1[0] - p0[0], p1[1] - p0[1]];
    const s = (k[0] - p0[0]) * -dy + (k[1] - p0[1]) * dx;
    if (Math.abs(s) < 1e-9) throw new Error('keepPoint is on the match line: pick a point inside the part of the sheet that stays.');
    return s > 0 ? 1 : -1;
  }
  return null;
}

function sheetNumber(doc: AssistantDocument, pageIndex: number): string | null {
  return doc.store.allSheets()[pageIndex]?.number ?? null;
}

function publicLine(line: StoredMatchLine, regions: StoredManualStitch['regions']) {
  const problem = lineProblem(line, regions);
  return {
    id: line.id,
    name: line.name,
    page: line.pageIndex + 1,
    p0: pt(line.p0),
    p1: pt(line.p1),
    keepSide: line.contentSide === 1 ? 'right' : 'left',
    matchTo: line.matchTo,
    ...(line.offset ? { slid: [round2(line.offset[0]), round2(line.offset[1])] } : {}),
    ...(problem ? { problem } : {}),
  };
}

const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

function handPairs(lines: readonly StoredMatchLine[]): Set<string> {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out = new Set<string>();
  for (const l of lines) {
    const p = l.matchTo ? byId.get(l.matchTo) : undefined;
    if (p && p.pageIndex !== l.pageIndex) out.add(pairKey(l.pageIndex, p.pageIndex));
  }
  return out;
}

function publicGroup(doc: AssistantDocument, group: StoredStitchGroup, lines: readonly StoredMatchLine[]) {
  const byHand = handPairs(lines);
  return {
    pages: group.placements.map((p) => p.pageIndex + 1),
    sheets: group.placements.map((p) => ({
      page: p.pageIndex + 1,
      sheetNumber: sheetNumber(doc, p.pageIndex),
      // Relative to the group's first sheet, which keeps its own page space.
      scale: Math.round(scaleOf(p.toWorld as Affine) * 1000) / 1000,
      rotation: Math.round((Math.atan2(p.toWorld[1], p.toWorld[0]) * 180) / Math.PI * 10) / 10,
      ...(p.region ? { region: true } : {}),
    })),
    joins: group.edges.map((e) => ({ pages: [e.a + 1, e.b + 1], name: e.station, byHand: byHand.has(pairKey(e.a, e.b)) })),
  };
}

function groupFor(doc: AssistantDocument, pageIndex: number): StoredStitchGroup {
  const group = stitchGroupsOf(doc).find((g) => g.placements.some((p) => p.pageIndex === pageIndex));
  if (!group) throw new Error(`Page ${pageIndex + 1} of ${doc.name} is not stitched to another sheet. Place match lines first (place_match_lines).`);
  return group;
}

function pageArg(doc: AssistantDocument, args: Record<string, unknown>): number {
  return args.page === undefined ? doc.pageIndex : pageIndexOf(doc, args.page);
}

/** Groups that hold any of `pages`, for a reply after a change. */
function groupsTouching(doc: AssistantDocument, pages: Iterable<number>) {
  const wanted = new Set(pages);
  const lines = doc.store.manualStitch().lines;
  return stitchGroupsOf(doc)
    .filter((g) => g.placements.some((p) => wanted.has(p.pageIndex)))
    .map((g) => publicGroup(doc, g, lines));
}

function getStitching(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  const manual = doc.store.manualStitch();
  const regions = effectiveRegions(doc, manual);
  const only = args.page === undefined ? null : pageIndexOf(doc, args.page);
  const groups = stitchGroupsOf(doc).filter((g) => only === null || g.placements.some((p) => p.pageIndex === only));
  return {
    document: doc.name,
    id: doc.id,
    lines: manual.lines.filter((l) => only === null || l.pageIndex === only).map((l) => publicLine(l, regions)),
    regions: Object.entries(manual.regions)
      .filter(([page]) => only === null || Number(page) === only)
      .map(([page, points]) => ({ page: Number(page) + 1, points: points.map(pt) })),
    groups: groups.map((g) => publicGroup(doc, g, manual.lines)),
  };
}

function setStitchRegion(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  writable(doc);
  if (args.page === undefined) throw new Error('Say which page the region is on.');
  const pageIndex = pageIndexOf(doc, args.page);
  const { width, height } = sizeOf(doc, pageIndex);
  const manual = doc.store.manualStitch();
  const raw = args.points;
  let regions = { ...manual.regions };
  if (raw === null || raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
    delete regions[pageIndex];
  } else {
    if (!Array.isArray(raw)) throw new Error('points is two opposite corners of a rectangle, or the corners of a polygon.');
    const clamp = (p: Point): Point => [Math.min(width, Math.max(0, p[0])), Math.min(height, Math.max(0, p[1]))];
    const pts = raw.map((p, i) => clamp(pointOf(p, `Point ${i + 1}`)));
    let poly: Point[];
    if (pts.length === 2) {
      const [[x0, y0], [x1, y1]] = pts as [Point, Point];
      const [l, r, t, b] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
      if (r - l < 1 || b - t < 1) throw new Error('That rectangle has no size.');
      poly = [[l, t], [r, t], [r, b], [l, b]];
    } else if (pts.length >= 3) {
      poly = pts;
    } else throw new Error('points is two opposite corners of a rectangle, or the corners of a polygon.');
    regions = { ...regions, [pageIndex]: poly };
  }
  doc.store.setManualStitch({ ...manual, regions });
  const next = doc.store.manualStitch();
  const shown = effectiveRegions(doc, next);
  return {
    document: doc.name,
    page: pageIndex + 1,
    region: next.regions[pageIndex]?.map(pt) ?? null,
    lines: next.lines.filter((l) => l.pageIndex === pageIndex).map((l) => publicLine(l, shown)),
  };
}

interface LineInput {
  pageIndex: number;
  p0: Point;
  p1: Point;
  side: 1 | -1 | null;
}

function lineInput(doc: AssistantDocument, raw: unknown, name: string): LineInput {
  const args = record(raw);
  if (args.page === undefined) throw new Error(`${name}: say which page it is on.`);
  const pageIndex = pageIndexOf(doc, args.page);
  const p0 = pointOf(args.p0, `${name} p0`);
  const p1 = pointOf(args.p1, `${name} p1`);
  onPage(doc, pageIndex, p0, `${name} p0`);
  onPage(doc, pageIndex, p1, `${name} p1`);
  if (tooShort({ p0, p1 })) throw new Error(`${name} is too short: its two ends have to be apart.`);
  return { pageIndex, p0, p1, side: sideFrom(args, p0, p1) };
}

function placeMatchLines(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  writable(doc);
  const pairs = args.pairs;
  if (!Array.isArray(pairs) || !pairs.length) throw new Error('Give the pairs of match lines: the same line on each of two sheets.');
  if (pairs.length > MAX_LINES) throw new Error(`At most ${MAX_LINES} pairs in one call.`);
  const manual = doc.store.manualStitch();
  const regions = effectiveRegions(doc, manual);
  let lines = [...manual.lines];
  const placed: { name: string; ids: [string, string]; pages: [number, number] }[] = [];
  // Everything is checked before anything is stored, so one bad pair changes nothing.
  pairs.forEach((rawPair, i) => {
    const pair = record(rawPair);
    const label = `Pair ${i + 1}`;
    const a = lineInput(doc, pair.a, `${label} a`);
    const b = lineInput(doc, pair.b, `${label} b`);
    if (a.pageIndex === b.pageIndex) throw new Error(`${label}: the two lines have to be on different pages.`);
    const name = typeof pair.name === 'string' && pair.name.trim() ? pair.name.trim() : nextLineName(lines);
    const stamp = `ml-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const make = (l: LineInput, id: string, matchTo: string): StoredMatchLine => {
      const size = sizeOf(doc, l.pageIndex);
      const base = newMatchLine(lines, l.pageIndex, l.p0, l.p1, size, regions[l.pageIndex]);
      return { ...base, id, name, matchTo, contentSide: l.side ?? defaultContentSide(size.width, size.height, l.p0, l.p1, regions[l.pageIndex]) };
    };
    const la = make(a, `${stamp}-a`, `${stamp}-b`);
    const lb = make(b, `${stamp}-b`, `${stamp}-a`);
    lines.push(la, lb);
    placed.push({ name, ids: [la.id, lb.id], pages: [a.pageIndex + 1, b.pageIndex + 1] });
  });
  doc.store.setManualStitch({ ...manual, lines });
  const next = doc.store.manualStitch();
  const shown = effectiveRegions(doc, next);
  const ids = new Set(placed.flatMap((p) => p.ids));
  lines = next.lines;
  return {
    document: doc.name,
    placed,
    lines: lines.filter((l) => ids.has(l.id)).map((l) => publicLine(l, shown)),
    groups: groupsTouching(doc, placed.flatMap((p) => p.pages.map((n) => n - 1))),
  };
}

function updateMatchLines(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  writable(doc);
  const items = args.lines;
  if (!Array.isArray(items) || !items.length) throw new Error('Give the match lines to change, by id from get_stitching.');
  if (items.length > MAX_LINES) throw new Error(`At most ${MAX_LINES} lines in one call.`);
  const manual = doc.store.manualStitch();
  let lines = [...manual.lines];
  const touched = new Set<number>();
  const moved: { id: string; page: number }[] = [];
  for (const [i, raw] of items.entries()) {
    const item = record(raw);
    const id = typeof item.id === 'string' ? item.id : '';
    const line = lines.find((l) => l.id === id);
    if (!line) throw new Error(`Line ${i + 1}: no match line ${id || '(no id)'} on ${doc.name}.`);
    let next: StoredMatchLine = { ...line };
    if (item.p0 !== undefined) next.p0 = pointOf(item.p0, `Line ${i + 1} p0`);
    if (item.p1 !== undefined) next.p1 = pointOf(item.p1, `Line ${i + 1} p1`);
    onPage(doc, next.pageIndex, next.p0, `Line ${i + 1} p0`);
    onPage(doc, next.pageIndex, next.p1, `Line ${i + 1} p1`);
    if (tooShort(next)) throw new Error(`Line ${i + 1} is too short: its two ends have to be apart.`);
    const side = sideFrom(item, next.p0, next.p1);
    if (side !== null) next.contentSide = side;
    if (item.flip === true) next.contentSide = next.contentSide === 1 ? -1 : 1;
    if (typeof item.name === 'string' && item.name.trim()) next.name = item.name.trim();
    lines = lines.map((l) => (l.id === id ? next : l));
    touched.add(next.pageIndex);
    if (item.matchTo !== undefined) {
      const to = item.matchTo === null ? null : String(item.matchTo);
      if (to !== null) {
        const partner = lines.find((l) => l.id === to);
        if (!partner) throw new Error(`Line ${i + 1}: no match line ${to} to match to.`);
        if (partner.pageIndex === next.pageIndex) throw new Error(`Line ${i + 1}: a match line joins a line on another page.`);
        touched.add(partner.pageIndex);
      }
      lines = pairLines(lines, id, to);
    }
    if (item.resetSlide === true) {
      const partnerId = lines.find((l) => l.id === id)?.matchTo;
      lines = lines.map((l) => (l.id === id || l.id === partnerId ? (({ offset: _, ...rest }) => rest)(l) : l));
    }
    if (item.slide !== undefined) {
      const slide = record(item.slide);
      const along = slide.along === undefined ? 0 : finite(slide.along, `Line ${i + 1} slide along`);
      const apart = slide.apart === undefined ? 0 : finite(slide.apart, `Line ${i + 1} slide apart`);
      const groups = mergeStitch(doc.store.stitchGroups(), withViewportRegions({ ...manual, lines }, doc.store.allViewports()));
      const group = groups.find((g) => g.placements.some((p) => p.pageIndex === next.pageIndex)) ?? null;
      const mover = moverLine(lines, id, group);
      if (!mover) throw new Error(`Line ${i + 1} is not matched to another line, so there is no sheet to slide.`);
      const [a, c] = nudgeToShift(lines, mover.id, along, apart);
      lines = shiftLine(lines, mover.id, a, c);
      moved.push({ id: mover.id, page: mover.pageIndex + 1 });
    }
  }
  doc.store.setManualStitch({ ...manual, lines });
  const next = doc.store.manualStitch();
  const shown = effectiveRegions(doc, next);
  const ids = new Set(items.map((raw) => String(record(raw).id)));
  for (const l of next.lines) if (ids.has(l.id) && l.matchTo) touched.add(next.lines.find((p) => p.id === l.matchTo)?.pageIndex ?? l.pageIndex);
  return {
    document: doc.name,
    lines: next.lines.filter((l) => ids.has(l.id)).map((l) => publicLine(l, shown)),
    ...(moved.length ? { slid: moved } : {}),
    groups: groupsTouching(doc, touched),
  };
}

async function deleteMatchLines(docs: readonly AssistantDocument[], params: unknown, env: AssistantEnv) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  writable(doc);
  const manual = doc.store.manualStitch();
  const all = args.all === true;
  const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
  const regionPages = Array.isArray(args.regionPages) ? args.regionPages.map((p) => pageIndexOf(doc, p)) : [];
  if (!all && !ids.length && !regionPages.length) throw new Error('Say which match lines to remove (ids), which pages to clear the region from (regionPages), or all.');
  for (const id of ids) if (!manual.lines.some((l) => l.id === id)) throw new Error(`No match line ${id} on ${doc.name}.`);
  const what = all ? 'every match line and region' : [ids.length ? `${ids.length} match line${ids.length === 1 ? '' : 's'}` : '', regionPages.length ? `the region on page${regionPages.length === 1 ? '' : 's'} ${regionPages.map((p) => p + 1).join(', ')}` : ''].filter(Boolean).join(' and ');
  await ask(env, `Remove ${what} on ${doc.name}? You can still Undo in redcolumn.`);
  if (all) {
    doc.store.setManualStitch({ lines: [], regions: {} });
    return { document: doc.name, removed: 'all' };
  }
  const gone = new Set(ids);
  // A line whose partner goes is left waiting for a new one.
  let lines = manual.lines.filter((l) => !gone.has(l.id));
  lines = lines.map((l) => (l.matchTo && gone.has(l.matchTo) ? (({ offset: _, ...rest }) => ({ ...rest, matchTo: null }))(l) : l));
  const regions = { ...manual.regions };
  for (const p of regionPages) delete regions[p];
  doc.store.setManualStitch({ lines, regions });
  return { document: doc.name, removed: { lines: ids, regionPages: regionPages.map((p) => p + 1) } };
}

/** The group's outline in its world space: each sheet cut at its region and match lines. */
function worldBounds(doc: AssistantDocument, group: StoredStitchGroup): PageRegion {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of group.placements) {
    const { width, height } = sizeOf(doc, p.pageIndex);
    const poly = visiblePolygon({ clips: p.clips, region: p.region?.map((q): [number, number] => [q[0], q[1]]) }, width, height);
    for (const q of poly) {
      const [x, y] = apply(p.toWorld as Affine, q);
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  }
  if (!Number.isFinite(x0)) throw new Error('Nothing of the sheets is left to show: check the regions and which side of each match line is kept.');
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

async function getStitchImage(docs: readonly AssistantDocument[], params: unknown) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  if (!doc.renderStitch) throw new Error(`${doc.name} cannot be drawn here.`);
  const group = groupFor(doc, pageArg(doc, args));
  const whole = worldBounds(doc, group);
  let bounds = whole;
  if (args.region !== undefined && args.region !== null) {
    const r = record(args.region);
    const [x, y, w, h] = [finite(r.x, 'Region x'), finite(r.y, 'Region y'), finite(r.w, 'Region w'), finite(r.h, 'Region h')];
    const [l, t] = [Math.max(whole.x, x), Math.max(whole.y, y)];
    const [rr, b] = [Math.min(whole.x + whole.w, x + w), Math.min(whole.y + whole.h, y + h)];
    if (rr <= l || b <= t) throw new Error(`That region is outside the stitched sheets (x ${round1(whole.x)}–${round1(whole.x + whole.w)}, y ${round1(whole.y)}–${round1(whole.y + whole.h)}).`);
    bounds = { x: l, y: t, w: rr - l, h: b - t };
  }
  const dpi = bounded(args.dpi, 'dpi', 18, 600, DEFAULT_IMAGE_DPI);
  const maxSize = bounded(args.maxSize, 'maxSize', 256, MAX_IMAGE_SIZE, DEFAULT_IMAGE_SIZE);
  const scale = Math.min(dpi / 72, maxSize / Math.max(bounds.w, bounds.h));
  const withMarkups = args.markups !== false;
  const image = await doc.renderStitch(group, bounds, scale, withMarkups);
  if (!image) throw new Error('The stitched sheets could not be drawn.');
  const toImage = (t: Affine): number[] => compose([scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale], t).map((v) => Math.round(v * 10000) / 10000);
  return {
    document: doc.name,
    id: doc.id,
    pages: group.placements.map((p) => p.pageIndex + 1),
    bounds: { x: round1(whole.x), y: round1(whole.y), w: round1(whole.w), h: round1(whole.h) },
    region: { x: round1(bounds.x), y: round1(bounds.y), w: round1(bounds.w), h: round1(bounds.h) },
    scale,
    width: image.width,
    height: image.height,
    sheets: group.placements.map((p) => ({ page: p.pageIndex + 1, sheetNumber: sheetNumber(doc, p.pageIndex), toImage: toImage(p.toWorld as Affine) })),
    markups: withMarkups,
    image: { mimeType: 'image/png', data: image.png },
  };
}

function showStitchedView(docs: readonly AssistantDocument[], params: unknown, env: AssistantEnv) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  if (!env.stitch) throw new Error('The stitched view is not available.');
  const on = args.on !== false;
  const pageIndex = pageArg(doc, args);
  const group = on ? groupFor(doc, pageIndex) : null;
  if (!env.stitch.show(doc.id, group, pageIndex)) throw new Error(`${doc.name} is not the drawing on screen.`);
  return { document: doc.name, stitched: on, ...(group ? { pages: group.placements.map((p) => p.pageIndex + 1) } : {}) };
}

async function stitchToPage(docs: readonly AssistantDocument[], params: unknown, env: AssistantEnv) {
  const args = record(params);
  const doc = findDocument(docs, args.document);
  writable(doc);
  if (!env.stitch) throw new Error('Stitch to New Page is not available.');
  const group = groupFor(doc, pageArg(doc, args));
  const withMarkups = args.markups !== false;
  const pages = group.placements.map((p) => p.pageIndex + 1);
  await ask(env, `Allow the assistant to stitch pages ${pages.join(', ')} onto a new page at the end of ${doc.name}${withMarkups ? ', with their markups' : ''}? You can still Undo in redcolumn.`);
  const result = await env.stitch.toPage(doc.id, group, withMarkups);
  if (!result) throw new Error(`${doc.name} has to be the drawing on screen, and not read-only.`);
  return { document: doc.name, page: result.pageIndex + 1, sheets: pages, markups: result.markups };
}

/** Runs one stitching tool. */
export async function stitchCall(docs: readonly AssistantDocument[], method: string, params: unknown, env: AssistantEnv): Promise<unknown> {
  switch (method as StitchMethod) {
    case 'get_stitching':
      return getStitching(docs, params);
    case 'set_stitch_region':
      return setStitchRegion(docs, params);
    case 'place_match_lines':
      return placeMatchLines(docs, params);
    case 'update_match_lines':
      return updateMatchLines(docs, params);
    case 'delete_match_lines':
      return deleteMatchLines(docs, params, env);
    case 'get_stitch_image':
      return getStitchImage(docs, params);
    case 'show_stitched_view':
      return showStitchedView(docs, params, env);
    case 'stitch_to_page':
      return stitchToPage(docs, params, env);
  }
  throw new Error('Unknown tool.');
}
