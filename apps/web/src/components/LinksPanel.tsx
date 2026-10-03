import type { LinkStatus, StoredLink } from '@nb/markup';
import type { SheetInfo } from '@nb/sheets';

interface Props {
  links: StoredLink[];
  sheets: Readonly<Record<number, SheetInfo>>;
  currentPage: number;
  showLinks: boolean;
  busy: boolean;
  onShowLinks: (show: boolean) => void;
  /** Jump to where the callout is drawn. */
  onReveal: (link: StoredLink) => void;
  /** Jump to what the callout points at. */
  onFollow: (link: StoredLink) => void;
  onStatus: (id: string, status: LinkStatus) => void;
  onRedetect: () => void;
}

function sheetName(sheets: Readonly<Record<number, SheetInfo>>, page: number) {
  return sheets[page]?.number ?? `p. ${page + 1}`;
}

/** Hyperlink review: low-confidence links to check, links on this sheet, and links pointing here. */
export function LinksPanel({ links, sheets, currentPage, showLinks, busy, onShowLinks, onReveal, onFollow, onStatus, onRedetect }: Props) {
  const active = links.filter((l) => l.status !== 'rejected');
  const review = links.filter((l) => l.status === 'review').sort((a, b) => a.pageIndex - b.pageIndex);
  const here = active.filter((l) => l.pageIndex === currentPage);
  const incoming = active.filter((l) => l.targetPage === currentPage && l.pageIndex !== currentPage);

  const row = (l: StoredLink, from: boolean) => (
    <li key={`${from ? 'f' : 't'}${l.id}`}>
      <button className="link-row" onClick={() => (from ? onFollow(l) : onReveal(l))} title={from ? 'Go to the target' : 'Go to the callout'}>
        <span className="num">{l.label}</span>
        <span className="name">
          {from ? `→ ${sheetName(sheets, l.targetPage)}` : `from ${sheetName(sheets, l.pageIndex)}`}
          {l.kind === 'detail' && !l.targetRect ? ' (detail not located)' : ''}
        </span>
      </button>
      {from && (
        <span className="review-actions">
          <button className="btn small" title="Not a link — remove it" onClick={() => onStatus(l.id, 'rejected')}>
            ✕
          </button>
        </span>
      )}
    </li>
  );

  return (
    <div className="links">
      <div className="sheet-actions">
        <label className="field">
          <input type="checkbox" checked={showLinks} onChange={(e) => onShowLinks(e.target.checked)} />
          Show links
        </label>
        <span className="grow" />
        <button className="btn small" disabled={busy} onClick={onRedetect} title="Find callouts again using the current sheet numbers">
          Re-detect
        </button>
      </div>
      <p className="empty">
        {active.length} link{active.length === 1 ? '' : 's'} in this set · click a callout on the drawing to follow it, Alt+← to go back.
      </p>
      {review.length > 0 && (
        <>
          <h3>Needs review ({review.length})</h3>
          <ul>
            {review.map((l) => (
              <li key={`r${l.id}`}>
                <button className="link-row" onClick={() => onReveal(l)} title="Show this callout">
                  <span className="num">{l.label}</span>
                  <span className="name">
                    {sheetName(sheets, l.pageIndex)} → {sheetName(sheets, l.targetPage)}
                  </span>
                </button>
                <span className="review-actions">
                  <button className="btn small" title="Keep this link" onClick={() => onStatus(l.id, 'accepted')}>
                    ✓
                  </button>
                  <button className="btn small" title="Not a link" onClick={() => onStatus(l.id, 'rejected')}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>On this sheet ({here.length})</h3>
      <ul>{here.map((l) => row(l, true))}</ul>
      <h3>Links to this sheet ({incoming.length})</h3>
      <ul>{incoming.map((l) => row(l, false))}</ul>
    </div>
  );
}
