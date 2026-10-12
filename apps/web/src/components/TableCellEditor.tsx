import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cssFont, setTableCell, tableCellFormat, tableCellRect, tableCellStyle, tableOf, tableRegion, textColor, type Markup, type MarkupStore } from '@nb/markup';
import { useSettings } from '../settings/settings';
import type { TileViewer } from '../viewer/TileViewer';

const MIN_EDIT_FONT_PX = 13;

interface Props {
  markup: Markup;
  row: number;
  col: number;
  /** Text typed on the selected cell to start editing it: it replaces the cell's text, as in a spreadsheet. */
  typed?: string;
  store: MarkupStore;
  viewer: TileViewer;
  /** Finished; `to` is the cell to edit next (Tab, Shift+Tab, Enter), if any. */
  onDone: (to?: { row: number; col: number }) => void;
}

/**
 * In-place editor over one cell of a table. Commits on blur; Esc cancels. Tab and Shift+Tab move
 * along the cells, Enter moves down, and Shift+Enter starts a new line in the cell.
 */
export function TableCellEditor({ markup, row, col, typed, store, viewer, onDone }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const next = useRef<{ row: number; col: number } | undefined>(undefined);
  const { spellCheck } = useSettings();

  // A layout effect, so the editor has focus before the browser handles the next key.
  useLayoutEffect(() => {
    const el = ref.current;
    el?.focus();
    if (typed !== undefined) el?.setSelectionRange(el.value.length, el.value.length);
    else el?.select();
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const table = tableOf(markup);
  const cell = tableCellRect(markup, row, col);
  const [x0, y0] = viewer.pageToClient([cell.x, cell.y], markup.pageIndex);
  // The cell's own font, size and colour over the table's.
  const style = tableCellStyle(markup, row, col);
  const fontSize = style.fontSize ?? 12;
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
    const total = cols * table.rows.length;
    // The next cell along that is not covered by a merged cell.
    const along = (dir: 1 | -1) => {
      for (let i = row * cols + col + dir; i >= 0 && i < total; i += dir) {
        const r = Math.floor(i / cols);
        const g = tableRegion(table, r, i % cols);
        if (g.row === r && g.col === i % cols) return { row: r, col: i % cols };
      }
      return undefined;
    };
    if (e.key === 'Escape') {
      cancelled.current = true;
      e.currentTarget.blur();
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      move(e, along(e.shiftKey ? -1 : 1));
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      const below = row + tableRegion(table, row, col).rowSpan;
      const g = below < table.rows.length ? tableRegion(table, below, col) : null;
      move(e, g ? { row: g.row, col: g.col } : undefined);
    }
  };

  return (
    <textarea
      spellCheck={spellCheck}
      ref={ref}
      className="text-editor"
      aria-label={`Row ${row + 1}, column ${col + 1}`}
      defaultValue={typed ?? table.cells[row]?.[col] ?? ''}
      style={{
        left: x0,
        top: y0,
        width: cell.w * scale,
        height: cell.h * scale,
        font: cssFont(style, fontSize * scale),
        lineHeight: 1.2,
        textAlign: style.textAlign ?? 'left',
        textDecoration: style.underline ? 'underline' : undefined,
        padding: 4 * scale,
        color: textColor(style),
        background: tableCellFormat(markup, row, col).fill,
      }}
      onBlur={finish}
      onKeyDown={onKeyDown}
    />
  );
}
