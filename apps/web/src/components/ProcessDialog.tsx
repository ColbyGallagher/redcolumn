import { useState } from 'react';
import type { ColourMode } from '../documents/process';
import { usePageChoice } from './PageToolsDialog';

export type ProcessSpec =
  | { kind: 'flatten'; recovery: boolean }
  | { kind: 'reduce'; recompress: boolean; quality: number }
  | { kind: 'colour'; mode: ColourMode; pages: number[] };

export type ProcessKind = ProcessSpec['kind'];

interface Props {
  kind: ProcessKind;
  pageCount: number;
  currentPage: number;
  markupCount: number;
  fileSize: number;
  onApply: (spec: ProcessSpec) => Promise<void>;
  onCancel: () => void;
}

const TITLES: Record<ProcessKind, string> = { flatten: 'Flatten', reduce: 'Reduce File Size', colour: 'Colour Processing' };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;

/** Document › Flatten, Reduce File Size and Colour Processing. */
export function ProcessDialog({ kind, pageCount, currentPage, markupCount, fileSize, onApply, onCancel }: Props) {
  const choice = usePageChoice(pageCount, currentPage, 'all');
  const [recovery, setRecovery] = useState(true);
  const [recompress, setRecompress] = useState(true);
  const [quality, setQuality] = useState(0.7);
  const [mode, setMode] = useState<ColourMode>('grayscale');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec: ProcessSpec | null =
    kind === 'flatten' ? { kind, recovery } : kind === 'reduce' ? { kind, recompress, quality } : choice.pages?.length ? { kind, mode, pages: choice.pages } : null;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal print-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!spec || busy) return;
          setBusy(true);
          setError(null);
          onApply(spec).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
      >
        <h3>{TITLES[kind]}</h3>
        {kind === 'flatten' && (
          <>
            <p>
              Burns {markupCount} markup{markupCount === 1 ? '' : 's'} into the page content, so every reader shows them and they can no longer be edited. Links and form
              fields stay interactive.
            </p>
            <label className="check">
              <input type="checkbox" checked={recovery} onChange={(e) => setRecovery(e.target.checked)} />
              Allow markup recovery (Document › Unflatten brings them back)
            </label>
          </>
        )}
        {kind === 'reduce' && (
          <>
            <p>
              The file is {mb(fileSize)}. Unused objects (old revisions, deleted pages, unused fonts and pictures) are dropped and the rest packed more tightly.
            </p>
            <label className="check">
              <input type="checkbox" checked={recompress} onChange={(e) => setRecompress(e.target.checked)} />
              Recompress JPEG pictures at quality
              <input type="number" min={0.3} max={0.95} step={0.05} value={quality} disabled={!recompress} style={{ width: 64 }} onChange={(e) => setQuality(Math.min(0.95, Math.max(0.3, Number(e.target.value) || 0.7)))} />
            </label>
          </>
        )}
        {kind === 'colour' && (
          <>
            <fieldset>
              <legend>Convert the drawing's colours to</legend>
              <label className="row">
                <input type="radio" checked={mode === 'grayscale'} onChange={() => setMode('grayscale')} />
                Greyscale
              </label>
              <label className="row">
                <input type="radio" checked={mode === 'black'} onChange={() => setMode('black')} />
                Black (everything but white)
              </label>
              <label className="row">
                <input type="radio" checked={typeof mode === 'object'} onChange={() => setMode({ replace: '#ff0000', with: '#000000', tolerance: 0.05 })} />
                Replace one colour
              </label>
              {typeof mode === 'object' && (
                <div className="row">
                  <input type="color" value={mode.replace} onChange={(e) => setMode({ ...mode, replace: e.target.value })} title="Colour to replace" />
                  →
                  <input type="color" value={mode.with} onChange={(e) => setMode({ ...mode, with: e.target.value })} title="Replace with" />
                  within
                  <input type="number" min={0} max={50} value={Math.round(mode.tolerance * 100)} style={{ width: 56 }} onChange={(e) => setMode({ ...mode, tolerance: Math.max(0, Math.min(50, Number(e.target.value) || 0)) / 100 })} />%
                </div>
              )}
            </fieldset>
            {choice.ui}
            <p className="print-hint">{typeof mode === 'object' ? 'Lines, fills and text of that colour change; pictures stay as they are.' : 'Lines, fills, text and pictures change.'} Markups are not changed.</p>
          </>
        )}
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!spec || busy || (kind === 'flatten' && !markupCount)}>
            {busy ? 'Working…' : 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
