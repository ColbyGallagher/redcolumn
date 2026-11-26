import { msg } from '@nb/i18n';
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
    ? msg('Enter a page range such as 1-3, 5.')
    : which === 'range' && !range.trim()
      ? msg('Enter the pages to delete.')
      : pages.length >= pageCount
        ? msg('A document needs at least one page: leave one out.')
        : null;
  const what = selected.length > 1 ? msg('Selected pages ({describe})', { describe: describe(selected) }) : msg('This page ({describe})', { describe: describe(selected) });

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal page-tools print-dialog"
        role="dialog"
        aria-label={msg('Delete Pages')}
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
        <h3>{msg('Delete Pages')}</h3>
        <fieldset>
          <legend>{msg('Pages')}</legend>
          <label className="row">
            <input type="radio" checked={which === 'selected'} onChange={() => setWhich('selected')} />
            {what}
          </label>
          <label className="row">
            <input type="radio" checked={which === 'range'} onChange={() => setWhich('range')} />
            {msg('Range')}
            <input
              type="text"
              value={range}
              aria-label={msg('Page range')}
              placeholder={msg('e.g. 1-3, 5 (of {pageCount})', { pageCount })}
              onFocus={() => setWhich('range')}
              onChange={(e) => setRange(e.target.value)}
            />
          </label>
        </fieldset>
        <p className="muted">{msg('Markups on the deleted pages are deleted too.')}</p>
        {problem && <p className="print-error">{problem}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!!problem} autoFocus>
            {pages && !problem ? msg('Delete {count, plural, one {page} other {# pages}}', { count: pages.length }) : msg('Delete')}
          </button>
        </div>
      </form>
    </div>
  );
}
