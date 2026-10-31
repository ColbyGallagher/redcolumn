import { useEffect, useRef, useState } from 'react';
import type { PageOp, PdfDocument } from '@nb/pdf-core';
import { drawMarkup, onImageLoad, type Markup, type MarkupStore } from '@nb/markup';
import type { SheetInfo } from '@nb/sheets';
import { yScaleLabel, type Scale } from '@nb/measure';
import { ScaleControl } from './ScaleControl';
import { OverflowMenu } from './OverflowMenu';
import { SetScaleDialog } from './SetScaleDialog';

/** Thumbnail width in CSS px. The slider moves between these; 150 is the default. */
const THUMB_MIN = 64;
const THUMB_MAX = 360;
const THUMB_DEFAULT = 150;
const THUMB_SIZE_KEY = 'nb.thumbSize';
/** How many default-size thumbnails to keep. Larger sizes keep fewer so memory stays similar. */
const MAX_THUMBS = 400;
/** Rendered thumbnail width, in device pixels. */
const MAX_BITMAP = 800;

function clampThumbWidth(width: number): number {
  return Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(width)));
}

function storedThumbWidth(): number {
  try {
    const raw = localStorage.getItem(THUMB_SIZE_KEY);
    if (raw == null || raw === '') return THUMB_DEFAULT;
    const n = Number(raw);
    if (Number.isFinite(n)) return clampThumbWidth(n);
  } catch {
    // Private mode: use the default for this visit.
  }
  return THUMB_DEFAULT;
}

/**
 * Renders thumbnails one at a time, only for items that are on screen, most recent request
 * first, and caches them per document. Shared by every thumbnail in the panel.
 */
class ThumbnailQueue {
  private cache = new Map<string, ImageBitmap>();
  private wanted = new Map<string, { doc: PdfDocument; page: number; width: number; done: (b: ImageBitmap) => void }>();
  private busy = false;

  private key(doc: PdfDocument, page: number, width: number) {
    return `${doc.id}:${page}:${width}`;
  }

  get(doc: PdfDocument, page: number, width: number): ImageBitmap | undefined {
    return this.cache.get(this.key(doc, page, width));
  }

  request(doc: PdfDocument, page: number, width: number, done: (b: ImageBitmap) => void) {
    const key = this.key(doc, page, width);
    const hit = this.cache.get(key);
    if (hit) return done(hit);
    this.wanted.delete(key);
    this.wanted.set(key, { doc, page, width, done });
    void this.pump();
  }

  cancel(doc: PdfDocument, page: number, width: number) {
    this.wanted.delete(this.key(doc, page, width));
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.wanted.size) {
        // Newest request first: whatever just scrolled into view.
        const [key, job] = [...this.wanted].at(-1)!;
        this.wanted.delete(key);
        const size = job.doc.pages[job.page];
        if (!size) continue;
        const dpr = window.devicePixelRatio || 1;
        const targetW = Math.min(Math.ceil(job.width * dpr), MAX_BITMAP);
        const scale = targetW / size.width;
        try {
          // Behind the view's own renders, and from the optimised copy where there is one.
          const { bitmap } = await job.doc.renderTile(job.page, scale, 0, 0, Math.ceil(size.width * scale), Math.ceil(size.height * scale), { copy: true, priority: 1 });
          const prev = this.cache.get(key);
          if (prev) {
            prev.close();
            this.cache.delete(key);
          }
          this.cache.set(key, bitmap);
          const cap = Math.min(MAX_THUMBS, Math.max(24, Math.round(MAX_THUMBS * (THUMB_DEFAULT / job.width) ** 2)));
          while (this.cache.size > cap) {
            const oldest = this.cache.entries().next().value;
            if (!oldest || oldest[0] === key) break;
            oldest[1].close();
            this.cache.delete(oldest[0]);
          }
          job.done(bitmap);
        } catch (err) {
          console.error('Thumbnail failed', err);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}

const queue = new ThumbnailQueue();

/** Which markups the drawing shows (MarkupTools): hidden layers, the list's hide filter, Show Spaces. */
export interface MarkupView {
  /** The markups of a page the drawing shows, in drawing order. */
  shownMarkups(markups: readonly Markup[]): Markup[];
  subscribeView(listener: () => void): () => void;
}

const NO_MARKUPS: readonly Markup[] = [];

/**
 * Each page's shown markups in drawing order. One subscription for the whole panel; a page keeps
 * the same array while none of its markups changed, so only that page's thumbnail redraws.
 */
function usePagedMarkups(store: MarkupStore | null, view: MarkupView | null): ReadonlyMap<number, readonly Markup[]> {
  const [byPage, setByPage] = useState<ReadonlyMap<number, readonly Markup[]>>(() => new Map());
  useEffect(() => {
    if (!store) {
      setByPage(new Map());
      return;
    }
    const read = () => {
      const grouped = new Map<number, Markup[]>();
      for (const m of store.all()) {
        const list = grouped.get(m.pageIndex);
        if (list) list.push(m);
        else grouped.set(m.pageIndex, [m]);
      }
      setByPage((prev) => {
        const next = new Map<number, readonly Markup[]>();
        for (const [page, list] of grouped) {
          const shown = view ? view.shownMarkups(list) : list.sort((a, b) => a.createdAt - b.createdAt);
          if (!shown.length) continue;
          // Markups are replaced on every edit, so unchanged entries compare equal by reference.
          const old = prev.get(page);
          next.set(page, old && old.length === shown.length && old.every((m, i) => m === shown[i]) ? old : shown);
        }
        return next;
      });
    };
    read();
    const offStore = store.subscribe(read);
    const offView = view?.subscribeView(read);
    return () => {
      offStore();
      offView?.();
    };
  }, [store, view]);
  return byPage;
}

interface ThumbProps {
  doc: PdfDocument;
  /** The document's markups, for their scales and legends. */
  store: MarkupStore | null;
  /** This page's shown markups, drawn over the page. */
  markups: readonly Markup[];
  page: number;
  /** Width drawn on screen. Can change ahead of `renderW` while the slider is moving. */
  thumbW: number;
  /** Width the bitmap is rendered at, after the slider settles. */
  renderW: number;
  label: string;
  /** Printed sheet number, edited by double-clicking the label. */
  sheet: string;
  scale?: string;
  /** Vertical scale, shown under `scale` when the page is scaled differently in Y. */
  yScale?: string;
  editable: boolean;
  active: boolean;
  selected: boolean;
  dropBefore: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onRename: (sheet: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Bumped to open the label editor from outside (the right-click menu's Rename Page Label). */
  renameTick: number;
}

function Thumbnail({ doc, store, markups, page, thumbW, renderW, label, sheet, scale, yScale, editable, active, selected, dropBefore, onClick, onDragStart, onDragOver, onDrop, onRename, onContextMenu, renameTick }: ThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [editing, setEditing] = useState(false);
  /** The rendered page, kept so markup edits redraw without rendering the page again. */
  const [base, setBase] = useState<ImageBitmap | null>(null);
  const [imageTick, setImageTick] = useState(0);
  /** Bumped to render the page again after the queue evicted (and closed) its bitmap. */
  const [renderTick, setRenderTick] = useState(0);
  const size = doc.pages[page]!;
  const height = Math.round((thumbW * size.height) / size.width);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let cancelled = false;
    const draw = (b: ImageBitmap) => {
      if (!cancelled) setBase(b);
    };
    const cached = queue.get(doc, page, renderW);
    if (cached) {
      draw(cached);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) queue.request(doc, page, renderW, draw);
        else queue.cancel(doc, page, renderW);
      },
      { rootMargin: '200px' },
    );
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
      queue.cancel(doc, page, renderW);
    };
  }, [doc, page, renderW, renderTick]);

  // Image markups load asynchronously; draw again once they arrive.
  useEffect(() => (markups.length ? onImageLoad(() => setImageTick((n) => n + 1)) : undefined), [markups]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!base) return;
    // The queue closes bitmaps it evicts; a closed one has zero size. Render the page again (once it
    // is in view) so markup changes still show.
    if (!base.width) {
      setBase(null);
      setRenderTick((n) => n + 1);
      return;
    }
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    if (!markups.length || !store) return;
    const k = base.width / size.width;
    const legends = { all: () => store.all(), scaleFor: (p: number) => store.scaleFor(p), scaleOf: (m: Markup) => store.scaleOf(m) };
    ctx.save();
    ctx.scale(k, k);
    for (const m of markups) {
      try {
        drawMarkup(ctx, m, k, store.scaleOf(m), legends);
      } catch (err) {
        console.error('Thumbnail markup failed', err);
      }
    }
    ctx.restore();
  }, [base, markups, store, size.width, imageTick]);

  useEffect(() => {
    if (renameTick && editable) setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameTick]);

  useEffect(() => {
    if (active) canvasRef.current?.parentElement?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      className={`thumb${active ? ' active' : ''}${selected ? ' selected' : ''}${dropBefore ? ' drop-before' : ''}`}
      onClick={onClick}
      onContextMenu={editing ? undefined : onContextMenu}
      title={editable ? `${label} — double-click the label to rename` : label}
      draggable={!editing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <canvas ref={canvasRef} style={{ width: thumbW, height }} />
      {editing ? (
        <input
          className="thumb-label-edit"
          autoFocus
          defaultValue={sheet}
          placeholder="A-101"
          aria-label="Page label"
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') setEditing(false);
          }}
          onKeyUp={(e) => e.preventDefault()}
          onBlur={(e) => {
            const v = e.target.value.trim();
            setEditing(false);
            if (v && v !== sheet) onRename(v);
          }}
        />
      ) : (
        <span
          onDoubleClick={(e) => {
            if (!editable) return;
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {label}
        </span>
      )}
      {scale && (yScale ? (
        <>
          <span className="thumb-scale">X: {scale}</span>
          <span className="thumb-scale">Y: {yScale}</span>
        </>
      ) : (
        <span className="thumb-scale">{scale}</span>
      ))}
    </button>
  );
}

interface Props {
  doc: PdfDocument | null;
  /** The open document's markups, shown on the thumbnails. */
  store: MarkupStore | null;
  /** Which of them the drawing shows; thumbnails show the same. */
  view: MarkupView | null;
  currentPage: number;
  sheets: Readonly<Record<number, SheetInfo>>;
  scales: Readonly<Record<number, Scale>>;
  busy: boolean;
  onGoTo: (pageIndex: number) => void;
  /** Applies page operations to the document (and everything attached to its pages). */
  onPageOps: (ops: PageOp[], inserts?: ArrayBuffer[]) => void;
  onSetScale: (pages: number[], scale: Scale) => void;
  onSetLabel: (pages: number[], label: string) => void;
  /** Starts the Calibrate tool; null when the document cannot take a scale. */
  onCalibrate: (() => void) | null;
  /** Opens Bulk Apply Page Scale for these pages. */
  onBulkScales: (pages: number[]) => void;
  /** Opens Page Labels (typed, or from regions) for these pages. */
  onPageLabels: (pages: number[]) => void;
  /**
   * Right-click in the thumbnails: `pages` are the pages it acts on (none between thumbnails);
   * `rename` opens that page's label editor.
   */
  onThumbMenu: (e: React.MouseEvent, pages: number[], rename: () => void) => void;
  /** Ctrl+C on the thumbnails: copies these pages. */
  onCopyPages: (pages: number[]) => void;
  /**
   * Ctrl+V on the thumbnails: pastes the copied pages before index `at`. False when there were
   * none to paste, and the key goes on to paste as it would elsewhere.
   */
  onPastePages: (at: number) => boolean;
}

/** Page thumbnails with selection, reordering by drag, and page operations. */
export function PagesPanel({ doc, store, view, currentPage, sheets, scales, busy, onGoTo, onPageOps, onSetScale, onSetLabel, onCalibrate, onBulkScales, onPageLabels, onThumbMenu, onCopyPages, onPastePages }: Props) {
  const [selected, setSelected] = useState<number[]>([]);
  const byPage = usePagedMarkups(store, view);
  const [anchor, setAnchor] = useState(0);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [thumbW, setThumbW] = useState(storedThumbWidth);
  /** Bitmap width. Follows the slider after a short pause so dragging does not re-render every pixel. */
  const [renderW, setRenderW] = useState(thumbW);
  /** Pages being dragged, captured at drag start (selection state may not have updated yet). */
  const dragging = useRef<number[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Below this width the page buttons no longer fit on one row: they collapse into a menu.
  const head = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = head.current;
    if (!el) return;
    const measure = () => setNarrow(el.clientWidth < 330);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [!!doc]);
  const [rename, setRename] = useState<{ page: number; tick: number } | null>(null);
  const [scaleOpen, setScaleOpen] = useState(false);

  // Selection refers to page numbers of the current document; reset when it changes.
  useEffect(() => setSelected([]), [doc]);

  useEffect(() => {
    try {
      localStorage.setItem(THUMB_SIZE_KEY, String(thumbW));
    } catch {
      // Not persisted; applies for this visit.
    }
    if (thumbW === renderW) return;
    const timeout = window.setTimeout(() => setRenderW(thumbW), 150);
    return () => window.clearTimeout(timeout);
  }, [thumbW, renderW]);

  if (!doc) return <p className="empty">No document open.</p>;
  const count = doc.pages.length;
  const chosen = selected.length ? [...selected].sort((a, b) => a - b) : [currentPage];
  const plural = chosen.length > 1 ? `${chosen.length} pages` : 'page';

  const click = (i: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      setSelected(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
      setAnchor(i);
    } else {
      setSelected([i]);
      setAnchor(i);
      onGoTo(i);
    }
  };

  const menu = (i: number, e: React.MouseEvent) => {
    // Right-click on an unselected page selects it, as a plain click would.
    const pages = selected.includes(i) ? chosen : [i];
    if (!selected.includes(i)) {
      setSelected([i]);
      setAnchor(i);
      onGoTo(i);
    }
    onThumbMenu(e, pages, () => setRename((r) => ({ page: i, tick: (r?.tick ?? 0) + 1 })));
  };

  // Ctrl+C / Ctrl+V here copy and paste pages, not markups: the thumbnails' keys stop at the panel.
  const keys = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = e.key.toLowerCase();
    if (key === 'c') onCopyPages(chosen);
    else if (key !== 'v' || busy || !onPastePages(chosen.at(-1)! + 1)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const deletePages = () => {
    if (confirm(`Delete ${plural} (${chosen.map((p) => p + 1).join(', ')})? Markups on ${chosen.length > 1 ? 'them' : 'it'} are deleted too.`)) {
      onPageOps([{ type: 'delete', pages: chosen }]);
    }
  };

  const moveTo = (before: number) => {
    const pages = dragging.current;
    if (!pages.length) return;
    // FPDF_MovePages places the moved pages starting at an index of the resulting document.
    const to = before - pages.filter((p) => p < before).length;
    const unchanged = pages.every((p, k) => p === to + k);
    if (!unchanged) onPageOps([{ type: 'move', pages, to }]);
  };

  return (
    <div className="pages-panel">
      <div className={`pages-head${narrow ? ' narrow' : ''}`} ref={head}>
        <div className="sheet-actions">
          {narrow ? (
            <OverflowMenu
              label="Pages"
              items={[
                { label: 'Rotate anticlockwise', title: `Rotate ${plural} anticlockwise`, disabled: busy, onClick: () => onPageOps([{ type: 'rotate', pages: chosen, quarterTurns: -1 }]) },
                { label: 'Rotate clockwise', title: `Rotate ${plural} clockwise`, disabled: busy, onClick: () => onPageOps([{ type: 'rotate', pages: chosen, quarterTurns: 1 }]) },
                { label: 'Delete', title: `Delete ${plural}`, disabled: busy || chosen.length >= count, onClick: deletePages },
                { label: 'Page Label', title: `Set the label of ${plural}`, disabled: busy, onClick: () => onPageLabels(selected.length > 1 ? chosen : [currentPage]), separated: true },
                { label: 'Insert PDF…', title: 'Insert the pages of another PDF after the selection', disabled: busy, onClick: () => fileRef.current?.click() },
                { label: 'Bulk Scales', title: 'Review and set the scale of many pages at once', disabled: busy, onClick: () => onBulkScales(selected.length > 1 ? chosen : []), separated: true },
              ]}
            />
          ) : (
            <>
              <button className="btn small" disabled={busy} title={`Rotate ${plural} anticlockwise`} onClick={() => onPageOps([{ type: 'rotate', pages: chosen, quarterTurns: -1 }])}>
                ⟲
              </button>
              <button className="btn small" disabled={busy} title={`Rotate ${plural} clockwise`} onClick={() => onPageOps([{ type: 'rotate', pages: chosen, quarterTurns: 1 }])}>
                ⟳
              </button>
              <button className="btn small" disabled={busy || chosen.length >= count} title={`Delete ${plural}`} onClick={deletePages}>
                Delete
              </button>
              <button className="btn small" disabled={busy} title={`Set the label of ${plural}`} onClick={() => onPageLabels(selected.length > 1 ? chosen : [currentPage])}>
                Page Label
              </button>
              <button className="btn small" disabled={busy} title="Insert the pages of another PDF after the selection" onClick={() => fileRef.current?.click()}>
                Insert PDF…
              </button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onPageOps([{ type: 'insert', source: 0, at: chosen.at(-1)! + 1 }], [await file.arrayBuffer()]);
            }}
          />
        </div>
        <div className="sheet-actions">
          <ScaleControl
            scale={chosen.length === 1 ? (scales[chosen[0]!] ?? null) : null}
            disabled={busy}
            onPreset={(s) => onSetScale(chosen, s)}
            onCustom={() => setScaleOpen(true)}
            onBulk={narrow ? undefined : () => onBulkScales(selected.length > 1 ? chosen : [])}
            compact={narrow}
          />
        </div>
      </div>
      <div
        className="thumbs"
        tabIndex={-1}
        onKeyDown={keys}
        onContextMenu={(e) => {
          // Between thumbnails: no page, so only what needs none is offered.
          if ((e.target as HTMLElement).closest('.thumb')) return;
          setSelected([]);
          onThumbMenu(e, [], () => {});
        }}
        onDragLeave={() => setDropAt(null)}
        onDrop={(e) => {
          // Dropped below the last page.
          e.preventDefault();
          if (dropAt === null) moveTo(count);
          setDropAt(null);
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        {doc.pages.map((_, i) => (
          <Thumbnail
            store={store}
            markups={byPage.get(i) ?? NO_MARKUPS}
            key={`${doc.id}:${i}`}
            doc={doc}
            page={i}
            thumbW={thumbW}
            renderW={renderW}
            label={sheets[i]?.number ? `${sheets[i]!.number} · ${i + 1}` : String(i + 1)}
            sheet={sheets[i]?.number ?? ''}
            scale={scales[i]?.label}
            yScale={scales[i] ? yScaleLabel(scales[i]!) ?? undefined : undefined}
            editable={!busy}
            onRename={(v) => onSetLabel([i], v)}
            active={i === currentPage}
            selected={selected.includes(i)}
            dropBefore={dropAt === i}
            onClick={(e) => click(i, e)}
            onContextMenu={(e) => menu(i, e)}
            renameTick={rename?.page === i ? rename.tick : 0}
            onDragStart={(e) => {
              dragging.current = selected.includes(i) ? chosen : [i];
              if (!selected.includes(i)) setSelected([i]);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropAt(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropAt(null);
              moveTo(i);
            }}
          />
        ))}
      </div>
      <label className="thumb-zoom">
        <span aria-hidden="true">−</span>
        <input
          type="range"
          min={THUMB_MIN}
          max={THUMB_MAX}
          step={1}
          value={thumbW}
          aria-label="Thumbnail size"
          title="Thumbnail size"
          onChange={(e) => setThumbW(clampThumbWidth(Number(e.target.value)))}
        />
        <span aria-hidden="true">+</span>
      </label>
      {scaleOpen && (
        <SetScaleDialog
          scale={scales[chosen[0]!] ?? null}
          pageCount={count}
          currentPage={currentPage}
          selected={selected}
          onCalibrate={
            onCalibrate &&
            (() => {
              setScaleOpen(false);
              onCalibrate();
            })
          }
          onApply={(pages, scale) => {
            onSetScale(pages, scale);
            setScaleOpen(false);
          }}
          onCancel={() => setScaleOpen(false)}
        />
      )}
    </div>
  );
}
