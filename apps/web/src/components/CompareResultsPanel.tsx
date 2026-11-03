import { useMemo, useState } from 'react';
import type { PageComparison } from '../compare/compare';
import type { Difference } from '../compare/diff';
import { useBelowRibbon } from './useFloatingPopup';

export interface CompareResults {
  oldName: string;
  newName: string;
  pages: PageComparison[];
  /** Page labels for the list, by page index. */
  oldLabel: (page: number) => string;
  newLabel: (page: number) => string;
}

export interface CompareStop {
  page: PageComparison;
  diff: Difference;
}

interface Props {
  results: CompareResults;
  onGo: (stop: CompareStop) => void;
  onSideBySide: () => void;
  onClose: () => void;
}

const KIND_LABEL = { added: 'Added', removed: 'Removed', changed: 'Changed' } as const;

/** With up to this many differences every page lists its own; with more, a page opens on a click. */
const SHOW_ALL = 200;

/** Pages listing their differences to begin with: all, unless there are many or some were grouped. */
const openAtFirst = (pages: PageComparison[]): ReadonlySet<PageComparison> =>
  new Set(pages.reduce((n, p) => n + p.differences.length, 0) <= SHOW_ALL && !pages.some((p) => p.found) ? pages : []);

/** The differences Compare Documents found, page by page, with Previous and Next. */
export function CompareResultsPanel({ results, onGo, onSideBySide, onClose }: Props) {
  const stops: CompareStop[] = useMemo(() => results.pages.flatMap((page) => page.differences.map((diff) => ({ page, diff }))), [results]);
  // Where each page's differences start in `stops`.
  const firstStop = useMemo(() => {
    const at = new Map<PageComparison, number>();
    let n = 0;
    for (const p of results.pages) {
      at.set(p, n);
      n += p.differences.length;
    }
    return at;
  }, [results]);
  const [at, setAt] = useState(-1);
  // Pages listing their differences; all of them when there are few.
  const [open, setOpen] = useState<ReadonlySet<PageComparison>>(() => openAtFirst(results.pages));
  // A new compare starts the list over.
  const [shown, setShown] = useState(results);
  if (shown !== results) {
    setShown(results);
    setAt(-1);
    setOpen(openAtFirst(results.pages));
  }
  const belowRibbon = useBelowRibbon();
  const go = (i: number) => {
    if (!stops.length) return;
    const n = (i + stops.length) % stops.length;
    setAt(n);
    const page = stops[n]!.page;
    if (!open.has(page)) setOpen(new Set(open).add(page));
    onGo(stops[n]!);
  };
  const toggle = (p: PageComparison) => {
    const next = new Set(open);
    if (!next.delete(p)) next.add(p);
    setOpen(next);
  };
  const changedPages = results.pages.filter((p) => p.differences.length).length;
  const crowded = results.pages.filter((p) => p.found).length;

  return (
    <div className="visual-search compare-results" style={belowRibbon} onKeyDown={(e) => e.stopPropagation()}>
      <div className="vs-head">
        <b>Compare Results</b>
        <button className="btn small flat" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="vs-result" title={`${results.oldName} → ${results.newName}`}>
        {stops.length
          ? `${stops.length} difference${stops.length === 1 ? '' : 's'} on ${changedPages} of ${results.pages.length} page${results.pages.length === 1 ? '' : 's'}`
          : `No differences on ${results.pages.length} page${results.pages.length === 1 ? '' : 's'}`}
      </p>
      {!!crowded && (
        <p className="vs-result compare-warning">
          {crowded === 1 ? 'One page had' : `${crowded} pages had`} too many differences to mark one by one, so nearby ones were grouped. The pages may not line up: try Scale to fit or 3-point alignment.
        </p>
      )}
      {!!stops.length && (
        <div className="vs-nav">
          <button className="btn small" onClick={() => go(at - 1)}>
            ‹ Previous
          </button>
          <span>{at >= 0 ? `${at + 1} of ${stops.length}` : ''}</span>
          <button className="btn small" onClick={() => go(at + 1)}>
            Next ›
          </button>
        </div>
      )}
      <ul className="compare-list">
        {results.pages.map((p) => (
          <li key={`${p.oldPage}:${p.newPage}`}>
            <button className={`compare-page${open.has(p) ? ' open' : ''}`} disabled={!p.differences.length} aria-expanded={p.differences.length ? open.has(p) : undefined} onClick={() => toggle(p)}>
              {results.newLabel(p.newPage)}
              {results.oldLabel(p.oldPage) !== results.newLabel(p.newPage) && <span className="muted"> (old {results.oldLabel(p.oldPage)})</span>}
              <span className="muted"> · {p.differences.length || 'no changes'}</span>
              {p.found && <span className="muted" title="Too many differences to mark one by one; nearby ones were grouped."> (grouped from {p.found.toLocaleString()})</span>}
            </button>
            {open.has(p) &&
              p.differences.map((d, k) => {
                const i = firstStop.get(p)! + k;
                return (
                  <button key={k} className={`compare-item ${d.kind}${i === at ? ' active' : ''}`} onClick={() => go(i)}>
                    {KIND_LABEL[d.kind]}
                  </button>
                );
              })}
          </li>
        ))}
      </ul>
      <div className="vs-apply">
        <button className="btn small" onClick={onSideBySide}>
          Show side by side
        </button>
      </div>
    </div>
  );
}
