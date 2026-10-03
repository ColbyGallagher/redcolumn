import { useState } from 'react';
import {
  bookmarkPos,
  bookmarksFromLabels,
  findBookmark,
  flattenBookmarks,
  indentBookmark,
  insertBookmark,
  outdentBookmark,
  removeBookmark,
  shiftBookmark,
  updateBookmark,
  type Bookmark,
  type Place,
  type Rect,
} from '@nb/markup';
import { InlineName } from './InlineName';

export interface ViewTarget {
  pageIndex: number;
  rect: Rect | null;
}

interface Props {
  bookmarks: readonly Bookmark[];
  places: readonly Place[];
  pageCount: number;
  currentPage: number;
  pageLabel: (pageIndex: number) => string;
  editable: boolean;
  onBookmarks: (tree: Bookmark[]) => void;
  onPlaces: (places: Place[]) => void;
  onGo: (target: ViewTarget) => void;
  /** Sets what the bookmark does: a page or view, a Place, a web page or another document. */
  onEditAction?: (id: string) => void;
  /** The page and area in view now, for new bookmarks and Places. */
  currentView: () => ViewTarget;
}

const newId = () => crypto.randomUUID();

/**
 * Bookmarks panel: the document outline, edited as a tree (add from the current view, rename,
 * nest, reorder, delete, generate from page labels), and the document's Places.
 */
export function BookmarksPanel({ bookmarks, places, pageCount, currentPage, pageLabel, editable, onBookmarks, onPlaces, onGo, currentView, onEditAction }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [placeSel, setPlaceSel] = useState<string | null>(null);
  const [renamingPlace, setRenamingPlace] = useState<string | null>(null);

  if (!pageCount) return <p className="empty">Open a PDF to see bookmarks.</p>;

  const sel = selected ? findBookmark(bookmarks, selected) : null;
  const pos = sel ? bookmarkPos(bookmarks, sel.id) : null;
  // Rows under a collapsed bookmark are hidden.
  const rows: { bookmark: Bookmark; depth: number }[] = [];
  let hideBelow = Infinity;
  for (const row of flattenBookmarks(bookmarks)) {
    if (row.depth > hideBelow) continue;
    hideBelow = collapsed.has(row.bookmark.id) ? row.depth : Infinity;
    rows.push(row);
  }

  const add = (child: boolean) => {
    const view = currentView();
    const b: Bookmark = { id: newId(), title: pageLabel(view.pageIndex), pageIndex: view.pageIndex, rect: view.rect, children: [] };
    const at = sel && pos ? (child ? { parentId: sel.id, index: Infinity } : { parentId: pos.parentId, index: pos.index + 1 }) : undefined;
    onBookmarks(insertBookmark(bookmarks, b, at));
    if (child && sel) setCollapsed(new Set([...collapsed].filter((id) => id !== sel.id)));
    setSelected(b.id);
    setRenaming(b.id);
  };
  const fromLabels = () => {
    if (bookmarks.length && !confirm('Replace the bookmarks with one per page, named by page label?')) return;
    onBookmarks(bookmarksFromLabels(Array.from({ length: pageCount }, (_, i) => pageLabel(i)), newId));
    setSelected(null);
  };
  const addPlace = () => {
    const view = currentView();
    const p: Place = { id: newId(), name: `Place ${places.length + 1}`, ...view };
    onPlaces([...places, p]);
    setPlaceSel(p.id);
    setRenamingPlace(p.id);
  };
  const place = places.find((p) => p.id === placeSel) ?? null;

  return (
    <div className="bookmarks-panel">
      {editable && (
        <div className="panel-toolbar">
          <button className="btn small" title="Add a bookmark to the current view, after the selected one" onClick={() => add(false)}>
            + Add
          </button>
          <button className="btn small" title="Add a bookmark under the selected one" disabled={!sel} onClick={() => add(true)}>
            + Child
          </button>
          <button className="btn small" title="Rename" disabled={!sel} onClick={() => setRenaming(sel!.id)}>
            ✎
          </button>
          <button className="btn small" title="Point the bookmark at the current view" disabled={!sel} onClick={() => onBookmarks(updateBookmark(bookmarks, sel!.id, currentView()))}>
            ⌖
          </button>
          {onEditAction && (
            <button className="btn small" title="Action: a page, a Place, a web page or another document" disabled={!sel} onClick={() => onEditAction(sel!.id)}>
              🔗
            </button>
          )}
          <button className="btn small" title="Move up" disabled={!pos || pos.index === 0} onClick={() => onBookmarks(shiftBookmark(bookmarks, sel!.id, -1))}>
            ↑
          </button>
          <button className="btn small" title="Move down" disabled={!sel} onClick={() => onBookmarks(shiftBookmark(bookmarks, sel!.id, 1))}>
            ↓
          </button>
          <button className="btn small" title="Nest under the bookmark above" disabled={!pos || pos.index === 0} onClick={() => onBookmarks(indentBookmark(bookmarks, sel!.id))}>
            →
          </button>
          <button className="btn small" title="Move out of its parent" disabled={!pos?.parentId} onClick={() => onBookmarks(outdentBookmark(bookmarks, sel!.id))}>
            ←
          </button>
          <button
            className="btn small"
            title="Delete the bookmark and those under it"
            disabled={!sel}
            onClick={() => {
              onBookmarks(removeBookmark(bookmarks, sel!.id));
              setSelected(null);
            }}
          >
            ×
          </button>
          <button className="btn small" title="Create a bookmark for every page from its page label" onClick={fromLabels}>
            From labels
          </button>
        </div>
      )}
      {!rows.length ? (
        <p className="empty">No bookmarks. {editable ? 'Add one for the current view, or create them from page labels.' : ''}</p>
      ) : (
        <ul className="bookmark-list bookmark-tree" role="tree">
          {rows.map(({ bookmark: b, depth }) => (
            <li key={b.id} role="treeitem" aria-level={depth + 1} aria-selected={b.id === selected} style={{ paddingLeft: depth * 14 }}>
              {b.children.length ? (
                <button
                  className="twisty"
                  aria-label={collapsed.has(b.id) ? 'Expand' : 'Collapse'}
                  onClick={() => {
                    const next = new Set(collapsed);
                    if (!next.delete(b.id)) next.add(b.id);
                    setCollapsed(next);
                  }}
                >
                  {collapsed.has(b.id) ? '▸' : '▾'}
                </button>
              ) : (
                <span className="twisty" />
              )}
              {renaming === b.id ? (
                <InlineName
                  initial={b.title}
                  placeholder="Bookmark title"
                  onDone={(title) => {
                    setRenaming(null);
                    if (title) onBookmarks(updateBookmark(bookmarks, b.id, { title }));
                  }}
                />
              ) : (
                <button
                  className={`bookmark${b.id === selected ? ' active' : ''}${b.pageIndex === currentPage ? ' current' : ''}`}
                  title={b.action ? (b.action.kind === 'url' ? b.action.url : b.action.kind === 'file' ? `${b.action.name}, page ${b.action.pageIndex + 1}` : 'A Place') : `${pageLabel(b.pageIndex)}${b.rect && b.rect.w > 0 ? ' (zoomed view)' : ''}`}
                  onClick={() => {
                    setSelected(b.id);
                    onGo(b);
                  }}
                  onDoubleClick={() => editable && setRenaming(b.id)}
                >
                  <span className="name">{b.title || '(untitled)'}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h4 className="panel-subhead">Places</h4>
      {editable && (
        <div className="panel-toolbar">
          <button className="btn small" title="Name the current view as a Place that hyperlinks can jump to" onClick={addPlace}>
            + Add Place
          </button>
          <button className="btn small" title="Rename" disabled={!place} onClick={() => setRenamingPlace(place!.id)}>
            ✎
          </button>
          <button
            className="btn small"
            title="Move the Place to the current view (links to it follow)"
            disabled={!place}
            onClick={() => onPlaces(places.map((p) => (p.id === place!.id ? { ...p, ...currentView() } : p)))}
          >
            ⌖
          </button>
          <button
            className="btn small"
            title="Delete the Place (links to it stop working)"
            disabled={!place}
            onClick={() => {
              onPlaces(places.filter((p) => p.id !== place!.id));
              setPlaceSel(null);
            }}
          >
            ×
          </button>
        </div>
      )}
      {!places.length ? (
        <p className="empty">No Places. A Place is a named view that hyperlinks jump to; move it and the links follow.</p>
      ) : (
        <ul className="bookmark-list">
          {places.map((p) => (
            <li key={p.id}>
              {renamingPlace === p.id ? (
                <InlineName
                  initial={p.name}
                  placeholder="Place name"
                  onDone={(name) => {
                    setRenamingPlace(null);
                    if (name) onPlaces(places.map((q) => (q.id === p.id ? { ...q, name } : q)));
                  }}
                />
              ) : (
                <button
                  className={`bookmark${p.id === placeSel ? ' active' : ''}`}
                  onClick={() => {
                    setPlaceSel(p.id);
                    onGo(p);
                  }}
                  onDoubleClick={() => editable && setRenamingPlace(p.id)}
                >
                  <span className="name">{p.name}</span>
                  <span className="num">{pageLabel(p.pageIndex)}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
