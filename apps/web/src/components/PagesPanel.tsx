import { useEffect, useRef, useState } from 'react';
import type { PageOp, PdfDocument } from '@nb/pdf-core';
import type { SheetInfo } from '@nb/sheets';
import type { Scale } from '@nb/measure';
import { ScaleControl } from './ScaleControl';

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
          const { bitmap } = await job.doc.renderTile(job.page, scale, 0, 0, Math.ceil(size.width * scale), Math.ceil(size.height * scale));
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

interface ThumbProps {
  doc: PdfDocument;
  page: number;
  /** Width drawn on screen. Can change ahead of `renderW` while the slider is moving. */
  thumbW: number;
  /** Width the bitmap is rendered at, after the slider settles. */
  renderW: number;
  label: string;
  /** Printed sheet number, edited by double-clicking the label. */
  sheet: string;
  scale?: string;
  editable: boolean;
  active: boolean;
  selected: boolean;
  dropBefore: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onRename: (sheet: string) => void;
}

function Thumbnail({ doc, page, thumbW, renderW, label, sheet, scale, editable, active, selected, dropBefore, onClick, onDragStart, onDragOver, onDrop, onRename }: ThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [editing, setEditing] = useState(false);
  const size = doc.pages[page]!;
  const height = Math.round((thumbW * size.height) / size.width);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let cancelled = false;
    const draw = (b: ImageBitmap) => {
      if (cancelled) return;
      canvas.width = b.width;
      canvas.height = b.height;
      canvas.getContext('2d')!.drawImage(b, 0, 0);
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
  }, [doc, page, renderW]);

  useEffect(() => {
    if (active) canvasRef.current?.parentElement?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      className={`thumb${active ? ' active' : ''}${selected ? ' selected' : ''}${dropBefore ? ' drop-before' : ''}`}
      onClick={onClick}
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
      {scale && <span className="thumb-scale">{scale}</span>}
    </button>
  );
}

interface Props {
  doc: PdfDocument | null;
  currentPage: number;
  sheets: Readonly<Record<number, SheetInfo>>;
  scales: Readonly<Record<number, Scale>>;
  busy: boolean;
  onGoTo: (pageIndex: number) => void;
  /** Applies page operations to the document (and everything attached to its pages). */
  onPageOps: (ops: PageOp[], inserts?: ArrayBuffer[]) => void;
  onExtract: (pages: number[]) => void;
  onSetScale: (pages: number[], scale: Scale) => void;
  onSetLabel: (pages: number[], label: string) => void;
}

/** Page thumbnails with selection, reordering by drag, and page operations. */
export function PagesPanel({ doc, currentPage, sheets, scales, busy, onGoTo, onPageOps, onExtract, onSetScale, onSetLabel }: Props) {
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState(0);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [thumbW, setThumbW] = useState(storedThumbWidth);
  /** Bitmap width. Follows the slider after a short pause so dragging does not re-render every pixel. */
  const [renderW, setRenderW] = useState(thumbW);
  /** Pages being dragged, captured at drag start (selection state may not have updated yet). */
  const dragging = useRef<number[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

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
      <div className="sheet-actions">
        <button className="btn small" disabled={busy} title={`Rotate ${plural} anticlockwise`} onClick={() => onPageOps([{ type: 'rotate', pages: chosen, quarterTurns: -1 }])}>
          ⟲
        </button>
        <button className="btn small" disabled={busy} title={`Rotate ${plural} clockwise`} onClick={() => onPageOps([{ type: 'rotate', pages: chosen, quarterTurns: 1 }])}>
          ⟳
        </button>
        <button
          className="btn small"
          disabled={busy || chosen.length >= count}
          title={`Delete ${plural}`}
          onClick={() => {
            if (confirm(`Delete ${plural} (${chosen.map((p) => p + 1).join(', ')})? Markups on ${chosen.length > 1 ? 'them' : 'it'} are deleted too.`)) {
              onPageOps([{ type: 'delete', pages: chosen }]);
            }
          }}
        >
          Delete
        </button>
        <button className="btn small" disabled={busy} title={`Save ${plural} as a new PDF`} onClick={() => onExtract(chosen)}>
          Extract
        </button>
        <button className="btn small" disabled={busy} title="Insert the pages of another PDF after the selection" onClick={() => fileRef.current?.click()}>
          Insert PDF…
        </button>
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
          pageCount={chosen.length}
          disabled={busy}
          showAllPages={false}
          onPreset={(s) => onSetScale(chosen, s)}
          onApplyAll={() => {}}
        />
      </div>
      <p className="empty">{selected.length > 1 ? `${selected.length} pages selected · ` : ''}Drag to reorder. Ctrl/Shift+click to select several. Double-click a label to rename it.</p>
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
      <div
        className="thumbs"
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
            key={`${doc.id}:${i}`}
            doc={doc}
            page={i}
            thumbW={thumbW}
            renderW={renderW}
            label={sheets[i]?.number ? `${sheets[i]!.number} · ${i + 1}` : String(i + 1)}
            sheet={sheets[i]?.number ?? ''}
            scale={scales[i]?.label}
            editable={!busy}
            onRename={(v) => onSetLabel([i], v)}
            active={i === currentPage}
            selected={selected.includes(i)}
            dropBefore={dropAt === i}
            onClick={(e) => click(i, e)}
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
    </div>
  );
}
