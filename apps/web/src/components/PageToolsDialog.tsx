import { msg, msgParts } from '@nb/i18n';
import { lazy } from '../i18n/lazy';
import { keyed } from '../i18n/keyed';
import { useEffect, useState, type ReactNode } from 'react';
import { PDFDocument } from 'pdf-lib';
import { parsePageRange } from '../documents/printPdf';
import { PAGE_SIZES } from '../documents/pageSizes';
import type { PageRect, SplitSpec } from '../documents/pageTools';
import { DEFAULT_SPLIT, SplitOptions } from './SplitOptions';

export type PageToolSpec =
  | { kind: 'extract'; pages: number[]; oneFilePerPage: boolean; deleteAfter: boolean }
  | ({ kind: 'split' } & SplitSpec)
  | { kind: 'replace'; file: File; targetPages: number[]; sourcePages: number[] }
  | { kind: 'crop'; pages: number[]; margins: { top: number; right: number; bottom: number; left: number } | null; rect: PageRect | null }
  | { kind: 'setup'; pages: number[]; size: { width: number; height: number }; fit: boolean };

export type PageToolKind = PageToolSpec['kind'];

interface Props {
  kind: PageToolKind;
  pageCount: number;
  currentPage: number;
  /** The document's name without `.pdf`, for the split naming example. */
  fileName?: string;
  /** Pages where top-level bookmarks start, for splitting by bookmark. */
  bookmarkStarts: number[];
  /** Crop: a rectangle drawn on the page (page space), if the user drew one. */
  drawnRect: PageRect | null;
  /** Crop: close the dialog so a rectangle can be drawn on the page. */
  onDraw: () => void;
  onApply: (spec: PageToolSpec) => Promise<void>;
  onCancel: () => void;
}

const TITLES = lazy((): Record<PageToolKind, string> => ({
  extract: msg('Extract Pages'),
  split: msg('Split Document'),
  replace: msg('Replace Pages'),
  crop: msg('Crop Pages'),
  setup: msg('Page Setup'),
}));

const UNITS = { in: 72, mm: 72 / 25.4 } as const;

/** Which pages an operation applies to: all, the current one, or a typed range. */
export function usePageChoice(pageCount: number, currentPage: number, initial: 'all' | 'current' = 'current') {
  const [which, setWhich] = useState<'all' | 'current' | 'range'>(initial);
  const [range, setRange] = useState(`${currentPage + 1}`);
  const pages = which === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : which === 'current' ? [currentPage] : parsePageRange(range, pageCount);
  const ui = (
    <fieldset>
      <legend>{msg('Pages')}</legend>
      <label className="row">
        {keyed(msgParts('{input}Current page ({page})', { input: <input type="radio" checked={which === 'current'} onChange={() => setWhich('current')} />, page: currentPage + 1 }))}
      </label>
      <label className="row">
        {keyed(msgParts('{input}All {pageCount} pages', { input: <input type="radio" checked={which === 'all'} onChange={() => setWhich('all')} />, pageCount }))}
      </label>
      <label className="row">
        {keyed(msgParts('{input}Pages{input2}', { input: <input type="radio" checked={which === 'range'} onChange={() => setWhich('range')} />, input2: <input type="text" value={range} aria-label={msg('Page range')} placeholder="e.g. 1-3, 5" onFocus={() => setWhich('range')} onChange={(e) => setRange(e.target.value)} /> }))}
      </label>
    </fieldset>
  );
  return { pages, ui };
}

/**
 * The Document menu's page tools: Extract (one file per page, delete afterwards), Split (every N
 * pages, by file size or at top-level bookmarks, with numbered names), Replace (with pages of another PDF, one for one), Crop (margins
 * or a drawn rectangle) and Page Setup (a new paper size, content centred, scaled to fit or not).
 */
export function PageToolsDialog({ kind, pageCount, currentPage, fileName, bookmarkStarts, drawnRect, onDraw, onApply, onCancel }: Props) {
  const choice = usePageChoice(pageCount, currentPage, kind === 'setup' ? 'all' : 'current');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Extract
  const [oneFile, setOneFile] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  // Split
  const [split, setSplit] = useState<SplitSpec>(() =>
    bookmarkStarts.length > 1 ? { ...DEFAULT_SPLIT, by: 'bookmarks', naming: { ...DEFAULT_SPLIT.naming, mode: 'bookmarks' } } : DEFAULT_SPLIT,
  );
  // Replace
  const [file, setFile] = useState<File | null>(null);
  const [sourceCount, setSourceCount] = useState(0);
  const [sourceRange, setSourceRange] = useState('');
  // Crop
  const [unit, setUnit] = useState<keyof typeof UNITS>('in');
  const [margins, setMargins] = useState({ top: '0.5', right: '0.5', bottom: '0.5', left: '0.5' });
  const [useDrawn, setUseDrawn] = useState(!!drawnRect);
  // Setup
  const [sizeId, setSizeId] = useState('arch-d');
  const [landscape, setLandscape] = useState(true);
  const [fit, setFit] = useState(true);

  useEffect(() => {
    if (!file) return;
    void file
      .arrayBuffer()
      .then((b) => PDFDocument.load(b, { ignoreEncryption: true }))
      .then((d) => {
        setSourceCount(d.getPageCount());
        setSourceRange(`1-${Math.min(d.getPageCount(), choice.pages?.length ?? 1)}`);
      })
      .catch(() => setError(msg('That file could not be read as a PDF.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const sourcePages = sourceCount ? parsePageRange(sourceRange, sourceCount) : null;
  const marginPts = (() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(margins)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return null;
      out[k] = n * UNITS[unit];
    }
    return out as { top: number; right: number; bottom: number; left: number };
  })();

  let spec: PageToolSpec | null = null;
  let problem: string | null = null;
  const pages = choice.pages;
  if (kind !== 'split' && !pages?.length) problem = msg('Enter pages between 1 and {pageCount}.', { pageCount });
  else if (kind === 'extract') spec = { kind, pages: pages!, oneFilePerPage: oneFile, deleteAfter };
  else if (kind === 'split') spec = { kind, ...split };
  else if (kind === 'replace') {
    if (!file) problem = msg('Choose the PDF with the new pages.');
    else if (!sourcePages) problem = sourceCount ? msg('Enter pages of the new PDF between 1 and {sourceCount}.', { sourceCount }) : null;
    else if (sourcePages.length !== pages!.length) problem = msg('Pick as many new pages ({count}) as pages to replace ({count2}).', { count: sourcePages.length, count2: pages!.length });
    else spec = { kind, file, targetPages: pages!, sourcePages };
  } else if (kind === 'crop') {
    if (useDrawn && drawnRect) spec = { kind, pages: pages!, margins: null, rect: drawnRect };
    else if (!marginPts) problem = msg('Margins must be numbers of zero or more.');
    else spec = { kind, pages: pages!, margins: marginPts, rect: null };
  } else if (kind === 'setup') {
    const p = PAGE_SIZES.find((s) => s.id === sizeId)!;
    spec = { kind, pages: pages!, size: landscape ? { width: p.height, height: p.width } : { width: p.width, height: p.height }, fit };
  }

  let body: ReactNode = null;
  if (kind === 'extract')
    body = (
      <>
        {choice.ui}
        <label className="check">
          {keyed(msgParts('{input}One file per page (downloaded as a zip)', { input: <input type="checkbox" checked={oneFile} onChange={(e) => setOneFile(e.target.checked)} /> }))}
        </label>
        <label className="check">
          {keyed(msgParts('{input}Delete the pages from this document afterwards', { input: <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} /> }))}
        </label>
      </>
    );
  else if (kind === 'split') body = <SplitOptions value={split} onChange={setSplit} pageCount={pageCount} bookmarkCount={bookmarkStarts.length} exampleBase={fileName} />;
  else if (kind === 'replace')
    body = (
      <>
        {choice.ui}
        <fieldset>
          <legend>{msg('New pages')}</legend>
          <label className="row">
            {keyed(msgParts('PDF{input}', { input: <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /> }))}
          </label>
          {sourceCount > 0 && (
            <label className="row">
              {keyed(msgParts('Its pages{input}of {sourceCount}', { input: <input type="text" value={sourceRange} aria-label={msg('Pages of the new PDF')} onChange={(e) => setSourceRange(e.target.value)} />, sourceCount }))}
            </label>
          )}
        </fieldset>
        <p className="print-hint">{msg('Markups stay on the replaced pages.')}</p>
      </>
    );
  else if (kind === 'crop')
    body = (
      <>
        {choice.ui}
        <fieldset>
          <legend>{msg('Crop to')}</legend>
          <label className="row">
            <input type="radio" checked={!useDrawn} onChange={() => setUseDrawn(false)} />
            {msg('Margins')}
            <select value={unit} onChange={(e) => setUnit(e.target.value as keyof typeof UNITS)}>
              <option value="in">{msg('in')}</option>
              <option value="mm">{msg('mm')}</option>
            </select>
          </label>
          <div className="margins" onFocus={() => setUseDrawn(false)}>
            {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
              <label key={k}>
                {k[0]!.toUpperCase() + k.slice(1)}
                <input type="number" min={0} step="any" value={margins[k]} onChange={(e) => setMargins({ ...margins, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <label className="row">
            <input type="radio" checked={useDrawn} disabled={!drawnRect} onChange={() => setUseDrawn(true)} />
            {drawnRect ? msg('The rectangle drawn on the page') : msg('A rectangle drawn on the page')}
            <button type="button" className="btn small" onClick={onDraw}>
              {msg('Draw…')}
            </button>
          </label>
        </fieldset>
      </>
    );
  else if (kind === 'setup')
    body = (
      <>
        {choice.ui}
        <fieldset>
          <legend>{msg('New page size')}</legend>
          <label className="row">
            <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} aria-label={msg('Paper size')}>
              {PAGE_SIZES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            {keyed(msgParts('{input}Portrait{input2}Landscape', { input: <input type="radio" checked={!landscape} onChange={() => setLandscape(false)} />, input2: <input type="radio" checked={landscape} onChange={() => setLandscape(true)} /> }))}
          </label>
          <label className="check">
            {keyed(msgParts('{input}Scale content to fit (otherwise keep its size, centred)', { input: <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> }))}
          </label>
        </fieldset>
        <p className="print-hint">{msg('Markups move and scale with the content.')}</p>
      </>
    );

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal page-tools print-dialog"
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
        <h3>{TITLES()[kind]}</h3>
        {body}
        {(problem || error) && <p className="print-error">{error ?? problem}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!spec || busy}>
            {busy ? msg('Working…') : 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
