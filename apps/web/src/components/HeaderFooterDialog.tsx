import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
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

const SLOT_LABELS = (): Record<Slot, string> => ({
  headerLeft: msg('Header left'),
  headerCenter: msg('Header centre'),
  headerRight: msg('Header right'),
  footerLeft: msg('Footer left'),
  footerCenter: msg('Footer centre'),
  footerRight: msg('Footer right'),
});

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
        <h3>{mode === 'number' ? msg('Number Pages') : msg('Headers & Footers')}</h3>
        <div className="hf-grid">
          {SLOTS.map((slot) => (
            <label key={slot}>
              {SLOT_LABELS()[slot]}
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
            {msg('Font')}
            <select value={font} onChange={(e) => setFont(e.target.value as HeaderFooterSpec['font'])}>
              <option>{msg('Helvetica')}</option>
              <option>{msg('Times')}</option>
              <option>{msg('Courier')}</option>
            </select>
          </label>
          <label>
            {keyed(msgParts('Size{input}', { input: <input type="number" min={4} max={72} value={fontSize} onChange={(e) => setFontSize(Math.max(4, Number(e.target.value) || 10))} style={{ width: 56 }} /> }))}
          </label>
          <label>
            {keyed(msgParts('Colour{input}', { input: <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /> }))}
          </label>
          <label>
            {keyed(msgParts('Margin (in){input}', { input: <input type="number" min={0} step={0.125} value={marginIn} onChange={(e) => setMarginIn(Math.max(0, Number(e.target.value) || 0))} style={{ width: 64 }} /> }))}
          </label>
          <label>
            {keyed(msgParts('First page no.{input}', { input: <input type="number" value={startPage} onChange={(e) => setStartPage(Math.floor(Number(e.target.value) || 1))} style={{ width: 56 }} /> }))}
          </label>
        </div>
        <fieldset>
          <legend>{msg('Bates numbers')}</legend>
          <div className="hf-row">
            <label>
              {keyed(msgParts('Prefix{input}', { input: <input value={bates.prefix} onChange={(e) => setBates({ ...bates, prefix: e.target.value })} style={{ width: 80 }} /> }))}
            </label>
            <label>
              {keyed(msgParts('Start{input}', { input: <input type="number" min={0} value={bates.start} onChange={(e) => setBates({ ...bates, start: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ width: 80 }} /> }))}
            </label>
            <label>
              {keyed(msgParts('Digits{input}', { input: <input type="number" min={1} max={12} value={bates.digits} onChange={(e) => setBates({ ...bates, digits: Math.min(12, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} style={{ width: 56 }} /> }))}
            </label>
            <label>
              {keyed(msgParts('Suffix{input}', { input: <input value={bates.suffix} onChange={(e) => setBates({ ...bates, suffix: e.target.value })} style={{ width: 80 }} /> }))}
            </label>
          </div>
        </fieldset>
        {batch ? <p className="print-hint">{msg('Every page of each file. Page numbers start again in each file; Bates numbers carry on from one file to the next, in the order listed.')}</p> : choice.ui}
        {(error || (!batch && !pages?.length && msg('Enter pages between 1 and {pageCount}.', { pageCount }))) && <p className="print-error">{error ?? msg('Enter pages between 1 and {pageCount}.', { pageCount })}</p>}
        <div className="actions">
          {hasExisting && (
            <button type="button" className="btn" disabled={busy} onClick={() => run(onRemove)}>
              {msg('Remove existing')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={(!batch && !pages?.length) || empty || busy}>
            {busy ? msg('Working…') : batch ? 'OK' : msg('Apply')}
          </button>
        </div>
      </form>
    </div>
  );
}
