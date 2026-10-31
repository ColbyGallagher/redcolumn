import { useState } from 'react';
import type { PictureColours } from '../markup/pictureColours';

interface Props {
  onApply: (mode: PictureColours) => Promise<void>;
  onCancel: () => void;
}

type Kind = 'grayscale' | 'blackAndWhite' | 'invert' | 'replace';

/** Right-click › Change Picture Colours: a Snapshot or other picture turned grey, black on white, inverted, or one colour swapped for another. */
export function PictureColoursDialog({ onApply, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>('grayscale');
  const [replace, setReplace] = useState('#ffffff');
  const [withColour, setWithColour] = useState('#000000');
  const [seeThrough, setSeeThrough] = useState(true);
  const [tolerance, setTolerance] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode: PictureColours = kind === 'replace' ? { replace, with: seeThrough ? null : withColour, tolerance: tolerance / 100 } : kind;
  const option = (value: Kind, label: string) => (
    <label className="row">
      <input type="radio" checked={kind === value} onChange={() => setKind(value)} />
      {label}
    </label>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          onApply(mode).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Change Picture Colours</h3>
        <fieldset>
          <legend>Change the picture's colours to</legend>
          {option('grayscale', 'Greyscale')}
          {option('blackAndWhite', 'Black on white (everything but white becomes black)')}
          {option('invert', 'Inverted (black and white swap, other colours go to their opposites)')}
          {option('replace', 'Swap one colour for another')}
          {kind === 'replace' && (
            <>
              <div className="row">
                <input type="color" aria-label="Colour to replace" value={replace} onChange={(e) => setReplace(e.target.value)} title="Colour to replace" />
                →
                {!seeThrough && <input type="color" aria-label="Replace with" value={withColour} onChange={(e) => setWithColour(e.target.value)} title="Replace with" />}
                {seeThrough && <span>see-through</span>}
                within
                <input
                  type="number"
                  aria-label="Tolerance"
                  min={0}
                  max={50}
                  value={tolerance}
                  style={{ width: 56 }}
                  onChange={(e) => setTolerance(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                />
                %
              </div>
              <label className="check">
                <input type="checkbox" checked={seeThrough} onChange={(e) => setSeeThrough(e.target.checked)} />
                Make it see-through (a white background lets the page show through)
              </label>
            </>
          )}
        </fieldset>
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Working…' : 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
