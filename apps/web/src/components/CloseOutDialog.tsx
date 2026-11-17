import { Fragment, useMemo, useState } from 'react';
import { closeOutCsv, type CloseOutSheet } from '../sheetsync/closeOut';

interface Props {
  docName: string;
  /** The comments by sheet, counted by `templateId`'s closed statuses. */
  sheets: readonly CloseOutSheet[];
  /** Register templates: the client's says which statuses are closed. */
  templates: readonly { id: string; name: string }[];
  templateId: string;
  onTemplate: (id: string) => void;
  /** Goes to the comment's markup on its sheet. */
  onOpen: (id: string, pageIndex: number) => void;
  onExportCsv: (csv: string) => void;
  onClose: () => void;
}

/** Document › Close-out: what is still open on each sheet, and the revision each comment was raised on. */
export function CloseOutDialog({ docName, sheets, templates, templateId, onTemplate, onOpen, onExportCsv, onClose }: Props) {
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const shown = useMemo(() => sheets.map((s) => ({ ...s, comments: show === 'open' ? s.comments.filter((c) => !c.closed) : s.comments })).filter((s) => show === 'all' || s.open > 0), [sheets, show]);
  const open = sheets.reduce((n, s) => n + s.open, 0);
  const closed = sheets.reduce((n, s) => n + s.closed, 0);
  const allOpen = shown.length > 0 && shown.every((s) => expanded.has(s.pageIndex));
  const toggle = (page: number) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(page)) next.add(page);
      return next;
    });

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal quantities-dialog close-out-dialog" role="dialog" aria-label="Close-out" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Close-out · {docName}</h3>
        </div>
        <div className="qty-toolbar">
          <label>
            Show{' '}
            <select aria-label="Show comments" value={show} onChange={(e) => setShow(e.target.value === 'all' ? 'all' : 'open')}>
              <option value="open">Sheets with open comments</option>
              <option value="all">Every sheet with comments</option>
            </select>
          </label>
          <label>
            Closed means{' '}
            <select aria-label="Closed statuses from" value={templateId} onChange={(e) => onTemplate(e.target.value)}>
              <option value="">Accepted, Completed or Cancelled</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  As in {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn small" disabled={!shown.length} onClick={() => setExpanded(allOpen ? new Set() : new Set(shown.map((s) => s.pageIndex)))}>
            {allOpen ? 'Collapse All' : 'Expand All'}
          </button>
          <span className="hint-text" data-testid="close-out-summary">
            {open} open, {closed} closed on {sheets.length} sheet{sheets.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="qty-scroll">
          <table className="qty-table close-out-table">
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Title</th>
                <th>Revision</th>
                <th className="num">Open</th>
                <th className="num">Closed</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <Fragment key={s.pageIndex}>
                  <tr className="close-out-sheet" tabIndex={0} aria-expanded={expanded.has(s.pageIndex)} onClick={() => toggle(s.pageIndex)} onKeyDown={(e) => e.key === 'Enter' && toggle(s.pageIndex)}>
                    <td>
                      {expanded.has(s.pageIndex) ? '▾ ' : '▸ '}
                      {s.sheet}
                    </td>
                    <td>{s.title}</td>
                    <td>{s.revision || '—'}</td>
                    <td className="num">{s.open}</td>
                    <td className="num">{s.closed}</td>
                  </tr>
                  {expanded.has(s.pageIndex) &&
                    s.comments.map((c) => (
                      <tr key={c.id} className="close-out-comment" tabIndex={0} title="Go to this comment on its sheet" onClick={() => onOpen(c.id, s.pageIndex)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.id, s.pageIndex)}>
                        <td className="num">{c.itemNo ?? ''}</td>
                        <td className="comment-text">
                          {c.text || '(no comment text)'}
                          {c.replies > 0 && <span className="hint-text"> · {c.replies === 1 ? '1 reply' : `${c.replies} replies`}</span>}
                        </td>
                        <td>{c.raisedRev ? `Raised at ${c.raisedRev}` : ''}</td>
                        <td colSpan={2}>
                          {c.statusName}
                          {c.closed && c.status !== 'none' ? ' (closed)' : ''}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="empty">{sheets.length ? 'Every comment is closed.' : 'This document has no comments yet.'}</p>}
        </div>
        <div className="actions">
          <button type="button" className="btn small" disabled={!shown.length} onClick={() => onExportCsv(closeOutCsv(shown))}>
            Export CSV
          </button>
          <span className="grow" />
          <button type="button" className="btn primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
