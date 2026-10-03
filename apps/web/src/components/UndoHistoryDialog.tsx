import { useSyncExternalStore } from 'react';
import type { MarkupStore } from '@nb/markup';

interface Props {
  store: MarkupStore;
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
        <h3>Undo History</h3>
        {steps.length ? (
          <>
            <p>Click a step to undo it and everything after it.</p>
            <ol className="undo-steps">
              {steps.map((s, i) => (
                <li key={i}>
                  <button className="btn flat" onClick={() => store.undoSteps(i + 1)} title={`Undo ${i + 1} step${i ? 's' : ''}`}>
                    <span>{s.label}</span>
                    <span className="when">{s.at ? new Date(s.at).toLocaleTimeString() : ''}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="empty">Nothing to undo in this document.</p>
        )}
        <div className="actions">
          <button className="btn primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
