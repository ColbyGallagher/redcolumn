import { useEffect, useRef, useState } from 'react';
import { dominantColours, recolourPixels, type PictureColours } from '../markup/pictureColours';

interface Props {
  /** The picture, as a data URL. */
  source: string;
  onApply: (mode: PictureColours) => Promise<void>;
  onCancel: () => void;
}

/** The picture on a small canvas, for finding its colours and showing it. */
async function smallCopy(source: string): Promise<ImageData> {
  const img = new Image();
  img.src = source;
  await img.decode();
  const k = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

function show(canvas: HTMLCanvasElement | null, pixels: ImageData) {
  if (!canvas) return;
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d')!.putImageData(pixels, 0, 0);
}

/**
 * Right-click › Change Colours on a picture: the colours it mostly uses, each swapped for another
 * colour (or made see-through), with the picture as it is beside how it will look.
 */
export function PictureColoursDialog({ source, onApply, onCancel }: Props) {
  const [base, setBase] = useState<ImageData | null>(null);
  const [colours, setColours] = useState<string[] | null>(null);
  /** What each colour becomes: a colour, or null for see-through. */
  const [next, setNext] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const before = useRef<HTMLCanvasElement>(null);
  const after = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    smallCopy(source).then(
      (pixels) => {
        if (!live) return;
        const found = dominantColours(pixels.data).map((c) => c.hex);
        setBase(pixels);
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
  const mode: PictureColours | null = changed.length ? { swaps: (colours ?? []).map((from) => ({ from, to: next[from] ?? from })) } : null;

  useEffect(() => {
    if (!base) return;
    show(before.current, base);
    const preview = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    if (mode) recolourPixels(preview.data, mode);
    show(after.current, preview);
  });

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal picture-colours"
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
        <h3>Change Colours</h3>
        <p>Each colour the picture mostly uses. A new colour replaces it wherever it is used.</p>
        <div className="picture-previews">
          <figure>
            <canvas ref={before} aria-label="The picture now" />
            <figcaption>Current</figcaption>
          </figure>
          <figure>
            <canvas ref={after} aria-label="The picture with the new colours" />
            <figcaption>Preview</figcaption>
          </figure>
        </div>
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
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !mode}>
            {busy ? 'Working…' : 'Change'}
          </button>
        </div>
      </form>
    </div>
  );
}
