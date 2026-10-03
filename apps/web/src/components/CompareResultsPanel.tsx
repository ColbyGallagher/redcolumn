import { useState } from 'react';
import type { PageComparison } from '../compare/compare';
import type { Difference } from '../compare/diff';

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

/** The differences Compare Documents found, page by page, with Previous and Next. */
export function CompareResultsPanel({ results, onGo, onSideBySide, onClose }: Props) {
  const stops: CompareStop[] = results.pages.flatMap((page) => page.differences.map((diff) => ({ page, diff })));
  const [at, setAt] = useState(-1);
  const go = (i: number) => {
    if (!stops.length) return;
    const n = (i + stops.length) % stops.length;
    setAt(n);
    onGo(stops[n]!);
  };
  const changedPages = results.pages.filter((p) => p.differences.length).length;

  return (
    <div className="visual-search compare-results" onKeyDown={(e) => e.stopPropagation()}>
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
            <div className="compare-page">
              {results.newLabel(p.newPage)}
              {results.oldLabel(p.oldPage) !== results.newLabel(p.newPage) && <span className="muted"> (old {results.oldLabel(p.oldPage)})</span>}
              <span className="muted"> · {p.differences.length || 'no changes'}</span>
            </div>
            {p.differences.map((d, k) => {
              const i = stops.findIndex((s) => s.page === p && s.diff === d);
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
