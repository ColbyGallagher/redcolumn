import { useState } from 'react';
import { parsePageRange } from '../documents/printPdf';

interface Props {
  pageCount: number;
  /** The pages selected in the thumbnails (0-based). */
  selected: number[];
  onDelete: (pages: number[]) => void;
  onCancel: () => void;
}

/** What a page or a list of pages reads as: "3", or "1-3, 5". */
function describe(pages: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    runs.push(j > i ? `${pages[i]! + 1}-${pages[j]! + 1}` : `${pages[i]! + 1}`);
    i = j + 1;
  }
  return runs.join(', ');
}

/** Delete Pages: just the selected page (or pages), or a range typed in. */
export function DeletePagesDialog({ pageCount, selected, onDelete, onCancel }: Props) {
  const [which, setWhich] = useState<'selected' | 'range'>('selected');
  const [range, setRange] = useState(describe(selected));
  const parsed = which === 'range' ? parsePageRange(range, pageCount) : selected;
  const pages = parsed && parsed.length ? parsed : null;
  const problem = !pages
    ? 'Enter a page range such as 1-3, 5.'
    : which === 'range' && !range.trim()
      ? 'Enter the pages to delete.'
      : pages.length >= pageCount
        ? 'A document needs at least one page: leave one out.'
        : null;
  const what = selected.length > 1 ? `Selected pages (${describe(selected)})` : `This page (${describe(selected)})`;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal page-tools print-dialog"
        role="dialog"
        aria-label="Delete Pages"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem && pages) onDelete(pages);
        }}
      >
        <h3>Delete Pages</h3>
        <fieldset>
          <legend>Pages</legend>
          <label className="row">
            <input type="radio" checked={which === 'selected'} onChange={() => setWhich('selected')} />
            {what}
          </label>
          <label className="row">
            <input type="radio" checked={which === 'range'} onChange={() => setWhich('range')} />
            Range
            <input
              type="text"
              value={range}
              aria-label="Page range"
              placeholder={`e.g. 1-3, 5 (of ${pageCount})`}
              onFocus={() => setWhich('range')}
              onChange={(e) => setRange(e.target.value)}
            />
          </label>
        </fieldset>
        <p className="muted">Markups on the deleted pages are deleted too.</p>
        {problem && <p className="print-error">{problem}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!!problem} autoFocus>
            Delete {pages && !problem ? (pages.length > 1 ? `${pages.length} pages` : 'page') : ''}
          </button>
        </div>
      </form>
    </div>
  );
}
