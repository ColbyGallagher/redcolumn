import { templateSegments, visualSearch } from '@nb/measure';
import { DEFAULT_LINK_HINTS, DETAIL_ID, idTest, SheetLookup, detailFrame, detailId, findDetailTitle, isDrawingNumberShape, type DetectedLink, type LinkHints, type PageText, type Rect, type Word } from '@nb/sheets';

/**
 * Taught marks: the user boxes one example of a section mark, section title, detail callout or
 * detail title and says which it is. The example's line work (the bubble, the cut arrow, the
 * underline) is found again with Symbol Search's vector matcher, and the label words are read
 * where the example had them: the detail or section identifier and the sheet it points at. Every
 * match becomes a link candidate for a person to check; none is applied on its own.
 */

export type MarkKind = 'sectionMark' | 'sectionTitle' | 'detailCallout' | 'detailTitle';

export const MARK_KINDS: Record<MarkKind, string> = {
  sectionMark: 'Section mark',
  sectionTitle: 'Section title',
  detailCallout: 'Detail callout',
  detailTitle: 'Detail title',
};

/** Callouts point at another drawing; titles sit under the drawing they name. */
export const isTitleKind = (k: MarkKind) => k === 'sectionTitle' || k === 'detailTitle';

/** A word of the example: what it is and where its centre sat, relative to the box's top-left. */
export interface MarkWord {
  /** `detail`: the section or detail identifier; `sheet`: a sheet number; `text`: fixed wording (SECTION, DETAIL). */
  role: 'detail' | 'sheet' | 'text';
  text: string;
  x: number;
  y: number;
  size: number;
}

/** A taught example, saved in the user's profile. */
export interface TaughtMark {
  id: string;
  kind: MarkKind;
  name: string;
  createdAt: number;
  /** The example box's size, in points. */
  w: number;
  h: number;
  /** Line work inside the box as flat [x1, y1, x2, y2, ...], relative to the box's top-left. */
  lines: number[];
  words: MarkWord[];
}

/** A page to search: its text and its vector line work. */
export interface MarkPage extends PageText {
  segments: ArrayLike<number>;
}

/** Sheet-number shape (as in links.ts), for examples taught before the set's sheet numbers are known. */
const SHEET_SHAPE = /^[A-Z]{1,3}[-.]?\d{1,4}(?:[.-]\d{1,3})?[A-Z]?$/;
/** More line work than this in the box means it holds more than one mark. */
const MAX_LINES = 600;

const TRAILING = new Set([',', ';', ':', '.', ')']);
/** A word without opening brackets or trailing punctuation (trimmed by hand: a `[...]+$` regex is slow on long runs). */
const clean = (t: string) => {
  const s = t.trim().toUpperCase();
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === '(') start++;
  while (end > start && TRAILING.has(s[end - 1]!)) end--;
  return s.slice(start, end);
};
const center = (w: Word): [number, number] => [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2];
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Makes a taught mark from the box the user drew. Throws, with a message for the user, when the
 * box cannot work as an example (no label to read, or several marks' worth of line work).
 */
/** Detail and section identifiers, as links.ts reads them; a drawing standard can name its own forms (see idTest). */
const anyId = (t: string) => DETAIL_ID.test(t);

/** `hints`: the drawing standard's identifier forms and the part of a number its callouts cite. */
export function teachMark(page: MarkPage, box: Rect, kind: MarkKind, name: string, sheetNumbers: readonly (string | null)[] = [], hints: LinkHints = DEFAULT_LINK_HINTS): TaughtMark {
  const lookup = new SheetLookup(sheetNumbers, hints.calloutPart);
  const isId = idTest(hints);
  const inside = page.words.filter((w) => {
    const [cx, cy] = center(w);
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
  });
  const isSheet = (t: string) => lookup.find(t, true) !== null || SHEET_SHAPE.test(t) || isDrawingNumberShape(t);
  // The sheet number: the longest sheet-like word. The identifier: the largest other short label.
  const sheet = inside.filter((w) => isSheet(clean(w.text)) && !(isId(clean(w.text)) && lookup.find(w.text, true) === null)).sort((a, b) => clean(b.text).length - clean(a.text).length)[0];
  const detail = inside.filter((w) => w !== sheet && isId(clean(w.text))).sort((a, b) => b.size - a.size || a.y0 - b.y0)[0];
  if (!detail && !sheet) {
    throw new Error(
      inside.length === 0
        ? `There is no selectable text in the box (${page.words.length} word${page.words.length === 1 ? '' : 's'} on this page). If the drawing's text is drawn as lines, as CAD plots often do, run Document › OCR… on the pages first, then teach the mark again.`
        : `There is no label text in the box. Box the whole mark, with its number, and try again. Text found in the box: ${inside.map((w) => `"${w.text}"`).join(', ')}.`,
    );
  }
  const words: MarkWord[] = inside.flatMap((w) => {
    const role = w === detail ? 'detail' : w === sheet ? 'sheet' : 'text';
    // Other words with digits (scales, dimensions) change from one mark to the next.
    if (role === 'text' && /\d/.test(w.text)) return [];
    const [cx, cy] = center(w);
    return [{ role, text: clean(w.text), x: round(cx - box.x), y: round(cy - box.y), size: round(w.size) }];
  });
  const segs = templateSegments(page.segments, box);
  if (segs.length > MAX_LINES) throw new Error('The box holds too much line work for one mark. Draw it tightly around a single mark.');
  const lines = segs.flatMap(([x1, y1, x2, y2]) => [round(x1 - box.x), round(y1 - box.y), round(x2 - box.x), round(y2 - box.y)]);
  return { id: crypto.randomUUID(), kind, name: name.trim() || MARK_KINDS[kind], createdAt: Date.now(), w: round(box.w), h: round(box.h), lines, words };
}

/** One place a taught mark was found, and what its label says. */
export interface MarkHit {
  mark: TaughtMark;
  pageIndex: number;
  rect: Rect;
  /** Share of the example's line work found; null for a mark with no line work (found by its words). */
  shape: number | null;
  /** Share of the example's words found where they belong. */
  text: number;
  detail: Word | null;
  sheet: Word | null;
  /** For a title: the section or detail it names, as far as its underline suggests; `rect` is the title alone. */
  frame?: Rect;
}

/**
 * The drawing a title names. Titles are underlined with a rule as wide as the drawing above them,
 * so the section runs from that rule up, about three quarters as high as it is wide. Null when no
 * such rule is found (or it runs most of the sheet's width, as a border does).
 */
export function sectionFrame(segments: ArrayLike<number>, box: Rect, pageWidth: number): Rect | null {
  const tol = 0.8;
  const band = { top: box.y + box.h * 0.4, bottom: box.y + box.h * 1.6 };
  let best: { y: number; x0: number; x1: number } | null = null;
  const rules: { y: number; x0: number; x1: number }[] = [];
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const y1 = segments[i + 1]!;
    const y2 = segments[i + 3]!;
    if (Math.abs(y1 - y2) > 0.5) continue;
    const x0 = Math.min(segments[i]!, segments[i + 2]!);
    const x1 = Math.max(segments[i]!, segments[i + 2]!);
    const y = (y1 + y2) / 2;
    if (x1 - x0 < 1) continue;
    // Only a rule in the title's band can be its underline, or a piece of one.
    if (y >= band.top - tol && y <= band.bottom + tol) rules.push({ y, x0, x1 });
    if (y < band.top || y > band.bottom || x1 < box.x || x0 > box.x + box.w || x1 - x0 < box.w * 0.5) continue;
    if (!best || x1 - x0 > best.x1 - best.x0) best = { y, x0, x1 };
  }
  if (!best) return null;
  // Chain on the pieces of a rule drawn in several strokes.
  const y = best.y;
  let { x0, x1 } = best;
  const same = rules.filter((r) => Math.abs(r.y - y) <= tol);
  for (let grown = true; grown; ) {
    grown = false;
    for (const r of same) {
      if (r.x0 < x0 - 1 && r.x1 >= x0 - 1) (x0 = r.x0), (grown = true);
      if (r.x1 > x1 + 1 && r.x0 <= x1 + 1) (x1 = r.x1), (grown = true);
    }
  }
  const w = x1 - x0;
  if (w > pageWidth * 0.6 || w < box.w * 0.5) return null;
  const top = Math.max(0, y - w * 0.75);
  const bottom = Math.max(y, box.y + box.h) + 2;
  return { x: x0, y: top, w, h: bottom - top };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0;
}

/** Reads the example's words at a candidate place (box top-left `ox, oy`, size `k` times the example's). */
function readLabel(mark: TaughtMark, page: PageText, ox: number, oy: number, k: number, lookup: SheetLookup, isId: (t: string) => boolean) {
  const box = { x: ox, y: oy, w: mark.w * k, h: mark.h * k };
  const fits: Record<MarkWord['role'], (t: string) => boolean> = {
    detail: isId,
    sheet: (t) => lookup.find(t, true) !== null,
    text: () => true,
  };
  const taken = new Set<Word>();
  let score = 0;
  const found: Partial<Record<MarkWord['role'], Word>> = {};
  for (const mw of mark.words) {
    const ex = ox + mw.x * k;
    const ey = oy + mw.y * k;
    const tol = Math.max(mw.size * k * 1.2, 3);
    const ok = (w: Word) => !taken.has(w) && fits[mw.role](clean(w.text)) && (mw.role !== 'text' || clean(w.text) === mw.text);
    let best: Word | null = null;
    let bestD = Infinity;
    for (const w of page.words) {
      const [cx, cy] = center(w);
      const d = Math.hypot(cx - ex, cy - ey);
      if (d <= tol && d < bestD && ok(w) && w.size / k > mw.size * 0.6 && w.size / k < mw.size * 1.6) {
        best = w;
        bestD = d;
      }
    }
    // Labels shift a little from mark to mark; one elsewhere in (or just beside) the mark counts for less.
    if (!best && mw.role !== 'text') {
      const near = { x: box.x - box.w * 0.25, y: box.y - box.h * 0.25, w: box.w * 1.5, h: box.h * 1.5 };
      best =
        page.words.find((w) => {
          const [cx, cy] = center(w);
          return ok(w) && cx >= near.x && cx <= near.x + near.w && cy >= near.y && cy <= near.y + near.h;
        }) ?? null;
      if (best) score -= 0.5;
    }
    if (!best) continue;
    taken.add(best);
    score += 1;
    if (mw.role !== 'text') found[mw.role] = best;
  }
  return { box, text: mark.words.length ? Math.max(0, score) / mark.words.length : 0, detail: found.detail ?? null, sheet: found.sheet ?? null };
}

/** Every place a taught mark appears on a page whose label can be read. */
function findOnPage(mark: TaughtMark, page: MarkPage, pageIndex: number, lookup: SheetLookup, isId: (t: string) => boolean): MarkHit[] {
  const hits: MarkHit[] = [];
  const needs = (h: ReturnType<typeof readLabel>) =>
    // A mark that showed a sheet number must show one here too (grid bubbles are the same circles).
    (!mark.words.some((w) => w.role === 'detail') || h.detail) && (!mark.words.some((w) => w.role === 'sheet') || h.sheet);
  const segs: [number, number, number, number][] = [];
  for (let i = 0; i + 3 < mark.lines.length; i += 4) segs.push([mark.lines[i]!, mark.lines[i + 1]!, mark.lines[i + 2]!, mark.lines[i + 3]!]);
  if (segs.length >= 2) {
    // The matcher reports where the line work's extent lands; the box sits at the same offset from it.
    const tx = Math.min(...segs.flatMap((s) => [s[0], s[2]]));
    const ty = Math.min(...segs.flatMap((s) => [s[1], s[3]]));
    for (const m of visualSearch(page.segments, segs, { minScore: 0.8 })) {
      const read = readLabel(mark, page, m.rect.x - tx, m.rect.y - ty, 1, lookup, isId);
      if (needs(read)) hits.push({ mark, pageIndex, rect: read.box, shape: m.score, text: read.text, detail: read.detail, sheet: read.sheet, frame: isTitleKind(mark.kind) ? (sectionFrame(page.segments, read.box, page.width) ?? undefined) : undefined });
    }
    return hits;
  }
  // No line work (a title set in text alone): find the words in the same arrangement.
  const anchor = mark.words.find((w) => w.role === 'detail') ?? mark.words.find((w) => w.role === 'sheet') ?? mark.words[0];
  if (!anchor) return hits;
  for (const w of page.words) {
    const t = clean(w.text);
    if (anchor.role === 'detail' ? !isId(t) : anchor.role === 'sheet' ? lookup.find(t, true) === null : t !== anchor.text) continue;
    const k = w.size / anchor.size;
    if (k < 0.8 || k > 1.25) continue;
    const [cx, cy] = center(w);
    const read = readLabel(mark, page, cx - anchor.x * k, cy - anchor.y * k, k, lookup, isId);
    // Fixed words or a second label must back the anchor up: one number alone is not a mark.
    if (needs(read) && (mark.words.length < 2 || read.text > 1 / mark.words.length + 0.01)) hits.push({ mark, pageIndex, rect: read.box, shape: null, text: read.text, detail: read.detail, sheet: read.sheet, frame: isTitleKind(mark.kind) ? (sectionFrame(page.segments, read.box, page.width) ?? undefined) : undefined });
  }
  return hits;
}

function confidence(h: MarkHit): number {
  const c = h.shape === null ? 0.3 + 0.4 * h.text : 0.4 + 0.3 * h.shape + 0.25 * h.text;
  return Math.min(0.95, c);
}

/**
 * Finds taught marks across a set and turns them into link candidates (ids start `mark-`):
 * - section marks and detail callouts link to the sheet their label names (or their own sheet,
 *   when the example named none), framing the matching title there when one is found;
 * - section and detail titles that name the sheet they are cut on link back to it.
 * Titles also tell callouts where on the target sheet their detail is drawn.
 */
export function findMarks(pages: readonly MarkPage[], sheetNumbers: readonly (string | null)[], marks: readonly TaughtMark[], hints: LinkHints = DEFAULT_LINK_HINTS): DetectedLink[] {
  const lookup = new SheetLookup(sheetNumbers, hints.calloutPart);
  const isId = idTest(hints);
  return marksToLinks(
    pages,
    sheetNumbers,
    pages.flatMap((page, pageIndex) => findMarksOnPage(page, pageIndex, lookup, marks, isId)),
    hints.calloutPart,
  );
}

/**
 * Whether a page's text has what a mark's label needs (an identifier, a sheet number), so a large
 * set only loads line work for pages that can hold one (not scans, not sheets of plain notes).
 */
export function mayHoldMarks(page: PageText, lookup: SheetLookup, marks: readonly TaughtMark[], isId: (t: string) => boolean = anyId): boolean {
  const ids = page.words.some((w) => isId(clean(w.text)));
  const sheets = page.words.some((w) => lookup.find(w.text, true) !== null);
  return marks.some((m) => (ids || !m.words.some((w) => w.role === 'detail')) && (sheets || !m.words.some((w) => w.role === 'sheet')));
}

/** Every taught mark found on one page (one per place). */
export function findMarksOnPage(page: MarkPage, pageIndex: number, lookup: SheetLookup, marks: readonly TaughtMark[], isId: (t: string) => boolean = anyId): MarkHit[] {
  const onPage: MarkHit[] = [];
  for (const mark of marks) onPage.push(...findOnPage(mark, page, pageIndex, lookup, isId));
  // One mark per place: the best of overlapping matches (two examples of one style, say).
  onPage.sort((a, b) => confidence(b) - confidence(a));
  const out: MarkHit[] = [];
  for (const h of onPage) if (!out.some((o) => overlap(o.rect, h.rect) > 0.5)) out.push(h);
  return out;
}

/** Turns the marks found across a set into link candidates (see findMarks). */
export function marksToLinks(pages: readonly PageText[], sheetNumbers: readonly (string | null)[], hits: readonly MarkHit[], calloutPart: number | null = null): DetectedLink[] {
  const lookup = new SheetLookup(sheetNumbers, calloutPart);
  const titles = new Map<string, Word>();
  /** Where each taught title was found: the preview zooms to it. */
  const titleRects = new Map<string, Rect>();
  const callouts = new Map<string, Rect>();
  /** Section marks alone: a section title on its own sheet goes to its cut, not to a detail callout with the same letter. */
  const cuts = new Map<string, Rect>();
  for (const h of hits) {
    if (!h.detail) continue;
    const key = `${h.pageIndex}:${detailId(h.detail.text)}`;
    if (isTitleKind(h.mark.kind)) {
      titles.set(key, h.detail);
      titleRects.set(key, h.frame ?? detailFrame(h.detail));
    }
    else {
      callouts.set(key, h.rect);
      if (h.mark.kind === 'sectionMark') cuts.set(key, h.rect);
    }
  }

  const links: DetectedLink[] = [];
  for (const h of hits) {
    const detail = h.detail ? detailId(h.detail.text) : null;
    const sheetText = h.sheet ? clean(h.sheet.text) : null;
    const named = h.sheet ? lookup.find(h.sheet.text, true) : null;
    let targetPage: number;
    let targetRect: Rect | null = null;
    if (isTitleKind(h.mark.kind)) {
      // A title names the sheet it is cut on; with no sheet named (a dash), it is cut on its own sheet.
      const own = h.mark.kind === 'sectionTitle' && (!h.sheet || named === h.pageIndex);
      if (!own && (named === null || named === h.pageIndex)) continue;
      targetPage = own ? h.pageIndex : named!;
      const cut = detail ? (own ? cuts : callouts).get(`${targetPage}:${detail}`) : undefined;
      // On its own sheet, a title with no cut mark to go to is a destination, not a link.
      if (own && !cut) continue;
      if (cut) targetRect = cut;
    } else {
      targetPage = named ?? h.pageIndex;
      if (detail) {
        const title = titles.get(`${targetPage}:${detail}`) ?? findDetailTitle(pages[targetPage]!, detail, sheetNumbers[targetPage] ?? null, lookup, targetPage);
        // On its own sheet, the callout must not take itself for the title.
        const own = title && targetPage === h.pageIndex && overlap({ x: title.x0, y: title.y0, w: title.x1 - title.x0, h: title.y1 - title.y0 }, h.rect) > 0;
        // A taught title is framed as taught; one found by its text gets a frame for the whole detail.
        if (title && !own) targetRect = titleRects.get(`${targetPage}:${detail}`) ?? detailFrame(title);
      }
    }
    if (!detail && targetPage === h.pageIndex) continue;
    const label = detail && sheetText ? `${detail}/${sheetText}` : (detail ?? sheetText!);
    const conf = confidence(h) - (detail && !targetRect ? 0.1 : 0);
    links.push({
      id: `mark-${h.pageIndex}:${label}:${Math.round(h.rect.x / 4)}:${Math.round(h.rect.y / 4)}`,
      pageIndex: h.pageIndex,
      rect: h.rect,
      label,
      kind: h.mark.kind === 'sectionMark' || h.mark.kind === 'sectionTitle' ? 'section' : detail ? 'detail' : 'sheet',
      detail,
      targetPage,
      targetRect,
      confidence: Math.round(conf * 100) / 100,
    });
  }
  return links;
}
