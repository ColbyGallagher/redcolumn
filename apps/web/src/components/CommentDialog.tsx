import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../settings/settings';

/** Edits one markup's comment (right-click → Add Comment). Ctrl+Enter saves, Escape cancels. */
export function CommentDialog({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { spellCheck } = useSettings();
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal comment-dialog"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(text);
        }}
      >
        <h3>{title}</h3>
        <textarea
          spellCheck={spellCheck}
          ref={ref}
          value={text}
          rows={5}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(text);
          }}
          placeholder="Comment"
        />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
