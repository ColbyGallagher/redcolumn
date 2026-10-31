import { SheetLookup, detailId, detectChainageLinks, idTest, numberParts, parsePlus, sheetTitled, type ChainageHints, type LinkHints, type Rect, type SheetInfo, type Word } from '@nb/sheets';
import { MARK_KINDS, teachMark, type BoxContents, type MarkKind, type MarkPage, type TaughtMark } from './marks';

/**
 * Teach Links: a person shows redcolumn one pair at a time, a mark on one sheet and what it points
 * at (a section mark and its section's title, a detail callout and its detail's title, a chainage
 * on a cross section and the same chainage on the plan). From each pair it keeps the two marks to
 * find again, and learns what it can about how the client draws: which part of the drawing number
 * callouts cite, how identifiers are written, and the words in front of titles and chainages.
 */

export type TeachKind = 'section' | 'detail' | 'elevation' | 'chainage';

export interface TeachStep {
  label: string;
  /** The kinds of mark kept for the two boxes; null for chainage, which keeps words, not marks. */
  mark: MarkKind | null;
  target: MarkKind | null;
  markPrompt: string;
  targetPrompt: string;
}

export const TEACH_KINDS: Record<TeachKind, TeachStep> = {
  section: {
    label: 'Sections',
    mark: 'sectionMark',
    target: 'sectionTitle',
    markPrompt: 'Find a section mark and drag a box around it, with its letter and the sheet it points to.',
    targetPrompt: 'Go to the sheet where that section is drawn and box its title.',
  },
  detail: {
    label: 'Details',
    mark: 'detailCallout',
    target: 'detailTitle',
    markPrompt: 'Find a detail callout and drag a box around it, with its number and the sheet it points to.',
    targetPrompt: 'Go to the detail it points to and box its title.',
  },
  elevation: {
    label: 'Elevations',
    mark: 'elevationMark',
    target: 'elevationTitle',
    markPrompt: 'Find an elevation mark and drag a box around it, with its label.',
    targetPrompt: 'Go to that elevation and box its title.',
  },
  chainage: {
    label: 'Chainage',
    mark: null,
    target: null,
    markPrompt: 'Go to a cross section and box its chainage, with the word in front of it (CH, CHAINAGE).',
    targetPrompt: 'Go to the plan and box the same chainage where it is marked along the alignment.',
  },
};

/** One box the person drew, and what of it they kept. */
export interface TaughtBox {
  page: MarkPage;
  pageIndex: number;
  box: Rect;
  contents: BoxContents;
}

/** What a pair taught. */
export interface Lesson {
  marks: TaughtMark[];
  /** The standard's link words with what the pair taught; null when it taught none. */
  links: LinkHints | null;
  /** The standard's chainage settings with what the pair taught; null when it taught none. */
  chainage: ChainageHints | null;
  /** What was learned and checked, for the person. */
  notes: string[];
  /** Why the pair cannot be kept as it is; null when it can. */
  problem: string | null;
}

const clean = (t: string) => {
  const s = t.trim().toUpperCase();
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === '(') start++;
  while (end > start && ',;:.)'.includes(s[end - 1]!)) end--;
  return s.slice(start, end);
};

/** The usual identifier forms (as DETAIL_ID reads them), kept when a standard adds its own. */
const USUAL_IDS = ['#', '##', '###', '#@', '##@', '###@', '@', '@#', '@##'];

/** An identifier's form as a template: `DT3` → `@@#`. */
export function idForm(text: string): string {
  let out = '';
  for (const ch of clean(text)) out += /\d/.test(ch) ? '#' : /[A-Z]/.test(ch) ? '@' : '#@?*\\'.includes(ch) ? `\\${ch}` : ch;
  return out;
}

/** The word a mark and its title both print, short enough to be an identifier and not a sheet number or a title word. */
function sharedId(mark: readonly Word[], target: readonly Word[], lookup: SheetLookup): string | null {
  const there = new Set(target.map((w) => clean(w.text)));
  const shared = mark
    .map((w) => clean(w.text))
    .filter((t) => t && t.length <= 8 && there.has(t) && /[A-Z0-9]/.test(t) && lookup.find(t, true) === null && !/^[A-Z]{4,}$/.test(t));
  return shared.sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a)) || a.length - b.length)[0] ?? null;
}

/** The words in front of a title's identifier on its row: `SECTION` of `SECTION C`, `TYPICAL CROSS SECTION` of `TYPICAL CROSS SECTION 2`. */
function wordsBefore(words: readonly Word[], id: string): string | null {
  const at = words.find((w) => detailId(clean(w.text)) === id);
  if (!at) return null;
  const row = words
    .filter((w) => w !== at && w.x1 <= at.x0 + 1 && Math.abs((w.y0 + w.y1) / 2 - (at.y0 + at.y1) / 2) < Math.max(w.size, at.size) * 0.6)
    .sort((a, b) => b.x0 - a.x0);
  const out: string[] = [];
  let edge = at.x0;
  for (const w of row) {
    if (edge - w.x1 > Math.max(w.size, at.size) * 3 || /\d/.test(w.text)) break;
    out.unshift(clean(w.text));
    edge = w.x0;
  }
  const phrase = out.filter(Boolean).join(' ');
  return phrase || null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Learns from a mark and the title it points at. `target` is null when the mark has nothing to
 * box (a callout to a whole sheet): only the mark is kept.
 */
export function learnLink(kind: Exclude<TeachKind, 'chainage'>, mark: TaughtBox, target: TaughtBox | null, sheetNumbers: readonly (string | null)[], hints: LinkHints, name: string): Lesson {
  const step = TEACH_KINDS[kind];
  const notes: string[] = [];
  const fail = (problem: string): Lesson => ({ marks: [], links: null, chainage: null, notes, problem });
  let h: LinkHints = structuredClone(hints);
  const other = target && target.pageIndex !== mark.pageIndex;
  const targetNumber = target ? (sheetNumbers[target.pageIndex] ?? null) : null;

  // Which part of the drawing number the mark cites (000022 of SBUCD-WSPAU-0002-RW-DRG-000022).
  if (other && targetNumber) {
    const cites = (part: number | null) => mark.contents.words.some((w) => new SheetLookup(sheetNumbers, part).find(w.text, true) === target.pageIndex);
    if (!cites(h.calloutPart)) {
      const parts = numberParts(targetNumber);
      const words = new Set(mark.contents.words.map((w) => clean(w.text)));
      const part = parts.findIndex((p, i) => /\d/.test(p) && words.has(p) && cites(i));
      if (part >= 0) {
        h.calloutPart = part;
        notes.push(`Callouts cite part ${part + 1} of the drawing number: ${parts[part]} for ${targetNumber}.`);
      }
    }
  }

  // Identifiers written the client's own way (DT3): the word the mark and its title both print.
  if (target) {
    const shared = sharedId(mark.contents.words, target.contents.words, new SheetLookup(sheetNumbers, h.calloutPart));
    if (shared && !idTest(h)(shared)) {
      const form = idForm(shared);
      h.ids = [...new Set([...(h.ids ?? USUAL_IDS), form])];
      notes.push(`Identifiers are written like ${shared} (${form}).`);
    }
  }

  const label = name.trim() || step.label.replace(/s$/, '');
  let taught: TaughtMark;
  let title: TaughtMark | null = null;
  try {
    // A pair's two marks are told apart by name; a mark kept alone keeps the name given.
    taught = teachMark(mark.page, mark.box, step.mark!, target ? `${label} mark` : name.trim() || MARK_KINDS[step.mark!], sheetNumbers, h, mark.contents);
    if (target) title = teachMark(target.page, target.box, step.target!, `${label} title`, sheetNumbers, h, target.contents);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const idOf = (m: TaughtMark) => m.words.find((w) => w.role === 'detail')?.text ?? null;
  const markId = idOf(taught);
  const titleId = title ? idOf(title) : null;
  if (markId && titleId && detailId(markId) !== detailId(titleId)) return fail(`The mark says ${markId} but the title says ${titleId}. Box a mark and the title of the ${kind} it points to.`);

  // The sheet the mark names must be the one its title is on.
  if (target) {
    const lookup = new SheetLookup(sheetNumbers, h.calloutPart);
    const named = taught.words.find((w) => w.role === 'sheet')?.text ?? null;
    const at = named ? lookup.find(named, true) : null;
    const where = (i: number) => sheetNumbers[i] ?? `page ${i + 1}`;
    if (named && at !== null && at !== target.pageIndex) return fail(`The mark points to ${named}, which is ${where(at)}, not the sheet you boxed the title on (${where(target.pageIndex)}).`);
    if (other && !named) notes.push('The mark names no sheet this set has, so marks like it are only linked on their own sheet. Check the sheet numbers are read (Pages panel), then teach it again.');
    else notes.push(`${MARK_KINDS[step.mark!]} ${markId ?? ''} on ${where(mark.pageIndex)} goes to ${MARK_KINDS[step.target!].toLowerCase()} ${titleId ?? ''} on ${where(target.pageIndex)}.`.replace(/ {2,}/g, ' '));
  }

  // The words in front of section and elevation titles, for reading links from the text alone.
  if (title && titleId && (kind === 'section' || kind === 'elevation')) {
    const phrase = wordsBefore(target!.contents.words, detailId(titleId));
    const known = h.titles[kind].map((w) => w.toUpperCase());
    if (phrase && !known.some((w) => ` ${phrase} `.includes(` ${w} `))) {
      h.titles = { ...h.titles, [kind]: [...h.titles[kind], phrase] };
      notes.push(`${step.label.replace(/s$/, '')} titles say ${phrase}.`);
    }
  }
  return { marks: title ? [taught, title] : [taught], links: same(h, hints) ? null : h, chainage: null, notes, problem: null };
}

/** Words that do not tell sheets apart, left off the ends of title words learned from a sheet title. */
const GENERIC = new Set(['SHEET', 'SHEETS', 'PAGE', 'NO', 'NO.', 'OF', 'AND', 'TO', 'CH', 'CH.', 'CHAINAGE', 'STA', '-', '–', '—', '&']);

/** The words of a sheet title that its sister sheets share: its longest run without numbers (`ROADWORKS PLAN` of `MCR1 ROADWORKS PLAN SHEET 2`). */
export function titleWords(title: string | null | undefined): string | null {
  const words = (title ?? '').toUpperCase().split(/\s+/).filter(Boolean);
  let best: string[] = [];
  let run: string[] = [];
  for (const w of [...words, '0']) {
    if (/\d/.test(w)) {
      while (run.length && GENERIC.has(run[run.length - 1]!)) run.pop();
      while (run.length && GENERIC.has(run[0]!)) run.shift();
      if (run.length > best.length) best = run;
      run = [];
    } else run.push(w);
  }
  return best.length ? best.join(' ') : null;
}

const PLAIN = /^\d{1,6}(?:\.\d{1,3})?$/;

/** The chainage in a box: its value and the words in front of it on its row. */
function chainageIn(words: readonly Word[]): { value: number; prefix: string | null; plus: boolean } | null {
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const w = sorted[i]!;
    const t = clean(w.text);
    const plus = parsePlus(t);
    const value = plus ?? (PLAIN.test(t) ? Number(t) : null);
    if (value === null) continue;
    const before = sorted
      .filter((o) => o !== w && o.x1 <= w.x0 + 1 && Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < Math.max(o.size, w.size) * 0.6 && !/\d/.test(o.text))
      .sort((a, b) => b.x0 - a.x0)[0];
    return { value, prefix: before ? clean(before.text) || null : null, plus: plus !== null };
  }
  return null;
}

/** Learns from a chainage boxed on a cross section and the same chainage boxed on the plan. */
export function learnChainage(section: TaughtBox, plan: TaughtBox, sheets: readonly (SheetInfo | null | undefined)[], hints: ChainageHints): Lesson {
  const notes: string[] = [];
  const fail = (problem: string): Lesson => ({ marks: [], links: null, chainage: null, notes, problem });
  const cut = chainageIn(section.contents.words);
  const along = chainageIn(plan.contents.words);
  if (!cut) return fail('There is no chainage in the box on the cross section.');
  if (!along) return fail('There is no chainage in the box on the plan.');
  if (Math.abs(cut.value - along.value) >= 0.05) return fail(`The cross section is at ${cut.value} but the plan box says ${along.value}. Box the same chainage on both.`);
  if (section.pageIndex === plan.pageIndex) return fail('Box the chainage on a cross-section sheet first, then on the plan sheet.');
  const h: ChainageHints = structuredClone(hints);
  if (cut.prefix && !h.prefixes.some((p) => p.toUpperCase() === cut.prefix)) {
    h.prefixes = [...h.prefixes, cut.prefix];
    notes.push(`Chainages are written after ${cut.prefix}.`);
  }
  if (!cut.prefix && !cut.plus) return fail('Box the chainage on the cross section with the word in front of it (CH, CHAINAGE): a number alone could be anything.');
  for (const [box, key, what] of [
    [section, 'sectionTitles', 'Cross-section'],
    [plan, 'planTitles', 'Plan'],
  ] as const) {
    if (sheetTitled(box.page, sheets[box.pageIndex], h[key])) continue;
    const words = titleWords(sheets[box.pageIndex]?.title);
    if (!words) return fail(`redcolumn has not read the title of the ${what.toLowerCase()} sheet. Type the words its titles use under Alignments and chainage.`);
    h[key] = [...h[key], words];
    notes.push(`${what} sheets are titled ${words}.`);
  }
  const linked = detectChainageLinks([plan.page, section.page], [sheets[plan.pageIndex], sheets[section.pageIndex]], h, true).some((l) => l.pageIndex === 1 && l.targetPage === 0);
  notes.push(linked ? `Chainage ${cut.value} on the cross section links to the plan.` : `No run of chainages was found along the alignment on the plan, so chainage ${cut.value} is not linked yet.`);
  return { marks: [], links: null, chainage: same(h, hints) ? null : h, notes, problem: null };
}
