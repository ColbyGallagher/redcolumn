import { msg } from '@nb/i18n';
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
      <div className="modal quantities-dialog close-out-dialog" role="dialog" aria-label={msg('Close-out')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>{msg('Close-out · {docName}', { docName })}</h3>
        </div>
        <div className="qty-toolbar">
          <label>
            {msg('Show')}{' '}
            <select aria-label={msg('Show comments')} value={show} onChange={(e) => setShow(e.target.value === 'all' ? 'all' : 'open')}>
              <option value="open">{msg('Sheets with open comments')}</option>
              <option value="all">{msg('Every sheet with comments')}</option>
            </select>
          </label>
          <label>
            {msg('Closed means')}{' '}
            <select aria-label={msg('Closed statuses from')} value={templateId} onChange={(e) => onTemplate(e.target.value)}>
              <option value="">{msg('Accepted, Completed or Cancelled')}</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {msg('As in {name}', { name: t.name })}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn small" disabled={!shown.length} onClick={() => setExpanded(allOpen ? new Set() : new Set(shown.map((s) => s.pageIndex)))}>
            {allOpen ? msg('Collapse All') : msg('Expand All')}
          </button>
          <span className="hint-text" data-testid="close-out-summary">
            {msg('{open} open, {closed} closed on {count, plural, one {# sheet} other {# sheets}}', { open, closed, count: sheets.length })}
          </span>
        </div>
        <div className="qty-scroll">
          <table className="qty-table close-out-table">
            <thead>
              <tr>
                <th>{msg('Sheet')}</th>
                <th>{msg('Title')}</th>
                <th>{msg('Revision')}</th>
                <th className="num">{msg('Open')}</th>
                <th className="num">{msg('Closed')}</th>
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
                      <tr key={c.id} className="close-out-comment" tabIndex={0} title={msg('Go to this comment on its sheet')} onClick={() => onOpen(c.id, s.pageIndex)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.id, s.pageIndex)}>
                        <td className="num">{c.itemNo ?? ''}</td>
                        <td className="comment-text">
                          {c.text || msg('(no comment text)')}
                          {c.replies > 0 && <span className="hint-text"> · {msg('{count, plural, one {# reply} other {# replies}}', { count: c.replies })}</span>}
                        </td>
                        <td>{c.raisedRev ? msg('Raised at {raisedRev}', { raisedRev: c.raisedRev }) : ''}</td>
                        <td colSpan={2}>
                          {c.statusName}
                          {c.closed && c.status !== 'none' ? ' ' + msg('(closed)') : ''}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!shown.length && <p className="empty">{sheets.length ? msg('Every comment is closed.') : msg('This document has no comments yet.')}</p>}
        </div>
        <div className="actions">
          <button type="button" className="btn small" disabled={!shown.length} onClick={() => onExportCsv(closeOutCsv(shown))}>
            {msg('Export CSV')}
          </button>
          <span className="grow" />
          <button type="button" className="btn primary" onClick={onClose} autoFocus>
            {msg('Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
