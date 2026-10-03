import { useMemo, useState } from 'react';
import { spaceName, spacesContaining, spaceTree, type Markup } from '@nb/markup';
import { formatArea, polygonArea, type Scale } from '@nb/measure';
import { InlineName } from './InlineName';

interface Props {
  /** Every markup in the document (Spaces and the markups inside them). */
  markups: readonly Markup[];
  selected: ReadonlySet<string>;
  pageLabel: (pageIndex: number) => string;
  scaleOf: (m: Markup) => Scale;
  editable: boolean;
  showSpaces: boolean;
  onShowSpaces: (show: boolean) => void;
  onSelect: (m: Markup) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Spaces panel: the document's rooms and zones as a tree (a room inside its floor), each with its
 * area and how many markups are in it. Markups belong to the Spaces around them; the Markups
 * list's Space column names them.
 */
export function SpacesPanel({ markups, selected, pageLabel, scaleOf, editable, showSpaces, onShowSpaces, onSelect, onAdd, onRename, onDelete }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const spaces = useMemo(() => markups.filter((m) => m.type === 'space'), [markups]);
  const rows = useMemo(() => spaceTree(spaces), [spaces]);
  // Markups (not Spaces) in each Space, nested ones included.
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const m of markups) {
      if (m.type === 'space') continue;
      for (const s of spacesContaining(m, spaces)) out.set(s.id, (out.get(s.id) ?? 0) + 1);
    }
    return out;
  }, [markups, spaces]);
  const sel = rows.find((r) => selected.has(r.space.id))?.space ?? null;

  return (
    <div className="spaces-panel">
      <div className="panel-toolbar">
        {editable && (
          <>
            <button className="btn small" title="Click the outline of a room or zone" onClick={onAdd}>
              + Add Space
            </button>
            <button className="btn small" title="Rename" disabled={!sel} onClick={() => setRenaming(sel!.id)}>
              ✎
            </button>
            <button className="btn small" title="Delete the Space (its markups stay)" disabled={!sel} onClick={() => onDelete(sel!.id)}>
              ×
            </button>
          </>
        )}
        <label className="field">
          <input type="checkbox" checked={showSpaces} onChange={(e) => onShowSpaces(e.target.checked)} />
          Show
        </label>
      </div>
      {!rows.length ? (
        <p className="empty">No Spaces. A Space is a named room or zone; markups inside it are grouped by it in the Markups list.</p>
      ) : (
        <ul className="bookmark-list bookmark-tree">
          {rows.flatMap(({ space: s, depth }, i) => [
            ...(i === 0 || rows[i - 1]!.space.pageIndex !== s.pageIndex
              ? [
                  <li key={`page-${s.pageIndex}`} className="space-page">
                    {pageLabel(s.pageIndex)}
                  </li>,
                ]
              : []),
            <li key={s.id} style={{ paddingLeft: depth * 14 }}>
              {renaming === s.id ? (
                <InlineName
                  initial={spaceName(s)}
                  placeholder="Space name"
                  onDone={(name) => {
                    setRenaming(null);
                    if (name) onRename(s.id, name);
                  }}
                />
              ) : (
                <button
                  className={`bookmark space-row${selected.has(s.id) ? ' active' : ''}`}
                  onClick={() => onSelect(s)}
                  onDoubleClick={() => editable && setRenaming(s.id)}
                >
                  <span className="swatch" style={{ background: s.style.fill ?? s.style.stroke }} />
                  <span className="name">{spaceName(s)}</span>
                  <span className="num" title="Markups in this Space">
                    {counts.get(s.id) ?? 0}
                  </span>
                  <span className="area">{formatArea(polygonArea(s.points) * scaleOf(s).metersPerPoint ** 2, scaleOf(s))}</span>
                </button>
              )}
            </li>,
          ])}
        </ul>
      )}
    </div>
  );
}
