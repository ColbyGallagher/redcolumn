import { useState, type DragEvent } from 'react';
import { dropPositionFromPoint, nextSortDirection, type DropPosition, type SortDirection } from '../assemblies/ordering';

/** Six-dot grip icon for draggable rows and list items. */
export function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.15" />
      <circle cx="7" cy="3" r="1.15" />
      <circle cx="3" cy="7" r="1.15" />
      <circle cx="7" cy="7" r="1.15" />
      <circle cx="3" cy="11" r="1.15" />
      <circle cx="7" cy="11" r="1.15" />
    </svg>
  );
}

/**
 * Drag handle for table rows containing inputs: only the handle is `draggable`, so selecting text
 * inside inputs never triggers a drag, while `setDragImage` shows the full row while dragging.
 */
export function DragHandle({
  disabled,
  label,
  onDragStart,
  onDragEnd,
}: {
  disabled: boolean;
  label: string;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <span
      className={`drag-handle${disabled ? ' disabled' : ''}`}
      draggable={!disabled}
      role="img"
      aria-label={label}
      title={disabled ? undefined : 'Drag to reorder'}
      onDragStart={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        const row = e.currentTarget.closest('tr');
        if (row) e.dataTransfer.setDragImage(row, 16, Math.round(row.offsetHeight / 2));
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
    >
      <GripIcon />
    </span>
  );
}

/** Compact alphabetical sort toggle button (A–Z, or Z–A when already sorted A–Z). */
export function SortButton<T>({
  items,
  getName,
  disabled,
  noun,
  onSort,
}: {
  items: readonly T[];
  getName: (item: T) => string;
  disabled: boolean;
  /** Used for aria-label and tooltip, e.g. "assemblies", "items", "variables". */
  noun: string;
  onSort: (direction: SortDirection) => void;
}) {
  const next = nextSortDirection(items, getName);
  const label = next === 'asc' ? 'Sort A–Z' : 'Sort Z–A';
  return (
    <button
      type="button"
      className="btn small"
      disabled={disabled || items.length < 2}
      aria-label={`Sort ${noun} ${next === 'asc' ? 'A–Z' : 'Z–A'}`}
      title={`Sort ${noun} alphabetically (${next === 'asc' ? 'A–Z' : 'Z–A'})`}
      onClick={() => onSort(next)}
    >
      {label}
    </button>
  );
}

/**
 * Shared HTML5 drag-and-drop state for reordering a list of keys (ids or indices).
 * Pass `order` so exact-midpoint drops infer direction cleanly.
 */
export function useDragReorder<K extends string | number>(
  order: readonly K[],
  disabled: boolean,
  onReorder: (from: K, to: K, position: DropPosition) => void,
) {
  const [dragging, setDragging] = useState<K | null>(null);
  const [over, setOver] = useState<{ key: K; position: DropPosition } | null>(null);

  const clear = () => {
    setDragging(null);
    setOver(null);
  };

  const positionFor = (from: K, to: K, e: DragEvent<HTMLElement>): DropPosition => {
    const movingDown = order.indexOf(from) < order.indexOf(to);
    return dropPositionFromPoint(e.clientY, e.currentTarget.getBoundingClientRect(), movingDown);
  };

  const start = (key: K, e: DragEvent<HTMLElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    setDragging(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(key));
  };

  const targetProps = (key: K) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (disabled || dragging === null || dragging === key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const position = positionFor(dragging, key, e);
      setOver((prev) => (prev && prev.key === key && prev.position === position ? prev : { key, position }));
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setOver((prev) => (prev?.key === key ? null : prev));
      }
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (disabled || dragging === null || dragging === key) return;
      e.preventDefault();
      const position = positionFor(dragging, key, e);
      const from = dragging;
      clear();
      onReorder(from, key, position);
    },
  });

  const rowClass = (key: K) => {
    const classes: string[] = [];
    if (dragging === key) classes.push('dragging');
    if (over?.key === key) classes.push(over.position === 'before' ? 'drop-before' : 'drop-after');
    return classes.join(' ') || undefined;
  };

  return { dragging, start, end: clear, targetProps, rowClass };
}
