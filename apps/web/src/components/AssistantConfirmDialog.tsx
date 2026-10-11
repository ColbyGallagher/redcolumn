import { useEffect, useSyncExternalStore } from 'react';
import { allowAssistant, assistantPrompt, denyAssistant, subscribeAssistantPrompt } from '../desktop/assistantConfirm';

/** Allow or Deny for a destructive assistant action. Deny is focused so Enter does not allow it. */
export function AssistantConfirmDialog() {
  const message = useSyncExternalStore(subscribeAssistantPrompt, assistantPrompt, () => null);
  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        denyAssistant();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message]);
  if (!message) return null;
  return (
    <div className="modal-backdrop assistant-confirm" onMouseDown={denyAssistant}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="assistant-confirm-title" onMouseDown={(e) => e.stopPropagation()}>
        <h3 id="assistant-confirm-title">Allow the assistant?</h3>
        <p>{message}</p>
        <div className="actions">
          <button type="button" className="btn" autoFocus onClick={denyAssistant}>
            Deny
          </button>
          <button type="button" className="btn primary" onClick={allowAssistant}>
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
