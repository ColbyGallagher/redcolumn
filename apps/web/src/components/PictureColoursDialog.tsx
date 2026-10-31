import { useEffect, useState } from 'react';
import { dominantColours, type PictureColours } from '../markup/pictureColours';

interface Props {
  /** The picture, as a data URL. */
  source: string;
  onApply: (mode: PictureColours) => Promise<void>;
  onCancel: () => void;
}

type Kind = 'colours' | 'grayscale' | 'blackAndWhite' | 'invert';

/** The colours a picture mostly uses, found on a small copy of it. */
async function coloursOf(source: string): Promise<string[]> {
  const img = new Image();
  img.src = source;
  await img.decode();
  const k = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return dominantColours(g.getImageData(0, 0, canvas.width, canvas.height).data).map((c) => c.hex);
}

/**
 * Right-click › Change Picture Colours: the colours the picture mostly uses, each swapped for
 * another colour (or made see-through), or the whole picture turned grey, black on white or inverted.
 */
export function PictureColoursDialog({ source, onApply, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>('colours');
  const [colours, setColours] = useState<string[] | null>(null);
  /** What each colour becomes: a colour, or null for see-through. */
  const [next, setNext] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    coloursOf(source).then(
      (found) => {
        if (!live) return;
        setColours(found);
        setNext(Object.fromEntries(found.map((c) => [c, c])));
      },
      (err) => live && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [source]);

  const changed = (colours ?? []).filter((c) => next[c] !== c);
  const mode: PictureColours | null = kind === 'colours' ? (changed.length ? { swaps: (colours ?? []).map((from) => ({ from, to: next[from] ?? from })) } : null) : kind;
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
          if (busy || !mode) return;
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
          <legend>Change the picture's colours</legend>
          {option('colours', 'One colour at a time')}
          {kind === 'colours' && (
            <div className="form-grid change-colours">
              {!colours && !error && <p>Finding the picture's colours…</p>}
              {colours && !colours.length && <p>The picture has no colours to change.</p>}
              {colours?.map((c, i) => {
                const to = next[c];
                return (
                  <div key={c} className="change-colour-row">
                    <span className="swatch" style={{ background: c }} title={c} />
                    <span className="change-colour-arrow" aria-hidden="true">
                      →
                    </span>
                    <input
                      type="color"
                      aria-label={`New colour for ${c}`}
                      value={to ?? c}
                      disabled={to === null}
                      autoFocus={i === 0}
                      onChange={(e) => setNext((n) => ({ ...n, [c]: e.target.value }))}
                    />
                    <label className="check">
                      <input type="checkbox" checked={to === null} onChange={(e) => setNext((n) => ({ ...n, [c]: e.target.checked ? null : c }))} />
                      See-through
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          {option('grayscale', 'Greyscale')}
          {option('blackAndWhite', 'Black on white (everything but white becomes black)')}
          {option('invert', 'Inverted (black and white swap, other colours go to their opposites)')}
        </fieldset>
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !mode}>
            {busy ? 'Working…' : 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
