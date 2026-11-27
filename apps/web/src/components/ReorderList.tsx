import { msg } from '@nb/i18n';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clickSelect, moveSelected, revealScroll, type ListSelection } from './listSelection';
import { useListDrag } from './useListDrag';

/** A listed item, with an id that stays with it as the list is reordered. */
type Row<T> = { id: number; item: T };

/**
 * An ordered list the user can rearrange, several rows at a time: by dragging, or with the buttons.
 * Holds the state for `ReorderList` and `ReorderButtons`.
 */
export function useReorderList<T>(initial: () => T[]) {
  const [rows, setRows] = useState<Row<T>[]>(() => initial().map((item, id) => ({ id, item })));
  const nextId = useRef(rows.length);
  const [selection, setSelection] = useState<ListSelection>(() => (rows.length ? { ids: new Set([0]), anchor: 0 } : { ids: new Set(), anchor: null }));
  const list = useRef<HTMLOListElement>(null);
  /** The direction of a move just made, so the list can scroll after it is redrawn. */
  const moved = useRef<-1 | 1 | null>(null);
  const picked = (row: Row<T>) => selection.ids.has(row.id);

  const drag = useListDrag({
    list,
    rows,
    setRows,
    // Picking up a selected row takes the whole selection; any other row is selected on its own.
    pickUp: (id) => {
      if (selection.ids.has(id)) return selection.ids;
      const ids = new Set([id]);
      setSelection({ ids, anchor: id });
      return ids;
    },
  });

  const click = (id: number, mods: { range: boolean; toggle: boolean }) => {
    if (!drag.wasDrag()) setSelection(clickSelect(rows.map((r) => r.id), selection, id, mods));
  };
  const add = (items: T[]) => setRows([...rows, ...items.map((item) => ({ id: nextId.current++, item }))]);
  const move = (by: -1 | 1) => {
    moved.current = by;
    drag.slide();
    setRows(moveSelected(rows, picked, by));
  };
  const remove = () => {
    const rest = rows.filter((row) => !picked(row));
    const next = rest[Math.max(0, rows.findIndex(picked) - 1)];
    setRows(rest);
    setSelection(next ? { ids: new Set([next.id]), anchor: next.id } : { ids: new Set(), anchor: null });
  };

  // Keep the moved rows in view, with the row beyond them so it is clear where they are going.
  const follow = () => {
    const by = moved.current;
    moved.current = null;
    const el = list.current;
    if (!by || !el) return;
    const items = [...el.children] as HTMLElement[];
    const chosen = items.flatMap((li, i) => (li.getAttribute('aria-selected') === 'true' ? [i] : []));
    if (!chosen.length) return;
    const first = items[Math.max(0, chosen[0]! - (by < 0 ? 1 : 0))]!;
    const last = items[Math.min(items.length - 1, chosen[chosen.length - 1]! + (by > 0 ? 1 : 0))]!;
    // Distances within the list's content. Only the vertical position changes, so a sideways scroll is kept.
    const origin = el.getBoundingClientRect().top + el.clientTop - el.scrollTop;
    el.scrollTop = revealScroll(el.scrollTop, el.clientHeight, first.getBoundingClientRect().top - origin, last.getBoundingClientRect().bottom - origin, by);
  };
  // After the order changes: scroll to follow a button move, then slide the rows to their new places.
  useLayoutEffect(() => {
    follow();
    drag.finishSlide();
  }, [rows]);

  return { items: rows.map((row) => row.item), rows, list, drag, picked, hasSelection: selection.ids.size > 0, click, add, move, remove };
}

type ReorderState<T> = ReturnType<typeof useReorderList<T>>;

interface ListProps<T> {
  state: ReorderState<T>;
  label: string;
  /** Shown when there is nothing listed. */
  empty: string;
  nameOf: (item: T) => string;
  /** A short note at the end of a row. */
  noteOf?: (item: T) => ReactNode;
}

export function ReorderList<T>({ state, label, empty, nameOf, noteOf }: ListProps<T>) {
  const { rows, drag, picked } = state;
  const carried = drag.preview && rows.find((row) => row.id === drag.preview!.id);
  return (
    <>
      <ol ref={state.list} className="reorder-list" role="listbox" aria-multiselectable="true" aria-label={label}>
        {rows.map((row) => (
          <li
            key={row.id}
            role="option"
            aria-selected={picked(row)}
            data-row
            className={[picked(row) && 'picked', drag.preview?.ids.has(row.id) && 'dragging'].filter(Boolean).join(' ')}
            // No tooltip during a drag, where it would cover the rows.
            title={drag.preview ? undefined : nameOf(row.item)}
            onPointerDown={(e) => drag.onPointerDown(e, row.id)}
            onClick={(e) => state.click(row.id, { range: e.shiftKey, toggle: e.ctrlKey || e.metaKey })}
          >
            <span className="grip" aria-hidden="true" />
            <span className="name">{nameOf(row.item)}</span>
            {noteOf && <span className="where">{noteOf(row.item)}</span>}
          </li>
        ))}
        {!rows.length && <li className="empty">{empty}</li>}
      </ol>
      {/* In the body, as a moved dialog's transform would offset a fixed element inside it. */}
      {drag.preview &&
        carried &&
        createPortal(
          <div
            ref={drag.ghost}
            className={drag.preview.ids.size > 1 ? 'reorder-ghost stacked' : 'reorder-ghost'}
            aria-hidden="true"
            style={{ translate: `${drag.preview.left}px ${drag.preview.top}px`, width: drag.preview.width, height: drag.preview.height }}
          >
            <span className="grip" />
            <span className="name">{nameOf(carried.item)}</span>
            {drag.preview.ids.size > 1 && <span className="count">{drag.preview.ids.size}</span>}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Move up, move down and remove, for the selected rows. */
export function ReorderButtons<T>({ state }: { state: ReorderState<T> }) {
  return (
    <>
      <button type="button" className="btn" disabled={!state.hasSelection} onClick={() => state.move(-1)} title={msg('Move up')}>
        ↑
      </button>
      <button type="button" className="btn" disabled={!state.hasSelection} onClick={() => state.move(1)} title={msg('Move down')}>
        ↓
      </button>
      <button type="button" className="btn" disabled={!state.hasSelection} onClick={state.remove}>
        {msg('Remove')}
      </button>
    </>
  );
}
