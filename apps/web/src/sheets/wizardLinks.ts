import { SheetLookup, alignmentTemplateOf, alignmentsIn, chainageReport, detectLinks, detailId, idTest, matchLineLabels, textInRegion, type AlignmentSource, type ChainageAmbiguity, type ChainageHints, type DetectedLink, type LinkHints, type PageText, type Rect, type SheetInfo } from '@nb/sheets';
import { backgroundLines, boxContents, familyOf, findMarksOnPage, marksToLinks, mayHoldMarks, type MarkHit, type MarkPage, type TaughtMark } from './marks';
import { chainageIn, learnSheetTitles, type TaughtBox } from './teachLinks';

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

/** The four boxes of the chainage step, in the order they are drawn. */
export interface ChainBoxes {
  /** A chainage on a plan (a tick or `CH 150`). */
  planChainage: TaughtBox;
  /** The name of the alignment that chainage is on, on the same plan. */
  planAlignment: TaughtBox;
  /** On a cross-section sheet of that alignment, where it names the alignment. */
  sectionAlignment: TaughtBox;
  /** On that sheet, one section's chainage. */
  sectionChainage: TaughtBox;
}

/** What the four boxes taught. */
export interface ChainLesson {
  /** The standard's chainage settings with what the boxes taught; null when they taught nothing new. */
  chainage: ChainageHints | null;
  notes: string[];
  /** Why the boxes cannot be kept as they are; null when they can. */
  problem: string | null;
}

/** An alignment name as boxed: its words in reading order, upper case, without the punctuation around it. */
export function alignmentSays(box: TaughtBox): string {
  return textInRegion(box.contents.words, box.box)
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[(]+|[,;:.)]+$/g, ''))
    .filter(Boolean)
    .join(' ');
}

const centre = (r: Rect) => [r.x + r.w / 2, r.y + r.h / 2] as const;

/**
 * Learns from the four boxes: how the plan and the cross sections write chainages, the alignment's
 * name and the form names take (`MC##`), which sheets are plans and which cross sections, and
 * where a cross-section sheet says its alignment (its title, once on the sheet, or beside each
 * section). Then checks the chain links on these two sheets.
 */
export function learnAlignmentChain(b: ChainBoxes, sheets: readonly (SheetInfo | null | undefined)[], hints: ChainageHints, titleBox: Rect | null = null): ChainLesson {
  const notes: string[] = [];
  const fail = (problem: string): ChainLesson => ({ chainage: null, notes, problem });
  const name = (i: number) => sheets[i]?.number ?? `sheet ${i + 1}`;
  const along = chainageIn(b.planChainage.contents.words);
  if (!along) return fail('There is no chainage in the first box. Box a chainage on the plan: a tick label or CH 150.');
  const planName = alignmentSays(b.planAlignment);
  if (!planName) return fail('There is no text in the alignment box on the plan. Box the name of the alignment (MC00).');
  if (planName.split(' ').length > 3) return fail(`The alignment box reads "${planName}". Box just the name of the alignment (MC00, LINE A).`);
  if (b.planAlignment.pageIndex !== b.planChainage.pageIndex) return fail('Box the name of the alignment on the same plan as the chainage.');
  if (b.sectionAlignment.pageIndex === b.planChainage.pageIndex) return fail('The cross-section boxes are on the plan. Go to a cross-section sheet of the alignment and box them there.');
  if (b.sectionChainage.pageIndex !== b.sectionAlignment.pageIndex) return fail(`Box the section's chainage on ${name(b.sectionAlignment.pageIndex)}, the sheet where you boxed the alignment.`);
  const sectionName = alignmentSays(b.sectionAlignment);
  if (!sectionName) return fail('There is no text in the alignment box on the cross-section sheet.');
  if (!` ${sectionName} `.includes(` ${planName} `)) return fail(`The plan's alignment is ${planName} but ${name(b.sectionAlignment.pageIndex)} names ${sectionName}. Box a cross-section sheet of ${planName}.`);
  const cut = chainageIn(b.sectionChainage.contents.words);
  if (!cut) return fail("There is no chainage in the last box. Box one section's chainage on the cross-section sheet.");
  if (!cut.prefix && !cut.plus) return fail("Box the section's chainage with the word in front of it (CH, CHAINAGE): a number alone could be anything.");

  const h: ChainageHints = structuredClone(hints);
  for (const c of [cut, along]) {
    if (c.prefix && !h.prefixes.some((p) => p.toUpperCase() === c.prefix)) {
      h.prefixes = [...h.prefixes, c.prefix];
      notes.push(`Chainages are written after ${c.prefix}.`);
    }
  }
  if (!along.prefix && !along.plus) notes.push('Plans mark chainages with bare numbers along the alignment.');
  if (!h.alignments.some((a) => a.toUpperCase() === planName)) h.alignments = [...h.alignments, planName];
  const template = alignmentTemplateOf(planName);
  if (template && !h.alignmentTemplate) {
    h.alignmentTemplate = template;
    notes.push(`Alignment names look like ${planName} (${template}, # a digit), so the set's other alignments are found too.`);
  } else if (template && h.alignmentTemplate !== template) notes.push(`${planName} does not fit the alignment names already taught (${h.alignmentTemplate}), so it is listed by name.`);

  // Where the cross-section sheet says its alignment: boxed in the title (or naming it there, boxed
  // away from the sections); beside each section (boxed next to the section, or printed over and
  // over on the sheet); else once on the sheet.
  const [ax, ay] = centre(b.sectionAlignment.box);
  const [cx, cy] = centre(b.sectionChainage.box);
  const reach = Math.max(b.sectionChainage.box.w, b.sectionChainage.box.h) * 3;
  const inTitleBox = !!titleBox && overlap(b.sectionAlignment.box, titleBox) > 0.5;
  const title = sheets[b.sectionAlignment.pageIndex]?.title;
  const titled = alignmentsIn(title, { alignments: [planName], alignmentTemplate: null }).length > 0;
  const first = planName.split(' ')[0]!;
  const body = b.sectionAlignment.page.words.filter((w) => w.text.toUpperCase().replace(/[.,;:]+$/, '') === first && !(titleBox && overlap({ x: w.x0, y: w.y0, w: w.x1 - w.x0, h: w.y1 - w.y0 }, titleBox) > 0.5));
  const source: AlignmentSource = inTitleBox ? 'title' : Math.hypot(ax - cx, ay - cy) < reach || body.length >= 2 ? 'section' : titled ? 'title' : 'sheet';
  h.alignmentSource = source;
  notes.push({ section: 'Cross sections name their alignment beside each section.', title: 'Cross-section sheets name their alignment in the title.', sheet: 'Cross-section sheets name their alignment once on the sheet.' }[source]);

  const titles = learnSheetTitles(h, b.sectionChainage, b.planChainage, sheets, notes);
  if (titles) return fail(titles);

  // The chain on these two sheets: the section's chainage back to the plan.
  const plan = b.planChainage;
  const section = b.sectionChainage;
  const two = chainageReport([plan.page, section.page], [sheets[plan.pageIndex], sheets[section.pageIndex]], h, true);
  const back = two.links.some((l) => l.pageIndex === 1 && l.targetPage === 0);
  notes.push(back ? `Chainage ${cut.value} on ${name(section.pageIndex)} links to ${name(plan.pageIndex)}.` : `Chainage ${cut.value} on ${name(section.pageIndex)} is not shown on ${name(plan.pageIndex)}, so that pair does not link; the rest of the set is checked next.`);
  return { chainage: JSON.stringify(h) === JSON.stringify(hints) ? null : h, notes, problem: null };
}

/** The chainage step over the set: its links, how many chainages should link and did, and those whose alignment is unclear. */
export function runChainageStep(texts: readonly PageText[], sheets: readonly (SheetInfo | null | undefined)[], hints: ChainageHints): StepRun & { ambiguous: ChainageAmbiguity[] } {
  const r = chainageReport(texts, sheets, hints, true);
  return { links: r.links, places: r.references, linked: r.linked, unreadable: 0, ambiguous: r.ambiguous };
}
