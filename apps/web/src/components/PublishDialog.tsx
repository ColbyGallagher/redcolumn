import { useState } from 'react';
import { parsePageRange } from '../documents/printPdf';

export type PublishRequest =
  | { kind: 'pdf'; flatten: boolean; reduce: boolean; quality: number; clean: boolean }
  | { kind: 'images'; format: 'png' | 'jpeg'; dpi: number; pages: number[]; markups: boolean };

interface Props {
  mode: 'pdf' | 'images';
  pageCount: number;
  currentPage: number;
  busy: boolean;
  onRun: (req: PublishRequest) => void;
  onClose: () => void;
}

/**
 * File › Publish (a copy to hand out: markups flattened, smaller, cleanly rewritten) and File ›
 * Export › Page Images (PNG or JPEG, with or without markups).
 */
export function PublishDialog({ mode, pageCount, currentPage, busy, onRun, onClose }: Props) {
  const [flatten, setFlatten] = useState(true);
  const [reduce, setReduce] = useState(false);
  const [quality, setQuality] = useState(70);
  const [clean, setClean] = useState(true);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [dpi, setDpi] = useState(150);
  const [range, setRange] = useState<'all' | 'current' | 'range'>('current');
  const [rangeText, setRangeText] = useState(`1-${pageCount}`);
  const [markups, setMarkups] = useState(true);
  const pages = range === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : range === 'current' ? [currentPage] : parsePageRange(rangeText, pageCount);
  const valid = mode === 'pdf' || (pages !== null && pages.length > 0 && dpi >= 36 && dpi <= 600);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal publish-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          if (mode === 'pdf') onRun({ kind: 'pdf', flatten, reduce, quality: quality / 100, clean });
          else onRun({ kind: 'images', format, dpi, pages: pages!, markups });
        }}
      >
        {mode === 'pdf' ? (
          <>
            <h3>Publish</h3>
            <p>Saves a copy to hand out. The document here is not changed.</p>
            <label className="field">
              <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
              Flatten markups (part of the drawing; they cannot be edited or removed)
            </label>
            <label className="field">
              <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} />
              Remove editing history (write the file again from scratch)
            </label>
            <label className="field">
              <input type="checkbox" checked={reduce} onChange={(e) => setReduce(e.target.checked)} />
              Compress pictures
            </label>
            {reduce && (
              <label className="field">
                JPEG quality
                <input type="range" min={30} max={95} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                {quality}%
              </label>
            )}
          </>
        ) : (
          <>
            <h3>Export Page Images</h3>
            <div className="form-grid">
              <label>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg')}>
                <option value="png">PNG (sharp lines)</option>
                <option value="jpeg">JPEG (smaller)</option>
              </select>
              <label>Resolution</label>
              <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                {[72, 96, 150, 200, 300, 400].map((d) => (
                  <option key={d} value={d}>
                    {d} dpi
                  </option>
                ))}
              </select>
              <label>Pages</label>
              <span className="radio-row">
                <label>
                  <input type="radio" checked={range === 'current'} onChange={() => setRange('current')} /> Current
                </label>
                <label>
                  <input type="radio" checked={range === 'all'} onChange={() => setRange('all')} /> All ({pageCount})
                </label>
                <label>
                  <input type="radio" checked={range === 'range'} onChange={() => setRange('range')} />
                  <input value={rangeText} onChange={(e) => setRangeText(e.target.value)} onFocus={() => setRange('range')} aria-invalid={range === 'range' && !pages} style={{ width: 90 }} />
                </label>
              </span>
            </div>
            <label className="field">
              <input type="checkbox" checked={markups} onChange={(e) => setMarkups(e.target.checked)} />
              Include markups
            </label>
            <p className="pref-hint">Several pages are saved together in a .zip.</p>
          </>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid || busy}>
            {busy ? 'Working…' : mode === 'pdf' ? 'Publish' : 'Export'}
          </button>
        </div>
      </form>
    </div>
  );
}
