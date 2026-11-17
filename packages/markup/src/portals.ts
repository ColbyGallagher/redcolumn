import { boundsOf, type Markup, type Point } from './model';
import { markupSegments, pointInPolygon } from './geometry';

/**
 * Portals (Experimental): an area that is the same on several sheets (a typical floor). A markup
 * drawn wholly inside it on one of its pages is mirrored onto every other page at the same page
 * coordinates, and the copies stay in sync: each is a real markup on its page (so it counts once
 * per page and exports as an ordinary annotation), joined to the others by `Markup.portalLink`.
 *
 * This module is the pure part: which markups mirror, and what one edit means for the others.
 * `MarkupStore` runs it after each local edit, in the same undo step.
 */
export interface Portal {
  id: string;
  name: string;
  /** The outline, in page coordinates (the same on every linked page). */
  points: Point[];
  /** The linked pages (0-based), the page it was drawn on included. */
  pages: number[];
  /** The page it was drawn on: its scale is the one the others are checked against. */
  sourcePage: number;
}

/** Joins the copies of one mirrored markup: the portal they are in, and an id they share. */
export interface PortalLink {
  portalId: string;
  linkId: string;
}

/**
 * Fields each copy keeps for itself: identity and page, review (status, replies, checkmark,
 * flags), grouping on its page, and the link to the PDF annotation it was read from. Everything
 * else (geometry, style, text, subject, layer, label, assembly, columns...) is shared.
 */
export const PORTAL_LOCAL_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'seq',
  'pageIndex',
  'createdAt',
  'modifiedAt',
  'pdfAnnot',
  'portalLink',
  'groupId',
  'capture',
  'status',
  'statusHistory',
  'replies',
  'checked',
  'flagged',
  'author',
]);

/** Types whose points are a path (their bounds would overstate them); the rest are boxes. */
const PATH_TYPES: ReadonlySet<string> = new Set([
  'line', 'arrow', 'polyline', 'arc', 'polygon', 'pen', 'highlighter', 'length', 'polylength', 'area', 'perimeter', 'volume', 'count', 'angle', 'arcLength', 'space', 'diameter', 'radius', 'polygonCloud', 'dimension',
]);

/** Whether a markup can be mirrored at all: connectors (glued to other markups by id), signatures, attachments and grouped markups stay local. */
export function canMirror(m: Markup): boolean {
  return m.type !== 'connector' && !m.signature && !m.groupId && !m.attachment && m.points.length > 0;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Whether a markup lies wholly inside a portal's outline: its points, its drawn outline (arcs,
 * ellipses and rotation included) and, for box-shaped types, its box. One that crosses the edge
 * stays local to its page.
 */
export function markupInside(m: Markup, outline: readonly Point[]): boolean {
  if (outline.length < 3) return false;
  const pts: Point[] = [...m.points, ...(m.holes ?? []).flat()];
  if (!PATH_TYPES.has(m.type) && m.points.length >= 2) {
    const b = boundsOf(m.points);
    pts.push([b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]);
  }
  let segs: number[] = [];
  try {
    segs = markupSegments(m);
  } catch {
    // A shape that cannot be outlined is judged by its points.
  }
  for (let i = 0; i + 1 < segs.length; i += 2) pts.push([segs[i]!, segs[i + 1]!]);
  if (!pts.every((p) => pointInPolygon(p, outline))) return false;
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const a: Point = [segs[i]!, segs[i + 1]!];
    const b: Point = [segs[i + 2]!, segs[i + 3]!];
    for (let j = 0, k = outline.length - 1; j < outline.length; k = j++) if (segmentsCross(a, b, outline[k]!, outline[j]!)) return false;
  }
  return true;
}

/** The portal a newly drawn markup is mirrored through: one linking its page (and another) that holds it wholly. */
export function portalFor(m: Markup, portals: readonly Portal[]): Portal | null {
  if (!canMirror(m)) return null;
  return portals.find((p) => p.pages.length > 1 && p.pages.includes(m.pageIndex) && markupInside(m, p.points)) ?? null;
}

/**
 * The shared fields an edit changed, to copy to the other copies (a field set to undefined is
 * removed); null when the edit changed only the copy's own fields.
 */
export function sharedPatch(was: Markup, now: Markup): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const a = was as unknown as Record<string, unknown>;
  const b = now as unknown as Record<string, unknown>;
  let any = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (PORTAL_LOCAL_FIELDS.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      patch[k] = b[k];
      any = true;
    }
  }
  return any ? patch : null;
}

function applyPatch(m: Markup, patch: Record<string, unknown>, at: number): Markup {
  const next: Record<string, unknown> = { ...m };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = structuredClone(v);
  }
  next.modifiedAt = at;
  return next as unknown as Markup;
}

/** A copy of `src` for another page of its portal: the same shared fields, its own review state. */
export function mirrorCopy(src: Markup, pageIndex: number, id: string, link: PortalLink, at: number): Markup {
  const copy: Record<string, unknown> = structuredClone({ ...src });
  for (const k of ['pdfAnnot', 'groupId', 'capture', 'statusHistory', 'replies', 'seq', 'checked', 'flagged']) delete copy[k];
  return { ...(copy as unknown as Markup), id, pageIndex, portalLink: link, createdAt: at, modifiedAt: at };
}

/** One markup's change in a local edit: `was` before it (unset when added), `now` after (unset when deleted). */
export interface MarkupChange {
  was?: Markup;
  now?: Markup;
}

/** What to write after an edit so every copy agrees: markups to set (new or changed) and ids to delete. */
export interface PortalSyncPlan {
  set: Markup[];
  remove: string[];
}

export interface PortalSyncInput {
  changes: readonly MarkupChange[];
  /** Every markup after the edit. */
  markups: Iterable<Markup>;
  portals: readonly Portal[];
  newId: () => string;
  at?: number;
  /** Whether this person may change a markup (others' markups are left as they are). */
  mayEdit?: (m: Markup) => boolean;
}

/**
 * Works out how the other copies follow one local edit:
 * - a markup added wholly inside a portal on one of its pages is copied to its other pages (a
 *   pasted or duplicated copy of a linked markup starts a link of its own);
 * - an edit to a linked markup's shared fields is copied to its other copies;
 * - deleting a linked markup deletes its other copies;
 * - a linked markup moved to another page, or whose link was removed (Break Link), is left alone.
 * The plan's own writes are not edits (the store applies them under another origin), so they never
 * set off another round.
 */
export function planPortalSync({ changes, markups, portals, newId, at = Date.now(), mayEdit = () => true }: PortalSyncInput): PortalSyncPlan {
  const set = new Map<string, Markup>();
  const remove = new Set<string>();
  if (!changes.length) return { set: [], remove: [] };
  const byLink = new Map<string, Markup[]>();
  for (const m of markups) {
    const l = m.portalLink?.linkId;
    if (!l) continue;
    const list = byLink.get(l);
    if (list) list.push(m);
    else byLink.set(l, [m]);
  }
  // Markups the edit itself changed: theirs is the newer word, so they are not overwritten.
  const touched = new Set<string>();
  for (const c of changes) {
    if (c.was) touched.add(c.was.id);
    if (c.now) touched.add(c.now.id);
  }
  const byId = new Map(portals.map((p) => [p.id, p]));
  /** The portal a markup is a live copy in: its portal still exists and still links its page. */
  const liveIn = (m: Markup): Portal | null => {
    const p = m.portalLink ? byId.get(m.portalLink.portalId) : undefined;
    return p && p.pages.includes(m.pageIndex) ? p : null;
  };
  const unlinked = (m: Markup) => {
    const { portalLink: _drop, ...rest } = m;
    return rest as Markup;
  };
  // New markups carrying the same link (several copies of one mirrored item pasted together) are
  // mirrored as one item: one new link, a copy only on the linked pages none of them is on.
  const pastedGroups = new Map<string, Markup[]>();
  for (const { was, now } of changes) {
    if (!now || was || !now.portalLink) continue;
    const list = pastedGroups.get(now.portalLink.linkId);
    if (list) list.push(now);
    else pastedGroups.set(now.portalLink.linkId, [now]);
  }
  const grouped = new Set<string>();
  for (const group of pastedGroups.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    const portal = portalFor(first, portals);
    const members = portal ? group.filter((m) => portal.pages.includes(m.pageIndex) && markupInside(m, portal.points)) : [];
    const onPages = new Set(members.map((m) => m.pageIndex));
    // Two pasted on one page are two items, not two copies of one: those are judged one by one.
    if (!portal || members.length !== group.length || onPages.size !== members.length) continue;
    const link: PortalLink = { portalId: portal.id, linkId: newId() };
    for (const m of members) {
      grouped.add(m.id);
      set.set(m.id, { ...m, portalLink: link });
    }
    for (const page of portal.pages) {
      if (onPages.has(page)) continue;
      const copy = mirrorCopy(first, page, newId(), link, at);
      set.set(copy.id, copy);
    }
  }
  for (const { was, now } of changes) {
    if (now && !was) {
      if (grouped.has(now.id)) continue;
      // New: a carried-over link (paste, duplicate) is not a copy of anything here.
      const portal = portalFor(now, portals);
      if (portal) {
        const link: PortalLink = { portalId: portal.id, linkId: newId() };
        set.set(now.id, { ...now, portalLink: link });
        for (const page of portal.pages) {
          if (page === now.pageIndex) continue;
          const copy = mirrorCopy(now, page, newId(), link, at);
          set.set(copy.id, copy);
        }
      } else if (now.portalLink) set.set(now.id, unlinked(now));
      continue;
    }
    if (was && !now) {
      const link = was.portalLink?.linkId;
      const portal = liveIn(was);
      if (!link || !portal) continue;
      for (const other of byLink.get(link) ?? []) if (other.id !== was.id && !touched.has(other.id) && liveIn(other) === portal && mayEdit(other)) remove.add(other.id);
      continue;
    }
    if (!was || !now) continue;
    const link = now.portalLink?.linkId;
    if (!link || was.portalLink?.linkId !== link) continue;
    const portal = liveIn(was);
    if (!portal) continue;
    if (was.pageIndex !== now.pageIndex || !markupInside(now, portal.points)) {
      // Moved to another page, or out of the portal (wholly or across its edge): no longer one of
      // the copies. It moves alone; the others stay where they are.
      set.set(now.id, unlinked(now));
      continue;
    }
    const patch = sharedPatch(was, now);
    if (!patch) continue;
    for (const other of byLink.get(link) ?? []) {
      if (other.id === now.id || touched.has(other.id) || remove.has(other.id) || liveIn(other) !== portal || !mayEdit(other)) continue;
      set.set(other.id, applyPatch(set.get(other.id) ?? other, patch, at));
    }
  }
  return { set: [...set.values()], remove: [...remove] };
}

/**
 * What changing a portal's linked pages does to its copies (Portals…): each linked item is copied
 * onto a page newly linked (when it has no copy there yet), and copies on a page no longer linked
 * become ordinary markups. `was` unset is a new portal (nothing to change).
 */
export function relinkPlan(was: Portal | undefined, now: Portal, markups: Iterable<Markup>, newId: () => string, at = Date.now()): Markup[] {
  if (!was) return [];
  const added = now.pages.filter((p) => !was.pages.includes(p));
  const dropped = new Set(was.pages.filter((p) => !now.pages.includes(p)));
  if (!added.length && !dropped.size) return [];
  const out: Markup[] = [];
  const groups = new Map<string, Markup[]>();
  for (const m of markups) {
    if (m.portalLink?.portalId !== now.id) continue;
    if (dropped.has(m.pageIndex)) {
      const { portalLink: _drop, ...rest } = m;
      out.push({ ...(rest as Markup), modifiedAt: at });
      continue;
    }
    if (!was.pages.includes(m.pageIndex)) continue;
    const list = groups.get(m.portalLink.linkId);
    if (list) list.push(m);
    else groups.set(m.portalLink.linkId, [m]);
  }
  for (const group of groups.values()) {
    const from = group.find((m) => m.pageIndex === now.sourcePage) ?? group[0]!;
    for (const page of added) if (!group.some((m) => m.pageIndex === page)) out.push(mirrorCopy(from, page, newId(), from.portalLink!, at));
  }
  return out;
}

/**
 * Links that lead nowhere: markups whose portal is gone, or no longer links their page. They
 * become ordinary markups (returned without their link).
 */
export function orphanedLinks(markups: Iterable<Markup>, portals: readonly Portal[]): Markup[] {
  const byId = new Map(portals.map((p) => [p.id, p]));
  const out: Markup[] = [];
  for (const m of markups) {
    if (!m.portalLink) continue;
    if (byId.get(m.portalLink.portalId)?.pages.includes(m.pageIndex)) continue;
    const { portalLink: _drop, ...rest } = m;
    out.push(rest as Markup);
  }
  return out;
}

/** The other copies of a linked markup (not itself). */
export function linkedCopies(m: Pick<Markup, 'id' | 'portalLink'>, markups: Iterable<Markup>): Markup[] {
  const link = m.portalLink?.linkId;
  if (!link) return [];
  const out: Markup[] = [];
  for (const o of markups) if (o.id !== m.id && o.portalLink?.linkId === link) out.push(o);
  return out;
}

/** Linked pages whose scale differs from the portal's own page (their quantities would not match). */
export function scaleMismatches(portal: Pick<Portal, 'pages' | 'sourcePage'>, scaleKey: (pageIndex: number) => string): number[] {
  const own = scaleKey(portal.sourcePage);
  return portal.pages.filter((p) => p !== portal.sourcePage && scaleKey(p) !== own);
}

/**
 * Follows page operations: each linked page moves to its new index (`to` gives null for deleted
 * pages); a portal left with fewer than two pages is dropped.
 */
export function remapPortals(portals: readonly Portal[], to: (page: number) => number | null): Portal[] {
  return portals.flatMap((p) => {
    const pages = [...new Set(p.pages.flatMap((i) => { const n = to(i); return n === null ? [] : [n]; }))].sort((a, b) => a - b);
    if (pages.length < 2) return [];
    const source = to(p.sourcePage);
    return [{ ...p, pages, sourcePage: source ?? pages[0]! }];
  });
}

const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Limits on what a file or a peer may hand over: beyond them, a portal is dropped. */
export const PORTAL_LIMITS = { portals: 200, points: 2000, pages: 5000 } as const;

/**
 * Portals read from a file or a peer: anything malformed is left out. With `pageCount`, linked
 * pages past the document's end are dropped; a portal left with fewer than two pages, an
 * outline of more than PORTAL_LIMITS.points corners or more than PORTAL_LIMITS.pages pages is
 * dropped, and at most PORTAL_LIMITS.portals are kept.
 */
export function sanitizePortals(raw: unknown, pageCount?: number): Portal[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Portal[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (out.length >= PORTAL_LIMITS.portals) break;
    if (!r || typeof r !== 'object') continue;
    const id = typeof r.id === 'string' ? r.id.slice(0, 100) : '';
    if (!id || seen.has(id)) continue;
    if (!Array.isArray(r.points) || r.points.length > PORTAL_LIMITS.points || !Array.isArray(r.pages) || r.pages.length > PORTAL_LIMITS.pages) continue;
    const points = (r.points as unknown[]).filter(isPoint).map((p) => [p[0], p[1]] as Point);
    const pages = [...new Set((r.pages as unknown[]).filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (pageCount === undefined || (n as number) < pageCount)))].sort((a, b) => a - b);
    if (points.length < 3 || pages.length < 2) continue;
    const sourcePage = Number.isInteger(r.sourcePage) && pages.includes(r.sourcePage as number) ? (r.sourcePage as number) : pages[0]!;
    seen.add(id);
    out.push({ id, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 200) : 'Portal', points, pages, sourcePage });
  }
  return out;
}
