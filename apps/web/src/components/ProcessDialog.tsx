import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
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

/** The processes in English, for revision notes (stored with the file). */
export const PROCESS_ENGLISH: Record<ProcessKind, string> = { flatten: 'Flatten', reduce: 'Reduce File Size', colour: 'Colour Processing' };
export const PROCESS_TITLES = (): Record<ProcessKind, string> => ({ flatten: msg('Flatten'), reduce: msg('Reduce File Size'), colour: msg('Colour Processing') });

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
        <h3>{PROCESS_TITLES()[kind]}</h3>
        {kind === 'flatten' && (
          <>
            <p>
              {msg('Burns {markupCount, plural, one {# markup} other {# markups}} into the page content, so every reader shows them and they can no longer be edited. Links and form fields stay interactive.', { markupCount })}
            </p>
            <label className="check">
              {keyed(msgParts('{input}Allow markup recovery (Document › Unflatten brings them back)', { input: <input type="checkbox" checked={recovery} onChange={(e) => setRecovery(e.target.checked)} /> }))}
            </label>
          </>
        )}
        {kind === 'reduce' && (
          <>
            <p>
              {msg('The file is {mb}. Unused objects (old revisions, deleted pages, unused fonts and pictures) are dropped and the rest packed more tightly.', { mb: mb(fileSize) })}
            </p>
            <label className="check">
              {keyed(msgParts('{input}Recompress JPEG pictures at quality{input2}', { input: <input type="checkbox" checked={recompress} onChange={(e) => setRecompress(e.target.checked)} />, input2: <input type="number" min={0.3} max={0.95} step={0.05} value={quality} disabled={!recompress} style={{ width: 64 }} onChange={(e) => setQuality(Math.min(0.95, Math.max(0.3, Number(e.target.value) || 0.7)))} /> }))}
            </label>
          </>
        )}
        {kind === 'colour' && (
          <>
            <fieldset>
              <legend>{msg('Convert the drawing\'s colours to')}</legend>
              <label className="row">
                {keyed(msgParts('{input}Greyscale', { input: <input type="radio" checked={mode === 'grayscale'} onChange={() => setMode('grayscale')} /> }))}
              </label>
              <label className="row">
                {keyed(msgParts('{input}Black (everything but white)', { input: <input type="radio" checked={mode === 'black'} onChange={() => setMode('black')} /> }))}
              </label>
              <label className="row">
                {keyed(msgParts('{input}Replace one colour', { input: <input type="radio" checked={typeof mode === 'object'} onChange={() => setMode({ replace: '#ff0000', with: '#000000', tolerance: 0.05 })} /> }))}
              </label>
              {typeof mode === 'object' && (
                <div className="row">
                  {keyed(msgParts('{input}→{input2}within{input3}%', { input: <input type="color" value={mode.replace} onChange={(e) => setMode({ ...mode, replace: e.target.value })} title={msg('Colour to replace')} />, input2: <input type="color" value={mode.with} onChange={(e) => setMode({ ...mode, with: e.target.value })} title={msg('Replace with')} />, input3: <input type="number" min={0} max={50} value={Math.round(mode.tolerance * 100)} style={{ width: 56 }} onChange={(e) => setMode({ ...mode, tolerance: Math.max(0, Math.min(50, Number(e.target.value) || 0)) / 100 })} /> }))}
                </div>
              )}
            </fieldset>
            {choice.ui}
            <p className="print-hint">{msg('{value} Markups are not changed. The drawing as it was is kept under Document › Revisions.', { value: typeof mode === 'object' ? msg('Lines, fills and text of that colour change; pictures stay as they are.') : msg('Lines, fills, text and pictures change.') })}</p>
          </>
        )}
        {error && <p className="print-error">{error}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!spec || busy || (kind === 'flatten' && !markupCount)}>
            {busy ? msg('Working…') : 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
