import { msg } from '@nb/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SnapIndex, type Snap, type SnapKind } from '@nb/measure';
import { affineFromPoints, type Affine } from '../compare/affine';
import type { Box } from '../compare/diff';
import { gridSpacingPoints, settings } from '../settings/settings';

/** A page drawn for picking on: the image and the page's size in points. */
export interface PagePreview {
  url: string;
  width: number;
  height: number;
}

/**
 * Live handle to one PDF page while Align Pages / Select Region is open: supports crisp zoomed
 * tile rendering and CAD-style Snap to Content without reopening the document on every pan/zoom.
 */
export interface PickerPageHandle {
  width: number;
  height: number;
  /** Renders a tile in device pixels at `scale` (px per pt) starting at `(x, y)` in scaled pixels. */
  renderTile: (scale: number, x: number, y: number, width: number, height: number, signal?: AbortSignal) => Promise<ImageBitmap>;
  /** Vector line work for Snap to Content. */
  snapIndex: () => Promise<SnapIndex>;
  /** Releases the underlying document when the picker closes. */
  release: () => void;
}

type Point = [number, number];

interface Common {
  /** Renders a page of a library document (index from 0). */
  preview: (fileId: string, page: number) => Promise<PagePreview>;
  /** Optional live handle for high-res zoomed tiles and Snap to Content. */
  openPage?: (fileId: string, page: number) => Promise<PickerPageHandle>;
  onCancel: () => void;
}

type Props =
  | (Common & {
      mode: 'points';
      old: { fileId: string; page: number };
      cur: { fileId: string; page: number };
      /** Colours for the live alignment preview (defaults to red for old, blue for new). */
      colors?: { old: string; new: string };
      onDone: (transform: Affine) => void;
    })
  | (Common & { mode: 'region'; cur: { fileId: string; page: number }; initial: Box | null; onDone: (region: Box | null) => void });

const COLORS = ['#e02020', '#1a8a1a', '#1a6cff'];

const SNAP_NAMES: Record<SnapKind | 'grid', string> = {
  endpoint: 'Endpoint',
  center: 'Centre',
  geocenter: 'Geometric Centre',
  intersection: 'Intersection',
  apparent: 'Apparent Intersection',
  midpoint: 'Midpoint',
  quadrant: 'Quadrant',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  nearest: 'Nearest',
  grid: 'Grid',
};

const CORE_SNAP_KINDS = new Set<SnapKind>(['endpoint', 'intersection', 'midpoint', 'center', 'quadrant', 'geocenter', 'apparent', 'nearest']);

function configuredSnapKinds(): Set<SnapKind> {
  const s = settings.get();
  const kinds = new Set<SnapKind>();
  if (s.snapEndpoints) kinds.add('endpoint');
  if (s.snapIntersections) kinds.add('intersection');
  if (s.snapMidpoints) kinds.add('midpoint');
  if (s.snapLines) kinds.add('nearest');
  if (s.snapCenters) kinds.add('center');
  if (s.snapQuadrants) kinds.add('quadrant');
  if (s.snapGeoCenters) kinds.add('geocenter');
  if (s.snapApparent) kinds.add('apparent');
  return kinds.size ? kinds : CORE_SNAP_KINDS;
}

interface Camera {
  /** CSS pixels per PDF point. */
  scale: number;
  /** CSS pixel offset of page origin (0, 0) inside the viewport. */
  tx: number;
  ty: number;
}

interface DetailTile {
  bitmap: ImageBitmap;
  pageX: number;
  pageY: number;
  pageW: number;
  pageH: number;
  renderScale: number;
}

interface SnapDisplay {
  point: Point;
  kind: SnapKind | 'grid';
}

interface LoadedPage {
  width: number;
  height: number;
  base: ImageBitmap | HTMLImageElement;
  baseScale: number;
  handle: PickerPageHandle | null;
}

function fitCamera(vw: number, vh: number, pageW: number, pageH: number): Camera {
  const pad = 16;
  const availW = Math.max(40, vw - pad * 2);
  const availH = Math.max(40, vh - pad * 2);
  const scale = Math.min(availW / pageW, availH / pageH);
  return {
    scale,
    tx: (vw - pageW * scale) / 2,
    ty: (vh - pageH * scale) / 2,
  };
}

function drawSnapGlyph(ctx: CanvasRenderingContext2D, sx: number, sy: number, kind: SnapKind | 'grid', color: string) {
  const s = 6;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  switch (kind) {
    case 'endpoint':
    case 'grid':
      ctx.rect(sx - s, sy - s, s * 2, s * 2);
      break;
    case 'intersection':
      ctx.moveTo(sx - s, sy - s);
      ctx.lineTo(sx + s, sy + s);
      ctx.moveTo(sx + s, sy - s);
      ctx.lineTo(sx - s, sy + s);
      break;
    case 'center':
      ctx.arc(sx, sy, s, 0, Math.PI * 2);
      ctx.moveTo(sx - s * 0.55, sy);
      ctx.lineTo(sx + s * 0.55, sy);
      ctx.moveTo(sx, sy - s * 0.55);
      ctx.lineTo(sx, sy + s * 0.55);
      break;
    case 'quadrant':
      ctx.arc(sx, sy, s * 0.55, 0, Math.PI * 2);
      ctx.moveTo(sx + s, sy);
      ctx.lineTo(sx, sy + s);
      ctx.lineTo(sx - s, sy);
      ctx.lineTo(sx, sy - s);
      ctx.closePath();
      break;
    case 'geocenter':
      ctx.arc(sx, sy, s, 0, Math.PI * 2);
      for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        ctx.moveTo(sx + Math.cos(a) * s * 0.6, sy + Math.sin(a) * s * 0.6);
        ctx.lineTo(sx - Math.cos(a) * s * 0.6, sy - Math.sin(a) * s * 0.6);
      }
      break;
    case 'apparent':
      ctx.rect(sx - s, sy - s, s * 2, s * 2);
      ctx.moveTo(sx - s * 0.6, sy - s * 0.6);
      ctx.lineTo(sx + s * 0.6, sy + s * 0.6);
      ctx.moveTo(sx + s * 0.6, sy - s * 0.6);
      ctx.lineTo(sx - s * 0.6, sy + s * 0.6);
      break;
    case 'midpoint':
      ctx.moveTo(sx, sy - s);
      ctx.lineTo(sx + s, sy + s);
      ctx.lineTo(sx - s, sy + s);
      ctx.closePath();
      break;
    default:
      // Diamond for nearest / perpendicular / tangent.
      ctx.moveTo(sx, sy - s);
      ctx.lineTo(sx + s, sy);
      ctx.lineTo(sx, sy + s);
      ctx.lineTo(sx - s, sy);
      ctx.closePath();
      break;
  }
  ctx.stroke();

  // Floating tooltip pill to the top-right of the snap glyph.
  const label = SNAP_NAMES[kind];
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(label).width + 10;
  const th = 18;
  const lx = sx + 11;
  const ly = sy - 16;
  ctx.fillStyle = 'rgba(17, 24, 39, 0.88)';
  ctx.beginPath();
  ctx.roundRect(lx, ly - th / 2, tw, th, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, lx + 5, ly);
  ctx.restore();
}

function drawPointMark(ctx: CanvasRenderingContext2D, sx: number, sy: number, index: number, color: string) {
  ctx.save();
  // Crisp white halo underneath so the marker stands out on both light and dark drawings.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(sx - 10, sy);
  ctx.lineTo(sx - 3, sy);
  ctx.moveTo(sx + 3, sy);
  ctx.lineTo(sx + 10, sy);
  ctx.moveTo(sx, sy - 10);
  ctx.lineTo(sx, sy - 3);
  ctx.moveTo(sx, sy + 3);
  ctx.lineTo(sx, sy + 10);
  ctx.stroke();

  // Coloured precision crosshair with clear center so the underlying intersection stays visible.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  ctx.moveTo(sx - 10, sy);
  ctx.lineTo(sx - 3, sy);
  ctx.moveTo(sx + 3, sy);
  ctx.lineTo(sx + 10, sy);
  ctx.moveTo(sx, sy - 10);
  ctx.lineTo(sx, sy - 3);
  ctx.moveTo(sx, sy + 3);
  ctx.lineTo(sx, sy + 10);
  ctx.stroke();

  // Small center dot.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Offset numbered badge.
  const bx = sx + 12;
  const by = sy - 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(bx, by, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(index + 1), bx, by + 0.5);
  ctx.restore();
}

interface PageSurfaceProps {
  page: LoadedPage | null;
  snapIndex: SnapIndex | null;
  snapLoading: boolean;
  snapContent: boolean;
  snapGrid: boolean;
  marks: Point[];
  region?: Box | null;
  onPoint?: (p: Point) => void;
  onRegion?: (r: Box) => void;
  label: string;
  activePrompt?: string | null;
  activeColor?: string;
}

/**
 * Interactive zoomable, pannable page canvas with high-res on-demand tile rendering and
 * CAD-style Snap to Content / Snap to Grid.
 */
function PageSurface({ page, snapIndex, snapLoading, snapContent, snapGrid, marks, region, onPoint, onRegion, label, activePrompt, activeColor }: PageSurfaceProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [cam, setCam] = useState<Camera | null>(null);
  const camRef = useRef<Camera | null>(null);
  camRef.current = cam;
  const [fitScale, setFitScale] = useState(1);
  const fitScaleRef = useRef(1);
  fitScaleRef.current = fitScale;
  const [hoverSnap, setHoverSnap] = useState<SnapDisplay | null>(null);
  const [hoverScreen, setHoverScreen] = useState<Point | null>(null);
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [altDown, setAltDown] = useState(false);
  const [detailTick, setDetailTick] = useState(0);
  const detailRef = useRef<DetailTile | null>(null);

  // Track pointer gesture: either panning or click-to-place (with 5px drag threshold to pan in points mode).
  const gestureRef = useRef<
    | { kind: 'pan'; startX: number; startY: number; startTx: number; startTy: number; moved: boolean }
    | { kind: 'maybe-pan'; pointerId: number; startX: number; startY: number; startTx: number; startTy: number; moved: boolean }
    | null
  >(null);

  // Observe container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setViewport((prev) => (Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5 ? prev : { w: r.width, h: r.height }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track Space (pan) and Alt (bypass snap).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) setSpaceDown(true);
      if (e.key === 'Alt') setAltDown(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
      if (e.key === 'Alt') setAltDown(false);
    };
    const onBlur = () => {
      setSpaceDown(false);
      setAltDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Fit camera when page first loads or container initializes.
  const initPageRef = useRef<LoadedPage | null>(null);
  useEffect(() => {
    if (!page || viewport.w < 10 || viewport.h < 10) return;
    const fitted = fitCamera(viewport.w, viewport.h, page.width, page.height);
    setFitScale(fitted.scale);
    if (initPageRef.current !== page || !camRef.current) {
      initPageRef.current = page;
      setCam(fitted);
    }
  }, [page, viewport.w, viewport.h]);

  // Clean up detail tile on unmount or page change.
  useEffect(() => {
    return () => {
      detailRef.current?.bitmap.close();
      detailRef.current = null;
    };
  }, [page]);

  // Zoom around a point (sx, sy) in viewport CSS pixels.
  const zoomAt = useCallback(
    (factor: number, sx?: number, sy?: number) => {
      if (!page || !camRef.current || viewport.w < 10 || viewport.h < 10) return;
      const cur = camRef.current;
      const minScale = Math.max(0.05, fitScaleRef.current * 0.5);
      const maxScale = Math.max(fitScaleRef.current * 35, 28);
      const nextScale = Math.min(maxScale, Math.max(minScale, cur.scale * factor));
      if (Math.abs(nextScale - cur.scale) < 1e-6) return;
      const cx = sx ?? viewport.w / 2;
      const cy = sy ?? viewport.h / 2;
      const px = (cx - cur.tx) / cur.scale;
      const py = (cy - cur.ty) / cur.scale;
      setCam({
        scale: nextScale,
        tx: cx - px * nextScale,
        ty: cy - py * nextScale,
      });
    },
    [page, viewport.w, viewport.h],
  );

  const resetFit = useCallback(() => {
    if (!page || viewport.w < 10 || viewport.h < 10) return;
    const fitted = fitCamera(viewport.w, viewport.h, page.width, page.height);
    setFitScale(fitted.scale);
    setCam(fitted);
  }, [page, viewport.w, viewport.h]);

  // Non-passive wheel listener for smooth zoom-to-cursor.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!page || !camRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const dir = settings.get().invertWheelZoom ? 1 : -1;
      // Trackpad pinch (ctrlKey) uses smaller deltas than mouse wheel notches.
      const step = e.ctrlKey ? Math.exp(e.deltaY * dir * 0.01) : e.deltaY * dir > 0 ? 1.2 : 1 / 1.2;
      zoomAt(step, sx, sy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [page, zoomAt]);

  // High-resolution viewport tile re-rendering when zoomed in past the overview bitmap.
  useEffect(() => {
    if (!page?.handle || !cam || viewport.w < 10 || viewport.h < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wantScale = cam.scale * dpr;
    if (wantScale <= page.baseScale * 1.15) return;

    const ac = new AbortController();
    const timer = window.setTimeout(async () => {
      const handle = page.handle;
      if (!handle || ac.signal.aborted) return;
      // Visible rectangle in page points, clamped to page bounds.
      const x0 = Math.max(0, -cam.tx / cam.scale);
      const y0 = Math.max(0, -cam.ty / cam.scale);
      const x1 = Math.min(page.width, (viewport.w - cam.tx) / cam.scale);
      const y1 = Math.min(page.height, (viewport.h - cam.ty) / cam.scale);
      const pw = x1 - x0;
      const ph = y1 - y0;
      if (pw <= 0.5 || ph <= 0.5) return;

      // Cap tile pixel size so huge zoom levels stay fast and bounded in memory.
      const maxDim = 2200;
      const renderScale = Math.min(wantScale, maxDim / Math.max(pw, ph));
      const tx = Math.floor(x0 * renderScale);
      const ty = Math.floor(y0 * renderScale);
      const tw = Math.max(1, Math.ceil(x1 * renderScale) - tx);
      const th = Math.max(1, Math.ceil(y1 * renderScale) - ty);

      try {
        const bitmap = await handle.renderTile(renderScale, tx, ty, tw, th, ac.signal);
        if (ac.signal.aborted) {
          bitmap.close();
          return;
        }
        detailRef.current?.bitmap.close();
        detailRef.current = {
          bitmap,
          pageX: tx / renderScale,
          pageY: ty / renderScale,
          pageW: tw / renderScale,
          pageH: th / renderScale,
          renderScale,
        };
        setDetailTick((n) => n + 1);
      } catch {
        // Ignore aborted or transient tile renders; overview bitmap remains visible.
      }
    }, 90);

    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [page, cam, viewport.w, viewport.h]);

  const resolvePoint = useCallback(
    (clientX: number, clientY: number, bypassSnap: boolean): { point: Point; snap: SnapDisplay | null; screen: Point } | null => {
      const el = wrapRef.current;
      const c = camRef.current;
      if (!el || !c || !page) return null;
      const r = el.getBoundingClientRect();
      const sx = clientX - r.left;
      const sy = clientY - r.top;
      const raw: Point = [(sx - c.tx) / c.scale, (sy - c.ty) / c.scale];
      const clamped: Point = [Math.min(page.width, Math.max(0, raw[0])), Math.min(page.height, Math.max(0, raw[1]))];

      if (bypassSnap) return { point: clamped, snap: null, screen: [sx, sy] };

      const s = settings.get();
      const radiusPt = (s.snapSensitivity || 12) / c.scale;
      let hit: Snap | null = null;
      if (snapContent && snapIndex && snapIndex.size > 0) {
        hit = snapIndex.snap(clamped, radiusPt, [], configuredSnapKinds(), s.snapCurves);
      }
      if (hit) {
        return { point: hit.point, snap: { point: hit.point, kind: hit.kind }, screen: [sx, sy] };
      }
      if (snapGrid) {
        const step = gridSpacingPoints(s);
        if (step > 0) {
          const gx = Math.round(clamped[0] / step) * step;
          const gy = Math.round(clamped[1] / step) * step;
          if (Math.hypot(gx - clamped[0], gy - clamped[1]) <= radiusPt) {
            return { point: [gx, gy], snap: { point: [gx, gy], kind: 'grid' }, screen: [sx, sy] };
          }
        }
      }
      return { point: clamped, snap: null, screen: [sx, sy] };
    },
    [page, snapContent, snapGrid, snapIndex],
  );

  // Paint canvas whenever camera, page, detail tile, marks, region, or hover snap changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page || !cam || viewport.w < 10 || viewport.h < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(viewport.w * dpr);
    const ch = Math.round(viewport.h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.w, viewport.h);

    const px = cam.tx;
    const py = cam.ty;
    const pw = page.width * cam.scale;
    const ph = page.height * cam.scale;

    // White sheet background + subtle border.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();

    // Overview page image.
    ctx.drawImage(page.base, px, py, pw, ph);

    // Crisp zoomed detail tile (when available and higher resolution than overview).
    const detail = detailRef.current;
    if (detail && detail.renderScale > page.baseScale * 1.05) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, pw, ph);
      ctx.clip();
      ctx.drawImage(detail.bitmap, px + detail.pageX * cam.scale, py + detail.pageY * cam.scale, detail.pageW * cam.scale, detail.pageH * cam.scale);
      ctx.restore();
    }

    // Subtle page outline.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);

    // Region selection rectangle (for Select Region mode).
    const shown = drag ? boxOf(drag.start, drag.end) : region;
    if (shown) {
      const rx = px + shown.x * cam.scale;
      const ry = py + shown.y * cam.scale;
      const rw = shown.w * cam.scale;
      const rh = shown.h * cam.scale;
      ctx.save();
      ctx.fillStyle = 'rgba(20, 163, 154, 0.14)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#14a39a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }

    // Placed alignment points.
    marks.forEach((pt, i) => {
      drawPointMark(ctx, px + pt[0] * cam.scale, py + pt[1] * cam.scale, i, COLORS[i % COLORS.length]!);
    });

    // Subtle hover crosshair on active target pane (helps line up even without snap).
    if (onPoint && hoverScreen && !panning && !spaceDown) {
      const targetX = hoverSnap ? px + hoverSnap.point[0] * cam.scale : hoverScreen[0];
      const targetY = hoverSnap ? py + hoverSnap.point[1] * cam.scale : hoverScreen[1];
      ctx.save();
      ctx.strokeStyle = activeColor ? `${activeColor}44` : 'rgba(20, 163, 154, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, targetY);
      ctx.lineTo(viewport.w, targetY);
      ctx.moveTo(targetX, 0);
      ctx.lineTo(targetX, viewport.h);
      ctx.stroke();
      ctx.restore();
    }

    // Live CAD snap indicator.
    if (onPoint && hoverSnap && !panning && !spaceDown) {
      const sx = px + hoverSnap.point[0] * cam.scale;
      const sy = py + hoverSnap.point[1] * cam.scale;
      drawSnapGlyph(ctx, sx, sy, hoverSnap.kind, settings.get().snapColour || '#ff8c00');
    }
  }, [page, cam, viewport.w, viewport.h, detailTick, marks, region, drag, hoverSnap, hoverScreen, onPoint, panning, spaceDown, activeColor]);

  const zoomPct = cam && fitScale > 0 ? Math.round((cam.scale / fitScale) * 100) : 100;

  return (
    <figure className={`compare-pick${activePrompt ? ' active-target' : ''}`} style={activePrompt && activeColor ? ({ '--pick-accent': activeColor } as React.CSSProperties) : undefined}>
      <figcaption className="compare-pick-bar">
        <span className="compare-pick-title">{label}</span>
        {activePrompt && (
          <span className="compare-pick-badge" style={activeColor ? { background: activeColor } : undefined}>
            {activePrompt}
          </span>
        )}
        {snapContent && snapLoading && <span className="compare-pick-snap-state">{msg('Loading snap…')}</span>}
        <span className="spacer" />
        <span className="compare-pick-zoom" role="group" aria-label={msg('{label} zoom controls', { label })}>
          <button type="button" className="btn compare-pick-zbtn" title={msg('Zoom out')} aria-label={msg('Zoom out {label}', { label })} disabled={!page} onClick={() => zoomAt(1 / 1.35)}>
            −
          </button>
          <span className="compare-pick-zpct">{zoomPct}%</span>
          <button type="button" className="btn compare-pick-zbtn" title={msg('Zoom in')} aria-label={msg('Zoom in {label}', { label })} disabled={!page} onClick={() => zoomAt(1.35)}>
            +
          </button>
          <button type="button" className="btn compare-pick-zbtn" title={msg('Fit page in view')} aria-label={msg('Fit {label}', { label })} disabled={!page} onClick={resetFit}>
            {msg('Fit')}
          </button>
        </span>
      </figcaption>
      <div
        ref={wrapRef}
        className={`compare-pick-viewport${panning ? ' panning' : spaceDown ? ' pan-ready' : onPoint || onRegion ? ' picking' : ''}`}
        aria-label={label}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (!page || !camRef.current) return;
          // Middle mouse, right mouse, or Space + left mouse: immediate pan.
          if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
            e.preventDefault();
            (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            gestureRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, startTx: camRef.current.tx, startTy: camRef.current.ty, moved: false };
            setPanning(true);
            return;
          }
          if (e.button !== 0) return;
          if (onRegion) {
            const res = resolvePoint(e.clientX, e.clientY, true);
            if (!res) return;
            (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            setDrag({ start: res.point, end: res.point });
            return;
          }
          // In points mode: left-click places a point, left-drag (>5px) pans the view.
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          gestureRef.current = { kind: 'maybe-pan', pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startTx: camRef.current.tx, startTy: camRef.current.ty, moved: false };
        }}
        onPointerMove={(e) => {
          if (!page || !camRef.current) return;
          const g = gestureRef.current;
          if (g) {
            const dx = e.clientX - g.startX;
            const dy = e.clientY - g.startY;
            if (g.kind === 'pan' || g.moved || Math.hypot(dx, dy) > 5) {
              g.moved = true;
              if (!panning) setPanning(true);
              setCam({ scale: camRef.current.scale, tx: g.startTx + dx, ty: g.startTy + dy });
              setHoverSnap(null);
              return;
            }
          }
          if (drag) {
            const res = resolvePoint(e.clientX, e.clientY, true);
            if (res) setDrag({ ...drag, end: res.point });
            return;
          }
          if (onPoint) {
            const res = resolvePoint(e.clientX, e.clientY, e.altKey || altDown);
            setHoverSnap(res?.snap ?? null);
            setHoverScreen(res?.screen ?? null);
          } else {
            setHoverSnap(null);
            setHoverScreen(null);
          }
        }}
        onPointerUp={(e) => {
          const g = gestureRef.current;
          if (g) {
            gestureRef.current = null;
            setPanning(false);
            if (g.kind === 'maybe-pan' && !g.moved && onPoint) {
              const res = resolvePoint(e.clientX, e.clientY, e.altKey || altDown);
              if (res) onPoint(res.point);
            }
            return;
          }
          if (drag) {
            const b = boxOf(drag.start, drag.end);
            setDrag(null);
            if (b.w > 4 && b.h > 4) onRegion?.(b);
          }
        }}
        onPointerCancel={() => {
          gestureRef.current = null;
          setPanning(false);
          setDrag(null);
        }}
        onPointerLeave={() => {
          setHoverSnap(null);
          setHoverScreen(null);
        }}
      >
        {!page ? <div className="compare-pick-loading">{msg('Drawing {label}…', { label: label.toLowerCase() })}</div> : <canvas ref={canvasRef} className="compare-pick-canvas" />}
      </div>
    </figure>
  );
}

function boxOf(a: Point, b: Point): Box {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

/** Tints dark ink on a white page bitmap into `color`, keeping white background white. */
function tintPage(source: ImageBitmap | HTMLImageElement, color: string): HTMLCanvasElement {
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Interactive zoom/pan preview of the 3-point affine alignment: blends the transformed Old page
 * over the New page in colour (matching lines appear dark; misaligned lines show in red/blue).
 */
function AlignmentPreview({
  oldPage,
  curPage,
  transform,
  curPts,
  colors,
}: {
  oldPage: LoadedPage;
  curPage: LoadedPage;
  transform: Affine;
  curPts: Point[];
  colors: { old: string; new: string };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [cam, setCam] = useState<Camera | null>(null);
  const camRef = useRef<Camera | null>(null);
  camRef.current = cam;
  const [fitScale, setFitScale] = useState(1);
  const fitScaleRef = useRef(1);
  fitScaleRef.current = fitScale;
  const [panning, setPanning] = useState(false);
  const [oldOpacity, setOldOpacity] = useState(1);
  const panRef = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);

  const tintedRef = useRef<{ old: HTMLCanvasElement; cur: HTMLCanvasElement } | null>(null);
  const [tintedReady, setTintedReady] = useState(0);

  useEffect(() => {
    tintedRef.current = {
      old: tintPage(oldPage.base, colors.old),
      cur: tintPage(curPage.base, colors.new),
    };
    setTintedReady((n) => n + 1);
    return () => {
      tintedRef.current = null;
    };
  }, [oldPage.base, curPage.base, colors.old, colors.new]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setViewport((prev) => (Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5 ? prev : { w: r.width, h: r.height }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (viewport.w < 10 || viewport.h < 10) return;
    const fitted = fitCamera(viewport.w, viewport.h, curPage.width, curPage.height);
    setFitScale(fitted.scale);
    if (!camRef.current) setCam(fitted);
  }, [curPage.width, curPage.height, viewport.w, viewport.h]);

  const zoomAt = useCallback(
    (factor: number, sx?: number, sy?: number) => {
      if (!camRef.current || viewport.w < 10 || viewport.h < 10) return;
      const cur = camRef.current;
      const minScale = Math.max(0.05, fitScaleRef.current * 0.5);
      const maxScale = Math.max(fitScaleRef.current * 35, 28);
      const nextScale = Math.min(maxScale, Math.max(minScale, cur.scale * factor));
      if (Math.abs(nextScale - cur.scale) < 1e-6) return;
      const cx = sx ?? viewport.w / 2;
      const cy = sy ?? viewport.h / 2;
      const px = (cx - cur.tx) / cur.scale;
      const py = (cy - cur.ty) / cur.scale;
      setCam({ scale: nextScale, tx: cx - px * nextScale, ty: cy - py * nextScale });
    },
    [viewport.w, viewport.h],
  );

  const resetFit = useCallback(() => {
    if (viewport.w < 10 || viewport.h < 10) return;
    const fitted = fitCamera(viewport.w, viewport.h, curPage.width, curPage.height);
    setFitScale(fitted.scale);
    setCam(fitted);
  }, [curPage.width, curPage.height, viewport.w, viewport.h]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!camRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const dir = settings.get().invertWheelZoom ? 1 : -1;
      const step = e.ctrlKey ? Math.exp(e.deltaY * dir * 0.01) : e.deltaY * dir > 0 ? 1.2 : 1 / 1.2;
      zoomAt(step, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const tinted = tintedRef.current;
    if (!canvas || !tinted || !cam || viewport.w < 10 || viewport.h < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(viewport.w * dpr);
    const ch = Math.round(viewport.h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.w, viewport.h);

    const px = cam.tx;
    const py = cam.ty;
    const pw = curPage.width * cam.scale;
    const ph = curPage.height * cam.scale;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();

    // Draw New page tinted in new-revision colour.
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.drawImage(tinted.cur, px, py, pw, ph);

    // Composite transformed Old page on top with multiply so aligned lines appear dark.
    const [a, b, c, d, e, f] = transform;
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = oldOpacity;
    ctx.translate(px, py);
    ctx.scale(cam.scale, cam.scale);
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(tinted.old, 0, 0, oldPage.width, oldPage.height);
    ctx.restore();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);

    curPts.forEach((pt, i) => {
      drawPointMark(ctx, px + pt[0] * cam.scale, py + pt[1] * cam.scale, i, COLORS[i % COLORS.length]!);
    });
  }, [cam, curPage.width, curPage.height, oldPage.width, oldPage.height, transform, curPts, oldOpacity, tintedReady, viewport.w, viewport.h]);

  const zoomPct = cam && fitScale > 0 ? Math.round((cam.scale / fitScale) * 100) : 100;

  return (
    <figure className="compare-pick compare-pick-preview">
      <figcaption className="compare-pick-bar">
        <span className="compare-pick-title">{msg('Alignment preview')}</span>
        <span className="compare-pick-legend">
          <span className="compare-pick-swatch" style={{ background: colors.old }} />
          {msg('Old')}
          <span className="compare-pick-swatch" style={{ background: colors.new }} />
          {msg('New')}
          <span className="compare-pick-snap-state">{msg('· Matching lines appear dark')}</span>
        </span>
        <span className="spacer" />
        <label className="compare-pick-opacity" title={msg('Adjust old page visibility')}>
          {msg('Old')}
          <input type="range" min={0} max={100} value={Math.round(oldOpacity * 100)} onChange={(e) => setOldOpacity(Number(e.target.value) / 100)} />
        </label>
        <span className="compare-pick-zoom" role="group" aria-label={msg('Alignment preview zoom controls')}>
          <button type="button" className="btn compare-pick-zbtn" title={msg('Zoom out')} aria-label={msg('Zoom out preview')} onClick={() => zoomAt(1 / 1.35)}>
            −
          </button>
          <span className="compare-pick-zpct">{zoomPct}%</span>
          <button type="button" className="btn compare-pick-zbtn" title={msg('Zoom in')} aria-label={msg('Zoom in preview')} onClick={() => zoomAt(1.35)}>
            +
          </button>
          <button type="button" className="btn compare-pick-zbtn" title={msg('Fit page in view')} aria-label={msg('Fit preview')} onClick={resetFit}>
            {msg('Fit')}
          </button>
        </span>
      </figcaption>
      <div
        ref={wrapRef}
        className={`compare-pick-viewport ${panning ? 'panning' : 'pan-ready'}`}
        aria-label={msg('Alignment preview')}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (!camRef.current || (e.button !== 0 && e.button !== 1 && e.button !== 2)) return;
          e.preventDefault();
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          panRef.current = { startX: e.clientX, startY: e.clientY, startTx: camRef.current.tx, startTy: camRef.current.ty };
          setPanning(true);
        }}
        onPointerMove={(e) => {
          const p = panRef.current;
          if (!p || !camRef.current) return;
          setCam({ scale: camRef.current.scale, tx: p.startTx + (e.clientX - p.startX), ty: p.startTy + (e.clientY - p.startY) });
        }}
        onPointerUp={() => {
          panRef.current = null;
          setPanning(false);
        }}
        onPointerCancel={() => {
          panRef.current = null;
          setPanning(false);
        }}
      >
        <canvas ref={canvasRef} className="compare-pick-canvas" />
      </div>
    </figure>
  );
}

/** Loads an overview bitmap + optional live PickerPageHandle + SnapIndex for one page. */
function usePickerPage(
  target: { fileId: string; page: number } | null,
  preview: (fileId: string, page: number) => Promise<PagePreview>,
  openPage?: (fileId: string, page: number) => Promise<PickerPageHandle>,
  onError?: (msg: string) => void,
) {
  const [page, setPage] = useState<LoadedPage | null>(null);
  const [snapIndex, setSnapIndex] = useState<SnapIndex | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const key = target ? `${target.fileId}:${target.page}` : '';

  useEffect(() => {
    if (!target) {
      setPage(null);
      setSnapIndex(null);
      setSnapLoading(false);
      return;
    }
    let live = true;
    let handle: PickerPageHandle | null = null;
    let baseBitmap: ImageBitmap | null = null;
    let objectUrl: string | null = null;
    setPage(null);
    setSnapIndex(null);

    const load = async () => {
      try {
        if (openPage) {
          handle = await openPage(target.fileId, target.page);
          if (!live) {
            handle.release();
            return;
          }
          const baseScale = 1400 / Math.max(handle.width, handle.height);
          const w = Math.max(1, Math.ceil(handle.width * baseScale));
          const h = Math.max(1, Math.ceil(handle.height * baseScale));
          baseBitmap = await handle.renderTile(baseScale, 0, 0, w, h);
          if (!live) {
            baseBitmap.close();
            handle.release();
            return;
          }
          setPage({ width: handle.width, height: handle.height, base: baseBitmap, baseScale, handle });

          // Load vector snap index in the background so the page appears right away.
          setSnapLoading(true);
          try {
            const idx = await handle.snapIndex();
            if (live) setSnapIndex(idx);
          } catch {
            // Snapping is optional if a page has no extractable vector geometry.
          } finally {
            if (live) setSnapLoading(false);
          }
          return;
        }

        // Fallback path (e.g. HyperlinkDialog passing only `preview`).
        const prev = await preview(target.fileId, target.page);
        objectUrl = prev.url;
        const img = new Image();
        img.src = prev.url;
        await img.decode();
        if (!live) return;
        const baseScale = img.naturalWidth / Math.max(1, prev.width);
        setPage({ width: prev.width, height: prev.height, base: img, baseScale, handle: null });
      } catch (err) {
        if (live) onError?.(err instanceof Error ? err.message : String(err));
      }
    };
    void load();

    return () => {
      live = false;
      baseBitmap?.close();
      handle?.release();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { page, snapIndex, snapLoading };
}

/**
 * Compare and Overlay helpers on the pages themselves: Align Pages (click the same three points
 * on the old page and the new, for revisions drawn at another scale or turned) and Select Region
 * (drag the part of the new page to compare).
 */
export function ComparePagePicker(props: Props) {
  const [error, setError] = useState<string | null>(null);
  const [oldPts, setOldPts] = useState<Point[]>([]);
  const [curPts, setCurPts] = useState<Point[]>([]);
  const [region, setRegion] = useState<Box | null>(props.mode === 'region' ? props.initial : null);
  const [snapContent, setSnapContent] = useState(true);
  const [snapGrid, setSnapGrid] = useState(() => settings.get().snapToGrid);
  const [previewing, setPreviewing] = useState(false);

  const oldLoaded = usePickerPage(props.mode === 'points' ? props.old : null, props.preview, props.openPage, setError);
  const curLoaded = usePickerPage(props.cur, props.preview, props.openPage, setError);

  const transform = props.mode === 'points' && oldPts.length === 3 && curPts.length === 3 ? affineFromPoints(oldPts, curPts) : null;
  const add = (set: typeof setOldPts) => (p: Point) => set((list) => (list.length >= 3 ? list : [...list, p]));

  useEffect(() => {
    if (!transform && previewing) setPreviewing(false);
  }, [transform, previewing]);

  const undoLastPoint = useCallback(() => {
    setPreviewing(false);
    if (curPts.length === oldPts.length && curPts.length > 0) {
      setCurPts((list) => list.slice(0, -1));
    } else if (oldPts.length > curPts.length) {
      setOldPts((list) => list.slice(0, -1));
    }
  }, [oldPts.length, curPts.length]);

  const pointsDone = oldPts.length === 3 && curPts.length === 3;
  const needOld = props.mode === 'points' && !pointsDone && oldPts.length <= curPts.length;
  const needCur = props.mode === 'points' && !pointsDone && curPts.length < oldPts.length;
  const activePairIndex = needOld ? oldPts.length : needCur ? curPts.length : -1;
  const stepNumber = oldPts.length + curPts.length + 1;

  const stepGuidance = (() => {
    if (props.mode !== 'points') return '';
    if (transform) return previewing ? msg('Inspect the overlaid pages (scroll to zoom, drag to pan), then click Align to apply or Back to points to adjust.') : msg('All 3 point pairs selected — click Preview alignment to verify, or click Align to apply.');
    if (pointsDone) return msg('Those 3 points are nearly in a straight line. Undo or start over and pick points spread across the page.');
    if (needOld) {
      const hint = activePairIndex === 0 ? msg('choose a crisp corner or grid intersection') : activePairIndex === 1 ? msg('far from Point 1') : msg('spread out to form a wide triangle');
      return msg('Step {step} of 6 — Click Point {point} on the Old page ({hint}).', { step: stepNumber, point: activePairIndex + 1, hint });
    }
    return msg('Step {step} of 6 — Now click the matching Point {point} on the New page.', { step: stepNumber, point: activePairIndex + 1 });
  })();

  const isPoints = props.mode === 'points';
  const showPreview = isPoints && previewing && !!transform && !!oldLoaded.page && !!curLoaded.page;
  const previewColors = props.mode === 'points' && props.colors ? props.colors : { old: '#e02020', new: '#1a6cff' };

  return (
    <div className="modal-backdrop" onMouseDown={props.onCancel}>
      <div
        className={`modal print-dialog compare-pick-dialog${isPoints ? ' compare-pick-full' : ''}`}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') props.onCancel();
          else if (isPoints && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undoLastPoint();
          }
        }}
      >
        <div className="compare-pick-header">
          <div className="compare-pick-heading">
            <h3>{isPoints ? msg('Align Pages') : msg('Select Region')}</h3>
            {isPoints ? (
              <div className="compare-pick-steps" aria-label={msg('Alignment point progress')}>
                {[0, 1, 2].map((i) => {
                  const hasOld = oldPts.length > i;
                  const hasNew = curPts.length > i;
                  const isCurrent = activePairIndex === i;
                  return (
                    <span key={i} className={`compare-pick-step${isCurrent ? ' current' : hasOld && hasNew ? ' done' : ''}`} style={{ '--step-color': COLORS[i] } as React.CSSProperties}>
                      <span className="compare-pick-dot">{i + 1}</span>
                      <span className={`compare-pick-pill${hasOld ? ' ok' : needOld && isCurrent ? ' active' : ''}`}>{msg('Old')}{hasOld ? ' ✓' : ''}</span>
                      <span className={`compare-pick-pill${hasNew ? ' ok' : needCur && isCurrent ? ' active' : ''}`}>{msg('New')}{hasNew ? ' ✓' : ''}</span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <span className="print-hint">{msg('Drag a rectangle over the part of the page to use.')}</span>
            )}
          </div>
          {isPoints && (
            <div className="compare-pick-toolbar">
              <div className={`compare-pick-guide${pointsDone && !transform ? ' warn' : transform ? ' ready' : ''}`} style={activePairIndex >= 0 ? { borderLeftColor: COLORS[activePairIndex] } : undefined}>
                {stepGuidance}
              </div>
              <div className="compare-pick-controls">
                {props.openPage && (
                  <label className="check" title={msg('Snap cursor to drawing endpoints, intersections, midpoints and centres (hold Alt to temporarily bypass)')}>
                    <input type="checkbox" checked={snapContent} onChange={(e) => setSnapContent(e.target.checked)} />
                    {msg('Snap to Content')}
                  </label>
                )}
                <label className="check" title={msg('Snap cursor to the page grid when no drawing geometry is nearer')}>
                  <input type="checkbox" checked={snapGrid} onChange={(e) => setSnapGrid(e.target.checked)} />
                  {msg('Snap to Grid')}
                </label>
                <span className="compare-pick-hint">{msg('Scroll: zoom · Drag / Middle-drag / Space+drag: pan · Alt: bypass snap')}</span>
              </div>
            </div>
          )}
        </div>
        {error && <p className="print-error">{error}</p>}
        <div className="compare-pick-pages">
          {showPreview ? (
            <AlignmentPreview oldPage={oldLoaded.page!} curPage={curLoaded.page!} transform={transform!} curPts={curPts} colors={previewColors} />
          ) : (
            <>
              {isPoints && (
                <PageSurface
                  label={msg('Old page')}
                  page={oldLoaded.page}
                  snapIndex={oldLoaded.snapIndex}
                  snapLoading={oldLoaded.snapLoading}
                  snapContent={snapContent}
                  snapGrid={snapGrid}
                  marks={oldPts}
                  onPoint={needOld ? add(setOldPts) : undefined}
                  activePrompt={needOld ? msg('Click Point {point} here', { point: activePairIndex + 1 }) : null}
                  activeColor={activePairIndex >= 0 ? COLORS[activePairIndex] : undefined}
                />
              )}
              <PageSurface
                label={isPoints ? msg('New page') : msg('Page')}
                page={curLoaded.page}
                snapIndex={curLoaded.snapIndex}
                snapLoading={curLoaded.snapLoading}
                snapContent={isPoints && snapContent}
                snapGrid={isPoints && snapGrid}
                marks={curPts}
                region={region}
                onPoint={needCur ? add(setCurPts) : undefined}
                onRegion={props.mode === 'region' ? setRegion : undefined}
                activePrompt={needCur ? msg('Click matching Point {point} here', { point: activePairIndex + 1 }) : null}
                activeColor={activePairIndex >= 0 ? COLORS[activePairIndex] : undefined}
              />
            </>
          )}
        </div>
        <div className="actions">
          {isPoints ? (
            <>
              <button type="button" className="btn" disabled={!oldPts.length} onClick={undoLastPoint} title={msg('Remove the last placed point (Ctrl+Z)')}>
                {msg('Undo point')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={!oldPts.length}
                onClick={() => {
                  setPreviewing(false);
                  setOldPts([]);
                  setCurPts([]);
                }}
              >
                {msg('Start over')}
              </button>
              <button
                type="button"
                className={`btn${showPreview ? ' active' : ''}`}
                disabled={!transform || !oldLoaded.page || !curLoaded.page}
                onClick={() => setPreviewing((v) => !v)}
                title={msg('Blend the transformed old page over the new page to verify alignment')}
              >
                {showPreview ? msg('Back to points') : msg('Preview alignment')}
              </button>
            </>
          ) : (
            <button type="button" className="btn" disabled={!region} onClick={() => setRegion(null)}>
              {msg('Whole page')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={props.onCancel}>
            {msg('Cancel')}
          </button>
          <button type="button" className="btn primary" disabled={isPoints ? !transform : false} onClick={() => (props.mode === 'points' ? transform && props.onDone(transform) : props.onDone(region))}>
            {isPoints ? msg('Align') : msg('OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
