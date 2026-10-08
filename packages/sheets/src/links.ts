import { isDrawingNumberShape } from './detect.ts';
import type { PageText, Word } from './types.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a callout points at: a whole sheet, or a detail/section drawn on it. */
export type LinkKind = 'detail' | 'sheet';

export interface DetectedLink {
  /** Stable across re-detection (page + label + rounded position), so review decisions stick. */
  id: string;
  pageIndex: number;
  /** Clickable area on the source page, in page space. */
  rect: Rect;
  /** Callout text as it reads, e.g. `3/C-501` or `C-102`. */
  label: string;
  kind: LinkKind;
  /** Detail or section identifier, for detail links. */
  detail: string | null;
  targetPage: number;
  /** Where the referenced detail sits on the target page; null means "the whole sheet". */
  targetRect: Rect | null;
  /** 0..1 */
  confidence: number;
}

/** Detail/section identifiers in callout bubbles: 3, 12, 3A, A, B2. */
const DETAIL_ID = /^(\d{1,3}[A-Z]?|[A-Z]\d{0,2})$/;
/** Sheet-number shape (same as sheet detection) for slash references. */
const SHEET_PART = '[A-Z]{1,3}[-.]?\\d{1,3}(?:[.-]\\d{1,3})?[A-Z]?';
/** `3/C-501`, `DETAIL 3/C-501`, `A/S-301`. */
const SLASH_REF = new RegExp(`^(\\d{1,3}[A-Z]?|[A-Z]\\d{0,2})\\/(${SHEET_PART})$`);

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function wordRect(w: Word, pad = 0): Rect {
  return { x: w.x0 - pad, y: w.y0 - pad, w: w.x1 - w.x0 + pad * 2, h: w.y1 - w.y0 + pad * 2 };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

const cleanWord = (t: string) => t.trim().toUpperCase().replace(/[,;:.)]+$/, '').replace(/^[(]+/, '');

/**
 * Looks up sheet numbers the way people write them. Exact text first; then ignoring separators
 * (C-501 vs C501), but only where that is unambiguous within the set. With `short`, also the
 * last segment of a long document number (`300082` for HLD1BDD-WSPAU-0508-BR-DRG-300082), as
 * section and detail bubbles abbreviate it; callers only allow that where the context says callout.
 */
export class SheetLookup {
  private exact = new Map<string, number>();
  private loose = new Map<string, number | null>();
  private tail = new Map<string, number | null>();

  constructor(sheetNumbers: readonly (string | null)[]) {
    sheetNumbers.forEach((n, pageIndex) => {
      if (!n) return;
      const key = n.trim().toUpperCase();
      if (!this.exact.has(key)) this.exact.set(key, pageIndex);
      const l = key.replace(/[-.\s]/g, '');
      this.loose.set(l, this.loose.has(l) && this.loose.get(l) !== pageIndex ? null : pageIndex);
      const parts = key.split(/[-.\s_/]+/);
      const t = parts[parts.length - 1]!;
      if (parts.length > 1 && t.length >= 3 && /\d/.test(t)) this.tail.set(t, this.tail.has(t) && this.tail.get(t) !== pageIndex ? null : pageIndex);
    });
  }

  find(text: string, short = false): number | null {
    const key = cleanWord(text);
    const found = this.exact.get(key) ?? this.loose.get(key.replace(/[-.\s]/g, ''));
    if (found !== undefined && found !== null) return found;
    return (short && !this.exact.has(key) ? this.tail.get(key) : null) ?? null;
  }
}

/**
 * On the target sheet, where the detail titled `detail` is drawn. Detail titles repeat the
 * callout's identifier in a larger bubble, usually with the sheet's own number beneath it and the
 * detail name to its right.
 */
export function findDetailTitle(page: PageText, detail: string, ownNumber: string | null, lookup: SheetLookup, selfPage: number): Word | null {
  const med = median(page.words.map((w) => w.size)) || 1;
  let best: { w: Word; score: number } | null = null;
  for (const w of page.words) {
    if (cleanWord(w.text) !== detail) continue;
    // Everything in the lower half of a bubble around this identifier; stray labels can sit there too.
    const below = page.words.filter((o) => o !== w && o.y0 >= w.y1 - w.size * 0.3 && o.y0 - w.y1 < w.size * 1.2 && Math.abs((o.x0 + o.x1) / 2 - (w.x0 + w.x1) / 2) < Math.max(w.x1 - w.x0, o.x1 - o.x0));
    // A bubble whose lower half names another sheet is a callout, not this detail's title.
    if (below.some((o) => { const p = lookup.find(o.text, true); return p !== null && p !== selfPage; })) continue;
    let score = w.size / med;
    if (ownNumber && below.some((o) => cleanWord(o.text) === ownNumber.toUpperCase() || lookup.find(o.text, true) === selfPage)) score += 2;
    const titleRight = page.words.some((o) => o.x0 > w.x1 && o.x0 - w.x1 < w.size * 4 && Math.abs(o.y1 - w.y1) < w.size && /^[A-Z][A-Z\s&-]{3,}$/.test(o.text));
    if (titleRight) score += 1;
    // Ties go to the larger bubble: detail titles are drawn bigger than the callouts to them.
    if (!best || score > best.score || (score === best.score && w.size > best.w.size)) best = { w, score };
  }
  return best && best.score >= 1.8 ? best.w : null;
}

/**
 * On the target sheet, a bubble with the same identifier that points back at the source sheet:
 * where a section title names the sheet it is cut on, that sheet carries the matching cut marker.
 */
function findCutMarker(page: PageText, detail: string, lookup: SheetLookup, sourcePage: number): Word | null {
  for (const w of page.words) {
    if (cleanWord(w.text) !== detail) continue;
    const back = page.words.some(
      (o) => o !== w && o.y0 >= w.y1 - w.size * 0.3 && o.y0 - w.y1 < w.size * 1.2 && Math.abs((o.x0 + o.x1) / 2 - (w.x0 + w.x1) / 2) < Math.max(w.x1 - w.x0, o.x1 - o.x0) && lookup.find(o.text, true) === sourcePage,
    );
    if (back) return w;
  }
  return null;
}

/** Frames the area around a section cut marker. */
function cutFrame(marker: Word): Rect {
  const s = marker.size;
  return { x: marker.x0 - s * 20, y: marker.y0 - s * 12, w: s * 40, h: s * 24 };
}

/** Frames a detail title bubble and the area above it, where the detail itself is drawn. */
function detailFrame(title: Word): Rect {
  const s = title.size;
  return { x: title.x0 - s * 4, y: title.y0 - s * 20, w: s * 40, h: s * 24 };
}

/** Words that introduce a reference to another drawing: `SEE SHEET 12`, `DRG No. 680`. */
const REFERENCE_WORD = /^(SEE|REFER|SHEET|SHEETS|SHT|DRG|DRGS|DWG|DWGS|DRAWING|DRAWINGS|NO|NOS|NUMBER)\.?$/;

/** Whether the word just before `w` on its line introduces a drawing reference. */
function introducedAsReference(page: PageText, w: Word): boolean {
  let prev: Word | null = null;
  for (const o of page.words) {
    if (o === w || Math.abs(o.y1 - w.y1) > w.size * 0.4 || o.x1 > w.x0 + w.size * 0.2 || w.x0 - o.x1 > w.size * 3) continue;
    if (!prev || o.x1 > prev.x1) prev = o;
  }
  return !!prev && REFERENCE_WORD.test(cleanWord(prev.text));
}

function stableId(pageIndex: number, label: string, r: Rect): string {
  return `${pageIndex}:${label}:${Math.round(r.x / 4)}:${Math.round(r.y / 4)}`;
}

/**
 * Finds hyperlinks between sheets from the text layer:
 * - detail/section bubbles: an identifier stacked above a sheet number (`3` over `C-501`);
 * - slash references: `3/C-501`;
 * - plain sheet references: `SEE SHEET C-102`, match lines, the cover-sheet index.
 * Only sheet numbers that exist in the set are linked, which keeps false positives rare. Sheets
 * numbered with bare numbers or short codes (`680`, `1B`, page labels) are only linked where the
 * text says it means a drawing (`SEE SHEET 680`): elsewhere those are addresses, stages, quantities.
 */
export function detectLinks(pages: PageText[], sheetNumbers: readonly (string | null)[]): DetectedLink[] {
  const lookup = new SheetLookup(sheetNumbers);
  const links: DetectedLink[] = [];
  const weak = sheetNumbers.map((n) => !!n && !isDrawingNumberShape(n));

  pages.forEach((page, pageIndex) => {
    const own = sheetNumbers[pageIndex]?.toUpperCase() ?? null;
    const used = new Set<Word>();

    const titleCache = new Map<string, Word | null>();
    const resolveDetail = (detail: string, targetPage: number) => {
      const key = `${targetPage}:${detail}`;
      if (!titleCache.has(key)) titleCache.set(key, findDetailTitle(pages[targetPage]!, detail, sheetNumbers[targetPage] ?? null, lookup, targetPage));
      return titleCache.get(key)!;
    };

    const add = (label: string, rect: Rect, kind: LinkKind, detail: string | null, targetPage: number, confidence: number) => {
      const title = detail ? resolveDetail(detail, targetPage) : null;
      const cut = detail && !title && targetPage !== pageIndex ? findCutMarker(pages[targetPage]!, detail, lookup, pageIndex) : null;
      const targetRect = title ? detailFrame(title) : cut ? cutFrame(cut) : null;
      // A detail callout whose detail cannot be found still links to the sheet, less confidently.
      const conf = detail && !targetRect ? confidence - 0.2 : confidence;
      links.push({ id: stableId(pageIndex, label, rect), pageIndex, rect, label, kind, detail, targetPage, targetRect, confidence: Math.round(conf * 100) / 100 });
    };

    // 1. Stacked bubbles.
    for (const bottom of page.words) {
      const target = lookup.find(bottom.text, true);
      if (target === null || weak[target]) continue;
      const cx = (bottom.x0 + bottom.x1) / 2;
      const top = page.words.find(
        (w) =>
          w !== bottom &&
          !used.has(w) &&
          DETAIL_ID.test(cleanWord(w.text)) &&
          w.y1 <= bottom.y0 + bottom.size * 0.3 &&
          bottom.y0 - w.y1 < bottom.size * 1.2 &&
          Math.abs((w.x0 + w.x1) / 2 - cx) < Math.max(bottom.x1 - bottom.x0, w.x1 - w.x0) * 0.6 &&
          w.size / bottom.size > 0.6 &&
          w.size / bottom.size < 1.8,
      );
      if (!top) continue;
      used.add(top);
      used.add(bottom);
      // The bubble that titles a detail on its own sheet is what callouts point at, not a link.
      if (target === pageIndex && resolveDetail(cleanWord(top.text), pageIndex) === top) continue;
      const detail = cleanWord(top.text);
      const pad = bottom.size * 0.5;
      add(`${detail}/${cleanWord(bottom.text)}`, union(wordRect(top, pad), wordRect(bottom, pad)), 'detail', detail, target, 0.9);
    }

    for (const w of page.words) {
      if (used.has(w)) continue;
      const text = cleanWord(w.text);
      // 2. Slash references.
      const slash = SLASH_REF.exec(text);
      if (slash) {
        const target = lookup.find(slash[2]!);
        if (target !== null) {
          used.add(w);
          add(text, wordRect(w, w.size * 0.3), 'detail', slash[1]!, target, 0.85);
        }
        continue;
      }
      // 3. Plain sheet references. A sheet naming itself (its title block, its own drawing number
      // in notes) is not a link anywhere useful.
      const target = lookup.find(text);
      if (target === null || target === pageIndex) continue;
      if (weak[target] && !introducedAsReference(page, w)) continue;
      used.add(w);
      add(text, wordRect(w, w.size * 0.3), 'sheet', null, target, 0.8);
    }
  });
  return links;
}
