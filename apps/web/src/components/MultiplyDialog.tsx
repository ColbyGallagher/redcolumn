import { useState } from 'react';
import { METERS_PER_UNIT, parseLength, type Scale } from '@nb/measure';

interface Props {
  /** The page scale spacing is entered in (page units when the page has no scale). */
  scale: Scale;
  onApply: (rows: number, columns: number, gapX: number, gapY: number) => void;
  onCancel: () => void;
}

const MAX_COPIES = 400;

/** Spacing typed in the scale's unit, in PDF points; 0 is allowed (copies touching). */
function gapPoints(text: string, scale: Scale): number | null {
  if (/^\s*0*\.?0*\s*$/.test(text) && text.trim() !== '.') return 0;
  const value = parseLength(text, scale.unit);
  return value === null ? null : (value * METERS_PER_UNIT[scale.unit]) / scale.metersPerPoint;
}

/** Edit → Multiply: copies the selected markups into a grid of rows and columns. */
export function MultiplyDialog({ scale, onApply, onCancel }: Props) {
  const [rows, setRows] = useState(1);
  const [columns, setColumns] = useState(3);
  const [gapX, setGapX] = useState('0');
  const [gapY, setGapY] = useState('0');
  const gx = gapPoints(gapX, scale);
  const gy = gapPoints(gapY, scale);
  const copies = rows * columns - 1;
  const valid = gx !== null && gy !== null && rows >= 1 && columns >= 1 && copies >= 1 && copies <= MAX_COPIES;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onApply(rows, columns, gx, gy);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Multiply</h3>
        <p>Copies the selection into a grid. The original is the top-left copy.</p>
        <div className="form-grid">
          <label htmlFor="mult-cols">Columns</label>
          <input id="mult-cols" type="number" min={1} max={100} value={columns} onChange={(e) => setColumns(Math.max(1, Math.floor(Number(e.target.value) || 1)))} autoFocus />
          <label htmlFor="mult-gapx">Horizontal spacing ({scale.unit})</label>
          <input id="mult-gapx" value={gapX} onChange={(e) => setGapX(e.target.value)} aria-invalid={gx === null} />
          <label htmlFor="mult-rows">Rows</label>
          <input id="mult-rows" type="number" min={1} max={100} value={rows} onChange={(e) => setRows(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          <label htmlFor="mult-gapy">Vertical spacing ({scale.unit})</label>
          <input id="mult-gapy" value={gapY} onChange={(e) => setGapY(e.target.value)} aria-invalid={gy === null} />
        </div>
        <p className="pref-hint">
          Spacing is the gap between neighbouring copies, measured at the page scale ({scale.label}).
          {copies > MAX_COPIES ? ` At most ${MAX_COPIES} copies at a time.` : ''}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            Make {Math.max(0, copies)} {copies === 1 ? 'copy' : 'copies'}
          </button>
        </div>
      </form>
    </div>
  );
}
