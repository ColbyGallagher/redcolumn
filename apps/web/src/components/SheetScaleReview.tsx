import { useEffect, useRef, useState } from 'react';
import type { Scale } from '@nb/measure';
import { canApply, defaultPicks, needsReview, type ScaleReviewRow, type ScaleReviewStatus } from '../measure/scaleReview';
import type { ViewProposal } from '../measure/viewScales';

interface Props {
  rows: ScaleReviewRow[];
  /** The pages' scale bars and dimensions are still being read. */
  reading: boolean;
  pageLabel: (pageIndex: number) => string;
  currentPage: number;
  readOnly: boolean;
  /** Brings a page into view, outlining the viewports proposed on it. */
  onShow: (pageIndex: number, views: readonly ViewProposal[]) => void;
  /** Sets each page's scale (when it has a new one) and adds its viewports. */
  onApply: (pages: { page: number; scale?: Scale; views: ViewProposal[] }[]) => void;
  onClose: () => void;
}

const STATUS: Record<ScaleReviewStatus, { label: string; hint: string }> = {
  ready: { label: 'Ready', hint: 'The title block gives a scale for this sheet size.' },
  resized: { label: 'Resized', hint: 'Saved at another sheet size than the scale was written for; the proposed scale is corrected for it.' },
  check: { label: 'Check', hint: "Cropped or padded against the stated sheet size, an unlikely scale, or the page's scale bar or dimensions disagree. Check the proposed scale against a known dimension before applying it." },
  matches: { label: 'Matches', hint: 'The page scale, or its viewports, are set and agree with the title block.' },
  differs: { label: 'Differs', hint: 'The page scale is set and disagrees with the title block. Check which is right.' },
  views: { label: 'Views', hint: 'The title block gives the scale view by view (AS SHOWN). Viewports are proposed from the view titles: show them on the sheet and check each before applying.' },
  nts: { label: 'Not to scale', hint: 'The title block says the sheet is not to scale. Do not measure it.' },
  none: { label: 'No scale', hint: 'No scale was read from the title block. Set or calibrate this page by hand.' },
};

const paperOf = (r: ScaleReviewRow) => r.actual?.paper.name ?? '—';

const WITNESS = { bar: 'scale bar', dimensions: 'dimensions' } as const;

/** What the page's own lengths said, short for the table and in full for its tooltip. */
function checkCell(r: ScaleReviewRow, reading: boolean): { text: string; title: string } {
  const c = r.check;
  if (!c) return reading && (r.proposed || r.current) ? { text: '…', title: 'Reading the page' } : { text: '—', title: '' };
  if (c.result === 'none') return { text: '—', title: 'No scale bar or dimensions found on the page' };
  const what = c.reading!.kind === 'bar' ? `scale bar ${c.reading!.text}` : c.reading!.text;
  if (c.result === 'agrees') return { text: `✓ ${WITNESS[c.reading!.kind]}`, title: `Agrees with the ${what}` };
  const times = c.ratio! >= 1 ? `×${c.ratio!.toFixed(2)}` : `÷${(1 / c.ratio!).toFixed(2)}`;
  return { text: `✗ ${WITNESS[c.reading!.kind]} ${times}`, title: `The ${what} measures ${times} the proposed scale. Check against a known length.` };
}

/**
 * Document › Review Sheet Scales: every page's title-block scale against the size the page was
 * actually saved at, so a drawing stated 1:100 @ A1 but saved at A3 measures as 1:200. Pages
 * without a scale yet whose proposal needs no checking start ticked; nothing changes until Apply.
 * A panel beside the sheet (not a dialog), so each page can be checked while it is in view.
 */
export function SheetScaleReview({ rows, reading, pageLabel, currentPage, readOnly, onShow, onApply, onClose }: Props) {
  const [show, setShow] = useState<'review' | 'all'>('review');
  const [picked, setPicked] = useState<Set<number>>(() => defaultPicks(rows));
  // Picks are by page index: when pages move, sheets are read or scales change, start them again
  // so Apply never reaches a page nobody ticked.
  const rowsKey = rows.map((r) => `${r.page}:${r.status}:${r.proposed?.label ?? ''}:${r.views.length}`).join('|');
  const seenKey = useRef(rowsKey);
  useEffect(() => {
    if (seenKey.current === rowsKey) return;
    seenKey.current = rowsKey;
    setPicked(defaultPicks(rows));
  }, [rowsKey, rows]);
  const shown = rows.filter((r) => show === 'all' || needsReview(r));
  const applicable = rows.filter((r) => canApply(r) && picked.has(r.page));
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
      <p className="hint-text takeoff-review-note">Each page's scale is read from its title block and corrected for the sheet size the page was saved at. Each scale is also measured against the page's own scale bars and dimensions. Sheets with views at their own scales get viewports from the view titles. Every quantity depends on this, so check the pages marked Resized, Check, Differs or Views.</p>
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
                <th title="What the page's own scale bars and dimensions say about the proposed scale">Checked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const canPick = canApply(r);
                return (
                  <tr key={r.page} className={`sr-${r.status}${r.page === currentPage ? ' current' : ''}`}>
                    <td>{canPick && <input type="checkbox" aria-label={`Apply to ${pageLabel(r.page)}`} checked={picked.has(r.page)} disabled={readOnly} onChange={(e) => pick(r.page, e.target.checked)} />}</td>
                    <td>
                      <button type="button" className="tp-measure" title={r.sheet?.title ?? 'Show this page'} onClick={() => onShow(r.page, r.views)}>
                        {pageLabel(r.page)}
                      </button>
                    </td>
                    <td>
                      {r.sheet?.scaleText ?? <span className="hint-text">—</span>}
                      {r.sheet?.source === 'ai' && (
                        <span className="sr-ai" title={`Proposed by an AI client${r.sheet.scaleReason ? `: ${r.sheet.scaleReason}` : ''}`}>
                          AI
                        </span>
                      )}
                    </td>
                    <td title={r.printRatio !== 1 ? `Saved at ${Math.round(r.printRatio * 100)}% of the stated sheet` : undefined}>
                      {r.stated && r.stated !== r.actual?.paper.name ? (
                        <>
                          {r.stated} → <b>{paperOf(r)}</b>
                        </>
                      ) : (
                        paperOf(r)
                      )}
                    </td>
                    <td>
                      {r.proposed?.label ?? (r.views.length ? null : '—')}
                      {r.views.length > 0 && (
                        <button type="button" className="tp-measure sr-viewports" title={r.views.map((v) => `${v.name}: ${v.scale.label}`).join('\n')} onClick={() => onShow(r.page, r.views)}>
                          {r.proposed ? ' + ' : ''}
                          {r.views.length} viewport{r.views.length === 1 ? '' : 's'}
                        </button>
                      )}
                    </td>
                    <td>{r.current?.label ?? <span className="hint-text">not set</span>}</td>
                    <td className={r.check ? `sr-check-${r.check.result}` : undefined} title={checkCell(r, reading).title}>
                      {checkCell(r, reading).text}
                    </td>
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
        <button type="button" className="btn small primary" disabled={readOnly || !applicable.length} onClick={() => onApply(applicable.map((r) => ({ page: r.page, ...(r.proposed && r.status !== 'matches' ? { scale: r.proposed } : {}), views: r.views })))}>
          Apply to {applicable.length} page{applicable.length === 1 ? '' : 's'}
        </button>
      </footer>
    </aside>
  );
}
