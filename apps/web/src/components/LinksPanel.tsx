import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
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
      <button className="link-row" onClick={() => (from ? onFollow(l) : onReveal(l))} title={from ? msg('Go to the target') : msg('Go to the callout')}>
        <span className="num">{l.label}</span>
        <span className="name">
          {from ? `→ ${sheetName(sheets, l.targetPage)}` : `from ${sheetName(sheets, l.pageIndex)}`}
          {l.kind !== 'sheet' ? ` · ${LINK_KINDS[l.kind]}` : ''}
          {l.detail && !l.targetRect ? ' ' + msg('(not located)') : ''}
        </span>
      </button>
      {from && (
        <span className="review-actions">
          <button className="btn small" title={msg('Not a link — remove it')} onClick={() => onStatus(l.id, 'rejected')}>
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
          {keyed(msgParts('{input}Show links', { input: <input type="checkbox" checked={showLinks} onChange={(e) => onShowLinks(e.target.checked)} /> }))}
        </label>
        <span className="grow" />
        <button className="btn small" disabled={busy || !editable} onClick={onTeach} title={msg('Box a section mark, detail callout or elevation mark, then what it points to, so links are found from marks like them')}>
          {msg('Teach links…')}
        </button>
        <button className="btn small" disabled={busy} onClick={onRedetect} title={msg('Find callouts again using the current sheet numbers')}>
          {msg('Re-detect')}
        </button>
      </div>
      <p className="empty">
        {msg('{count, plural, one {# link} other {# links}} in this set · click a callout on the drawing to follow it, Alt+← to go back.', { count: active.length })}
      </p>
      {review.length > 0 && (
        <>
          <h3>{msg('Needs review ({count})', { count: review.length })}</h3>
          <ul>
            {review.map((l) => (
              <li key={`r${l.id}`}>
                <button className="link-row" onClick={() => onReveal(l)} title={msg('Show this callout')}>
                  <span className="num">{l.label}</span>
                  <span className="name">
                    {sheetName(sheets, l.pageIndex)} → {sheetName(sheets, l.targetPage)}
                    <span className="confidence" title={l.id.startsWith('ai-') ? l.note ? msg('Proposed by AI: {note}', { note: l.note }) : msg('Proposed by AI') : l.id.startsWith('mark-') ? msg('Found from a taught mark') : msg('Found from the text')}>
                      {Math.round(l.confidence * 100)}%
                    </span>
                  </span>
                </button>
                <span className="review-actions">
                  <button className="btn small" title={msg('Keep this link')} onClick={() => onStatus(l.id, 'accepted')}>
                    ✓
                  </button>
                  <button className="btn small" title={msg('Not a link')} onClick={() => onStatus(l.id, 'rejected')}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>{msg('On this sheet ({count})', { count: here.length })}</h3>
      <ul>{here.map((l) => row(l, true))}</ul>
      <h3>{msg('Links to this sheet ({count})', { count: incoming.length })}</h3>
      <ul>{incoming.map((l) => row(l, false))}</ul>
      {marks.length > 0 && (
        <>
          <h3>{msg('Taught marks ({count})', { count: marks.length })}</h3>
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
                  <button className="btn small" title={msg('Forget this mark')} aria-label={msg('Forget {name}', { name: m.name })} disabled={busy} onClick={() => onForget(m.id)}>
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
