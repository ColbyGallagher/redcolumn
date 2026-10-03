/**
 * The app's icons as PNGs, drawn from the same shapes as public/icon.svg. Install prompts, Android
 * home screens and iOS need raster icons (192 and 512 pixels, maskable versions, a 180 pixel Apple
 * touch icon); drawing them here at build time keeps them in step with the SVG without an image
 * library. Plain module: runs in Node (vite.config.ts, tests) and in the browser.
 */

type Pt = readonly [number, number];
type Rgba = readonly [number, number, number, number];

const hex = (h: string): Rgba => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

/** The icon in its 64 unit viewBox (see public/icon.svg). */
export const ICON = {
  background: hex('#1e3a8a'),
  radius: 12,
  sheet: { fill: hex('#ffffff'), points: [[18, 14], [38, 14], [48, 24], [48, 50], [18, 50]] as Pt[] },
  fold: { fill: hex('#bfdbfe'), points: [[38, 14], [38, 24], [48, 24]] as Pt[] },
  mark: { stroke: hex('#3b82f6'), width: 3, points: [[24, 40], [32, 28], [40, 40]] as Pt[] },
};

export interface IconOptions {
  /** Square corners with the background to the edge (maskable and Apple icons, which the system masks). */
  fullBleed?: boolean;
  /** Scale of the drawing about the centre (maskable icons keep it inside the 80% safe zone). */
  scale?: number;
}

function inPolygon(x: number, y: number, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearPolyline(x: number, y: number, pts: readonly Pt[], half: number): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= half) return true;
  }
  return false;
}

function inRoundRect(x: number, y: number, size: number, r: number): boolean {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const cx = Math.max(r, Math.min(size - r, x));
  const cy = Math.max(r, Math.min(size - r, y));
  return Math.hypot(x - cx, y - cy) <= r;
}

/** The colour at a point of the 64 unit icon, or null outside it. */
function sample(x: number, y: number, o: IconOptions): Rgba | null {
  if (!(o.fullBleed ? x >= 0 && y >= 0 && x <= 64 && y <= 64 : inRoundRect(x, y, 64, ICON.radius))) return null;
  // The drawing is scaled about the centre; the background is not.
  const s = o.scale ?? 1;
  const u = 32 + (x - 32) / s;
  const v = 32 + (y - 32) / s;
  if (nearPolyline(u, v, ICON.mark.points, ICON.mark.width / 2)) return ICON.mark.stroke;
  if (inPolygon(u, v, ICON.fold.points)) return ICON.fold.fill;
  if (inPolygon(u, v, ICON.sheet.points)) return ICON.sheet.fill;
  return ICON.background;
}

/** RGBA pixels of the icon at `size` pixels square, 4×4 supersampled. */
export function drawIcon(size: number, o: IconOptions = {}): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const n = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const c = sample(((px + (sx + 0.5) / n) * 64) / size, ((py + (sy + 0.5) / n) * 64) / size, o);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const i = (py * size + px) * 4;
      // Colour is averaged over the covered samples (not premultiplied), alpha over all of them.
      const covered = a / 255;
      if (covered) {
        out[i] = Math.round(r / covered);
        out[i + 1] = Math.round(g / covered);
        out[i + 2] = Math.round(b / covered);
      }
      out[i + 3] = Math.round(a / (n * n));
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // 'deflate' is the zlib format PNG's IDAT wants; CompressionStream is in browsers and Node 18+.
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An 8-bit RGBA PNG of `pixels` (width × height × 4 bytes). */
export async function encodePng(width: number, height: number, pixels: Uint8Array): Promise<Uint8Array> {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  // Each scanline starts with its filter type (0: none).
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The PNG icons the manifest and index.html refer to, by file name. */
export const ICON_FILES: { name: string; size: number; options: IconOptions }[] = [
  { name: 'icon-192.png', size: 192, options: {} },
  { name: 'icon-512.png', size: 512, options: {} },
  { name: 'icon-maskable-192.png', size: 192, options: { fullBleed: true, scale: 0.8 } },
  { name: 'icon-maskable-512.png', size: 512, options: { fullBleed: true, scale: 0.8 } },
  { name: 'apple-touch-icon.png', size: 180, options: { fullBleed: true, scale: 0.9 } },
];

export async function iconPngs(): Promise<{ name: string; bytes: Uint8Array }[]> {
  return Promise.all(ICON_FILES.map(async (f) => ({ name: f.name, bytes: await encodePng(f.size, f.size, drawIcon(f.size, f.options)) })));
}
