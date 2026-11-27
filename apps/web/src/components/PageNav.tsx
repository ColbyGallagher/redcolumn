import { msg } from '@nb/i18n';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { FitMode } from '../viewer/TileViewer';

const ZOOM_PRESETS = [6400, 3200, 2400, 1600, 800, 400, 200, 150, 125, 100, 75, 50, 25, 12.5] as const;

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
  /** Active sticky fit mode, for highlighting Fit Page / Fit Width in the strip and zoom menu. */
  fitMode?: FitMode;
  /** Highest zoom percentage offered in the zoom presets menu (default 6400). */
  maxZoom?: number;
  continuous: boolean;
  /** Pages per row (1: single column, 2: side-by-side). */
  columns?: 1 | 2;
  /** First page sits alone on the right in side-by-side layout. */
  cover?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFitWidth: () => void;
  onActualSize?: () => void;
  /** Switches page layout (single, continuous, side-by-side, continuous side-by-side, cover page). Absent in single-page-only views. */
  onLayout?: (columns: 1 | 2, cover: boolean, continuous: boolean) => void;
  /** The active tool, and a switch to pan (Shift+V), select (V) or select text (Shift+T). */
  tool?: string;
  onTool?: (tool: 'pan' | 'select' | 'selectText') => void;
  sheetLabel?: string;
  sheetTitle?: string;
  pageWidthPt: number | null;
  pageHeightPt: number | null;
  scaleControl?: ReactNode;
  /** Sets the zoom (CSS px per point, 1 = 100%) typed into the zoom box. */
  onZoomTo?: (zoom: number) => void;
  onBack?: () => void;
  onForward?: () => void;
  canBack?: boolean;
  canForward?: boolean;
}

const layoutIcon = (d: string) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICON_SINGLE = 'M4 1.5h8v13H4z';
const ICON_CONTINUOUS = 'M4 1h8v6H4zM4 9h8v6H4z';
const ICON_SIDE_BY_SIDE = 'M1.5 2.5h6v11h-6zM8.5 2.5h6v11h-6z';
const ICON_CONT_SIDE_BY_SIDE = 'M1.5 1h6v6h-6zM8.5 1h6v6h-6zM1.5 9h6v6h-6zM8.5 9h6v6h-6z';
const ICON_COVER = 'M8.5 2.5h6v11h-6zM2 2.5h4.5M2 5.5h4.5M2 8.5h3';

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
const FOLD_ORDER = ['sheet', 'size', 'history', 'tools', 'layout', 'fit', 'ends', 'scale', 'zoom'] as const;
type Fold = (typeof FOLD_ORDER)[number];

/**
 * True when any part of the strip is wider than the room it has. The right-hand side is packed to
 * its right edge, so it overflows to the left, which scrollWidth does not count: look for a control
 * that starts before its side does.
 */
function overflowing(el: HTMLElement) {
  if ([el, ...Array.from(el.children)].some((c) => c.scrollWidth > c.clientWidth + 1)) return true;
  return Array.from(el.children).some((side) => {
    const left = side.getBoundingClientRect().left;
    return Array.from(side.children).some((c) => c.getBoundingClientRect().left < left - 1);
  });
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
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(0);
  const [width, setWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const cols = p.columns ?? 1;
  const cover = p.cover ?? false;
  const maxZ = p.maxZoom ?? 6400;
  const zoomPresets = ZOOM_PRESETS.filter((z) => z <= maxZ);
  const content = [p.sheetLabel, p.sheetTitle, size?.short, !!p.onBack, p.continuous, cols, pageCount].join('|');
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    // Its own window's observer: the strip can be shown in a popped-out window.
    const RO = el.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const ro = new RO(([e]) => setWidth(Math.round(e!.contentRect.width)));
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
  const inMenu = FOLD_ORDER.filter(
    (f) => hidden.has(f) && (f !== 'sheet' || p.sheetLabel) && (f !== 'size' || size) && (f !== 'history' || p.onBack || p.onForward) && (f !== 'tools' || p.onTool),
  );
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
    const doc = menuRef.current?.ownerDocument ?? document;
    doc.addEventListener('pointerdown', away, true);
    doc.addEventListener('keydown', esc, true);
    return () => {
      doc.removeEventListener('pointerdown', away, true);
      doc.removeEventListener('keydown', esc, true);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (!zoomOpen) return;
    const away = (e: PointerEvent) => {
      if (!zoomMenuRef.current?.contains(e.target as Node)) setZoomOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomOpen(false);
    };
    const doc = zoomMenuRef.current?.ownerDocument ?? document;
    doc.addEventListener('pointerdown', away, true);
    doc.addEventListener('keydown', esc, true);
    return () => {
      doc.removeEventListener('pointerdown', away, true);
      doc.removeEventListener('keydown', esc, true);
    };
  }, [zoomOpen]);
  /** A menu row that runs `fn` and closes the menu. */
  const item = (label: string, fn: (() => void) | undefined, off: boolean, keys?: string, active?: boolean) => (
    <button
      type="button"
      role="menuitem"
      className={`pagenav-menu-item${active ? ' active' : ''}`}
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
            <button className="btn flat" disabled={disabled} onClick={p.onZoomOut} title={msg('Zoom out (−)')}>
              −
            </button>
            <div className="pagenav-zoom" ref={zoomMenuRef}>
              <input
                className="zoom"
                aria-label={msg('Zoom')}
                title={msg('Zoom: type a percentage and press Enter')}
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
              {p.onZoomTo && (
                <button
                  type="button"
                  className={`btn flat pagenav-zoom-btn${zoomOpen ? ' active' : ''}`}
                  disabled={disabled}
                  title={msg('Zoom presets')}
                  aria-label={msg('Zoom presets')}
                  aria-haspopup="menu"
                  aria-expanded={zoomOpen}
                  onClick={() => setZoomOpen((o) => !o)}
                >
                  ▾
                </button>
              )}
              {zoomOpen && (
                <div className="pagenav-menu pagenav-zoom-menu" role="menu">
                  {zoomPresets.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      role="menuitem"
                      className={`pagenav-menu-item${!p.fitMode && Math.abs(p.zoom * 100 - pct) < 0.5 ? ' active' : ''}`}
                      onClick={() => {
                        p.onZoomTo?.(pct / 100);
                        setZoomOpen(false);
                      }}
                    >
                      <span>{`${pct}%`}</span>
                    </button>
                  ))}
                  <div className="pagenav-menu-sep" role="separator" />
                  {p.onActualSize && (
                    <button
                      type="button"
                      role="menuitem"
                      className={`pagenav-menu-item${!p.fitMode && Math.abs(p.zoom - 1) < 0.005 ? ' active' : ''}`}
                      onClick={() => {
                        p.onActualSize?.();
                        setZoomOpen(false);
                      }}
                    >
                      <span>{msg('Actual Size')}</span>
                      <kbd>Ctrl+8</kbd>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className={`pagenav-menu-item${p.fitMode === 'page' ? ' active' : ''}`}
                    onClick={() => {
                      p.onFit();
                      setZoomOpen(false);
                    }}
                  >
                    <span>{msg('Fit Page')}</span>
                    <kbd>Ctrl+9</kbd>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`pagenav-menu-item${p.fitMode === 'width' ? ' active' : ''}`}
                    onClick={() => {
                      p.onFitWidth();
                      setZoomOpen(false);
                    }}
                  >
                    <span>{msg('Fit Width')}</span>
                    <kbd>Ctrl+0</kbd>
                  </button>
                </div>
              )}
            </div>
            <button className="btn flat" disabled={disabled} onClick={p.onZoomIn} title={msg('Zoom in (+)')}>
              +
            </button>
          </>
        )}
        {show('fit') && (
          <>
            <button
              className={`btn flat${p.fitMode === 'page' ? ' active' : ''}`}
              disabled={disabled}
              onClick={p.onFit}
              title={msg('Fit page (Ctrl+9)')}
              aria-pressed={p.fitMode === 'page'}
            >
              ⤢
            </button>
            <button
              className={`btn flat${p.fitMode === 'width' ? ' active' : ''}`}
              disabled={disabled}
              onClick={p.onFitWidth}
              title={msg('Fit width (Ctrl+0)')}
              aria-pressed={p.fitMode === 'width'}
            >
              ↔
            </button>
          </>
        )}
        {show('layout') && p.onLayout && (
          <span className="pagenav-layouts" role="group" aria-label={msg('Page Layout')}>
            <button
              type="button"
              className={`btn flat pagenav-layout-btn${!p.continuous && cols === 1 ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => p.onLayout?.(1, cover, false)}
              title={msg('Single Page (Ctrl+4)')}
              aria-label={msg('Single Page')}
              aria-pressed={!p.continuous && cols === 1}
            >
              {layoutIcon(ICON_SINGLE)}
            </button>
            <button
              type="button"
              className={`btn flat pagenav-layout-btn${p.continuous && cols === 1 ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => p.onLayout?.(1, cover, true)}
              title={msg('Continuous Pages (Ctrl+5)')}
              aria-label={msg('Continuous Pages')}
              aria-pressed={p.continuous && cols === 1}
            >
              {layoutIcon(ICON_CONTINUOUS)}
            </button>
            <button
              type="button"
              className={`btn flat pagenav-layout-btn${!p.continuous && cols === 2 ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => p.onLayout?.(2, cover, false)}
              title={msg('Side-by-Side (Ctrl+6)')}
              aria-label={msg('Side-by-Side')}
              aria-pressed={!p.continuous && cols === 2}
            >
              {layoutIcon(ICON_SIDE_BY_SIDE)}
            </button>
            <button
              type="button"
              className={`btn flat pagenav-layout-btn${p.continuous && cols === 2 ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => p.onLayout?.(2, cover, true)}
              title={msg('Continuous Side-by-Side (Ctrl+7)')}
              aria-label={msg('Continuous Side-by-Side')}
              aria-pressed={p.continuous && cols === 2}
            >
              {layoutIcon(ICON_CONT_SIDE_BY_SIDE)}
            </button>
            {cols === 2 && (
              <button
                type="button"
                className={`btn flat pagenav-layout-btn${cover ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => p.onLayout?.(2, !cover, p.continuous)}
                title={msg('Show Cover Page in Side-by-Side')}
                aria-label={msg('Show Cover Page in Side-by-Side')}
                aria-pressed={cover}
              >
                {layoutIcon(ICON_COVER)}
              </button>
            )}
          </span>
        )}
        {show('tools') && p.onTool && (
          <>
            <button className={`btn flat${p.tool === 'pan' ? ' active' : ''}`} disabled={disabled} onClick={() => p.onTool?.('pan')} title={msg('Pan (Shift+V)')} aria-label={msg('Pan')} aria-pressed={p.tool === 'pan'}>
              ✥
            </button>
            <button className={`btn flat${p.tool === 'select' ? ' active' : ''}`} disabled={disabled} onClick={() => p.onTool?.('select')} title={msg('Select (V)')} aria-label={msg('Select')} aria-pressed={p.tool === 'select'}>
              ➤
            </button>
            <button className={`btn flat${p.tool === 'selectText' ? ' active' : ''}`} disabled={disabled} onClick={() => p.onTool?.('selectText')} title={msg('Select text (Shift+T)')} aria-label={msg('Select text')} aria-pressed={p.tool === 'selectText'}>
              Ꭲ
            </button>
          </>
        )}
      </div>
      <div className="pagenav-center">
        {p.onBack && show('history') && (
          <button className="btn flat" disabled={disabled || !p.canBack} onClick={p.onBack} title={msg('Previous view (Alt+←)')}>
            ↶
          </button>
        )}
        {show('ends') && (
          <button className="btn flat" disabled={disabled || pageIndex <= 0} onClick={p.onFirst} title={msg('First page')}>
            |‹
          </button>
        )}
        <button className="btn flat" disabled={disabled || pageIndex <= 0} onClick={p.onPrev} title={msg('Previous page (Page Up)')}>
          ‹
        </button>
        <span className="page-field">
          <input
            aria-label={msg('Page')}
            disabled={disabled}
            placeholder="–"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span>{msg('of {count}', { count: pageCount || '–' })}</span>
        </span>
        <button className="btn flat" disabled={disabled || pageIndex >= pageCount - 1} onClick={p.onNext} title={msg('Next page (Page Down)')}>
          ›
        </button>
        {show('ends') && (
          <button className="btn flat" disabled={disabled || pageIndex >= pageCount - 1} onClick={p.onLast} title={msg('Last page')}>
            ›|
          </button>
        )}
        {p.onForward && show('history') && (
          <button className="btn flat" disabled={disabled || !p.canForward} onClick={p.onForward} title={msg('Next view (Alt+→)')}>
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
          <span className="page-size" title={msg('Page size {long}', { long: size.long })}>
            {size.short}
          </span>
        )}
        {show('scale') && p.scaleControl}
        {inMenu.length > 0 && (
          <div className="pagenav-more" ref={menuRef}>
            <button
              type="button"
              className={`btn flat${menuOpen ? ' active' : ''}`}
              title={msg('More controls (there is no room for them here)')}
              aria-label={msg('More controls')}
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
                    <span className="pagenav-menu-label">{msg('Zoom')}</span>
                    <button type="button" className="btn flat" disabled={disabled} onClick={p.onZoomOut} title={msg('Zoom out (−)')}>
                      −
                    </button>
                    <span className="pagenav-menu-value">{pageCount ? `${Math.round(p.zoom * 100)}%` : '–'}</span>
                    <button type="button" className="btn flat" disabled={disabled} onClick={p.onZoomIn} title={msg('Zoom in (+)')}>
                      +
                    </button>
                  </div>
                )}
                {hidden.has('fit') && (
                  <>
                    {item(msg('⤢  Fit page'), p.onFit, disabled, 'Ctrl+9', p.fitMode === 'page')}
                    {item(msg('↔  Fit width'), p.onFitWidth, disabled, 'Ctrl+0', p.fitMode === 'width')}
                  </>
                )}
                {hidden.has('layout') && p.onLayout && (
                  <>
                    {item(msg('Single Page'), () => p.onLayout?.(1, cover, false), disabled, 'Ctrl+4', !p.continuous && cols === 1)}
                    {item(msg('Continuous Pages'), () => p.onLayout?.(1, cover, true), disabled, 'Ctrl+5', p.continuous && cols === 1)}
                    {item(msg('Side-by-Side'), () => p.onLayout?.(2, cover, false), disabled, 'Ctrl+6', !p.continuous && cols === 2)}
                    {item(msg('Continuous Side-by-Side'), () => p.onLayout?.(2, cover, true), disabled, 'Ctrl+7', p.continuous && cols === 2)}
                    {cols === 2 && item(msg('Show Cover Page in Side-by-Side'), () => p.onLayout?.(2, !cover, p.continuous), disabled, undefined, cover)}
                  </>
                )}
                {hidden.has('tools') && p.onTool && (
                  <>
                    {item(msg('Pan'), () => p.onTool?.('pan'), disabled, 'Shift+V', p.tool === 'pan')}
                    {item(msg('Select'), () => p.onTool?.('select'), disabled, 'V', p.tool === 'select')}
                    {item(msg('Select text'), () => p.onTool?.('selectText'), disabled, 'Shift+T', p.tool === 'selectText')}
                  </>
                )}
                {hidden.has('ends') && (
                  <>
                    {item(msg('|‹  First page'), p.onFirst, disabled || pageIndex <= 0, 'Home')}
                    {item(msg('›|  Last page'), p.onLast, disabled || pageIndex >= pageCount - 1, 'End')}
                  </>
                )}
                {hidden.has('history') && (
                  <>
                    {p.onBack && item(msg('↶  Previous view'), p.onBack, disabled || !p.canBack, 'Alt+←')}
                    {p.onForward && item(msg('↷  Next view'), p.onForward, disabled || !p.canForward, 'Alt+→')}
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
                    {hidden.has('size') && size && <span>{msg('Page size {long}', { long: size.long })}</span>}
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
