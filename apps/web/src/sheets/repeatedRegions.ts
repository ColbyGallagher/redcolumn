import type { PageText } from '@nb/sheets';
import { textInRegion, type Region } from './regions';

export interface PageSize {
  width: number;
  height: number;
}

/** A box of text found at the same place on most pages (a header, footer or side note). */
export interface RepeatedRegion {
  /** "Header", "Footer", "Left side" or "Right side", numbered when a band has more than one. */
  name: string;
  /** Page space of the reference page size. */
  rect: Region;
  /** Pages with text in the box. */
  pages: number[];
  /** The box's text on the first of those pages. */
  sample: string;
}

/**
 * The same box on a page of another size. Along each axis a box in the first third keeps its
 * distance from that edge, one in the last third from the far edge, and one in the middle from the
 * centre, so a footer stays at the bottom and a centred page number stays centred; a box that
 * spans most of the page's width (or height) stretches with it.
 */
export function regionOnPage(r: Region, from: PageSize, to: PageSize): Region {
  if (from.width === to.width && from.height === to.height) return r;
  const axis = (start: number, size: number, fromLen: number, toLen: number): [number, number] => {
    if (size > fromLen / 2) return [start, Math.max(0, size + toLen - fromLen)];
    const centre = start + size / 2;
    if (centre < fromLen / 3) return [start, size];
    if (centre > (fromLen * 2) / 3) return [start + toLen - fromLen, size];
    return [start + (toLen - fromLen) / 2, size];
  };
  const [x, w] = axis(r.x, r.w, from.width, to.width);
  const [y, h] = axis(r.y, r.h, from.height, to.height);
  return { x, y, w, h };
}

/** The page size most of `pages` share, as the reference for boxes that apply to all of them. */
export function commonPageSize(texts: readonly (PageSize | undefined)[], pages: readonly number[]): PageSize | null {
  const counts = new Map<string, { size: PageSize; n: number }>();
  for (const p of pages) {
    const t = texts[p];
    if (!t) continue;
    const key = `${Math.round(t.width)}x${Math.round(t.height)}`;
    const c = counts.get(key);
    if (c) c.n++;
    else counts.set(key, { size: { width: t.width, height: t.height }, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.size ?? null;
}

type Band = 'top' | 'bottom' | 'left' | 'right';
const BAND_NAMES: Record<Band, string> = { top: 'Header', bottom: 'Footer', left: 'Left side', right: 'Right side' };

/**
 * Text that repeats at the same place on most pages, near an edge: headers and footers (the top
 * and bottom 15% of the page) and side notes (the outer 10% at the left and right). Words are
 * grouped by their distance from the edge; a group counts when it is on at least `minShare` of
 * the pages (and on two or more). The words can differ from page to page (page numbers, dates),
 * only the place matters. Boxes are padded slightly and given in the reference page size.
 */
export function findRepeatedRegions(texts: readonly (PageText | undefined)[], pages: readonly number[], minShare = 0.6): RepeatedRegion[] {
  const ref = commonPageSize(texts, pages);
  if (!ref || pages.length < 2) return [];
  const need = Math.max(2, Math.ceil(pages.length * minShare));
  const found: Record<Band, { at: number; page: number; box: Region }[]> = { top: [], bottom: [], left: [], right: [] };
  for (const page of pages) {
    const t = texts[page];
    if (!t) continue;
    for (const w of t.words) {
      if (!w.text.trim()) continue;
      const box = regionOnPage({ x: w.x0, y: w.y0, w: w.x1 - w.x0, h: w.y1 - w.y0 }, t, ref);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      if (cy < ref.height * 0.15) found.top.push({ at: cy, page, box });
      else if (cy > ref.height * 0.85) found.bottom.push({ at: ref.height - cy, page, box });
      else if (cx < ref.width * 0.1) found.left.push({ at: cx, page, box });
      else if (cx > ref.width * 0.9) found.right.push({ at: ref.width - cx, page, box });
    }
  }
  const out: RepeatedRegion[] = [];
  for (const band of ['top', 'bottom', 'left', 'right'] as Band[]) {
    // Groups of words at (nearly) the same distance from the edge.
    const sorted = found[band].sort((a, b) => a.at - b.at);
    const groups: (typeof sorted)[] = [];
    for (const w of sorted) {
      const g = groups[groups.length - 1];
      if (g && w.at - g[g.length - 1]!.at <= 3) g.push(w);
      else groups.push([w]);
    }
    // Groups on enough pages, as boxes; boxes that touch (lines of one header) become one.
    const boxes: { rect: Region; pages: Set<number> }[] = [];
    for (const g of groups) {
      const on = new Set(g.map((w) => w.page));
      if (on.size < need) continue;
      const x0 = Math.min(...g.map((w) => w.box.x));
      const y0 = Math.min(...g.map((w) => w.box.y));
      const x1 = Math.max(...g.map((w) => w.box.x + w.box.w));
      const y1 = Math.max(...g.map((w) => w.box.y + w.box.h));
      boxes.push({ rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, pages: on });
    }
    const vertical = band === 'top' || band === 'bottom';
    const merged: typeof boxes = [];
    for (const b of boxes.sort((m, n) => (vertical ? m.rect.y - n.rect.y : m.rect.x - n.rect.x))) {
      const last = merged[merged.length - 1];
      const gap = last ? (vertical ? b.rect.y - (last.rect.y + last.rect.h) : b.rect.x - (last.rect.x + last.rect.w)) : Infinity;
      if (last && gap <= 6) {
        const x0 = Math.min(last.rect.x, b.rect.x);
        const y0 = Math.min(last.rect.y, b.rect.y);
        const x1 = Math.max(last.rect.x + last.rect.w, b.rect.x + b.rect.w);
        const y1 = Math.max(last.rect.y + last.rect.h, b.rect.y + b.rect.h);
        last.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        for (const p of b.pages) last.pages.add(p);
      } else merged.push({ rect: { ...b.rect }, pages: new Set(b.pages) });
    }
    merged.forEach((b, i) => {
      const pad = 2;
      const x = Math.max(0, b.rect.x - pad);
      const y = Math.max(0, b.rect.y - pad);
      const rect = { x, y, w: Math.min(ref.width, b.rect.x + b.rect.w + pad) - x, h: Math.min(ref.height, b.rect.y + b.rect.h + pad) - y };
      const on = [...b.pages].sort((m, n) => m - n);
      const first = texts[on[0]!]!;
      out.push({
        name: merged.length > 1 ? `${BAND_NAMES[band]} ${i + 1}` : BAND_NAMES[band],
        rect,
        pages: on,
        sample: textInRegion(first.words, regionOnPage(rect, ref, first)),
      });
    });
  }
  return out;
}

/** Pages with text inside a box (at the box's place on each page's size). */
export function pagesWithText(texts: readonly (PageText | undefined)[], pages: readonly number[], r: Region, ref: PageSize): number[] {
  return pages.filter((p) => {
    const t = texts[p];
    return !!t && !!textInRegion(t.words, regionOnPage(r, ref, t));
  });
}
