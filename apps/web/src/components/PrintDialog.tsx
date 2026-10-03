import { useState } from 'react';
import { PAPER_SIZES, parsePageRange, type PrintContent, type PrintOptions } from '../documents/printPdf';

interface Props {
  pageCount: number;
  currentPage: number;
  onPrint: (content: PrintContent, pages: number[], options: PrintOptions & { dimFiltered: boolean }) => Promise<void>;
  /** The Markups list is filtered (so filtered-out markups can print dimmed). */
  filtering?: boolean;
  onCancel: () => void;
}

type Which = 'all' | 'current' | 'range';

/**
 * File › Print: what to print (document with markups, document only, markups only) and which
 * pages. Paper, copies, scaling and orientation are chosen in the browser's print dialog next.
 */
export function PrintDialog({ pageCount, currentPage, onPrint, onCancel, filtering = false }: Props) {
  const [reverse, setReverse] = useState(false);
  const [tile, setTile] = useState(false);
  const [paper, setPaper] = useState('Letter');
  const [dimFiltered, setDimFiltered] = useState(true);
  const [content, setContent] = useState<PrintContent>('all');
  const [which, setWhich] = useState<Which>('all');
  const [range, setRange] = useState(`${currentPage + 1}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pages = which === 'all' ? parsePageRange('', pageCount) : which === 'current' ? [currentPage] : parsePageRange(range, pageCount);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal print-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!pages?.length || busy) return;
          setBusy(true);
          setError(null);
          const [w, h] = PAPER_SIZES[paper]!;
          onPrint(content, pages, { reverse, tile: tile ? { width: w, height: h, overlap: 18 } : null, dimFiltered: filtering && dimFiltered }).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
      >
        <h3>Print</h3>
        <fieldset>
          <legend>Print</legend>
          {(
            [
              ['all', 'Document and markups'],
              ['document', 'Document only'],
              ['markups', 'Markups only'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="row">
              <input type="radio" name="content" checked={content === value} onChange={() => setContent(value)} autoFocus={value === 'all'} />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Pages</legend>
          <label className="row">
            <input type="radio" name="which" checked={which === 'all'} onChange={() => setWhich('all')} />
            All {pageCount} pages
          </label>
          <label className="row">
            <input type="radio" name="which" checked={which === 'current'} onChange={() => setWhich('current')} />
            Current page ({currentPage + 1})
          </label>
          <label className="row">
            <input type="radio" name="which" checked={which === 'range'} onChange={() => setWhich('range')} />
            Pages
            <input type="text" value={range} aria-label="Page range" placeholder="e.g. 1-3, 5" onFocus={() => setWhich('range')} onChange={(e) => setRange(e.target.value)} />
          </label>
          {which === 'range' && !pages && <p className="print-error">Enter pages between 1 and {pageCount}, e.g. 1-3, 5.</p>}
        </fieldset>
        <fieldset>
          <legend>Options</legend>
          <label className="row">
            <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
            Reverse order
          </label>
          <label className="row">
            <input type="checkbox" checked={tile} onChange={(e) => setTile(e.target.checked)} />
            Tile large pages onto
            <select value={paper} onChange={(e) => setPaper(e.target.value)} disabled={!tile}>
              {Object.keys(PAPER_SIZES).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            paper
          </label>
          {filtering && content !== 'document' && (
            <label className="row">
              <input type="checkbox" checked={dimFiltered} onChange={(e) => setDimFiltered(e.target.checked)} />
              Dim markups the Markups list's filter leaves out
            </label>
          )}
        </fieldset>
        <p className="print-hint">Paper size, copies, scaling and orientation are set in the print dialog that opens next.</p>
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!pages?.length || busy}>
            {busy ? 'Preparing…' : 'Print…'}
          </button>
        </div>
      </form>
    </div>
  );
}
