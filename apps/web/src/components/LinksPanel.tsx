import type { LinkStatus, StoredLink } from '@nb/markup';
import { LINK_KINDS, type SheetInfo } from '@nb/sheets';
import { MARK_KINDS, type TaughtMark } from '../sheets/marks';

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
  /** Section marks, titles and detail callouts taught in this profile; `standard` names the drawing standard a mark belongs to. */
  marks: readonly (TaughtMark & { standard?: string })[];
  /** The document takes edits (teaching adds links to review). */
  editable: boolean;
  /** Opens Teach Links: box a mark, then what it points to. */
  onTeach: () => void;
  /** Forgets a taught mark (its links still waiting for review go too). */
  onForget: (id: string) => void;
}

function sheetName(sheets: Readonly<Record<number, SheetInfo>>, page: number) {
  return sheets[page]?.number ?? `p. ${page + 1}`;
}

/** Hyperlink review: low-confidence links to check, links on this sheet, and links pointing here. */
export function LinksPanel({ links, sheets, currentPage, showLinks, busy, onShowLinks, onReveal, onFollow, onStatus, onRedetect, marks, editable, onTeach, onForget }: Props) {
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
          {l.kind !== 'sheet' ? ` · ${LINK_KINDS[l.kind]}` : ''}
          {l.detail && !l.targetRect ? ' (not located)' : ''}
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
        <button className="btn small" disabled={busy || !editable} onClick={onTeach} title="Box a section mark, detail callout or elevation mark, then what it points to, so links are found from marks like them">
          Teach links…
        </button>
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
                    <span className="confidence" title={l.id.startsWith('mark-') ? 'Found from a taught mark' : 'Found from the text'}>
                      {Math.round(l.confidence * 100)}%
                    </span>
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
      {marks.length > 0 && (
        <>
          <h3>Taught marks ({marks.length})</h3>
          <ul>
            {marks.map((m) => (
              <li key={m.id}>
                <span className="link-row">
                  <span className="num">{m.name}</span>
                  <span className="name taught-kind">
                    {MARK_KINDS[m.kind]}
                    {m.standard ? ` · ${m.standard}` : ''}
                  </span>
                </span>
                <span className="review-actions">
                  <button className="btn small" title="Forget this mark" aria-label={`Forget ${m.name}`} disabled={busy} onClick={() => onForget(m.id)}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
