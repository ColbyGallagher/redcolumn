import { drawMarkup, type MarkupStore } from '@nb/markup';
import type { GeoRegion } from '@nb/measure';
import type { PdfDocument } from '@nb/pdf-core';
import type { SheetOverlay } from '@nb/model3d';
import { pageToGrid, placementFromGeoRegion } from '../geospatial/align';
import { MAX_FIT_ERROR } from '../geospatial/modelOnSheet';

/** A sheet that can be shown in the 3D view: a page's map registration in an open PDF. */
export interface SheetSource {
  /** `fileId:pageIndex:regionId`. */
  key: string;
  label: string;
  region: GeoRegion;
  doc: PdfDocument;
  store: MarkupStore;
}

/** How one sheet shows in the 3D view. */
export interface SheetSetting {
  show: boolean;
  mode: 'plane' | 'drape';
  /** Plane: its height (metres, the map's height datum). */
  height: number;
  /** 0..1 */
  opacity: number;
}

/** The longest side of a sheet's picture in the 3D view, in pixels. */
export const MAX_SHEET_PIXELS = 4096;

/** The area a region covers on its page: its bounding box. */
function regionBox(region: GeoRegion) {
  const xs = region.bounds.map((p) => p[0]);
  const ys = region.bounds.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/**
 * A sheet as the 3D view shows it: a picture of the region (the drawing, with its markups on it) on
 * a level plane, or its markups' lines to lay over the model. Null where the region cannot be placed.
 */
export async function sheetOverlay(src: SheetSource, setting: SheetSetting, signal?: AbortSignal): Promise<SheetOverlay | null> {
  const fit = placementFromGeoRegion(src.region);
  if (!fit || fit.error > MAX_FIT_ERROR) return null;
  const { x0, y0, w, h } = regionBox(src.region);
  if (w <= 0 || h <= 0) return null;
  const toGrid = (p: readonly [number, number]) => pageToGrid(fit.placement, p);
  const markups = src.store.forPage(src.region.pageIndex).filter((m) => !m.hidden);
  // What is drawn: the page's markups and how the sheet shows; the same version is not drawn again.
  const version = `${hashText(JSON.stringify(markups))}:${setting.mode}:${setting.height}:${setting.opacity}`;
  const base = { id: src.key, mode: setting.mode, height: setting.height, opacity: setting.opacity, version };
  if (setting.mode === 'drape') {
    const inside = (p: readonly [number, number]) => p[0] >= x0 && p[0] <= x0 + w && p[1] >= y0 && p[1] <= y0 + h;
    const lines = markups
      .filter((m) => m.points.length > 1 && m.points.some(inside))
      .map((m) => {
        const closed = ['polygon', 'area', 'perimeter', 'space', 'volume', 'rect', 'cloud'].includes(m.type);
        const pts = m.type === 'rect' || m.type === 'cloud' ? rectCorners(m.points) : m.points;
        return { points: (closed ? [...pts, pts[0]!] : pts).map(toGrid), colour: m.style.stroke || '#e03131' };
      });
    return { ...base, corners: [], image: null, lines };
  }
  const scale = Math.min(MAX_SHEET_PIXELS / w, MAX_SHEET_PIXELS / h, 4);
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const { bitmap } = await src.doc.renderTile(src.region.pageIndex, scale, Math.round(x0 * scale), Math.round(y0 * scale), width, height, { copy: true, transparent: true, signal });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-x0, -y0);
  for (const m of markups) drawMarkup(ctx, m, scale);
  ctx.restore();
  return {
    ...base,
    corners: [toGrid([x0, y0]), toGrid([x0 + w, y0]), toGrid([x0 + w, y0 + h]), toGrid([x0, y0 + h])],
    image: canvas,
    lines: [],
  };
}

/** A rectangle's four corners from two opposite ones. */
function rectCorners(points: readonly (readonly [number, number])[]): [number, number][] {
  const [a, b] = points as [[number, number], [number, number]];
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
}

/** A short hash of some text (FNV-1a), to tell when a page's markups changed. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
