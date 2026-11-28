import { msg } from '@nb/i18n';
import { useSyncExternalStore } from 'react';
import type { MarkupDocument } from '@nb/markup';

interface Props {
  store: MarkupDocument;
  onClose: () => void;
}

/**
 * Edit › Undo History: the steps that can be undone, newest first. Clicking one undoes it and
 * every step after it.
 */
export function UndoHistoryDialog({ store, onClose }: Props) {
  // The list changes as edits and undos happen while the dialog is open.
  const key = useSyncExternalStore(
    (l) => store.subscribe(l),
    () => JSON.stringify(store.undoHistory()),
  );
  const steps = JSON.parse(key) as { label: string; at: number }[];
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal undo-history"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{msg('Undo History')}</h3>
        {steps.length ? (
          <>
            <p>{msg('Click a step to undo it and everything after it.')}</p>
            <ol className="undo-steps">
              {steps.map((s, i) => (
                <li key={i}>
                  <button className="btn flat" onClick={() => store.undoSteps(i + 1)} title={msg('Undo {count, plural, one {# step} other {# steps}}', { count: i + 1 })}>
                    <span>{s.label}</span>
                    <span className="when">{s.at ? new Date(s.at).toLocaleTimeString() : ''}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="empty">{msg('Nothing to undo in this document.')}</p>
        )}
        <div className="actions">
          <button className="btn primary" onClick={onClose} autoFocus>
            {msg('Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
