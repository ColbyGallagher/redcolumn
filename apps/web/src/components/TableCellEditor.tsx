import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cssFont, setTableCell, tableCellRect, tableOf, textColor, type Markup, type MarkupStore } from '@nb/markup';
import { useSettings } from '../settings/settings';
import type { TileViewer } from '../viewer/TileViewer';

const MIN_EDIT_FONT_PX = 13;

interface Props {
  markup: Markup;
  row: number;
  col: number;
  store: MarkupStore;
  viewer: TileViewer;
  /** Finished; `to` is the cell to edit next (Tab, Shift+Tab, Enter), if any. */
  onDone: (to?: { row: number; col: number }) => void;
}

/**
 * In-place editor over one cell of a table. Commits on blur; Esc cancels. Tab and Shift+Tab move
 * along the cells, Enter moves down, and Shift+Enter starts a new line in the cell.
 */
export function TableCellEditor({ markup, row, col, store, viewer, onDone }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const next = useRef<{ row: number; col: number } | undefined>(undefined);
  const { spellCheck } = useSettings();

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const table = tableOf(markup);
  const cell = tableCellRect(markup, row, col);
  const [x0, y0] = viewer.pageToClient([cell.x, cell.y], markup.pageIndex);
  const fontSize = markup.style.fontSize ?? 12;
  // When zoomed out, enlarge the editor so the text being typed stays readable.
  const scale = Math.max(viewer.zoomFor(markup.pageIndex), MIN_EDIT_FONT_PX / fontSize);

  const finish = () => {
    const text = ref.current?.value ?? '';
    const live = store.get(markup.id);
    if (!cancelled.current && live && text !== (tableOf(live).cells[row]?.[col] ?? '')) store.update(markup.id, { table: setTableCell(live, row, col, text) });
    onDone(cancelled.current ? undefined : next.current);
  };

  const move = (e: ReactKeyboardEvent<HTMLTextAreaElement>, to: { row: number; col: number } | undefined) => {
    e.preventDefault();
    next.current = to;
    e.currentTarget.blur();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    const cols = table.cols.length;
    const index = row * cols + col;
    const at = (i: number) => (i >= 0 && i < cols * table.rows.length ? { row: Math.floor(i / cols), col: i % cols } : undefined);
    if (e.key === 'Escape') {
      cancelled.current = true;
      e.currentTarget.blur();
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      move(e, at(index + (e.shiftKey ? -1 : 1)));
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      move(e, row + 1 < table.rows.length ? { row: row + 1, col } : undefined);
    }
  };

  return (
    <textarea
      spellCheck={spellCheck}
      ref={ref}
      className="text-editor"
      aria-label={`Row ${row + 1}, column ${col + 1}`}
      defaultValue={table.cells[row]?.[col] ?? ''}
      style={{
        left: x0,
        top: y0,
        width: cell.w * scale,
        height: cell.h * scale,
        font: cssFont(markup.style, fontSize * scale),
        lineHeight: 1.2,
        textAlign: markup.style.textAlign ?? 'left',
        textDecoration: markup.style.underline ? 'underline' : undefined,
        padding: 4 * scale,
        color: textColor(markup.style),
      }}
      onBlur={finish}
      onKeyDown={onKeyDown}
    />
  );
}
