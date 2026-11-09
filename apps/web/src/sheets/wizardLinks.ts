import { SheetLookup, detectLinks, detailId, idTest, textInRegion, type DetectedLink, type LinkHints, type PageText, type Rect } from '@nb/sheets';
import { backgroundLines, boxContents, familyOf, findMarksOnPage, marksToLinks, mayHoldMarks, type MarkHit, type MarkPage, type TaughtMark } from './marks';
import type { TaughtBox } from './teachLinks';

/**
 * The setup wizard's link steps (sections, elevations, details): what a boxed example says, and
 * every link of the step's kind across the set, found from the text and from the taught marks'
 * shapes, with how many references were found and how many got a link.
 */

export type CalloutKind = 'section' | 'elevation' | 'detail';

/** A box drawn on a page, as an example: its words and line work, without the road or hatching behind it. */
export function taughtBox(page: MarkPage, pageIndex: number, box: Rect): TaughtBox {
  const all = boxContents(page, box);
  const behind = backgroundLines(page, box, all);
  return { page, pageIndex, box, contents: { words: all.words, lines: all.lines.filter((_, i) => !behind.has(i)) } };
}

const clean = (t: string) => t.trim().toUpperCase().replace(/^\(+|[,;:.)]+$/g, '');

/** What a boxed callout or title says: its words, the identifier in it, and the sheet it names (other than its own). */
export function boxSays(box: TaughtBox, sheetNumbers: readonly (string | null)[], hints: LinkHints): { text: string; id: string | null; sheet: number | null } {
  const words = [...box.contents.words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lookup = new SheetLookup(sheetNumbers, hints.calloutPart);
  const isId = idTest(hints);
  const id = words.map((w) => clean(w.text)).find((t) => isId(t) && lookup.find(t, true) === null) ?? null;
  const named = words.map((w) => lookup.find(w.text, true)).find((p): p is number => p !== null && p !== box.pageIndex) ?? null;
  return { text: textInRegion(box.contents.words, box.box), id: id ? detailId(id) : null, sheet: named };
}

export interface StepRun {
  /** Links of the step's kind (callouts to their titles, and titles back to where they are cut). */
  links: DetectedLink[];
  /** References of the step's kind found in the set (bubbles read from the text, marks found by shape). */
  places: number;
  /** Of those, how many got a link. */
  linked: number;
  /**
   * Marks found by their shape whose identifier and sheet could not be read. The mark finder keeps
   * only marks it can read, so this stays 0 until shape search reports the others.
   */
  unreadable: number;
}

const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0;
};

/**
 * Every link of `kind` in the set, as the document would get them read with these hints and
 * taught marks: links read from the text, and links from the marks found by shape where the text
 * found none. `readPage` gives a page's line work, read only for pages whose text could hold a mark.
 */
export async function runCalloutStep(
  kind: CalloutKind,
  texts: readonly PageText[],
  sheetNumbers: readonly (string | null)[],
  hints: LinkHints,
  marks: readonly TaughtMark[],
  readPage: (pageIndex: number) => Promise<MarkPage>,
  signal?: AbortSignal,
): Promise<StepRun> {
  const fromText = detectLinks([...texts], sheetNumbers, hints).filter((l) => l.kind === kind);
  const own = marks.filter((m) => familyOf(m.kind) === kind);
  const hits: MarkHit[] = [];
  if (own.length) {
    const lookup = new SheetLookup(sheetNumbers, hints.calloutPart);
    const isId = idTest(hints);
    for (let i = 0; i < texts.length; i++) {
      signal?.throwIfAborted();
      if (!mayHoldMarks(texts[i]!, lookup, own, isId)) continue;
      hits.push(...findMarksOnPage(await readPage(i), i, lookup, own, isId));
    }
  }
  const fromMarks = marksToLinks([...texts], sheetNumbers, hits, hints.calloutPart).filter((l) => l.kind === kind && !fromText.some((t) => t.pageIndex === l.pageIndex && overlap(t.rect, l.rect) > 0.3));
  const links = [...fromText, ...fromMarks];

  // The places: every link's source, and every mark found, once each.
  const places: { pageIndex: number; rect: Rect }[] = [];
  for (const p of [...links, ...hits]) if (!places.some((q) => q.pageIndex === p.pageIndex && overlap(q.rect, p.rect) > 0.3)) places.push({ pageIndex: p.pageIndex, rect: p.rect });
  const linked = places.filter((p) => links.some((l) => l.pageIndex === p.pageIndex && overlap(l.rect, p.rect) > 0.3)).length;
  return { links, places: places.length, linked, unreadable: hits.filter((h) => !h.detail && !h.sheet).length };
}
