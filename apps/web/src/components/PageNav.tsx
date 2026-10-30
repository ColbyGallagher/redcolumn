import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  pageIndex: number;
  pageCount: number;
  disabled: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onGoTo: (pageIndex: number) => void;
  zoom: number;
  continuous: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFitWidth: () => void;
  onToggleContinuous: () => void;
  /** The active tool, and a switch to pan (Shift+V), select (V) or select text (Shift+T). */
  tool?: string;
  onTool?: (tool: 'pan' | 'select' | 'selectText') => void;
  sheetLabel?: string;
  sheetTitle?: string;
  pageWidthPt: number | null;
  pageHeightPt: number | null;
  scaleControl: ReactNode;
  /** Sets the zoom (CSS px per point, 1 = 100%) typed into the zoom box. */
  onZoomTo?: (zoom: number) => void;
  onBack?: () => void;
  onForward?: () => void;
  canBack?: boolean;
  canForward?: boolean;
}

/** PDF points → centimetres (72 pt = 1 in). */
function formatPageSize(widthPt: number, heightPt: number) {
  const cm = (pt: number) => ((pt / 72) * 2.54).toFixed(1);
  const inch = (pt: number) => (pt / 72).toFixed(1);
  return { short: `${cm(widthPt)} × ${cm(heightPt)} cm`, long: `${cm(widthPt)} × ${cm(heightPt)} cm (${inch(widthPt)} × ${inch(heightPt)} in)` };
}

/**
 * What folds into the ⌃ menu when the strip is too narrow, first to last. Page navigation (‹, the
 * page box, ›) always stays.
 */
const FOLD_ORDER = ['sheet', 'size', 'history', 'layout', 'fit', 'ends', 'scale', 'zoom'] as const;
type Fold = (typeof FOLD_ORDER)[number];

/** True when any part of the strip is wider than the room it has. */
function overflowing(el: HTMLElement) {
  return [el, ...Array.from(el.children)].some((c) => c.scrollWidth > c.clientWidth + 1);
}

/**
 * The strip under the drawing: zoom and page layout on the left, page navigation in
 * the middle, and the sheet, page size and scale on the right. When the pane is too narrow for all
 * of it, the least used controls fold into a ⌃ menu at the right-hand end instead of overlapping.
 */
export function PageNav(p: Props) {
  const { pageIndex, pageCount, disabled } = p;
  const [draft, setDraft] = useState(String(pageIndex + 1));
  useEffect(() => setDraft(pageCount ? String(pageIndex + 1) : ''), [pageIndex, pageCount]);

  const commit = () => {
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 1 || n > pageCount) {
      setDraft(pageCount ? String(pageIndex + 1) : '');
      return;
    }
    p.onGoTo(n - 1);
  };
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const commitZoom = () => {
    const n = Number.parseFloat((zoomDraft ?? '').replace('%', ''));
    setZoomDraft(null);
    if (Number.isFinite(n) && n > 0) p.onZoomTo?.(n / 100);
  };
  const size = p.pageWidthPt != null && p.pageHeightPt != null ? formatPageSize(p.pageWidthPt, p.pageHeightPt) : null;

  // How many of FOLD_ORDER are folded away. Back to none whenever the room or the content changes,
  // then one more per layout pass (before paint) until everything fits.
  const navRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(0);
  const [width, setWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const content = [p.sheetLabel, p.sheetTitle, size?.short, !!p.onBack, p.continuous, pageCount].join('|');
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => setFolded(0), [width, content]);
  useLayoutEffect(() => {
    const el = navRef.current;
    if (el && folded < FOLD_ORDER.length && overflowing(el)) setFolded((n) => n + 1);
  });
  const hidden = new Set<Fold>(FOLD_ORDER.slice(0, folded));
  const show = (f: Fold) => !hidden.has(f);
  // Folded groups that have something to show in the menu.
  const inMenu = FOLD_ORDER.filter((f) => hidden.has(f) && (f !== 'sheet' || p.sheetLabel) && (f !== 'size' || size) && (f !== 'history' || p.onBack || p.onForward));
  useEffect(() => {
    if (!inMenu.length) setMenuOpen(false);
  }, [inMenu.length]);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [menuOpen]);
  /** A menu row that runs `fn` and closes the menu. */
  const item = (label: string, fn: (() => void) | undefined, off: boolean, keys?: string) => (
    <button
      type="button"
      role="menuitem"
      className="pagenav-menu-item"
      disabled={off || !fn}
      onClick={() => {
        fn?.();
        setMenuOpen(false);
      }}
    >
      <span>{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  );

  return (
    <div className="pagenav" ref={navRef}>
      <div className="pagenav-side left">
        {show('zoom') && (
          <>
            <button className="btn flat" disabled={disabled} onClick={p.onZoomOut} title="Zoom out (−)">
              −
            </button>
            <input
              className="zoom"
              aria-label="Zoom"
              title="Zoom: type a percentage and press Enter"
              disabled={disabled || !p.onZoomTo}
              value={zoomDraft ?? (pageCount ? `${Math.round(p.zoom * 100)}%` : '–')}
              onFocus={(e) => {
                setZoomDraft(String(Math.round(p.zoom * 100)));
                requestAnimationFrame(() => e.target.select());
              }}
              onChange={(e) => setZoomDraft(e.target.value)}
              onBlur={commitZoom}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setZoomDraft(null);
                  requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
                }
              }}
            />
            <button className="btn flat" disabled={disabled} onClick={p.onZoomIn} title="Zoom in (+)">
              +
            </button>
          </>
        )}
        {show('fit') && (
          <>
            <button className="btn flat" disabled={disabled} onClick={p.onFit} title="Fit page (Ctrl+9)">
              ⤢
            </button>
            <button className="btn flat" disabled={disabled} onClick={p.onFitWidth} title="Fit width (Ctrl+0)">
              ↔
            </button>
          </>
        )}
        {show('layout') && (
          <button
            className={`btn flat${p.continuous ? ' active' : ''}`}
            disabled={disabled}
            onClick={p.onToggleContinuous}
            title={p.continuous ? 'Continuous: scroll moves through pages (Ctrl+4 for single page)' : 'Single page: scroll zooms (Ctrl+5 for continuous)'}
          >
            {p.continuous ? '▤ Continuous' : '▢ Single'}
          </button>
        )}
        {show('layout') && p.onTool && (
          <>
            <button className={`btn flat${p.tool === 'pan' ? ' active' : ''}`} disabled={disabled} onClick={() => p.onTool?.('pan')} title="Pan (Shift+V)" aria-label="Pan" aria-pressed={p.tool === 'pan'}>
              ✥
            </button>
            <button className={`btn flat${p.tool === 'select' ? ' active' : ''}`} disabled={disabled} onClick={() => p.onTool?.('select')} title="Select (V)" aria-label="Select" aria-pressed={p.tool === 'select'}>
              ➤
            </button>
            <button className={`btn flat${p.tool === 'selectText' ? ' active' : ''}`} disabled={disabled} onClick={() => p.onTool?.('selectText')} title="Select text (Shift+T)" aria-label="Select text" aria-pressed={p.tool === 'selectText'}>
              Ꭲ
            </button>
          </>
        )}
      </div>
      <div className="pagenav-center">
        {p.onBack && show('history') && (
          <button className="btn flat" disabled={disabled || !p.canBack} onClick={p.onBack} title="Previous view (Alt+←)">
            ↶
          </button>
        )}
        {show('ends') && (
          <button className="btn flat" disabled={disabled || pageIndex <= 0} onClick={p.onFirst} title="First page">
            |‹
          </button>
        )}
        <button className="btn flat" disabled={disabled || pageIndex <= 0} onClick={p.onPrev} title="Previous page (Page Up)">
          ‹
        </button>
        <span className="page-field">
          <input
            aria-label="Page"
            disabled={disabled}
            placeholder="–"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span>of {pageCount || '–'}</span>
        </span>
        <button className="btn flat" disabled={disabled || pageIndex >= pageCount - 1} onClick={p.onNext} title="Next page (Page Down)">
          ›
        </button>
        {show('ends') && (
          <button className="btn flat" disabled={disabled || pageIndex >= pageCount - 1} onClick={p.onLast} title="Last page">
            ›|
          </button>
        )}
        {p.onForward && show('history') && (
          <button className="btn flat" disabled={disabled || !p.canForward} onClick={p.onForward} title="Next view (Alt+→)">
            ↷
          </button>
        )}
      </div>
      <div className="pagenav-side right">
        {p.sheetLabel && show('sheet') && (
          <span className="sheet-label" title={p.sheetTitle ? `${p.sheetLabel} — ${p.sheetTitle}` : p.sheetLabel}>
            <b>{p.sheetLabel}</b> {p.sheetTitle}
          </span>
        )}
        {size && show('size') && (
          <span className="page-size" title={`Page size ${size.long}`}>
            {size.short}
          </span>
        )}
        {show('scale') && p.scaleControl}
        {inMenu.length > 0 && (
          <div className="pagenav-more" ref={menuRef}>
            <button
              type="button"
              className={`btn flat${menuOpen ? ' active' : ''}`}
              title="More controls (there is no room for them here)"
              aria-label="More controls"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {menuOpen && (
              <div className="pagenav-menu" role="menu">
                {hidden.has('zoom') && (
                  <div className="pagenav-menu-row">
                    <span className="pagenav-menu-label">Zoom</span>
                    <button type="button" className="btn flat" disabled={disabled} onClick={p.onZoomOut} title="Zoom out (−)">
                      −
                    </button>
                    <span className="pagenav-menu-value">{pageCount ? `${Math.round(p.zoom * 100)}%` : '–'}</span>
                    <button type="button" className="btn flat" disabled={disabled} onClick={p.onZoomIn} title="Zoom in (+)">
                      +
                    </button>
                  </div>
                )}
                {hidden.has('fit') && (
                  <>
                    {item('⤢  Fit page', p.onFit, disabled, 'Ctrl+9')}
                    {item('↔  Fit width', p.onFitWidth, disabled, 'Ctrl+0')}
                  </>
                )}
                {hidden.has('layout') && item(p.continuous ? '▢  Single page' : '▤  Continuous', p.onToggleContinuous, disabled, p.continuous ? 'Ctrl+4' : 'Ctrl+5')}
                {hidden.has('ends') && (
                  <>
                    {item('|‹  First page', p.onFirst, disabled || pageIndex <= 0, 'Home')}
                    {item('›|  Last page', p.onLast, disabled || pageIndex >= pageCount - 1, 'End')}
                  </>
                )}
                {hidden.has('history') && (
                  <>
                    {p.onBack && item('↶  Previous view', p.onBack, disabled || !p.canBack, 'Alt+←')}
                    {p.onForward && item('↷  Next view', p.onForward, disabled || !p.canForward, 'Alt+→')}
                  </>
                )}
                {hidden.has('scale') && <div className="pagenav-menu-row">{p.scaleControl}</div>}
                {((hidden.has('size') && size) || (hidden.has('sheet') && p.sheetLabel)) && (
                  <div className="pagenav-menu-info">
                    {hidden.has('sheet') && p.sheetLabel && (
                      <span>
                        <b>{p.sheetLabel}</b> {p.sheetTitle}
                      </span>
                    )}
                    {hidden.has('size') && size && <span>Page size {size.long}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
