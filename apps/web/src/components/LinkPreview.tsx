import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** What a preview shows: the page point at its centre, and CSS pixels per page point. */
export interface PreviewView {
  cx: number;
  cy: number;
  zoom: number;
}

/** A drawn preview: the canvas, its top-left in page space, and the view it was drawn for. */
export interface PreviewDrawing {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  view: PreviewView;
}

/** A floating preview of the sheet or detail a link points to. */
export interface LinkPreviewWindow {
  id: string;
  /** `3/A-501 → A-501 Details`. */
  title: string;
  /** A pinned preview stays when another link is clicked; an unpinned one is replaced. */
  pinned: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  windows: readonly LinkPreviewWindow[];
  /** Draws what a window shows in `width` × `height` CSS pixels (the link's target when no `view` is given); null when it cannot be drawn. */
  render: (id: string, width: number, height: number, view?: PreviewView) => Promise<PreviewDrawing | null>;
  onChange: (w: LinkPreviewWindow) => void;
  onOpen: (id: string) => void;
  /** Goes back to the place the link was clicked (the mark that opened a title, or the title that opened a mark). */
  onBack?: (id: string) => void;
  onClose: (id: string) => void;
  /** Changes when the markups may have changed, so the previews draw again. */
  revision?: unknown;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 60;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const MIN_W = 220;
const MIN_H = 160;

/**
 * Previews of linked sections and details beside the plan: moved by the title bar, resized from a
 * corner, zoomed with the wheel (or + and −), panned by dragging, closed with Esc.
 */
export function LinkPreviews({ windows, render, onChange, onOpen, onBack, onClose, revision }: Props) {
  // Esc closes the preview being used, or else the newest one (not from a dialog or a field being typed in).
  useEffect(() => {
    if (!windows.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const inside = t?.closest?.('.link-preview')?.getAttribute('data-preview');
      if (inside) {
        // Esc in a preview is for it alone.
        e.stopPropagation();
        onClose(inside);
        return;
      }
      // Elsewhere the page still gets Esc too (to cancel a markup being drawn, say).
      onClose(windows[windows.length - 1]!.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [windows, onClose]);
  return (
    <>
      {windows.map((w) => (
        <PreviewWindow key={w.id} win={w} render={render} onChange={onChange} onOpen={onOpen} onBack={onBack} onClose={onClose} revision={revision} />
      ))}
    </>
  );
}

function PreviewWindow({ win, render, onChange, onOpen, onBack, onClose, revision }: { win: LinkPreviewWindow } & Omit<Props, 'windows'>) {
  const body = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const drag = useRef<{ kind: 'move' | 'size'; x: number; y: number; from: LinkPreviewWindow } | null>(null);
  const [live, setLive] = useState(win);
  useEffect(() => setLive(win), [win]);

  // Zoom and pan: `view` is what the person asked for (null: fit the link's target); `shown` is what is drawn.
  const [view, setView] = useState<PreviewView | null>(null);
  const [shown, setShown] = useState<{ view: PreviewView } | null>(null);
  const latest = useRef<PreviewView | null>(null);
  latest.current = view ?? shown?.view ?? null;
  const pan = useRef<{ x: number; y: number; from: PreviewView } | null>(null);

  /** Zooms by `factor`, keeping the page point under (`px`, `py`), in body pixels, where it is. */
  const zoomAt = (factor: number, px: number, py: number) => {
    const el = body.current;
    const b = latest.current;
    if (!el || !b) return;
    const z = clampZoom(b.zoom * factor);
    const dx = px - el.clientWidth / 2;
    const dy = py - el.clientHeight / 2;
    const next = { cx: b.cx + dx / b.zoom - dx / z, cy: b.cy + dy / b.zoom - dy / z, zoom: z };
    latest.current = next;
    setView(next);
  };
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    // The wheel zooms where the pointer is; it has to be a non-passive listener to stop the page scrolling.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAtRef.current(Math.exp(-dy * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const panStart = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !latest.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, from: latest.current };
  };
  const panMove = (e: ReactPointerEvent) => {
    const d = pan.current;
    if (!d) return;
    const next = { ...d.from, cx: d.from.cx - (e.clientX - d.x) / d.from.zoom, cy: d.from.cy - (e.clientY - d.y) / d.from.zoom };
    latest.current = next;
    setView(next);
  };
  const panEnd = () => {
    pan.current = null;
  };
  const step = (factor: number) => {
    const el = body.current;
    if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };
  // Until the new drawing arrives, the old one is moved and scaled to match the view asked for.
  const el = body.current;
  const interim =
    view && shown && el && view !== shown.view
      ? (() => {
          const s = view.zoom / shown.view.zoom;
          const W = el.clientWidth;
          const H = el.clientHeight;
          return `translate(${W / 2 - (s * W) / 2 + (shown.view.cx - view.cx) * view.zoom}px, ${H / 2 - (s * H) / 2 + (shown.view.cy - view.cy) * view.zoom}px) scale(${s})`;
        })()
      : undefined;

  // Draw the view to fit the body, again (shortly) after a resize, zoom or pan.
  useEffect(() => {
    let cancelled = false;
    const el = body.current;
    const into = host.current;
    if (!el || !into) return;
    const timer = setTimeout(() => {
      const { clientWidth, clientHeight } = el;
      void render(win.id, clientWidth, clientHeight, view ?? undefined)
        .then((drawn) => {
          if (cancelled) return;
          if (!drawn) return setState('failed');
          const { canvas, x0, y0, view: v } = drawn;
          canvas.className = 'link-preview-canvas';
          canvas.style.left = `${(x0 - (v.cx - clientWidth / 2 / v.zoom)) * v.zoom}px`;
          canvas.style.top = `${(y0 - (v.cy - clientHeight / 2 / v.zoom)) * v.zoom}px`;
          into.replaceChildren(canvas);
          setShown({ view: v });
          setState('ready');
        })
        .catch(() => !cancelled && setState('failed'));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [win.id, win.w, win.h, render, revision, view]);

  const start = (kind: 'move' | 'size') => (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, from: live };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 40;
    setLive(
      d.kind === 'move'
        ? { ...d.from, x: Math.min(maxX, Math.max(0, d.from.x + dx)), y: Math.min(maxY, Math.max(0, d.from.y + dy)) }
        : { ...d.from, w: Math.max(MIN_W, d.from.w + dx), h: Math.max(MIN_H, d.from.h + dy) },
    );
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onChange(live);
  };

  return (
    <div className={`link-preview${win.pinned ? ' pinned' : ''}`} data-preview={win.id} role="dialog" aria-label={`Preview of ${win.title}`} style={{ left: live.x, top: live.y, width: live.w, height: live.h }}>
      <div className="link-preview-head" onPointerDown={start('move')} onPointerMove={onMove} onPointerUp={onUp}>
        <span className="link-preview-title" title={win.title}>
          {win.title}
        </span>
        <button type="button" className={`link-preview-btn${win.pinned ? ' on' : ''}`} aria-pressed={win.pinned} title={win.pinned ? 'Unpin: the next link replaces this preview' : 'Pin: keep this preview when another link is clicked'} onClick={() => onChange({ ...live, pinned: !win.pinned })}>
          📌
        </button>
        <button type="button" className="link-preview-btn" title="Zoom out" aria-label="Zoom out" onClick={() => step(1 / 1.4)}>
          −
        </button>
        <button type="button" className="link-preview-btn" title="Zoom in" aria-label="Zoom in" onClick={() => step(1.4)}>
          +
        </button>
        <button type="button" className="link-preview-btn" title="Fit the link's target again" onClick={() => setView(null)}>
          Fit
        </button>
        {onBack && (
          <button type="button" className="link-preview-btn" title="Go back to where this link was clicked" onClick={() => onBack(win.id)}>
            Back
          </button>
        )}
        <button type="button" className="link-preview-btn" title="Open the sheet" onClick={() => onOpen(win.id)}>
          Open
        </button>
        <button type="button" className="link-preview-btn" aria-label="Close preview" title="Close (Esc)" onClick={() => onClose(win.id)}>
          ×
        </button>
      </div>
      <div className="link-preview-body" ref={body} title="Scroll to zoom, drag to pan, double-click to open the sheet" onDoubleClick={() => onOpen(win.id)} onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={panEnd}>
        <div className="link-preview-host" ref={host} style={interim ? { transform: interim } : undefined} />
        {state === 'loading' && <span className="link-preview-status">Loading…</span>}
        {state === 'failed' && <span className="link-preview-status">This sheet could not be drawn.</span>}
      </div>
      <div className="link-preview-grip" aria-hidden="true" onPointerDown={start('size')} onPointerMove={onMove} onPointerUp={onUp} />
    </div>
  );
}
