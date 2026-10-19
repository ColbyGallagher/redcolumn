import { PDFDocument, PDFName, type PDFRef } from 'pdf-lib';
import { compose, visiblePolygon, type Affine } from '@nb/stitch';
import { pointInPolygon, transformMarkup, type Markup, type Point, type StoredStitchGroup } from '@nb/markup';
import { pageMatrix, type Matrix } from '@nb/markup/export';
import { openForEdit } from './incremental';
import { displayedSize } from './pageTools';

/** Space left around the stitched drawing on the new page, in points. */
const MARGIN = 36;
/** The largest page side PDF readers handle (Acrobat's limit). */
const MAX_SIDE = 14400;

export interface StitchedPage {
  bytes: Uint8Array;
  /** The new page's index (it is added after the last page). */
  pageIndex: number;
  /** Each sheet's page space to the new page's. */
  toPage: Map<number, Affine>;
  /** Each sheet's kept outline, in its own page space. */
  visible: Map<number, Point[]>;
  /** The new page's size relative to the drawing (below 1 when it had to shrink to fit). */
  shrink: number;
}

/** a then b. */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
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
const apply = (m: Affine, [x, y]: readonly [number, number]): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Stitch to New Page: the sheets of a stitched group drawn onto one new page at the end of the
 * document, each turned and scaled into place and clipped to its region and match lines, so the
 * title blocks and legends stay out and the sheets meet at the lines. The sheets stay vector.
 */
export async function stitchToPage(bytes: ArrayBuffer | Uint8Array, group: StoredStitchGroup): Promise<StitchedPage> {
  const { doc, save } = await openForEdit(bytes);
  // Embedding reads the sheets from a second copy, so the new page never draws itself.
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = src.getPages();

  const visible = new Map<number, Point[]>();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of group.placements) {
    const page = pages[p.pageIndex];
    if (!page) throw new Error(`Page ${p.pageIndex + 1} is not in the document.`);
    const { width, height } = displayedSize(page);
    const poly = visiblePolygon({ clips: p.clips, region: p.region?.map((q): [number, number] => [q[0], q[1]]) }, width, height);
    if (poly.length < 3) continue;
    visible.set(p.pageIndex, poly);
    for (const q of poly) {
      const [x, y] = apply(p.toWorld, q);
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  }
  if (!visible.size) throw new Error('Nothing of the sheets is left to stitch: check the regions and which side of each match line is kept.');
  const shrink = Math.min(1, (MAX_SIDE - 2 * MARGIN) / Math.max(x1 - x0, y1 - y0));
  const W = (x1 - x0) * shrink + 2 * MARGIN;
  const H = (y1 - y0) * shrink + 2 * MARGIN;
  // The group's world space to the new page's page space (y down).
  const worldToPage: Affine = [shrink, 0, 0, shrink, MARGIN - x0 * shrink, MARGIN - y0 * shrink];
  const out = doc.addPage([W, H]);
  const flip: Matrix = [1, 0, 0, -1, 0, H];

  const toPage = new Map<number, Affine>();
  const ops: string[] = [];
  const names = new Map<number, PDFRef>();
  for (const p of group.placements) {
    const poly = visible.get(p.pageIndex);
    const page = pages[p.pageIndex]!;
    if (!poly) continue;
    const t = compose(worldToPage, p.toWorld as Affine);
    toPage.set(p.pageIndex, t);
    if (!page.node.Contents()) continue;
    const box = page.getCropBox();
    const embedded = await doc.embedPage(page, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height }, [1, 0, 0, 1, 0, 0]);
    names.set(p.pageIndex, embedded.ref);
    // Sheet user space → sheet page space → new page space → new page user space.
    const m = multiply(multiply(invert(pageMatrix(page)), [...t] as Matrix), flip);
    const path = poly.map((q, i) => {
      const [x, y] = apply(t, q);
      return `${n(x)} ${n(H - y)} ${i ? 'l' : 'm'}`;
    });
    ops.push(`q ${path.join(' ')} h W n q ${m.map(n).join(' ')} cm /S${p.pageIndex} Do Q Q`);
  }
  for (const [i, ref] of names) out.node.setXObject(PDFName.of(`S${i}`), ref);
  out.node.addContentStream(doc.context.register(doc.context.flateStream(ops.join('\n'))));
  return { bytes: await save(), pageIndex: doc.getPageCount() - 1, toPage, visible, shrink };
}

/**
 * Copies of the sheets' markups for the stitched page: moved, turned and scaled with their
 * sheets. Markups wholly outside a sheet's kept outline (on the title block, or past the match
 * line, where the next sheet takes over) are left out. The copies get new IDs.
 */
export function stitchedMarkups(markups: readonly Markup[], stitched: Pick<StitchedPage, 'pageIndex' | 'toPage' | 'visible'>, newId: () => string): Markup[] {
  const out: Markup[] = [];
  const now = Date.now();
  for (const m of markups) {
    const t = stitched.toPage.get(m.pageIndex);
    const poly = stitched.visible.get(m.pageIndex);
    if (!t || !poly || !m.points.some((p) => pointInPolygon(p, poly))) continue;
    // Copies stand alone: not the PDF's annotation, not in the originals' groups, no thread.
    const { pdfAnnot: _annot, seq: _seq, replies: _replies, groupId: _group, ...rest } = m;
    out.push({ ...rest, ...transformMarkup(m, { a: t[0], b: t[1], c: t[2], d: t[3], e: t[4], f: t[5] }), id: newId(), pageIndex: stitched.pageIndex, createdAt: now, modifiedAt: now });
  }
  return out;
}
