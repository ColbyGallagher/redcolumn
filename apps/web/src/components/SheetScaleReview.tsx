import { useEffect, useRef, useState } from 'react';
import type { Scale } from '@nb/measure';
import { defaultPicks, needsReview, type ScaleReviewRow, type ScaleReviewStatus } from '../measure/scaleReview';

interface Props {
  rows: ScaleReviewRow[];
  pageLabel: (pageIndex: number) => string;
  currentPage: number;
  readOnly: boolean;
  /** Brings a page into view. */
  onShow: (pageIndex: number) => void;
  onApply: (scales: { page: number; scale: Scale }[]) => void;
  onClose: () => void;
}

const STATUS: Record<ScaleReviewStatus, { label: string; hint: string }> = {
  ready: { label: 'Ready', hint: 'The title block gives a scale for this sheet size.' },
  resized: { label: 'Resized', hint: 'Saved at another sheet size than the scale was written for; the proposed scale is corrected for it.' },
  check: { label: 'Check', hint: 'The page is cropped or padded against the stated sheet size. Check the proposed scale against a known dimension before applying it.' },
  matches: { label: 'Matches', hint: 'The page scale is set and agrees with the title block.' },
  differs: { label: 'Differs', hint: 'The page scale is set and disagrees with the title block. Check which is right.' },
  nts: { label: 'Not to scale', hint: 'The title block says the sheet is not to scale. Do not measure it.' },
  none: { label: 'No scale', hint: 'No scale was read from the title block. Set or calibrate this page by hand.' },
};

const paperOf = (r: ScaleReviewRow) => r.actual?.paper.name ?? '—';

/**
 * Document › Review Sheet Scales: every page's title-block scale against the size the page was
 * actually saved at, so a drawing stated 1:100 @ A1 but saved at A3 measures as 1:200. Pages
 * without a scale yet whose proposal needs no checking start ticked; nothing changes until Apply.
 * A panel beside the sheet (not a dialog), so each page can be checked while it is in view.
 */
export function SheetScaleReview({ rows, pageLabel, currentPage, readOnly, onShow, onApply, onClose }: Props) {
  const [show, setShow] = useState<'review' | 'all'>('review');
  const [picked, setPicked] = useState<Set<number>>(() => defaultPicks(rows));
  // Picks are by page index: when pages move, sheets are read or scales change, start them again
  // so Apply never reaches a page nobody ticked.
  const rowsKey = rows.map((r) => `${r.page}:${r.status}:${r.proposed?.label ?? ''}`).join('|');
  const seenKey = useRef(rowsKey);
  useEffect(() => {
    if (seenKey.current === rowsKey) return;
    seenKey.current = rowsKey;
    setPicked(defaultPicks(rows));
  }, [rowsKey, rows]);
  const shown = rows.filter((r) => show === 'all' || needsReview(r));
  const applicable = rows.filter((r) => r.proposed && r.status !== 'matches' && picked.has(r.page));
  const counts = rows.reduce<Partial<Record<ScaleReviewStatus, number>>>((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {});
  const pick = (page: number, on: boolean) => setPicked((s) => (on ? new Set([...s, page]) : new Set([...s].filter((p) => p !== page))));

  return (
    <aside className="takeoff-review scale-review" role="complementary" aria-label="Sheet scale review">
      <header className="takeoff-review-head">
        <h3>Review Sheet Scales</h3>
        <span className="hint-text">
          {(Object.keys(STATUS) as ScaleReviewStatus[])
            .filter((s) => counts[s])
            .map((s) => `${counts[s]} ${STATUS[s].label.toLowerCase()}`)
            .join(' · ')}
        </span>
        <span className="grow" />
        <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as 'review' | 'all')}>
          <option value="review">Needing review</option>
          <option value="all">All pages</option>
        </select>
        <button type="button" className="link-preview-btn" aria-label="Close sheet scale review" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="hint-text takeoff-review-note">Each page's scale is read from its title block and corrected for the sheet size the page was saved at. Every quantity depends on this, so check the pages marked Resized, Check or Differs.</p>
      <div className="takeoff-review-list">
        {!shown.length ? (
          <p className="empty">{rows.length ? 'Every page agrees with its title block.' : 'No pages.'}</p>
        ) : (
          <table className="qty-table scale-review-table">
            <thead>
              <tr>
                <th aria-label="Apply" />
                <th>Page</th>
                <th>Title block</th>
                <th title="The sheet size the scale was written for, and the size the page actually is">Sheet</th>
                <th>Proposed</th>
                <th>Current</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const canPick = !!r.proposed && r.status !== 'matches';
                return (
                  <tr key={r.page} className={`sr-${r.status}${r.page === currentPage ? ' current' : ''}`}>
                    <td>{canPick && <input type="checkbox" aria-label={`Apply to ${pageLabel(r.page)}`} checked={picked.has(r.page)} disabled={readOnly} onChange={(e) => pick(r.page, e.target.checked)} />}</td>
                    <td>
                      <button type="button" className="tp-measure" title={r.sheet?.title ?? 'Show this page'} onClick={() => onShow(r.page)}>
                        {pageLabel(r.page)}
                      </button>
                    </td>
                    <td>{r.sheet?.scaleText ?? <span className="hint-text">—</span>}</td>
                    <td title={r.printRatio !== 1 ? `Saved at ${Math.round(r.printRatio * 100)}% of the stated sheet` : undefined}>
                      {r.stated && r.stated !== r.actual?.paper.name ? (
                        <>
                          {r.stated} → <b>{paperOf(r)}</b>
                        </>
                      ) : (
                        paperOf(r)
                      )}
                    </td>
                    <td>{r.proposed?.label ?? '—'}</td>
                    <td>{r.current?.label ?? <span className="hint-text">not set</span>}</td>
                    <td>
                      <span className={`sr-state sr-${r.status}`} title={STATUS[r.status].hint}>
                        {STATUS[r.status].label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <footer className="takeoff-review-foot">
        <button type="button" className="btn small flat" disabled={readOnly} onClick={() => setPicked(defaultPicks(rows))}>
          Pick ready
        </button>
        <button type="button" className="btn small flat" disabled={readOnly} onClick={() => setPicked(new Set())}>
          Clear
        </button>
        <span className="grow" />
        <button type="button" className="btn small" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn small primary" disabled={readOnly || !applicable.length} onClick={() => onApply(applicable.map((r) => ({ page: r.page, scale: r.proposed! })))}>
          Apply to {applicable.length} page{applicable.length === 1 ? '' : 's'}
        </button>
      </footer>
    </aside>
  );
}
