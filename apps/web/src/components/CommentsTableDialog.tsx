import { useMemo, useState } from 'react';
import { COMMENT_COLUMNS, commentsToCsv, filterComments, sortComments, type CommentColumn, type CommentRow, type StatusFilter } from '../studio/comments';

interface Props {
  /** What the comments are from: `Project Tower A` or `Live Session Review 3`. */
  title: string;
  /** Null while the files are still being read. */
  rows: readonly CommentRow[] | null;
  /** While reading: how many files are done. */
  progress?: { done: number; total: number } | null;
  /** Files that could not be read, with why. */
  failed?: readonly string[];
  onOpen: (row: CommentRow) => void;
  /** Reads the files again. */
  onRefresh?: () => void;
  onExportCsv: (csv: string) => void;
  onClose: () => void;
}

const fmtDate = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Every comment and reply across a Project's or Live Session's files, as one table. */
export function CommentsTableDialog({ title, rows, progress, failed = [], onOpen, onRefresh, onExportCsv, onClose }: Props) {
  const [status, setStatus] = useState<StatusFilter>('open');
  const [fileId, setFileId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sort, setSort] = useState<{ key: CommentColumn; dir: 1 | -1 } | null>(null);
  const files = useMemo(() => [...new Map((rows ?? []).map((r) => [r.fileId, r.file])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const statuses = useMemo(() => [...new Map((rows ?? []).filter((r) => r.status !== 'none').map((r) => [r.status, r.statusName])).entries()], [rows]);
  const shown = useMemo(() => {
    const list = filterComments(rows ?? [], status, fileId, text);
    return sort ? sortComments(list, sort.key, sort.dir) : list;
  }, [rows, status, fileId, text, sort]);
  const toggleSort = (key: CommentColumn) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal quantities-dialog comments-table-dialog" role="dialog" aria-label="All comments" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="columns-head">
          <h3>Comments · {title}</h3>
        </div>
        <div className="qty-toolbar">
          <label>
            Status{' '}
            <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">All</option>
              <option value="open">Open (no status)</option>
              <option value="resolved">Resolved (any status)</option>
              {statuses.map(([id, name]) => (
                <option key={id} value={`status:${id}`}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            File{' '}
            <select aria-label="File filter" value={fileId ?? ''} onChange={(e) => setFileId(e.target.value || null)}>
              <option value="">All files</option>
              {files.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <input type="search" aria-label="Find in comments" placeholder="Find text or author" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="hint-text">
            {rows ? `${shown.length} of ${rows.length}` : progress ? `Reading files… ${progress.done} of ${progress.total}` : 'Reading files…'}
          </span>
        </div>
        {failed.length > 0 && <p className="warn">Not read: {failed.join('; ')}</p>}
        <div className="qty-scroll">
          <table className="qty-table comments-table">
            <thead>
              <tr>
                {COMMENT_COLUMNS.map((c) => (
                  <th key={c.key} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.fileId}:${r.key}`} className={r.replyId ? 'reply' : undefined} tabIndex={0} title="Open the sheet at this markup" onClick={() => onOpen(r)} onKeyDown={(e) => e.key === 'Enter' && onOpen(r)}>
                  <td>{r.file}</td>
                  <td>{r.sheet}</td>
                  <td>{r.author}</td>
                  <td className="comment-text">
                    {r.replyId && <span className="reply-mark">↳ </span>}
                    {r.text}
                  </td>
                  <td>{r.statusName}</td>
                  <td className="num">{fmtDate(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !shown.length && <p className="empty">{rows.length ? 'No comments match these filters.' : 'No comments or replies yet.'}</p>}
        </div>
        <div className="actions">
          <button type="button" className="btn small" disabled={!shown.length} onClick={() => onExportCsv(commentsToCsv(shown))}>
            Export CSV
          </button>
          {onRefresh && (
            <button type="button" className="btn small" title="Read the files again" onClick={onRefresh}>
              Refresh
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
