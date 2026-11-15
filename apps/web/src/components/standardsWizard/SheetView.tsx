import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import type { PreviewDrawing, PreviewView } from '../LinkPreview';

export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box shown on the sheet: what the wizard already knows, or the one being answered. */
export interface ShownBox extends PageRect {
  key: string;
  label: string;
  tone: 'done' | 'active' | 'ignore';
}

/** Zoom controls for the strip under the sheet (the app's own PageNav). */
export interface SheetViewApi {
  zoomBy: (factor: number) => void;
  zoomTo: (zoom: number) => void;
  fit: () => void;
  fitWidth: () => void;
}

interface Props {
  ref?: Ref<SheetViewApi>;
  /** The zoom shown (CSS px per point), for the strip under the sheet. */
  onZoom?: (zoom: number) => void;
  pageIndex: number;
  /** The page's size in points. */
  page: { width: number; height: number };
  /** Draws part of a page: `width` × `height` CSS pixels at `view`. */
  render: (pageIndex: number, width: number, height: number, view: PreviewView) => Promise<PreviewDrawing | null>;
  boxes: readonly ShownBox[];
  /** Dragging draws a box (else it pans). */
  drawing: boolean;
  onBox: (rect: PageRect) => void;
  /** Area to show when the page or `focusKey` changes (null: the whole page). */
  focus?: PageRect | null;
  focusKey?: string;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * One sheet of the open document, for the setup wizard: fitted to the pane, zoomed with the wheel
 * or the strip under it (through `ref`), panned by dragging (or with the middle button while drawing), boxes drawn by
 * dragging when `drawing`. Everything it listens to is on its own element, so it works the same in
 * the wizard's own window.
 */
export function SheetView({ ref, onZoom, pageIndex, page, render, boxes, drawing, onBox, focus, focusKey }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<PreviewView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [shown, setShown] = useState<PreviewView | null>(null);
  const [sketch, setSketch] = useState<PageRect | null>(null);
  const sketchRef = useRef<PageRect | null>(null);
  const drag = useRef<{ kind: 'pan' | 'box'; x: number; y: number; from: PreviewView; at: { x: number; y: number } } | null>(null);
  const latest = useRef<PreviewView | null>(null);
  latest.current = view;
  /** The person zoomed or panned: a resize keeps their view rather than fitting again. */
  const moved = useRef(false);

  // The pane's size, watched with its own window's ResizeObserver.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const RO = el.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const ro = new RO(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** The view that fits `area` (with a margin) in the pane. */
  const fit = useCallback(
    (area: PageRect | null | undefined): PreviewView | null => {
      if (!size.w || !size.h) return null;
      const a = area ?? { x: 0, y: 0, w: page.width, h: page.height };
      const pad = area ? Math.max(a.w, a.h) * 0.15 : 0;
      const w = a.w + pad * 2;
      const h = a.h + pad * 2;
      return { cx: a.x + a.w / 2, cy: a.y + a.h / 2, zoom: clamp(Math.min(size.w / w, size.h / h) * 0.97) };
    },
    [size.w, size.h, page.width, page.height],
  );

  // A new page or focus: fit it. (Only then, so a person's zoom survives redraws.)
  const fitted = useRef('');
  useEffect(() => {
    const key = `${pageIndex}:${focusKey ?? ''}`;
    if (!size.w) return;
    if (fitted.current === key && moved.current) return;
    if (fitted.current !== key) moved.current = false;
    fitted.current = key;
    setView(fit(focus));
    // `fit` changes with the pane's size: until the person moves the view, it fits again.
  }, [pageIndex, focusKey, focus, fit, size.w]);

  // Draw (shortly) after the view or size changes.
  useEffect(() => {
    if (!view || !size.w || !size.h) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void render(pageIndex, size.w, size.h, view)
        .then((drawn) => {
          if (cancelled || !host.current) return;
          if (!drawn) return setState('failed');
          const { canvas, x0, y0, view: v } = drawn;
          canvas.className = 'sheet-view-canvas';
          canvas.style.left = `${(x0 - (v.cx - size.w / 2 / v.zoom)) * v.zoom}px`;
          canvas.style.top = `${(y0 - (v.cy - size.h / 2 / v.zoom)) * v.zoom}px`;
          host.current.replaceChildren(host.current.ownerDocument.adoptNode(canvas));
          setShown(v);
          setState('ready');
        })
        .catch(() => !cancelled && setState('failed'));
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [render, pageIndex, view, size.w, size.h]);

  const toPage = (px: number, py: number, v: PreviewView) => ({ x: v.cx + (px - size.w / 2) / v.zoom, y: v.cy + (py - size.h / 2) / v.zoom });
  const toScreen = (r: PageRect, v: PreviewView) => ({ left: (r.x - v.cx) * v.zoom + size.w / 2, top: (r.y - v.cy) * v.zoom + size.h / 2, width: r.w * v.zoom, height: r.h * v.zoom });

  const zoomAt = (factor: number, px: number, py: number) => {
    const v = latest.current;
    if (!v) return;
    moved.current = true;
    const z = clamp(v.zoom * factor);
    const dx = px - size.w / 2;
    const dy = py - size.h / 2;
    const next = { cx: v.cx + dx / v.zoom - dx / z, cy: v.cy + dy / v.zoom - dy / z, zoom: z };
    latest.current = next;
    setView(next);
  };
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (f) => zoomAtRef.current(f, size.w / 2, size.h / 2),
      zoomTo: (z) => {
        const v = latest.current;
        moved.current = true;
        if (v) setView({ ...v, zoom: clamp(z) });
      },
      fit: () => {
        moved.current = false;
        setView(fit(null));
      },
      fitWidth: () => {
        const v = latest.current;
        moved.current = true;
        if (v && size.w) setView({ cx: page.width / 2, cy: v.cy, zoom: clamp(size.w / page.width) });
      },
    }),
    [size.w, size.h, fit, page.width],
  );
  useEffect(() => {
    if (view) onZoom?.(view.zoom);
  }, [view, onZoom]);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAtRef.current(Math.exp(-dy * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: ReactPointerEvent) => {
    const r = body.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: ReactPointerEvent) => {
    const v = latest.current;
    if (!v || (e.button !== 0 && e.button !== 1)) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is gone already: the drag still works while it stays over the sheet.
    }
    const at = local(e);
    drag.current = { kind: drawing && e.button === 0 ? 'box' : 'pan', x: e.clientX, y: e.clientY, from: v, at };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      moved.current = true;
      const next = { ...d.from, cx: d.from.cx - (e.clientX - d.x) / d.from.zoom, cy: d.from.cy - (e.clientY - d.y) / d.from.zoom };
      latest.current = next;
      setView(next);
      return;
    }
    const a = toPage(d.at.x, d.at.y, d.from);
    const p = local(e);
    const b = toPage(p.x, p.y, d.from);
    sketchRef.current = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    setSketch(sketchRef.current);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== 'box') return;
    const s = sketchRef.current;
    sketchRef.current = null;
    setSketch(null);
    // A click, not a drag: nothing drawn.
    if (s && s.w * d.from.zoom > 4 && s.h * d.from.zoom > 4) onBox(clip(s, page));
  };

  const v = view;
  // Until the new drawing arrives, the old one is moved and scaled to match the view asked for.
  const interim =
    v && shown && v !== shown
      ? `translate(${size.w / 2 - ((v.zoom / shown.zoom) * size.w) / 2 + (shown.cx - v.cx) * v.zoom}px, ${size.h / 2 - ((v.zoom / shown.zoom) * size.h) / 2 + (shown.cy - v.cy) * v.zoom}px) scale(${v.zoom / shown.zoom})`
      : undefined;

  return (
    <div className="sheet-view">
      <div
        ref={body}
        className={`sheet-view-body${drawing ? ' drawing' : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onAuxClick={(e) => e.preventDefault()}
        data-testid="sheet-view"
        // Where the page sits, for scripts that box a place on it: centre x, centre y, zoom (screen px per point).
        data-view={v ? `${v.cx},${v.cy},${v.zoom}` : undefined}
      >
        <div ref={host} className="sheet-view-host" style={{ transform: interim, transformOrigin: '0 0' }} />
        {v &&
          boxes.map((b) => (
            <div key={b.key} className={`sheet-view-box ${b.tone}`} style={toScreen(b, v)}>
              <span>{b.label}</span>
            </div>
          ))}
        {v && sketch && <div className="sheet-view-box active sketch" style={toScreen(sketch, v)} />}
        {state === 'loading' && <div className="sheet-view-note">Drawing the sheet…</div>}
        {state === 'failed' && <div className="sheet-view-note">This sheet could not be drawn.</div>}
      </div>
    </div>
  );
}

/** A box kept on the page. */
function clip(r: PageRect, page: { width: number; height: number }): PageRect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.min(page.width, r.x + r.w) - x, h: Math.min(page.height, r.y + r.h) - y };
}
