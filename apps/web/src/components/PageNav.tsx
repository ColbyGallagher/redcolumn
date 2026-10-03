import { useEffect, useState, type ReactNode } from 'react';

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
 * The strip under the drawing: zoom and page layout on the left, page navigation in
 * the middle, and the sheet, page size and scale on the right.
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

  return (
    <div className="pagenav">
      <div className="pagenav-side left">
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
        <button className="btn flat" disabled={disabled} onClick={p.onFit} title="Fit page (Ctrl+9)">
          ⤢
        </button>
        <button className="btn flat" disabled={disabled} onClick={p.onFitWidth} title="Fit width (Ctrl+0)">
          ↔
        </button>
        <button
          className={`btn flat${p.continuous ? ' active' : ''}`}
          disabled={disabled}
          onClick={p.onToggleContinuous}
          title={p.continuous ? 'Continuous: scroll moves through pages (Ctrl+4 for single page)' : 'Single page: scroll zooms (Ctrl+5 for continuous)'}
        >
          {p.continuous ? '▤ Continuous' : '▢ Single'}
        </button>
      </div>
      <div className="pagenav-center">
        {p.onBack && (
          <button className="btn flat" disabled={disabled || !p.canBack} onClick={p.onBack} title="Previous view (Alt+←)">
            ↶
          </button>
        )}
        <button className="btn flat" disabled={disabled || pageIndex <= 0} onClick={p.onFirst} title="First page">
          |‹
        </button>
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
        <button className="btn flat" disabled={disabled || pageIndex >= pageCount - 1} onClick={p.onLast} title="Last page">
          ›|
        </button>
        {p.onForward && (
          <button className="btn flat" disabled={disabled || !p.canForward} onClick={p.onForward} title="Next view (Alt+→)">
            ↷
          </button>
        )}
      </div>
      <div className="pagenav-side right">
        {p.sheetLabel && (
          <span className="sheet-label" title={p.sheetTitle ? `${p.sheetLabel} — ${p.sheetTitle}` : p.sheetLabel}>
            <b>{p.sheetLabel}</b> {p.sheetTitle}
          </span>
        )}
        {size && (
          <span className="page-size" title={`Page size ${size.long}`}>
            {size.short}
          </span>
        )}
        {p.scaleControl}
      </div>
    </div>
  );
}
