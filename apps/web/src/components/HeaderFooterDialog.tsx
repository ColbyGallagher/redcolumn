import { useRef, useState } from 'react';
import { SLOTS, TOKENS, type HeaderFooterSpec, type Slot } from '../documents/headerFooter';
import { usePageChoice } from './PageToolsDialog';

interface Props {
  /** `number`: Document › Number Pages (page or Bates numbers preset in the footer). */
  mode: 'headerFooter' | 'number';
  pageCount: number;
  currentPage: number;
  /** The document already has headers or footers from this app. */
  hasExisting: boolean;
  onApply: (spec: HeaderFooterSpec, pages: number[]) => Promise<void>;
  onRemove: () => Promise<void>;
  onCancel: () => void;
  /** Batch: every page of many files, numbered on across them; no page range. */
  batch?: boolean;
}

const SLOT_LABELS: Record<Slot, string> = {
  headerLeft: 'Header left',
  headerCenter: 'Header centre',
  headerRight: 'Header right',
  footerLeft: 'Footer left',
  footerCenter: 'Footer centre',
  footerRight: 'Footer right',
};

const KEY = 'nb.headerFooter';

function saved(): Partial<HeaderFooterSpec> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<HeaderFooterSpec>;
  } catch {
    return {};
  }
}

/**
 * Document › Headers & Footers and Number Pages: text in six positions with tokens for page
 * numbers, page labels, Bates numbers, the file name and the date. They are added in their own
 * layer of the page content, so they can be changed or removed later.
 */
export function HeaderFooterDialog({ mode, pageCount, currentPage, hasExisting, onApply, onRemove, onCancel, batch }: Props) {
  const last = saved();
  const choice = usePageChoice(pageCount, currentPage, 'all');
  const [text, setText] = useState<Partial<Record<Slot, string>>>(
    mode === 'number' ? { footerRight: 'Page <<page>> of <<pages>>' } : (last.text ?? { headerLeft: '<<file>>', footerRight: 'Page <<page>> of <<pages>>' }),
  );
  const [fontSize, setFontSize] = useState(last.fontSize ?? 10);
  const [color, setColor] = useState(last.color ?? '#000000');
  const [font, setFont] = useState<HeaderFooterSpec['font']>(last.font ?? 'Helvetica');
  const [marginIn, setMarginIn] = useState(last.margin ? last.margin.top / 72 : 0.5);
  const [bates, setBates] = useState(last.bates ?? { start: 1, digits: 6, prefix: '', suffix: '' });
  const [startPage, setStartPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef<Slot>('footerRight');

  const insert = (token: string) => {
    const slot = focused.current;
    setText({ ...text, [slot]: `${text[slot] ?? ''}${text[slot] ? ' ' : ''}${token}` });
  };
  const spec: HeaderFooterSpec = {
    text,
    fontSize,
    color,
    font,
    margin: { top: marginIn * 72, bottom: marginIn * 72, left: marginIn * 72, right: marginIn * 72 },
    bates,
    startPage,
  };
  const pages = batch ? [] : choice.pages;
  const empty = !SLOTS.some((s) => text[s]?.trim());
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    fn().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal header-footer print-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if ((!batch && !pages?.length) || empty || busy) return;
          try {
            localStorage.setItem(KEY, JSON.stringify({ ...spec, startPage: undefined }));
          } catch {
            // Remembering the last layout is a convenience.
          }
          run(() => onApply(spec, pages ?? []));
        }}
      >
        <h3>{mode === 'number' ? 'Number Pages' : 'Headers & Footers'}</h3>
        <div className="hf-grid">
          {SLOTS.map((slot) => (
            <label key={slot}>
              {SLOT_LABELS[slot]}
              <input value={text[slot] ?? ''} onFocus={() => (focused.current = slot)} onChange={(e) => setText({ ...text, [slot]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="field-chips">
          {TOKENS.map((t) => (
            <button key={t.token} type="button" className="btn small" title={t.token} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t.token)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="hf-row">
          <label>
            Font
            <select value={font} onChange={(e) => setFont(e.target.value as HeaderFooterSpec['font'])}>
              <option>Helvetica</option>
              <option>Times</option>
              <option>Courier</option>
            </select>
          </label>
          <label>
            Size
            <input type="number" min={4} max={72} value={fontSize} onChange={(e) => setFontSize(Math.max(4, Number(e.target.value) || 10))} style={{ width: 56 }} />
          </label>
          <label>
            Colour
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label>
            Margin (in)
            <input type="number" min={0} step={0.125} value={marginIn} onChange={(e) => setMarginIn(Math.max(0, Number(e.target.value) || 0))} style={{ width: 64 }} />
          </label>
          <label>
            First page no.
            <input type="number" value={startPage} onChange={(e) => setStartPage(Math.floor(Number(e.target.value) || 1))} style={{ width: 56 }} />
          </label>
        </div>
        <fieldset>
          <legend>Bates numbers</legend>
          <div className="hf-row">
            <label>
              Prefix
              <input value={bates.prefix} onChange={(e) => setBates({ ...bates, prefix: e.target.value })} style={{ width: 80 }} />
            </label>
            <label>
              Start
              <input type="number" min={0} value={bates.start} onChange={(e) => setBates({ ...bates, start: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ width: 80 }} />
            </label>
            <label>
              Digits
              <input type="number" min={1} max={12} value={bates.digits} onChange={(e) => setBates({ ...bates, digits: Math.min(12, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} style={{ width: 56 }} />
            </label>
            <label>
              Suffix
              <input value={bates.suffix} onChange={(e) => setBates({ ...bates, suffix: e.target.value })} style={{ width: 80 }} />
            </label>
          </div>
        </fieldset>
        {batch ? <p className="print-hint">Every page of each file. Page numbers start again in each file; Bates numbers carry on from one file to the next, in the order listed.</p> : choice.ui}
        {(error || (!batch && !pages?.length && `Enter pages between 1 and ${pageCount}.`)) && <p className="print-error">{error ?? `Enter pages between 1 and ${pageCount}.`}</p>}
        <div className="actions">
          {hasExisting && (
            <button type="button" className="btn" disabled={busy} onClick={() => run(onRemove)}>
              Remove existing
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={(!batch && !pages?.length) || empty || busy}>
            {busy ? 'Working…' : batch ? 'OK' : 'Apply'}
          </button>
        </div>
      </form>
    </div>
  );
}
