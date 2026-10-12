import { useState } from 'react';
import { clampLines, MAX_TABLE_LINES } from '@nb/markup';

interface Props {
  onApply: (rows: number, columns: number) => void;
  onCancel: () => void;
}

/** The size of the last table made, offered again for the next one. */
let lastSize = { rows: 3, columns: 3 };

/** Tools › Table: how many rows and columns the table just drawn has. */
export function TableDialog({ onApply, onCancel }: Props) {
  const [rows, setRows] = useState(String(lastSize.rows));
  const [columns, setColumns] = useState(String(lastSize.columns));
  const valid = (text: string) => /^\d+$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= MAX_TABLE_LINES;
  const ok = valid(rows) && valid(columns);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          lastSize = { rows: clampLines(Number(rows)), columns: clampLines(Number(columns)) };
          onApply(lastSize.rows, lastSize.columns);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Table</h3>
        <p>Click a cell to select it and double-click to type in it. Drag the lines to resize, drag across cells and right-click to merge them, or right-click to insert or delete rows and columns.</p>
        <div className="form-grid">
          <label htmlFor="table-rows">Rows</label>
          <input id="table-rows" type="number" inputMode="numeric" min={1} max={MAX_TABLE_LINES} value={rows} onChange={(e) => setRows(e.target.value)} aria-invalid={!valid(rows)} autoFocus onFocus={(e) => e.currentTarget.select()} />
          <label htmlFor="table-cols">Columns</label>
          <input id="table-cols" type="number" inputMode="numeric" min={1} max={MAX_TABLE_LINES} value={columns} onChange={(e) => setColumns(e.target.value)} aria-invalid={!valid(columns)} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <p className="pref-hint">Up to {MAX_TABLE_LINES} of each.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok}>
            Add Table
          </button>
        </div>
      </form>
    </div>
  );
}
