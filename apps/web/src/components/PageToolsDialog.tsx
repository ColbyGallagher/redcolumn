import { useEffect, useState, type ReactNode } from 'react';
import { PDFDocument } from 'pdf-lib';
import { parsePageRange } from '../documents/printPdf';
import { PAGE_SIZES } from '../documents/pageSizes';
import type { PageRect } from '../documents/pageTools';

export type PageToolSpec =
  | { kind: 'extract'; pages: number[]; oneFilePerPage: boolean; deleteAfter: boolean }
  | { kind: 'split'; parts: 'count' | 'bookmarks'; count: number }
  | { kind: 'replace'; file: File; targetPages: number[]; sourcePages: number[] }
  | { kind: 'crop'; pages: number[]; margins: { top: number; right: number; bottom: number; left: number } | null; rect: PageRect | null }
  | { kind: 'setup'; pages: number[]; size: { width: number; height: number }; fit: boolean };

export type PageToolKind = PageToolSpec['kind'];

interface Props {
  kind: PageToolKind;
  pageCount: number;
  currentPage: number;
  /** Pages where top-level bookmarks start, for splitting by bookmark. */
  bookmarkStarts: number[];
  /** Crop: a rectangle drawn on the page (page space), if the user drew one. */
  drawnRect: PageRect | null;
  /** Crop: close the dialog so a rectangle can be drawn on the page. */
  onDraw: () => void;
  onApply: (spec: PageToolSpec) => Promise<void>;
  onCancel: () => void;
}

const TITLES: Record<PageToolKind, string> = {
  extract: 'Extract Pages',
  split: 'Split Document',
  replace: 'Replace Pages',
  crop: 'Crop Pages',
  setup: 'Page Setup',
};

const UNITS = { in: 72, mm: 72 / 25.4 } as const;

/** Which pages an operation applies to: all, the current one, or a typed range. */
export function usePageChoice(pageCount: number, currentPage: number, initial: 'all' | 'current' = 'current') {
  const [which, setWhich] = useState<'all' | 'current' | 'range'>(initial);
  const [range, setRange] = useState(`${currentPage + 1}`);
  const pages = which === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : which === 'current' ? [currentPage] : parsePageRange(range, pageCount);
  const ui = (
    <fieldset>
      <legend>Pages</legend>
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
        <input type="text" value={range} aria-label="Page range" placeholder="e.g. 1-3, 5" onFocus={() => setWhich('range')} onChange={(e) => setRange(e.target.value)} />
      </label>
    </fieldset>
  );
  return { pages, ui };
}

/**
 * The Document menu's page tools: Extract (one file per page, delete afterwards), Split (every N
 * pages or at top-level bookmarks), Replace (with pages of another PDF, one for one), Crop (margins
 * or a drawn rectangle) and Page Setup (a new paper size, content centred, scaled to fit or not).
 */
export function PageToolsDialog({ kind, pageCount, currentPage, bookmarkStarts, drawnRect, onDraw, onApply, onCancel }: Props) {
  const choice = usePageChoice(pageCount, currentPage, kind === 'setup' ? 'all' : 'current');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Extract
  const [oneFile, setOneFile] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  // Split
  const [splitBy, setSplitBy] = useState<'count' | 'bookmarks'>(bookmarkStarts.length > 1 ? 'bookmarks' : 'count');
  const [count, setCount] = useState(1);
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
      .catch(() => setError('That file could not be read as a PDF.'));
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
  if (kind !== 'split' && !pages?.length) problem = `Enter pages between 1 and ${pageCount}.`;
  else if (kind === 'extract') spec = { kind, pages: pages!, oneFilePerPage: oneFile, deleteAfter };
  else if (kind === 'split') spec = count >= 1 || splitBy === 'bookmarks' ? { kind, parts: splitBy, count } : null;
  else if (kind === 'replace') {
    if (!file) problem = 'Choose the PDF with the new pages.';
    else if (!sourcePages) problem = sourceCount ? `Enter pages of the new PDF between 1 and ${sourceCount}.` : null;
    else if (sourcePages.length !== pages!.length) problem = `Pick as many new pages (${sourcePages.length}) as pages to replace (${pages!.length}).`;
    else spec = { kind, file, targetPages: pages!, sourcePages };
  } else if (kind === 'crop') {
    if (useDrawn && drawnRect) spec = { kind, pages: pages!, margins: null, rect: drawnRect };
    else if (!marginPts) problem = 'Margins must be numbers of zero or more.';
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
          <input type="checkbox" checked={oneFile} onChange={(e) => setOneFile(e.target.checked)} />
          One file per page (downloaded as a zip)
        </label>
        <label className="check">
          <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} />
          Delete the pages from this document afterwards
        </label>
      </>
    );
  else if (kind === 'split')
    body = (
      <fieldset>
        <legend>Split into</legend>
        <label className="row">
          <input type="radio" checked={splitBy === 'count'} onChange={() => setSplitBy('count')} />
          Files of
          <input type="number" min={1} max={pageCount} value={count} style={{ width: 64 }} onFocus={() => setSplitBy('count')} onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          page{count === 1 ? '' : 's'} ({Math.ceil(pageCount / Math.max(1, count))} files)
        </label>
        <label className="row">
          <input type="radio" checked={splitBy === 'bookmarks'} disabled={bookmarkStarts.length < 2} onChange={() => setSplitBy('bookmarks')} />
          One file per top-level bookmark ({bookmarkStarts.length})
        </label>
      </fieldset>
    );
  else if (kind === 'replace')
    body = (
      <>
        {choice.ui}
        <fieldset>
          <legend>New pages</legend>
          <label className="row">
            PDF
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {sourceCount > 0 && (
            <label className="row">
              Its pages
              <input type="text" value={sourceRange} aria-label="Pages of the new PDF" onChange={(e) => setSourceRange(e.target.value)} />
              of {sourceCount}
            </label>
          )}
        </fieldset>
        <p className="print-hint">Markups stay on the replaced pages.</p>
      </>
    );
  else if (kind === 'crop')
    body = (
      <>
        {choice.ui}
        <fieldset>
          <legend>Crop to</legend>
          <label className="row">
            <input type="radio" checked={!useDrawn} onChange={() => setUseDrawn(false)} />
            Margins
            <select value={unit} onChange={(e) => setUnit(e.target.value as keyof typeof UNITS)}>
              <option value="in">in</option>
              <option value="mm">mm</option>
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
            {drawnRect ? 'The rectangle drawn on the page' : 'A rectangle drawn on the page'}
            <button type="button" className="btn small" onClick={onDraw}>
              Draw…
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
          <legend>New page size</legend>
          <label className="row">
            <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} aria-label="Paper size">
              {PAGE_SIZES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <input type="radio" checked={!landscape} onChange={() => setLandscape(false)} />
            Portrait
            <input type="radio" checked={landscape} onChange={() => setLandscape(true)} />
            Landscape
          </label>
          <label className="check">
            <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} />
            Scale content to fit (otherwise keep its size, centred)
          </label>
        </fieldset>
        <p className="print-hint">Markups move and scale with the content.</p>
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
        <h3>{TITLES[kind]}</h3>
        {body}
        {(problem || error) && <p className="print-error">{error ?? problem}</p>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!spec || busy}>
            {busy ? 'Working…' : 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
