import { useState } from 'react';
import { parsePageRange } from '../documents/printPdf';
import { settings, useSettings } from '../settings/settings';

/** Languages OCR can read (their data is served with the app); see documents/ocr.ts. */
const LANGUAGES: [string, string][] = [
  ['eng', 'English'],
  ['fra', 'French'],
  ['deu', 'German'],
  ['spa', 'Spanish'],
  ['ita', 'Italian'],
  ['por', 'Portuguese'],
  ['nld', 'Dutch'],
];

interface Props {
  pageCount: number;
  currentPage: number;
  /** Pages with no text layer (scans), which OCR is for. */
  pagesWithoutText: number[];
  onRun: (pages: number[], dpi: number) => void;
  onCancel: () => void;
}

/**
 * Document › OCR: reads the words on scanned pages and adds them as invisible text, so the pages
 * can be searched, selected, copied and redacted. Runs in the browser.
 */
export function OcrDialog({ pageCount, currentPage, pagesWithoutText, onRun, onCancel }: Props) {
  const [which, setWhich] = useState<'scans' | 'current' | 'all' | 'range'>(pagesWithoutText.length ? 'scans' : 'current');
  const [range, setRange] = useState(`${currentPage + 1}`);
  const [dpi, setDpi] = useState(200);
  const prefs = useSettings();
  const langs = prefs.ocrLanguages.length ? prefs.ocrLanguages : ['eng'];
  const pages =
    which === 'scans' ? pagesWithoutText : which === 'current' ? [currentPage] : which === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : parsePageRange(range, pageCount);
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
          if (pages?.length) onRun(pages, dpi);
        }}
      >
        <h3>OCR</h3>
        <p>Reads the words on scanned pages and adds them as invisible text, so they can be searched, selected and copied. The pages look the same.</p>
        <fieldset>
          <legend>Pages</legend>
          <label className="row">
            <input type="radio" checked={which === 'scans'} disabled={!pagesWithoutText.length} onChange={() => setWhich('scans')} />
            Pages without text ({pagesWithoutText.length})
          </label>
          <label className="row">
            <input type="radio" checked={which === 'current'} onChange={() => setWhich('current')} />
            Current page ({currentPage + 1})
          </label>
          <label className="row">
            <input type="radio" checked={which === 'all'} onChange={() => setWhich('all')} />
            All {pageCount} pages
          </label>
          <label className="row">
            <input type="radio" checked={which === 'range'} onChange={() => setWhich('range')} />
            Pages
            <input type="text" value={range} aria-label="Page range" onFocus={() => setWhich('range')} onChange={(e) => setRange(e.target.value)} />
          </label>
        </fieldset>
        <label className="row">
          Resolution
          <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            <option value={150}>150 dpi (faster)</option>
            <option value={200}>200 dpi</option>
            <option value={300}>300 dpi (small text)</option>
          </select>
        </label>
        <fieldset>
          <legend>Languages</legend>
          <div className="row wrap">
            {LANGUAGES.map(([code, name]) => (
              <label key={code} className="check">
                <input
                  type="checkbox"
                  checked={langs.includes(code)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...langs, code] : langs.filter((l) => l !== code);
                    if (next.length) settings.set({ ocrLanguages: next });
                  }}
                />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="print-hint">Pick the languages on the pages (each extra one makes OCR slower). Large sheets are read at up to 7000 pixels across.</p>
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!pages?.length}>
            Run OCR
          </button>
        </div>
      </form>
    </div>
  );
}
