import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useEffect, useState } from 'react';
import type { SymbolMatch } from '@nb/measure';
import { useBelowRibbon } from './useFloatingPopup';

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
  const belowRibbon = useBelowRibbon();

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
    <div className="visual-search" style={belowRibbon} onKeyDown={(e) => e.stopPropagation()}>
      <div className="vs-head">
        <b>{msg('Symbol Search')}</b>
        <button className="btn small flat" title={msg('Close')} onClick={onClose}>
          ×
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={allPages} disabled={pageCount < 2} onChange={(e) => setAllPages(e.target.checked)} />
        {msg('{count, plural, one {All # page} other {All # pages}}', { count: pageCount })}
      </label>
      <label className="check">
        {keyed(msgParts('{input}Include rotated copies', { input: <input type="checkbox" checked={rotations} onChange={(e) => setRotations(e.target.checked)} /> }))}
      </label>
      <label className="check">
        {keyed(msgParts('{input}Include larger and smaller copies', { input: <input type="checkbox" checked={scales} disabled={image} onChange={(e) => setScales(e.target.checked)} /> }))}
      </label>
      <label className="check" title={msg('For scanned sheets: compares the pixels (also used when the box holds no line work)')}>
        {keyed(msgParts('{input}Match the image (scanned sheets)', { input: <input type="checkbox" checked={image} onChange={(e) => setImage(e.target.checked)} /> }))}
      </label>
      <p className="vs-result">
        {busy
          ? msg('Searching…')
          : hits
            ? hits.length && hits[0]!.image
              ? allPages
                ? msg('{count} found by image on {pages, plural, one {# page} other {# pages}}', { count: hits.length, pages })
                : msg('{count} found by image', { count: hits.length })
              : allPages
                ? msg('{count} found on {pages, plural, one {# page} other {# pages}}', { count: hits.length, pages })
                : msg('{count} found', { count: hits.length })
            : ''}
        {!busy && hits?.length === 0 && ' ' + msg('(box one whole symbol)')}
      </p>
      {!!hits?.length && (
        <>
          <div className="vs-nav">
            <button className="btn small" onClick={() => go(at - 1)}>
              {msg('‹ Prev')}
            </button>
            <span>
              {at + 1} / {hits.length}
            </span>
            <button className="btn small" onClick={() => go(at + 1)}>
              {msg('Next ›')}
            </button>
          </div>
          {editable && (
            <div className="vs-apply">
              <span>{msg('Mark all as')}</span>
              <button className="btn small" title={msg('One count per page, a point on each copy')} onClick={() => onApply('count', hits)}>
                {msg('Count')}
              </button>
              <button className="btn small" onClick={() => onApply('cloud', hits)}>
                {msg('Clouds')}
              </button>
              <button className="btn small" onClick={() => onApply('rect', hits)}>
                {msg('Boxes')}
              </button>
              <button className="btn small" title={msg('A hyperlink on every copy, all going to the same place')} onClick={() => onApply('hyperlink', hits)}>
                {msg('Hyperlinks…')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
