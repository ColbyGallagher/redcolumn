import { useEffect, useState } from 'react';
import type { SymbolMatch } from '@nb/measure';

export interface VisualSearchHit {
  pageIndex: number;
  match: SymbolMatch;
  /** Found by matching the page image (a scanned sheet) rather than its line work. */
  image?: boolean;
}

export type VisualSearchAction = 'count' | 'cloud' | 'rect' | 'hyperlink';

export interface VisualSearchOptions {
  allPages: boolean;
  rotations: boolean;
  /** Line work only: copies drawn half to twice the size. */
  scales: boolean;
  /** Match the page image (scanned sheets); automatic when the box holds no line work. */
  image: boolean;
}

interface Props {
  pageCount: number;
  editable: boolean;
  /** Runs the search; resolves with every match, in page order. */
  onSearch: (options: VisualSearchOptions) => Promise<VisualSearchHit[]>;
  /** Shows one match. */
  onGo: (hit: VisualSearchHit, index: number, all: readonly VisualSearchHit[]) => void;
  onApply: (action: VisualSearchAction, hits: readonly VisualSearchHit[]) => void;
  onClose: () => void;
}

/**
 * Symbol Search: finds every copy of the symbol boxed on the page (this page or all pages, as
 * drawn or at any rotation), steps through them, and turns them into counts, clouds or boxes.
 */
export function VisualSearchPanel({ pageCount, editable, onSearch, onGo, onApply, onClose }: Props) {
  const [allPages, setAllPages] = useState(false);
  const [rotations, setRotations] = useState(false);
  const [scales, setScales] = useState(false);
  const [image, setImage] = useState(false);
  const [hits, setHits] = useState<VisualSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(0);

  const run = async () => {
    setBusy(true);
    try {
      const found = await onSearch({ allPages, rotations, scales, image });
      setHits(found);
      setAt(0);
    } finally {
      setBusy(false);
    }
  };
  // Search straight away with the defaults; options re-run it.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPages, rotations, scales, image]);

  const go = (i: number) => {
    if (!hits?.length) return;
    const n = (i + hits.length) % hits.length;
    setAt(n);
    onGo(hits[n]!, n, hits);
  };
  const pages = hits ? new Set(hits.map((h) => h.pageIndex)).size : 0;

  return (
    <div className="visual-search" onKeyDown={(e) => e.stopPropagation()}>
      <div className="vs-head">
        <b>Symbol Search</b>
        <button className="btn small flat" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={allPages} disabled={pageCount < 2} onChange={(e) => setAllPages(e.target.checked)} />
        All {pageCount} pages
      </label>
      <label className="check">
        <input type="checkbox" checked={rotations} onChange={(e) => setRotations(e.target.checked)} />
        Include rotated copies
      </label>
      <label className="check">
        <input type="checkbox" checked={scales} disabled={image} onChange={(e) => setScales(e.target.checked)} />
        Include larger and smaller copies
      </label>
      <label className="check" title="For scanned sheets: compares the pixels (also used when the box holds no line work)">
        <input type="checkbox" checked={image} onChange={(e) => setImage(e.target.checked)} />
        Match the image (scanned sheets)
      </label>
      <p className="vs-result">
        {busy ? 'Searching…' : hits ? `${hits.length} found${allPages ? ` on ${pages} page${pages === 1 ? '' : 's'}` : ''}` : ''}
        {!busy && !!hits?.length && hits[0]!.image && ' by image'}
        {!busy && hits?.length === 0 && ' (box one whole symbol)'}
      </p>
      {!!hits?.length && (
        <>
          <div className="vs-nav">
            <button className="btn small" onClick={() => go(at - 1)}>
              ‹ Prev
            </button>
            <span>
              {at + 1} / {hits.length}
            </span>
            <button className="btn small" onClick={() => go(at + 1)}>
              Next ›
            </button>
          </div>
          {editable && (
            <div className="vs-apply">
              <span>Mark all as</span>
              <button className="btn small" title="One count per page, a point on each copy" onClick={() => onApply('count', hits)}>
                Count
              </button>
              <button className="btn small" onClick={() => onApply('cloud', hits)}>
                Clouds
              </button>
              <button className="btn small" onClick={() => onApply('rect', hits)}>
                Boxes
              </button>
              <button className="btn small" title="A hyperlink on every copy, all going to the same place" onClick={() => onApply('hyperlink', hits)}>
                Hyperlinks…
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
