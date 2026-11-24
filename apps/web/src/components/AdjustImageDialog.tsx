import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useEffect, useRef, useState } from 'react';
import { adjustPixels, adjustsPicture, NO_ADJUST, type PictureAdjust } from '../markup/pictureColours';

interface Props {
  /** The picture to preview, as a data URL (the first of the selected pictures). */
  source: string;
  /** How many pictures the adjustment will go to. */
  count: number;
  onApply: (adjust: PictureAdjust) => Promise<void>;
  /** Opens Change Colours for the picture instead (one picture only). */
  onChangeColours?: () => void;
  onCancel: () => void;
}

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
 * Modify › Adjust Image: brightness, contrast, greyscale, invert and making the white background
 * see-through, on the selected pictures (Snapshots and inserted images), with a live preview.
 */
export function AdjustImageDialog({ source, count, onApply, onChangeColours, onCancel }: Props) {
  const [base, setBase] = useState<ImageData | null>(null);
  const [adjust, setAdjust] = useState<PictureAdjust>(NO_ADJUST);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const before = useRef<HTMLCanvasElement>(null);
  const after = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    smallCopy(source).then(
      (pixels) => live && setBase(pixels),
      (err) => live && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [source]);

  const changed = adjustsPicture(adjust);

  useEffect(() => {
    if (!base) return;
    show(before.current, base);
    const preview = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    adjustPixels(preview.data, adjust);
    show(after.current, preview);
  });

  const slider = (key: 'brightness' | 'contrast' | 'whiteOut', label: string, min: number, max: number) => (
    <label className="adjust-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={1} value={adjust[key]} aria-label={label} onChange={(e) => setAdjust((a) => ({ ...a, [key]: Number(e.target.value) }))} />
      <output>{adjust[key]}</output>
    </label>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal picture-colours adjust-image"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !changed) return;
          setBusy(true);
          setError(null);
          onApply(adjust).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>{msg('Adjust Image')}</h3>
        <p>{count > 1 ? msg('Applies to the {count} selected pictures; the first is shown.', { count }) : msg('Adjusts the selected picture. Undo puts it back.')}</p>
        <div className="picture-previews">
          <figure>
            <canvas ref={before} aria-label={msg('The picture now')} />
            <figcaption>{msg('Current')}</figcaption>
          </figure>
          <figure>
            <canvas ref={after} aria-label={msg('The picture adjusted')} />
            <figcaption>{msg('Preview')}</figcaption>
          </figure>
        </div>
        <div className="form-grid">
          {slider('brightness', 'Brightness', -100, 100)}
          {slider('contrast', 'Contrast', -100, 100)}
          {slider('whiteOut', msg('Make white see-through'), 0, 30)}
          <label className="check">
            {keyed(msgParts('{input}Greyscale', { input: <input type="checkbox" checked={adjust.greyscale} onChange={(e) => setAdjust((a) => ({ ...a, greyscale: e.target.checked }))} /> }))}
          </label>
          <label className="check">
            {keyed(msgParts('{input}Invert', { input: <input type="checkbox" checked={adjust.invert} onChange={(e) => setAdjust((a) => ({ ...a, invert: e.target.checked }))} /> }))}
          </label>
        </div>
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          {onChangeColours && (
            <button type="button" className="btn" onClick={onChangeColours}>
              {msg('Change Colours…')}
            </button>
          )}
          <button type="button" className="btn" disabled={!changed} onClick={() => setAdjust(NO_ADJUST)}>
            {msg('Reset')}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !changed}>
            {busy ? msg('Working…') : msg('Apply')}
          </button>
        </div>
      </form>
    </div>
  );
}
