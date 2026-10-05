import type { Rect } from './model';

/**
 * Where a hyperlink (or bookmark) goes: a page, optionally zoomed to an area of it (a "snapshot
 * view"); a Place, found by id so moving the Place keeps its links working; or a web address.
 */
export type LinkAction =
  | { kind: 'page'; pageIndex: number; rect: Rect | null }
  | { kind: 'place'; placeId: string }
  | { kind: 'url'; url: string }
  /** A page of another library document (Auto-Link Sheets); `name` is its file name, for export. */
  | { kind: 'file'; fileId: string; name: string; pageIndex: number; rect: Rect | null; label?: string };

/** A bookmark: a titled jump to a page or a view of it, with nested bookmarks under it. */
export interface Bookmark {
  id: string;
  title: string;
  pageIndex: number;
  /** An area to zoom to, or a top-left point (w = h = 0); null shows the whole page. */
  rect: Rect | null;
  /** A point destination's zoom (as the PDF's outline had it); unset keeps the reader's zoom. */
  zoom?: number;
  children: Bookmark[];
  /** Instead of its page: a web page, another document, or a Place. */
  action?: Exclude<LinkAction, { kind: 'page' }>;
}

/** A named view in the document that hyperlinks can jump to. */
export interface Place {
  id: string;
  name: string;
  pageIndex: number;
  rect: Rect | null;
}

/** Where a bookmark sits: its parent's children array and its index there. */
export interface TreePos {
  parentId: string | null;
  index: number;
}

export function findBookmark(tree: readonly Bookmark[], id: string): Bookmark | null {
  for (const b of tree) {
    if (b.id === id) return b;
    const hit = findBookmark(b.children, id);
    if (hit) return hit;
  }
  return null;
}

export function bookmarkPos(tree: readonly Bookmark[], id: string, parentId: string | null = null): TreePos | null {
  for (let i = 0; i < tree.length; i++) {
    const b = tree[i]!;
    if (b.id === id) return { parentId, index: i };
    const hit = bookmarkPos(b.children, id, b.id);
    if (hit) return hit;
  }
  return null;
}

/** Every bookmark depth-first, with its depth: the order the panel lists them. */
export function flattenBookmarks(tree: readonly Bookmark[], depth = 0): { bookmark: Bookmark; depth: number }[] {
  return tree.flatMap((b) => [{ bookmark: b, depth }, ...flattenBookmarks(b.children, depth + 1)]);
}

/** A copy of the tree with `fn` applied to the children array of `parentId` (null: the top level). */
function editChildren(tree: readonly Bookmark[], parentId: string | null, fn: (children: Bookmark[]) => Bookmark[]): Bookmark[] {
  if (parentId === null) return fn([...tree]);
  return tree.map((b) => (b.id === parentId ? { ...b, children: fn([...b.children]) } : { ...b, children: editChildren(b.children, parentId, fn) }));
}

/** Inserts `bookmark` at `pos` (by default, the end of the top level). */
export function insertBookmark(tree: readonly Bookmark[], bookmark: Bookmark, pos: TreePos = { parentId: null, index: Infinity }): Bookmark[] {
  return editChildren(tree, pos.parentId, (c) => {
    c.splice(Math.min(pos.index, c.length), 0, bookmark);
    return c;
  });
}

/** Removes a bookmark with everything under it. */
export function removeBookmark(tree: readonly Bookmark[], id: string): Bookmark[] {
  return tree.filter((b) => b.id !== id).map((b) => ({ ...b, children: removeBookmark(b.children, id) }));
}

export function updateBookmark(tree: readonly Bookmark[], id: string, patch: Partial<Omit<Bookmark, 'id' | 'children'>>): Bookmark[] {
  return tree.map((b) => (b.id === id ? { ...b, ...patch } : { ...b, children: updateBookmark(b.children, id, patch) }));
}

/** Moves a bookmark up or down among its siblings. */
export function shiftBookmark(tree: readonly Bookmark[], id: string, by: -1 | 1): Bookmark[] {
  const pos = bookmarkPos(tree, id);
  if (!pos) return [...tree];
  return editChildren(tree, pos.parentId, (c) => {
    const to = pos.index + by;
    if (to < 0 || to >= c.length) return c;
    [c[pos.index], c[to]] = [c[to]!, c[pos.index]!];
    return c;
  });
}

/** Makes a bookmark the last child of the sibling above it. */
export function indentBookmark(tree: readonly Bookmark[], id: string): Bookmark[] {
  const pos = bookmarkPos(tree, id);
  if (!pos || pos.index === 0) return [...tree];
  const b = findBookmark(tree, id)!;
  let prevId = '';
  const without = editChildren(tree, pos.parentId, (c) => {
    prevId = c[pos.index - 1]!.id;
    c.splice(pos.index, 1);
    return c;
  });
  return insertBookmark(without, b, { parentId: prevId, index: Infinity });
}

/** Moves a bookmark out of its parent, to just after it. */
export function outdentBookmark(tree: readonly Bookmark[], id: string): Bookmark[] {
  const pos = bookmarkPos(tree, id);
  if (!pos || pos.parentId === null) return [...tree];
  const parent = bookmarkPos(tree, pos.parentId)!;
  const b = findBookmark(tree, id)!;
  return insertBookmark(removeBookmark(tree, id), b, { parentId: parent.parentId, index: parent.index + 1 });
}

/**
 * Follows page operations: bookmarks move with their pages; one whose page was deleted goes, and
 * its children take its place.
 */
export function remapBookmarks(tree: readonly Bookmark[], to: (pageIndex: number) => number | null, rect: (pageIndex: number, r: Rect) => Rect): Bookmark[] {
  return tree.flatMap((b) => {
    const children = remapBookmarks(b.children, to, rect);
    const n = to(b.pageIndex);
    return n === null ? children : [{ ...b, pageIndex: n, rect: b.rect ? rect(b.pageIndex, b.rect) : null, children }];
  });
}

/** One bookmark per page, titled by its label (e.g. sheet number and title). */
export function bookmarksFromLabels(labels: readonly string[], newId: () => string): Bookmark[] {
  return labels.map((title, pageIndex) => ({ id: newId(), title, pageIndex, rect: null, children: [] }));
}

/** Where an action lands, resolving Places; null for web links and missing Places. */
export function actionTarget(action: LinkAction, places: readonly Place[]): { pageIndex: number; rect: Rect | null } | null {
  if (action.kind === 'page') return { pageIndex: action.pageIndex, rect: action.rect };
  if (action.kind === 'place') {
    const p = places.find((q) => q.id === action.placeId);
    return p ? { pageIndex: p.pageIndex, rect: p.rect } : null;
  }
  return null;
}

/** A short description of an action for tooltips and the markups list. */
export function describeAction(action: LinkAction, places: readonly Place[], pageLabel: (i: number) => string): string {
  if (action.kind === 'url') return action.url;
  if (action.kind === 'file') return `${action.label ?? `Page ${action.pageIndex + 1}`} in ${action.name}`;
  if (action.kind === 'place') return `Place: ${places.find((p) => p.id === action.placeId)?.name ?? '(missing)'}`;
  return `${action.rect && action.rect.w > 0 ? 'View on ' : ''}${pageLabel(action.pageIndex)}`;
}

/** Adds a scheme to bare web addresses ("example.com" → "https://example.com"). */
export function normalizeUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`;
  return `https://${u}`;
}
