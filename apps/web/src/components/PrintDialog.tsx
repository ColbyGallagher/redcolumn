import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
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
        <h3>{msg('Print')}</h3>
        <fieldset>
          <legend>{msg('Print')}</legend>
          {(
            [
              ['all', msg('Document and markups')],
              ['document', msg('Document only')],
              ['markups', msg('Markups only')],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="row">
              <input type="radio" name="content" checked={content === value} onChange={() => setContent(value)} autoFocus={value === 'all'} />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{msg('Pages')}</legend>
          <label className="row">
            {keyed(msgParts('{input}All {pageCount} pages', { input: <input type="radio" name="which" checked={which === 'all'} onChange={() => setWhich('all')} />, pageCount }))}
          </label>
          <label className="row">
            {keyed(msgParts('{input}Current page ({page})', { input: <input type="radio" name="which" checked={which === 'current'} onChange={() => setWhich('current')} />, page: currentPage + 1 }))}
          </label>
          <label className="row">
            {keyed(msgParts('{input}Pages{input2}', { input: <input type="radio" name="which" checked={which === 'range'} onChange={() => setWhich('range')} />, input2: <input type="text" value={range} aria-label={msg('Page range')} placeholder="e.g. 1-3, 5" onFocus={() => setWhich('range')} onChange={(e) => setRange(e.target.value)} /> }))}
          </label>
          {which === 'range' && !pages && <p className="print-error">{msg('Enter pages between 1 and {pageCount}, e.g. 1-3, 5.', { pageCount })}</p>}
        </fieldset>
        <fieldset>
          <legend>{msg('Options')}</legend>
          <label className="row">
            {keyed(msgParts('{input}Reverse order', { input: <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> }))}
          </label>
          <label className="row">
            <input type="checkbox" checked={tile} onChange={(e) => setTile(e.target.checked)} />
            {msg('Tile large pages onto')}
            <select value={paper} onChange={(e) => setPaper(e.target.value)} disabled={!tile}>
              {Object.keys(PAPER_SIZES).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            {msg('paper')}
          </label>
          {filtering && content !== 'document' && (
            <label className="row">
              {keyed(msgParts('{input}Dim markups the Markups list\'s filter leaves out', { input: <input type="checkbox" checked={dimFiltered} onChange={(e) => setDimFiltered(e.target.checked)} /> }))}
            </label>
          )}
        </fieldset>
        <p className="print-hint">{msg('Paper size, copies, scaling and orientation are set in the print dialog that opens next.')}</p>
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!pages?.length || busy}>
            {busy ? msg('Preparing…') : msg('Print…')}
          </button>
        </div>
      </form>
    </div>
  );
}
