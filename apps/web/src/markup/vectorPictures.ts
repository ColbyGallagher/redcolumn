// Vector Snapshots (`Markup.vector`): each one's one-page PDF is opened in a PDF engine of its own,
// drawn in tiles at the zoom it is seen at (so it stays sharp), and read for its line work (so it
// can be snapped to like the drawing).
import { PdfEngine, type PdfDocument } from '@nb/pdf-core';
import { base64ToBytes, notifyImagesChanged, type PictureMatrix, type VectorPainter, type VectorPicture } from '@nb/markup';

/** Tile edge in device pixels. */
const TILE = 512;
/** Most tiles kept drawn (about 1 MB each). */
const MAX_TILES = 64;
/** Most pictures kept open in the engine. */
const MAX_DOCS = 12;
/** Most pictures whose line work (and short id) is remembered. */
const MAX_REMEMBERED = 64;
/** Renders running at once. */
const MAX_RENDERS = 3;
/** A queued tile not asked for again within this long is no longer in view, and is dropped. */
const STALE_MS = 1500;
/** Sharpest and coarsest levels drawn, in pixels per point. */
const MAX_LEVEL = 64;
const MIN_LEVEL = 1 / 8;

interface Tile {
  bitmap: ImageBitmap | null;
  failed?: boolean;
}

interface Queued {
  key: string;
  pdf: string;
  level: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The picture's recorded width in points. */
  width: number;
  wanted: number;
}

/** Line work in a picture's shown space (points, y down, `width` × `height`), as `PdfDocument.geometry` gives a page's. */
export interface PictureGeometry {
  segments: Float32Array;
  curves: Uint8Array;
}

const apply = (t: PictureMatrix, x: number, y: number): [number, number] => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];

function invert(t: PictureMatrix): PictureMatrix | null {
  const det = t[0] * t[3] - t[1] * t[2];
  if (!det) return null;
  const a = t[3] / det;
  const b = -t[1] / det;
  const c = -t[2] / det;
  const d = t[0] / det;
  return [a, b, c, d, -(t[4] * a + t[5] * c), -(t[4] * b + t[5] * d)];
}

class VectorPictures {
  private engine: PdfEngine | null = null;
  /** Open pictures by their PDF (base64), least recently used first. */
  private docs = new Map<string, Promise<PdfDocument>>();
  private tiles = new Map<string, Tile>();
  private queue: Queued[] = [];
  private running = 0;
  private geometries = new Map<string, Promise<PictureGeometry>>();
  /** A short id for each picture's PDF, so tile keys stay short. */
  private ids = new Map<string, number>();
  private nextId = 1;
  private redrawQueued = false;

  private engineFor(): PdfEngine {
    if (!this.engine?.alive) {
      // A fresh engine: whatever was open in the old one is gone.
      this.engine = new PdfEngine();
      this.docs.clear();
    }
    return this.engine;
  }

  private open(pdf: string): Promise<PdfDocument> {
    const engine = this.engineFor();
    let doc = this.docs.get(pdf);
    if (doc) {
      this.docs.delete(pdf);
      this.docs.set(pdf, doc);
      return doc;
    }
    doc = engine.open(base64ToBytes(pdf).slice().buffer);
    doc.catch(() => this.docs.delete(pdf));
    this.docs.set(pdf, doc);
    while (this.docs.size > MAX_DOCS) {
      const [oldest, old] = this.docs.entries().next().value!;
      this.docs.delete(oldest);
      void old.then((d) => d.close()).catch(() => {});
    }
    return doc;
  }

  private idOf(pdf: string): number {
    let id = this.ids.get(pdf);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(pdf, id);
      // Tiles of a forgotten id are never asked for again, and go as others are drawn.
      if (this.ids.size > MAX_REMEMBERED) this.ids.delete(this.ids.keys().next().value!);
    }
    return id;
  }

  /** The picture's line work in its shown space. */
  geometry(v: VectorPicture): Promise<PictureGeometry> {
    let g = this.geometries.get(v.pdf);
    if (!g) {
      g = this.open(v.pdf).then(async (doc) => {
        const { segments, curves } = await doc.geometry(0);
        const size = doc.pages[0];
        // The page as PDFium measures it, onto the size recorded when it was taken.
        const kx = size?.width ? v.width / size.width : 1;
        const ky = size?.height ? v.height / size.height : 1;
        if (kx !== 1 || ky !== 1)
          for (let i = 0; i + 1 < segments.length; i += 2) {
            segments[i] = segments[i]! * kx;
            segments[i + 1] = segments[i + 1]! * ky;
          }
        return { segments, curves };
      });
      g.catch(() => this.geometries.delete(v.pdf));
      this.geometries.set(v.pdf, g);
      if (this.geometries.size > MAX_REMEMBERED) this.geometries.delete(this.geometries.keys().next().value!);
    }
    return g;
  }

  /** Draws a picture from tiles at the zoom it is seen at; see `VectorPainter`. */
  paint: VectorPainter = (ctx, v, place, fallback) => {
    const d = ctx.getTransform();
    // Shown space → device pixels.
    const toDevice: PictureMatrix = [
      place[0] * d.a + place[1] * d.c,
      place[0] * d.b + place[1] * d.d,
      place[2] * d.a + place[3] * d.c,
      place[2] * d.b + place[3] * d.d,
      place[4] * d.a + place[5] * d.c + d.e,
      place[4] * d.b + place[5] * d.d + d.f,
    ];
    const fromDevice = invert(toDevice);
    if (!fromDevice) return;
    const pxPerPoint = Math.sqrt(Math.abs(toDevice[0] * toDevice[3] - toDevice[1] * toDevice[2]));
    const level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, 2 ** Math.ceil(Math.log2(pxPerPoint || 1))));
    // The part of the picture in view, in shown space.
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const corners = [apply(fromDevice, 0, 0), apply(fromDevice, cw, 0), apply(fromDevice, 0, ch), apply(fromDevice, cw, ch)];
    const x0 = Math.max(0, Math.min(...corners.map((c) => c[0])));
    const y0 = Math.max(0, Math.min(...corners.map((c) => c[1])));
    const x1 = Math.min(v.width, Math.max(...corners.map((c) => c[0])));
    const y1 = Math.min(v.height, Math.max(...corners.map((c) => c[1])));
    if (x1 <= x0 || y1 <= y0) return;
    // Tiles of the page drawn `level` pixels per point.
    const pageW = Math.max(1, Math.ceil(v.width * level));
    const pageH = Math.max(1, Math.ceil(v.height * level));
    const id = this.idOf(v.pdf);
    const now = performance.now();
    const ready: { bitmap: ImageBitmap; x: number; y: number; w: number; h: number }[] = [];
    const missing: { x: number; y: number; w: number; h: number }[] = [];
    for (let ty = Math.floor((y0 * level) / TILE); ty * TILE < Math.min(pageH, y1 * level); ty++) {
      for (let tx = Math.floor((x0 * level) / TILE); tx * TILE < Math.min(pageW, x1 * level); tx++) {
        const px = tx * TILE;
        const py = ty * TILE;
        const pw = Math.min(TILE, pageW - px);
        const ph = Math.min(TILE, pageH - py);
        const rect = { x: px / level, y: py / level, w: pw / level, h: ph / level };
        const key = `${id}:${level}:${tx}:${ty}`;
        const tile = this.tiles.get(key);
        if (tile?.bitmap) {
          // Most recently used last.
          this.tiles.delete(key);
          this.tiles.set(key, tile);
          ready.push({ bitmap: tile.bitmap, ...rect });
          continue;
        }
        missing.push(rect);
        if (tile?.failed) continue;
        const queued = this.queue.find((q) => q.key === key);
        if (queued) queued.wanted = now;
        else if (!tile) this.queue.push({ key, pdf: v.pdf, level, x: px, y: py, w: pw, h: ph, width: v.width, wanted: now });
      }
    }
    if (missing.length) {
      // The picture shows where tiles are still to come.
      ctx.save();
      ctx.save();
      ctx.transform(...place);
      ctx.beginPath();
      for (const r of missing) ctx.rect(r.x, r.y, r.w, r.h);
      ctx.restore();
      ctx.clip();
      fallback();
      ctx.restore();
      this.pump();
    }
    if (ready.length) {
      ctx.save();
      ctx.transform(...place);
      for (const t of ready) ctx.drawImage(t.bitmap, t.x, t.y, t.w, t.h);
      ctx.restore();
    }
  };

  private pump() {
    while (this.running < MAX_RENDERS && this.queue.length) {
      const now = performance.now();
      this.queue = this.queue.filter((q) => now - q.wanted < STALE_MS);
      // The tile asked for most recently first: what is in view now.
      const next = this.queue.pop();
      if (!next) return;
      this.running++;
      this.tiles.set(next.key, { bitmap: null });
      void this.render(next).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async render(q: Queued) {
    try {
      const doc = await this.open(q.pdf);
      const size = doc.pages[0];
      // The tile grid is laid out on the recorded size; PDFium's page may measure a hair different.
      const scale = size?.width ? (q.level * q.width) / size.width : q.level;
      const { bitmap } = await doc.renderTile(0, scale, q.x, q.y, q.w, q.h, { transparent: true });
      this.tiles.set(q.key, { bitmap });
      this.evict();
      this.redraw();
    } catch {
      this.tiles.set(q.key, { bitmap: null, failed: true });
      // The picture draws instead.
    }
  }

  private evict() {
    let drawn = 0;
    for (const t of this.tiles.values()) if (t.bitmap) drawn++;
    for (const [key, t] of this.tiles) {
      if (drawn <= MAX_TILES) break;
      if (!t.bitmap) continue;
      t.bitmap.close();
      this.tiles.delete(key);
      drawn--;
    }
  }

  private redraw() {
    if (this.redrawQueued) return;
    this.redrawQueued = true;
    requestAnimationFrame(() => {
      this.redrawQueued = false;
      notifyImagesChanged();
    });
  }
}

export const vectorPictures = new VectorPictures();
