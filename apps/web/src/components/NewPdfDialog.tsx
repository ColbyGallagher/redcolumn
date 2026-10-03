import { useState } from 'react';
import { PAGE_SIZES, presetFor } from '../documents/pageSizes';

export interface BlankPagesRequest {
  width: number;
  height: number;
  count: number;
  /** Blank pages mode: insert before this page index (the page count appends). */
  at: number;
}

interface Props {
  /** `new`: File → New PDF. `blank`: Document → Insert → Blank Pages. */
  mode: 'new' | 'blank';
  /** The current page (blank mode): its size is offered, and pages go before or after it. */
  current?: { index: number; count: number; width: number; height: number };
  onApply: (req: BlankPagesRequest) => void;
  onCancel: () => void;
}

const CUSTOM = 'custom';
const SAME = 'same';

/** Choose a page size, orientation and count for a new PDF or for blank pages. */
export function NewPdfDialog({ mode, current, onApply, onCancel }: Props) {
  const [size, setSize] = useState(current ? SAME : 'letter');
  const [landscape, setLandscape] = useState(false);
  const [custom, setCustom] = useState({ w: '8.5', h: '11', unit: 'in' as 'in' | 'mm' });
  const [count, setCount] = useState(1);
  const [where, setWhere] = useState<'after' | 'before' | 'end'>('after');

  const base = (() => {
    if (size === SAME && current) return { width: current.width, height: current.height };
    if (size === CUSTOM) {
      const k = custom.unit === 'in' ? 72 : 72 / 25.4;
      return { width: Number(custom.w) * k, height: Number(custom.h) * k };
    }
    const p = PAGE_SIZES.find((x) => x.id === size) ?? PAGE_SIZES[0]!;
    return { width: p.width, height: p.height };
  })();
  // The current page keeps its own orientation; presets follow the orientation choice.
  const turned = size !== SAME && landscape !== base.width > base.height;
  const width = turned ? base.height : base.width;
  const height = turned ? base.width : base.height;
  const valid = width >= 18 && height >= 18 && width <= 14400 && height <= 14400 && count >= 1 && count <= 500;
  const at = !current ? 0 : where === 'before' ? current.index : where === 'after' ? current.index + 1 : current.count;
  const sameLabel = current ? `Same as page ${current.index + 1} (${presetFor(current.width, current.height)?.label ?? `${(current.width / 72).toFixed(2)} × ${(current.height / 72).toFixed(2)} in`})` : '';

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onApply({ width, height, count, at });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>{mode === 'new' ? 'New PDF' : 'Insert Blank Pages'}</h3>
        <div className="form-grid">
          <label htmlFor="np-size">Page size</label>
          <select id="np-size" value={size} onChange={(e) => setSize(e.target.value)} autoFocus>
            {current && <option value={SAME}>{sameLabel}</option>}
            {PAGE_SIZES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
          {size === CUSTOM && (
            <>
              <label htmlFor="np-w">Width × height</label>
              <div className="row">
                <input id="np-w" value={custom.w} onChange={(e) => setCustom({ ...custom, w: e.target.value })} aria-invalid={!(Number(custom.w) > 0)} />
                <input aria-label="Height" value={custom.h} onChange={(e) => setCustom({ ...custom, h: e.target.value })} aria-invalid={!(Number(custom.h) > 0)} />
                <select aria-label="Unit" value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: e.target.value as 'in' | 'mm' })}>
                  <option value="in">in</option>
                  <option value="mm">mm</option>
                </select>
              </div>
            </>
          )}
          {size !== SAME && (
            <>
              <span>Orientation</span>
              <div className="row">
                <label className="check">
                  <input type="radio" name="np-orient" checked={!landscape} onChange={() => setLandscape(false)} /> Portrait
                </label>
                <label className="check">
                  <input type="radio" name="np-orient" checked={landscape} onChange={() => setLandscape(true)} /> Landscape
                </label>
              </div>
            </>
          )}
          <label htmlFor="np-count">Pages</label>
          <input id="np-count" type="number" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          {mode === 'blank' && current && (
            <>
              <label htmlFor="np-where">Insert</label>
              <select id="np-where" value={where} onChange={(e) => setWhere(e.target.value as typeof where)}>
                <option value="after">After page {current.index + 1}</option>
                <option value="before">Before page {current.index + 1}</option>
                <option value="end">At the end</option>
              </select>
            </>
          )}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            {mode === 'new' ? 'Create' : 'Insert'}
          </button>
        </div>
      </form>
    </div>
  );
}
