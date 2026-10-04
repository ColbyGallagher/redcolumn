import { PDFDocument, PDFName, type PDFPage, type PDFRef } from 'pdf-lib';
import { pageMatrix, type Matrix } from '@nb/markup/export';
import { recolourPages } from './process';

/**
 * Overlay Pages: pages of several documents stacked on one page, each drawn in its own colour and
 * multiplied together, so what is the same in all of them shows dark and what differs shows in
 * the colour of the document it is in (red for the old revision, blue for the new, by default).
 * The pages stay vector: each is made grey, then tinted inside an isolated transparency group.
 */

export interface OverlaySource {
  bytes: ArrayBuffer | Uint8Array;
  /** Layer colour, 0–1 RGB. */
  color: [number, number, number];
}

export interface OverlayLayer {
  source: number;
  page: number;
  /** Where the page's top-left lands on the overlay page, in points (page space, y down). */
  offset: [number, number];
  /** Instead of the offset: the page's page space to the overlay page's (scaled or 3-point aligned). */
  transform?: Readonly<Matrix>;
}

export interface OverlayPageSpec {
  size: { width: number; height: number };
  /** Bottom first. */
  layers: OverlayLayer[];
}

/** a then b. */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}

const n = (v: number) => (Math.round(v * 10000) / 10000).toString();

/** Hex colour to 0–1 RGB. */
export function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : [0, 0, 0];
}

/** Builds the overlay PDF, one page per spec. */
export async function overlayPages(sources: readonly OverlaySource[], pages: readonly OverlayPageSpec[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  // Each source made grey once, loaded once.
  const used = sources.map((_, s) => [...new Set(pages.flatMap((p) => p.layers.filter((l) => l.source === s).map((l) => l.page)))]);
  const docs = await Promise.all(
    sources.map(async (src, s) => (used[s]!.length ? PDFDocument.load(await recolourPages(src.bytes, used[s]!, 'grayscale'), { updateMetadata: false }) : null)),
  );
  const embedded = new Map<string, { ref: PDFRef; toUser: Matrix } | null>();
  const embed = async (source: number, pageIndex: number) => {
    const key = `${source}:${pageIndex}`;
    if (!embedded.has(key)) {
      const page: PDFPage | undefined = docs[source]?.getPages()[pageIndex];
      // A page without content (blank) has nothing to draw.
      if (!page || !page.node.Contents()) embedded.set(key, null);
      else {
        const box = page.getCropBox();
        const e = await out.embedPage(page, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height }, [1, 0, 0, 1, 0, 0]);
        embedded.set(key, { ref: e.ref, toUser: pageMatrix(page) });
      }
    }
    return embedded.get(key)!;
  };

  const multiplyGs = out.context.register(out.context.obj({ Type: 'ExtGState', BM: 'Multiply' }));
  const lightenGs = out.context.register(out.context.obj({ Type: 'ExtGState', BM: 'Lighten' }));
  for (const spec of pages) {
    const { width: W, height: H } = spec.size;
    const page = out.addPage([W, H]);
    // Overlay page space (y down) → its user space.
    const flip: Matrix = [1, 0, 0, -1, 0, H];
    const ops: string[] = [];
    for (let k = 0; k < spec.layers.length; k++) {
      const layer = spec.layers[k]!;
      const e = await embed(layer.source, layer.page);
      if (!e) continue;
      // Source user space → source page space → moved → overlay user space.
      const shift: Matrix = layer.transform ? [...layer.transform] : [1, 0, 0, 1, layer.offset[0], layer.offset[1]];
      const m = multiply(multiply(invert(e.toUser), shift), flip);
      const [r, g, b] = sources[layer.source]!.color;
      const content = [
        '1 1 1 rg',
        `0 0 ${n(W)} ${n(H)} re f`,
        `q ${m.map(n).join(' ')} cm /P Do Q`,
        `q /L gs ${n(r)} ${n(g)} ${n(b)} rg 0 0 ${n(W)} ${n(H)} re f Q`,
      ].join('\n');
      const form = out.context.flateStream(content, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, W, H],
        Resources: { XObject: { P: e.ref }, ExtGState: { L: lightenGs } },
        Group: { S: 'Transparency', I: true, CS: 'DeviceRGB' },
      });
      const name = page.node.newXObject(`Layer${k}`, out.context.register(form));
      ops.push(`q /M gs ${name.asString()} Do Q`);
    }
    page.node.setExtGState(PDFName.of('M'), multiplyGs);
    page.node.addContentStream(out.context.register(out.context.flateStream(ops.join('\n'))));
  }
  return out.save();
}
