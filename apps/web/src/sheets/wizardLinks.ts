import { SheetLookup, detectLinks, detailId, idTest, matchLineLabels, textInRegion, type DetectedLink, type LinkHints, type PageText, type Rect } from '@nb/sheets';
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


/** What a pair of match-line labels taught: the words to look for, and what the person should know. */
export interface MatchLesson {
  /** The standard's link words with the label's words added; null when the usual words already read it. */
  links: LinkHints | null;
  notes: string[];
  /** Why the pair cannot be kept as it is; null when it can. */
  problem: string | null;
}

/** Words on a label that are about the reference, not the words that say "match line". */
const NOT_THE_PHRASE = new Set(['SEE', 'SHEET', 'SHEETS', 'SHT', 'DRG', 'DWG', 'DRAWING', 'REFER', 'TO', 'NO', 'NO.', 'CH', 'STA', 'CHAINAGE', 'ADJOINS', 'ADJOINING', 'CONTINUED', 'ON', 'AT', 'FOR']);
const CHAINAGE_ON_LABEL = /\b(?:CH|STA|CHAINAGE)\.?\s*\d|\b\d+\+\d{2,3}\b/;

/** Whether one of the match-line phrases is in a label's text (a phrase also run together: MATCHLINE). */
function saysMatchLine(text: string, phrases: readonly string[]): boolean {
  const flat = text.toUpperCase().replace(/\s+/g, '');
  return phrases.some((p) => p.trim() && flat.includes(p.toUpperCase().replace(/\s+/g, '')));
}

/**
 * Learns from a match-line label and, when given, the matching label on the sheet it names:
 * the words that say match line (when the usual ones do not), whether labels give the chainage
 * and the adjoining drawing, and whether the pair agrees with itself.
 */
export function learnMatchLine(first: TaughtBox, second: TaughtBox | null, sheetNumbers: readonly (string | null)[], hints: LinkHints): MatchLesson {
  const notes: string[] = [];
  const where = (i: number) => sheetNumbers[i] ?? `sheet ${i + 1}`;
  const a = boxSays(first, sheetNumbers, hints);
  const fail = (problem: string): MatchLesson => ({ links: null, notes, problem });
  if (!a.text.trim()) return fail('There is no text in that box. Draw it around the label’s words.');
  if (second) {
    const b = boxSays(second, sheetNumbers, hints);
    if (second.pageIndex === first.pageIndex) return fail('Both labels are on the same sheet. Box the second one on the sheet the first one names.');
    if (a.sheet !== null && a.sheet !== second.pageIndex) return fail(`The first label names ${where(a.sheet)}, not ${where(second.pageIndex)} where you boxed the second.`);
    if (b.sheet !== null && b.sheet !== first.pageIndex) return fail(`The second label names ${where(b.sheet)}, not ${where(first.pageIndex)} where you boxed the first.`);
    if (b.sheet === null) notes.push(`The label on ${where(second.pageIndex)} names no drawing in this set, so it is found by its words only.`);
  }
  let h: LinkHints | null = null;
  const text = a.text.toUpperCase();
  if (!saysMatchLine(text, hints.matchLine)) {
    // The leading words that are not about the reference: MATCH LINE, JOIN LINE, LIMIT OF SHEET.
    const words = text.split(/\s+/).map((w) => w.replace(/[^A-Z]/g, ''));
    const phrase: string[] = [];
    for (const w of words) {
      if (!w || NOT_THE_PHRASE.has(w) || phrase.length === 3) {
        if (phrase.length) break;
        continue;
      }
      phrase.push(w);
    }
    if (!phrase.length) return fail('No words in that label say it is a match line. Box the words with it (MATCH LINE, JOIN LINE).');
    h = { ...hints, matchLine: [...hints.matchLine, phrase.join(' ')] };
    notes.push(`Match lines are labelled ${phrase.join(' ')}.`);
  }
  notes.push(a.sheet !== null ? `Labels name the adjoining drawing (${where(a.sheet)}).` : 'This label names no drawing in the set: match lines will link only where their label does.');
  if (CHAINAGE_ON_LABEL.test(text)) notes.push('Labels give the chainage of the line, so the sheets can be lined up along the road.');
  return { links: h, notes, problem: null };
}

/**
 * The set's match-line links, with how many labels were found and how many link: a label
 * found by its words that names no sheet in the set is found but not linked.
 */
export function runMatchLineStep(texts: readonly PageText[], sheetNumbers: readonly (string | null)[], hints: LinkHints): StepRun {
  const links = detectLinks([...texts], sheetNumbers, hints).filter((l) => l.kind === 'matchline');
  const claimed = new Set<DetectedLink>();
  let places = 0;
  let linked = 0;
  texts.forEach((page, pageIndex) => {
    for (const w of matchLineLabels(page, hints)) {
      places++;
      const cx = (w.x0 + w.x1) / 2;
      const cy = (w.y0 + w.y1) / 2;
      const near = links.filter((l) => l.pageIndex === pageIndex && Math.hypot(l.rect.x + l.rect.w / 2 - cx, l.rect.y + l.rect.h / 2 - cy) < w.size * 40);
      if (near.length) linked++;
      for (const l of near) claimed.add(l);
    }
  });
  // A link whose label the words did not find (worded another way) is still one label, linked.
  const others = links.filter((l) => !claimed.has(l)).length;
  return { links, places: places + others, linked: linked + others, unreadable: 0 };
}
