import { useEffect, useRef, useState } from 'react';
import type { PageOp, PdfDocument } from '@nb/pdf-core';
import type { SheetInfo } from '@nb/sheets';
import type { Scale } from '@nb/measure';
import { ScaleControl } from './ScaleControl';

/** Thumbnail width in CSS px. */
const THUMB_W = 150;
/** Rendered thumbnails kept in memory (~150x106 px each). */
const MAX_THUMBS = 400;

/**
 * Renders thumbnails one at a time, only for items that are on screen, most recent request
 * first, and caches them per document. Shared by every thumbnail in the panel.
 */
class ThumbnailQueue {
  private cache = new Map<string, ImageBitmap>();
  private wanted = new Map<string, { doc: PdfDocument; page: number; done: (b: ImageBitmap) => void }>();
  private busy = false;

  get(doc: PdfDocument, page: number): ImageBitmap | undefined {
    return this.cache.get(`${doc.id}:${page}`);
  }

  request(doc: PdfDocument, page: number, done: (b: ImageBitmap) => void) {
    const key = `${doc.id}:${page}`;
    const hit = this.cache.get(key);
    if (hit) return done(hit);
    this.wanted.delete(key);
    this.wanted.set(key, { doc, page, done });
    void this.pump();
  }

  cancel(doc: PdfDocument, page: number) {
    this.wanted.delete(`${doc.id}:${page}`);
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
        const scale = (THUMB_W * dpr) / size.width;
        try {
          const { bitmap } = await job.doc.renderTile(job.page, scale, 0, 0, Math.ceil(size.width * scale), Math.ceil(size.height * scale));
          this.cache.set(key, bitmap);
          while (this.cache.size > MAX_THUMBS) {
            const [oldKey, old] = this.cache.entries().next().value!;
            old.close();
            this.cache.delete(oldKey);
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
  label: string;
  scale?: string;
  active: boolean;
  selected: boolean;
  dropBefore: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function Thumbnail({ doc, page, label, scale, active, selected, dropBefore, onClick, onDragStart, onDragOver, onDrop }: ThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = doc.pages[page]!;
  const height = Math.round((THUMB_W * size.height) / size.width);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const draw = (b: ImageBitmap) => {
      canvas.width = b.width;
      canvas.height = b.height;
      canvas.getContext('2d')!.drawImage(b, 0, 0);
    };
    const cached = queue.get(doc, page);
    if (cached) {
      draw(cached);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) queue.request(doc, page, draw);
        else queue.cancel(doc, page);
      },
      { rootMargin: '200px' },
    );
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      queue.cancel(doc, page);
    };
  }, [doc, page]);

  useEffect(() => {
    if (active) canvasRef.current?.parentElement?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      className={`thumb${active ? ' active' : ''}${selected ? ' selected' : ''}${dropBefore ? ' drop-before' : ''}`}
      onClick={onClick}
      title={label}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <canvas ref={canvasRef} style={{ width: THUMB_W, height }} />
      <span>{label}</span>
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
  /** Pages being dragged, captured at drag start (selection state may not have updated yet). */
  const dragging = useRef<number[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Selection refers to page numbers of the current document; reset when it changes.
  useEffect(() => setSelected([]), [doc]);

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
        <label className="field" title="Printed sheet number shown on this thumbnail">
          Label
          <input
            key={chosen.join(',') + (sheets[chosen[0]!]?.number ?? '')}
            defaultValue={chosen.length === 1 ? (sheets[chosen[0]!]?.number ?? '') : ''}
            placeholder={chosen.length > 1 ? `${chosen.length} pages` : 'A-101'}
            disabled={busy}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) onSetLabel(chosen, v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
      </div>
      <p className="empty">{selected.length > 1 ? `${selected.length} pages selected · ` : ''}Drag to reorder. Ctrl/Shift+click to select several.</p>
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
            label={sheets[i]?.number ? `${sheets[i]!.number} · ${i + 1}` : String(i + 1)}
            scale={scales[i]?.label}
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
