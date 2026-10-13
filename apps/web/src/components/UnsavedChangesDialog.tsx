import { useEffect, useSyncExternalStore } from 'react';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

interface Prompt {
  name: string;
  resolve: (choice: UnsavedChoice) => void;
}

const waiting: Prompt[] = [];
let showing: Prompt | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function finish(choice: UnsavedChoice) {
  const prompt = showing;
  if (!prompt) return;
  showing = waiting.shift() ?? null;
  prompt.resolve(choice);
  emit();
}

/** Asks whether to save a document's changes before it closes. One question at a time. */
export function askSaveChanges(name: string): Promise<UnsavedChoice> {
  return new Promise((resolve) => {
    const prompt = { name, resolve };
    if (showing) waiting.push(prompt);
    else {
      showing = prompt;
      emit();
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Save, Don't Save or Cancel for a document with unsaved changes. Save is focused, so Enter keeps the changes. */
export function UnsavedChangesDialog() {
  const prompt = useSyncExternalStore(subscribe, () => showing, () => null);
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish('cancel');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt]);
  if (!prompt) return null;
  return (
    <div className="modal-backdrop" onMouseDown={() => finish('cancel')}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unsaved-title" onMouseDown={(e) => e.stopPropagation()}>
        <h3 id="unsaved-title">Save changes?</h3>
        <p>{prompt.name} has changes that are not saved. Save them before closing?</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => finish('cancel')}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => finish('discard')}>
            Don&apos;t Save
          </button>
          <button type="button" className="btn primary" autoFocus onClick={() => finish('save')}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
