import { useState } from 'react';

interface Props {
  /** The colours the selected markups use (line, fill and text), as lower-case hex. */
  colours: string[];
  /** Applies the replacements (old colour → new colour; only changed ones). */
  onApply: (map: Record<string, string>) => void;
  onCancel: () => void;
}

/** Right-click › Change Colours: each colour the selection uses, swapped for another everywhere it is used. */
export function ChangeColoursDialog({ colours, onApply, onCancel }: Props) {
  const [next, setNext] = useState<Record<string, string>>(() => Object.fromEntries(colours.map((c) => [c, c])));
  const changed = Object.fromEntries(Object.entries(next).filter(([from, to]) => to.toLowerCase() !== from));

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onApply(changed);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Change Colours</h3>
        <p>Each colour the selected markups use: line, fill and text. A new colour replaces it wherever it is used.</p>
        <div className="form-grid change-colours">
          {colours.map((c, i) => (
            <div key={c} className="change-colour-row">
              <span className="swatch" style={{ background: c }} title={c} />
              <span className="change-colour-arrow" aria-hidden="true">
                →
              </span>
              <input
                type="color"
                aria-label={`New colour for ${c}`}
                value={next[c] ?? c}
                autoFocus={i === 0}
                onChange={(e) => setNext((n) => ({ ...n, [c]: e.target.value }))}
              />
              <code>{(next[c] ?? c).toUpperCase()}</code>
            </div>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!Object.keys(changed).length}>
            Change
          </button>
        </div>
      </form>
    </div>
  );
}
