import { msg } from '@nb/i18n';
import type { InboxEntry } from '@nb/sync';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReviewDocument } from './ReviewDocument';
import { describeChange, describeRejection, syncSummary } from './syncText';
import './review.css';

export interface SyncStatusBarProps {
  doc: ReviewDocument;
  /** The page in front, shared with others who have the document open. */
  pageIndex: number;
}

function RejectedList({ doc, entries }: { doc: ReviewDocument; entries: readonly InboxEntry[] }) {
  return (
    <ul className="sync-rejected" aria-label={msg('Changes that were not saved')}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <span>
            <strong>{describeChange(entry)}</strong> {describeRejection(entry.reason)}
          </span>
          <span className="sync-rejected-actions">
            <button
              type="button"
              className="btn small"
              disabled={doc.readOnly}
              onClick={() => {
                if (!doc.sync.retryInboxAsNew(entry.id)) doc.report(msg('That change can no longer be made.'));
              }}
            >
              {msg('Try again')}
            </button>
            <button type="button" className="btn small" onClick={() => doc.sync.discardInbox(entry.id)}>
              {msg('Discard')}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Whether changes are saved on the server, who else is here, and anything that was not saved. */
export function SyncStatusBar({ doc, pageIndex }: SyncStatusBarProps) {
  useSyncExternalStore(
    (listener) => doc.subscribeStatus(listener),
    () => doc.statusVersion,
  );
  const [showRejected, setShowRejected] = useState(false);
  useEffect(() => doc.setViewedPage(pageIndex), [doc, pageIndex]);

  const { connection, pendingCount, inbox } = doc.sync;
  const summary = syncSummary(connection, pendingCount, doc.sessionEnded);
  const offline = connection === 'disconnected' && !doc.sessionEnded;

  return (
    <div className="sync-status" data-sync-state={summary.state}>
      <div className="sync-status-row">
        <span className="sync-status-main" role="status">
          <span className="sync-dot" aria-hidden="true" />
          {summary.text}
        </span>
        {offline && (
          <button type="button" className="btn small" onClick={() => doc.retryNow()}>
            {msg('Reconnect')}
          </button>
        )}
        {(doc.sessionEnded || connection === 'update_required') && (
          <button type="button" className="btn small" onClick={() => window.location.reload()}>
            {msg('Reload')}
          </button>
        )}
        {inbox.length > 0 && (
          <button type="button" className="btn small sync-rejected-toggle" aria-expanded={showRejected} onClick={() => setShowRejected((v) => !v)}>
            {msg('{count, plural, one {# change not saved} other {# changes not saved}}', { count: inbox.length })}
          </button>
        )}
      </div>
      {doc.others.length > 0 && (
        <ul className="sync-presence" aria-label={msg('Also viewing this document')}>
          {doc.others.map((user) => (
            <li key={user.connectionId}>
              {user.pageIndex === null ? user.name : msg('{name} · page {page}', { name: user.name, page: user.pageIndex + 1 })}
            </li>
          ))}
        </ul>
      )}
      {showRejected && inbox.length > 0 && <RejectedList doc={doc} entries={inbox} />}
      {doc.problem && (
        <div className="sync-problem" role="alert">
          <span>{doc.problem}</span>
          <button type="button" className="btn small" onClick={() => doc.dismissProblem()}>
            {msg('Dismiss')}
          </button>
        </div>
      )}
    </div>
  );
}
