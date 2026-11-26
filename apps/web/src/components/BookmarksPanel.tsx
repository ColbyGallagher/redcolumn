import { msg } from '@nb/i18n';
import { useRef, useState } from 'react';
import {
  applyBookmarkTemplate,
  bookmarkPos,
  bookmarksFromLabels,
  DEFAULT_BOOKMARK_TEMPLATE,
  filterBookmarkRows,
  findBookmark,
  flattenBookmarks,
  indentBookmark,
  insertBookmark,
  outdentBookmark,
  removeBookmark,
  shiftBookmark,
  updateBookmark,
  type Bookmark,
  type BookmarkTemplate,
  type Place,
  type Rect,
} from '@nb/markup';
import { importRevuFiles } from '../toolchest/revuLibraries';
import { useWorkspace } from '../workspace/profiles';
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
  /** Opens Page Labels from Regions set to name bookmarks from boxes drawn on the page. */
  onFromRegions?: () => void;
  /** The page and area in view now, for new bookmarks and Places. */
  currentView: () => ViewTarget;
}

const newId = () => crypto.randomUUID();

/**
 * Bookmarks panel: the document outline, edited as a tree (add from the current view, rename,
 * nest, reorder, delete, generate from page labels), and the document's Places.
 */
export function BookmarksPanel({ bookmarks, places, pageCount, currentPage, pageLabel, editable, onBookmarks, onPlaces, onGo, currentView, onEditAction, onFromRegions }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [placeSel, setPlaceSel] = useState<string | null>(null);
  const [renamingPlace, setRenamingPlace] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const { bookmarkTemplates } = useWorkspace();
  const templates = [DEFAULT_BOOKMARK_TEMPLATE, ...bookmarkTemplates.filter((t) => t.name !== DEFAULT_BOOKMARK_TEMPLATE.name)];

  if (!pageCount) return <p className="empty">{msg('Open a PDF to see bookmarks.')}</p>;

  const sel = selected ? findBookmark(bookmarks, selected) : null;
  const pos = sel ? bookmarkPos(bookmarks, sel.id) : null;
  const trimmedQuery = query.trim();
  const filtering = trimmedQuery.length > 0;
  // When filtering, use filterBookmarkRows without mutating `collapsed` so clearing restores it.
  const rows: { bookmark: Bookmark; depth: number; matched: boolean }[] = [];
  if (filtering) {
    rows.push(...filterBookmarkRows(bookmarks, trimmedQuery, pageLabel));
  } else {
    // Rows under a collapsed bookmark are hidden.
    let hideBelow = Infinity;
    for (const row of flattenBookmarks(bookmarks)) {
      if (row.depth > hideBelow) continue;
      hideBelow = collapsed.has(row.bookmark.id) ? row.depth : Infinity;
      rows.push({ ...row, matched: true });
    }
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
    if (bookmarks.length && !confirm(msg('Replace the bookmarks with one per page, named by page label?'))) return;
    onBookmarks(bookmarksFromLabels(Array.from({ length: pageCount }, (_, i) => pageLabel(i)), newId));
    setSelected(null);
  };
  const applyTemplate = (t: BookmarkTemplate) => {
    if (bookmarks.length && !confirm(msg('Replace the bookmarks with the "{name}" template?', { name: t.name }))) return;
    const { tree, unmatched } = applyBookmarkTemplate(t, Array.from({ length: pageCount }, (_, i) => ({ pageIndex: i, label: pageLabel(i) })), newId);
    onBookmarks(tree);
    setSelected(null);
    setNote(
      tree.length
        ? msg('Filed {filed} of {total} pages under "{name}".', { filed: pageCount - unmatched.length, total: pageCount, name: t.name }) +
            (unmatched.length
              ? ' ' +
                msg('{count, plural, one {# had} other {# had}} no sheet number that fits: {pages}.', {
                  count: unmatched.length,
                  pages: unmatched.slice(0, 5).map((i) => pageLabel(i) || msg('page {page}', { page: i + 1 })).join(', ') + (unmatched.length > 5 ? '…' : ''),
                })
              : '')
        : msg('No page has a sheet number that fits "{name}" (pages are filed by numbers like A-101 or C-205).', { name: t.name }),
    );
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
          <button className="btn small" title={msg('Add a bookmark to the current view, after the selected one')} onClick={() => add(false)}>
            {msg('+ Add')}
          </button>
          <button className="btn small" title={msg('Add a bookmark under the selected one')} disabled={!sel} onClick={() => add(true)}>
            {msg('+ Child')}
          </button>
          <button className="btn small" title={msg('Rename')} disabled={!sel} onClick={() => setRenaming(sel!.id)}>
            ✎
          </button>
          <button className="btn small" title={msg('Point the bookmark at the current view')} disabled={!sel} onClick={() => onBookmarks(updateBookmark(bookmarks, sel!.id, currentView()))}>
            ⌖
          </button>
          {onEditAction && (
            <button className="btn small" title={msg('Action: a page, a Place, a web page or another document')} disabled={!sel} onClick={() => onEditAction(sel!.id)}>
              🔗
            </button>
          )}
          <button className="btn small" title={msg('Move up')} disabled={!pos || pos.index === 0} onClick={() => onBookmarks(shiftBookmark(bookmarks, sel!.id, -1))}>
            ↑
          </button>
          <button className="btn small" title={msg('Move down')} disabled={!sel} onClick={() => onBookmarks(shiftBookmark(bookmarks, sel!.id, 1))}>
            ↓
          </button>
          <button className="btn small" title={msg('Nest under the bookmark above')} disabled={!pos || pos.index === 0} onClick={() => onBookmarks(indentBookmark(bookmarks, sel!.id))}>
            →
          </button>
          <button className="btn small" title={msg('Move out of its parent')} disabled={!pos?.parentId} onClick={() => onBookmarks(outdentBookmark(bookmarks, sel!.id))}>
            ←
          </button>
          <button
            className="btn small"
            title={msg('Delete the bookmark and those under it')}
            disabled={!sel}
            onClick={() => {
              onBookmarks(removeBookmark(bookmarks, sel!.id));
              setSelected(null);
            }}
          >
            ×
          </button>
          <button className="btn small" title={msg('Create a bookmark for every page from its page label')} onClick={fromLabels}>
            {msg('From labels')}
          </button>
          {onFromRegions && (
            <button className="btn small" title={msg('Name a bookmark for every page from the text in boxes you draw on the title block')} onClick={onFromRegions}>
              {msg('From regions…')}
            </button>
          )}
          <select
            className="btn small"
            aria-label={msg('Bookmark template')}
            title={msg('File the pages under a bookmark template, by their sheet numbers')}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'import') importRef.current?.click();
              else applyTemplate(templates.find((t) => t.name === v.slice(2))!);
            }}
          >
            <option value="" disabled>
              {msg('Template…')}
            </option>
            {templates.map((t) => (
              <option key={t.name} value={`t:${t.name}`}>
                {msg('Apply {name}', { name: t.name })}
              </option>
            ))}
            <option value="import">{msg('Import template…')}</option>
          </select>
          <input
            ref={importRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) void importRevuFiles(files).then(setNote);
            }}
          />
        </div>
      )}
      <div className="bookmark-filter">
        <input
          type="text"
          placeholder={msg('Filter bookmarks…')}
          aria-label={msg('Filter bookmarks…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              setQuery('');
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="btn small bookmark-filter-clear"
            aria-label={msg('Clear bookmark filter')}
            title={msg('Clear')}
            onClick={() => setQuery('')}
          >
            ×
          </button>
        )}
      </div>
      {note && (
        <p className="pref-hint" role="status" onClick={() => setNote(null)}>
          {note}
        </p>
      )}
      {!rows.length ? (
        <p className="empty">
          {filtering
            ? msg('No bookmarks match "{query}".', { query: trimmedQuery })
            : editable
              ? msg('No bookmarks. Add one for the current view, or create them from page labels or from boxes on the title block.')
              : msg('No bookmarks.')}
        </p>
      ) : (
        <ul className="bookmark-list bookmark-tree" role="tree">
          {rows.map(({ bookmark: b, depth, matched }) => (
            <li key={b.id} role="treeitem" aria-level={depth + 1} aria-selected={b.id === selected} style={{ paddingLeft: depth * 14 }}>
              {b.children.length ? (
                filtering ? (
                  <span className="twisty" aria-hidden="true">▾</span>
                ) : (
                  <button
                    className="twisty"
                    aria-label={collapsed.has(b.id) ? msg('Expand') : msg('Collapse')}
                    onClick={() => {
                      const next = new Set(collapsed);
                      if (!next.delete(b.id)) next.add(b.id);
                      setCollapsed(next);
                    }}
                  >
                    {collapsed.has(b.id) ? '▸' : '▾'}
                  </button>
                )
              ) : (
                <span className="twisty" />
              )}
              {renaming === b.id ? (
                <InlineName
                  initial={b.title}
                  placeholder={msg('Bookmark title')}
                  onDone={(title) => {
                    setRenaming(null);
                    if (title) onBookmarks(updateBookmark(bookmarks, b.id, { title }));
                  }}
                />
              ) : (
                <button
                  className={`bookmark${b.id === selected ? ' active' : ''}${b.pageIndex === currentPage ? ' current' : ''}${!matched ? ' ancestor' : ''}`}
                  title={b.action ? (b.action.kind === 'url' ? b.action.url : b.action.kind === 'file' ? msg('{name}, page {page}', { name: b.action.name, page: b.action.pageIndex + 1 }) : msg('A Place')) : b.rect && b.rect.w > 0 ? msg('{page} (zoomed view)', { page: pageLabel(b.pageIndex) }) : pageLabel(b.pageIndex)}
                  onClick={() => {
                    setSelected(b.id);
                    onGo(b);
                  }}
                  onDoubleClick={() => editable && setRenaming(b.id)}
                >
                  <span className="name">{b.title || msg('(untitled)')}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h4 className="panel-subhead">{msg('Places')}</h4>
      {editable && (
        <div className="panel-toolbar">
          <button className="btn small" title={msg('Name the current view as a Place that hyperlinks can jump to')} onClick={addPlace}>
            {msg('+ Add Place')}
          </button>
          <button className="btn small" title={msg('Rename')} disabled={!place} onClick={() => setRenamingPlace(place!.id)}>
            ✎
          </button>
          <button
            className="btn small"
            title={msg('Move the Place to the current view (links to it follow)')}
            disabled={!place}
            onClick={() => onPlaces(places.map((p) => (p.id === place!.id ? { ...p, ...currentView() } : p)))}
          >
            ⌖
          </button>
          <button
            className="btn small"
            title={msg('Delete the Place (links to it stop working)')}
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
        <p className="empty">{msg('No Places. A Place is a named view that hyperlinks jump to; move it and the links follow.')}</p>
      ) : (
        <ul className="bookmark-list">
          {places.map((p) => (
            <li key={p.id}>
              {renamingPlace === p.id ? (
                <InlineName
                  initial={p.name}
                  placeholder={msg('Place name')}
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
