import { scoreEvidence, type EvidenceKey } from './confidence.ts';
import type { DetectedLink, Rect } from './links.ts';
import type { PageText, SheetInfo, Word } from './types.ts';

/**
 * Chainage (stationing) on linear work: roads, rail, pipelines. A chainage names a spot along an
 * alignment: `598+59.00` (US, hundreds of feet), `1+250.000` (metric, kilometres and metres), or
 * a prefixed number, `CH 1250.000`. Plan and long-section sheets cover a stretch of an alignment;
 * cross-section sheets show the alignment at single chainages. A mention links to the cross
 * section drawn at that chainage, else to the plan that covers it.
 *
 * Reworks Miche-pup's station links (#168): which sheets cover the alignment, and which are cross
 * sections, come from their titles rather than from how their ticks are spaced, and every chainage
 * belongs to an alignment, so a ramp's 12+00 never links to the mainline's.
 */

/** What a drawing standard knows about a client's linear work. */
export interface ChainageHints {
  /** Words written in front of a chainage: STA, CH. */
  prefixes: string[];
  /** Alignment names as the drawings print them: MC01, LINE A, RAMP B. Empty: one alignment. */
  alignments: string[];
  /** Title words of the sheets that cover a stretch: PLAN AND PROFILE, PLAN AND LONGITUDINAL SECTION. */
  planTitles: string[];
  /** Title words of cross-section sheets. */
  sectionTitles: string[];
  /**
   * How the client forms alignment names, to find ones the list does not name: `MC##` (# a digit,
   * @ a letter, anything else as written). Null: only the listed names.
   */
  alignmentTemplate?: string | null;
  /**
   * Where a cross-section sheet says which alignment it is cut across: in its title, once on the
   * sheet, or beside each section. Null: not known (title first, then a name beside the section).
   */
  alignmentSource?: AlignmentSource | null;
}

export type AlignmentSource = 'title' | 'sheet' | 'section';

export const DEFAULT_CHAINAGE_HINTS: ChainageHints = {
  prefixes: ['STA', 'CH', 'CHAINAGE'],
  alignments: [],
  planTitles: ['PLAN AND PROFILE', 'PLAN & PROFILE', 'PLAN AND LONGITUDINAL SECTION', 'PLAN AND LONG SECTION'],
  sectionTitles: ['CROSS SECTIONS', 'CROSS SECTION', 'TYPICAL SECTIONS'],
};

/** A chainage printed on a page. */
export interface Chainage {
  /** Distance along the alignment, in the drawing's units (feet or metres). */
  value: number;
  /** The words it was read from (a prefix and the number, or one word). */
  words: Word[];
  /** Written with a prefix (`CH 1250`) rather than bare (`12+00`, a plan's tick or a note's mention). */
  prefixed: boolean;
  /** The alignment it belongs to; '' when the standard names none, null when it cannot be told. */
  alignment: string | null;
  /** For a plan's bare ticks, which run of ticks along one line it is in (runs on a page are numbered from 0). */
  run?: number;
}

const PLUS = /^(\d{1,4})\+(\d{2,3})(?:\.(\d{1,3}))?$/;
const PLAIN = /^\d{1,6}(?:\.\d{1,3})?$/;

const upper = (t: string) => t.trim().toUpperCase();
/** Trailing punctuation trimmed by hand (a `[...]+$` regex is slow on long runs). */
function trimWord(t: string): string {
  const s = upper(t);
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === '(') start++;
  while (end > start && ',;:)'.includes(s[end - 1]!)) end--;
  return s.slice(start, end);
}

/** `598+59.00` → 59859 (two digits after the plus: hundreds); `1+250.000` → 1250 (three: thousands). */
export function parsePlus(text: string): number | null {
  const m = PLUS.exec(text);
  if (!m) return null;
  const unit = m[2]!.length === 2 ? 100 : 1000;
  return Number(m[1]) * unit + Number(`${m[2]}.${m[3] ?? '0'}`);
}

/** The text after a prefix (`CH1250`, `STA:12+00`, `CH.`), or null when `t` does not start with one. */
function afterPrefix(t: string, prefixes: readonly string[]): string | null {
  for (const p of prefixes) {
    if (!t.startsWith(p)) continue;
    let rest = t.slice(p.length);
    if (rest.startsWith('.') || rest.startsWith(':')) rest = rest.slice(1);
    return rest;
  }
  return null;
}

/** Every chainage on a page, without its alignment. */
export function readChainages(page: PageText, hints: ChainageHints): Chainage[] {
  const prefixes = hints.prefixes.map(upper).filter(Boolean).sort((a, b) => b.length - a.length);
  const out: Chainage[] = [];
  const words = page.words;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const t = trimWord(w.text);
    const plus = parsePlus(t);
    if (plus !== null) {
      const prev = words[i - 1];
      const prefixed = !!prev && prefixes.includes(trimWord(prev.text).replace(/[.:]$/, '')) && sameRow(prev, w);
      out.push({ value: plus, words: prefixed ? [prev!, w] : [w], prefixed, alignment: null });
      continue;
    }
    const rest = afterPrefix(t, prefixes);
    if (rest === null) continue;
    if (rest) {
      // Run together: CH1250.000, STA:12+00.
      const v = parsePlus(rest) ?? (PLAIN.test(rest) ? Number(rest) : null);
      if (v !== null) out.push({ value: v, words: [w], prefixed: true, alignment: null });
      continue;
    }
    // The prefix alone; the number is the next word on the row (a plus form is read on its own turn).
    const next = words[i + 1];
    if (next && sameRow(w, next) && PLAIN.test(trimWord(next.text))) {
      out.push({ value: Number(trimWord(next.text)), words: [w, next], prefixed: true, alignment: null });
      i++;
    }
  }
  // A range (`CH 280 TO CH 565`, a sheet's title or a note on where a typical section applies)
  // names a stretch, not a place: neither end is a reference.
  const at = new Map(words.map((w, i) => [w, i]));
  const range = new Set<Chainage>();
  for (let k = 0; k + 1 < out.length; k++) {
    const a = out[k]!;
    const b = out[k + 1]!;
    const end = at.get(a.words[a.words.length - 1]!)!;
    const join = words[end + 1];
    if (join && words[end + 2] === b.words[0] && /^(TO|-|–)$/.test(trimWord(join.text)) && sameRow(a.words[0]!, join)) range.add(a).add(b);
  }
  return range.size ? out.filter((c) => !range.has(c)) : out;
}

/** Fewest bare numbers in a run before they count as a plan's chainage ticks. */
const MIN_TICKS = 4;
/** More bare numbers than this on a sheet and it is not worth walking them all. */
const MAX_NUMBERS = 2000;

interface Bare {
  w: Word;
  v: number;
  x: number;
  y: number;
}

const turn = (a: Word, b: Word) => Math.abs(Math.atan2(Math.sin(a.angle - b.angle), Math.cos(a.angle - b.angle)));
const sameSize = (a: Word, b: Word) => Math.abs(a.size - b.size) <= Math.max(a.size, b.size) * 0.15;
/** Next along a curving line: the same size as the run's first, turned at most a little more than the last (labels turn with the line). */
const nextAlike = (first: Word, last: Word, n: Word) => sameSize(first, n) && turn(last, n) < 0.35;
const key = (v: number) => Math.round(v * 1000);

/**
 * Bare numbers along an alignment on a plan, with no prefix or plus: 101140, 101160, 101180. Their
 * values step evenly and so do their places on the sheet; the alignment may bend, so the run may
 * too, a little at each step. Not chainage: a run hugging the sheet's edge or printed twice (grid
 * coordinates on opposite edges), or one too short to cross much of the sheet (a scale bar).
 */
export function readTicks(page: PageText, skip: ReadonlySet<Word> = new Set()): Chainage[] {
  const nums: Bare[] = [];
  for (const w of page.words) {
    if (skip.has(w)) continue;
    const t = trimWord(w.text);
    if (PLAIN.test(t)) nums.push({ w, v: Number(t), x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 });
  }
  if (nums.length < MIN_TICKS || nums.length > MAX_NUMBERS) return [];
  const byValue = new Map<number, Bare[]>();
  for (const n of nums) byValue.set(key(n.v), [...(byValue.get(key(n.v)) ?? []), n]);
  nums.sort((a, b) => a.v - b.v);
  const used = new Set<Word>();
  const runs: Bare[][] = [];
  for (const a of nums) {
    if (used.has(a.w)) continue;
    let best: Bare[] | null = null;
    for (const b of nums) {
      if (b.v <= a.v || used.has(b.w) || !nextAlike(a.w, a.w, b.w)) continue;
      const gap = Math.hypot(b.x - a.x, b.y - a.y);
      if (gap < a.w.size * 2 || gap > a.w.size * 80) continue;
      const step = b.v - a.v;
      const run = [a, b];
      for (;;) {
        const [p, q] = [run[run.length - 2]!, run[run.length - 1]!];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const next = (byValue.get(key(q.v + step)) ?? []).find((n) => {
          if (used.has(n.w) || !nextAlike(a.w, q.w, n.w)) return false;
          const ex = n.x - q.x;
          const ey = n.y - q.y;
          const d = Math.hypot(ex, ey);
          // Spaced as before, and turning at most about 35 degrees from the last step.
          return Math.abs(d - gap) < gap * 0.25 && (dx * ex + dy * ey) / (Math.hypot(dx, dy) * d) > 0.82;
        });
        if (!next) break;
        run.push(next);
      }
      if (run.length >= MIN_TICKS && (!best || run.length > best.length)) best = run;
    }
    if (!best) continue;
    runs.push(best);
    for (const n of best) used.add(n.w);
  }
  const edge = (n: Bare) => n.x < page.width * 0.05 || n.x > page.width * 0.95 || n.y < page.height * 0.05 || n.y > page.height * 0.95;
  const values = (r: Bare[]) => r.map((n) => key(n.v)).join(',');
  // Printed twice across the sheet (grid coordinates on opposite edges), not a plan and its long
  // section, which repeat the chainages a little apart.
  const across = (a: Bare[], b: Bare[]) => {
    const dx = Math.abs(a[0]!.x - b[0]!.x);
    const dy = Math.abs(a[0]!.y - b[0]!.y);
    return dx > page.width * 0.6 || dy > page.height * 0.6;
  };
  const out: Chainage[] = [];
  let number = 0;
  for (const run of runs) {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    if (Math.hypot(last.x - first.x, last.y - first.y) < Math.max(page.width, page.height) * 0.15) continue;
    if (run.every(edge)) continue;
    if (runs.some((r) => r !== run && values(r) === values(run) && across(r, run))) continue;
    for (const n of run) out.push({ value: n.v, words: [n.w], prefixed: false, alignment: null, run: number });
    number++;
  }
  return out;
}

function sameRow(a: Word, b: Word): boolean {
  return Math.abs(a.y1 - b.y1) < Math.max(a.size, b.size) * 0.6 && b.x0 - a.x1 < Math.max(a.size, b.size) * 3 && b.x0 > a.x0;
}

/** The template of an alignment name: its digits as `#` (`MC01` → `MC##`); null for a name with no digits. */
export function alignmentTemplateOf(name: string): string | null {
  const t = upper(name).replace(/\s+/g, ' ');
  return /\d/.test(t) ? t.replace(/\d/g, '#') : null;
}

/** Tests for each word of a template (`MC##`, `LINE @`): # a digit, @ a letter, the rest as written. */
function templateParts(template: string | null | undefined): RegExp[] | null {
  const parts = template ? upper(template).split(/\s+/).filter(Boolean) : [];
  if (!parts.length) return null;
  return parts.map((p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/#/g, '\\d').replace(/@/g, '[A-Z]')}$`));
}

/** What finds alignment names: the listed names, word by word, and the template's form. */
interface Names {
  listed: string[][];
  template: RegExp[] | null;
}

function namesOf(hints: Pick<ChainageHints, 'alignments' | 'alignmentTemplate'>): Names {
  return { listed: hints.alignments.map((n) => upper(n).split(/\s+/).filter(Boolean)).filter((p) => p.length), template: templateParts(hints.alignmentTemplate) };
}

const anyNames = (n: Names) => n.listed.length > 0 || n.template !== null;

/** The names starting at `tokens[i]`, as printed (several words joined by a space). */
function namesAt(tokens: readonly string[], i: number, n: Names, follows: (k: number) => boolean): string[] {
  const out: string[] = [];
  const fits = (parts: readonly (string | RegExp)[]) => parts.every((p, k) => i + k < tokens.length && (k === 0 || follows(i + k)) && (typeof p === 'string' ? tokens[i + k] === p : p.test(tokens[i + k]!)));
  for (const parts of n.listed) if (fits(parts)) out.push(parts.join(' '));
  if (n.template && fits(n.template)) {
    const name = tokens.slice(i, i + n.template.length).join(' ');
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Where alignment names are printed on a page (their first word). */
function alignmentNames(page: PageText, n: Names): { name: string; at: Word }[] {
  if (!anyNames(n)) return [];
  const tokens = page.words.map((w) => trimWord(w.text));
  const out: { name: string; at: Word }[] = [];
  page.words.forEach((w, i) => {
    for (const name of namesAt(tokens, i, n, (k) => sameRow(page.words[k - 1]!, page.words[k]!))) out.push({ name, at: w });
  });
  return out;
}

function titleNames(text: string | null | undefined, n: Names): string[] {
  const tokens = upper(text ?? '').split(/\s+/).map(trimWord).filter(Boolean);
  const out = new Set<string>();
  tokens.forEach((_, i) => namesAt(tokens, i, n, () => true).forEach((x) => out.add(x)));
  return [...out];
}

/** The alignment names in a line of text, such as a sheet title. */
export function alignmentsIn(text: string | null | undefined, hints: Pick<ChainageHints, 'alignments' | 'alignmentTemplate'>): string[] {
  return titleNames(text, namesOf(hints));
}

/**
 * Gives each chainage its alignment, and says which alignment the page is about.
 * - A plan's run of ticks is on one alignment: the name printed closest to the run; else, for a
 *   run repeating a named run's values (the long section under the plan), that run's; else the
 *   title's or the page's.
 * - Any other chainage: the name printed on its row before it, else the nearest name close by,
 *   else the title's, else the one the page is mostly about.
 * - On a cross section the names close by are often the strings it cuts (MCN1, MCR3), not its own
 *   alignment, so where the sheet says its alignment (`source`) decides: its title, the name the
 *   sheet is mostly about, or the name beside each section. Not known: the title first.
 * With no names in the standard every chainage is on the one alignment ('').
 */
function assignAlignments(page: PageText, chainages: Chainage[], n: Names, title: string | null | undefined, section: boolean, source: AlignmentSource | null | undefined): string | null {
  if (!anyNames(n)) {
    for (const c of chainages) c.alignment = '';
    return '';
  }
  const inTitle = titleNames(title, n);
  const fromTitle = inTitle.length === 1 ? inTitle[0]! : null;
  const found = alignmentNames(page, n);
  const counts = new Map<string, number>();
  for (const f of found) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  // The page's own alignment, when one name clearly dominates it.
  const main = ranked.length && (ranked.length === 1 || ranked[0]![1] >= ranked[1]![1] * 2) ? ranked[0]![0] : null;
  const dist = (a: Word, b: Word) => Math.hypot((a.x0 + a.x1 - b.x0 - b.x1) / 2, (a.y0 + a.y1 - b.y0 - b.y1) / 2);

  // A run of ticks as a whole: the name printed closest to any of its ticks.
  const runs = new Map<number, Chainage[]>();
  for (const c of chainages) if (c.run !== undefined) runs.set(c.run, [...(runs.get(c.run) ?? []), c]);
  const runName = new Map<number, string | null>();
  for (const [r, cs] of runs) {
    const s = Math.max(cs[0]!.words[0]!.size, 4);
    let best: { name: string; d: number } | null = null;
    for (const f of found) {
      const d = Math.min(...cs.map((c) => dist(f.at, c.words[0]!)));
      if (d < s * 25 && (!best || d < best.d)) best = { name: f.name, d };
    }
    runName.set(r, best?.name ?? null);
  }
  // A run with no name close by that repeats a named run's values (the long section under the plan).
  for (const [r, cs] of runs) {
    if (runName.get(r)) continue;
    const values = new Set(cs.map((c) => key(c.value)));
    const twin = [...runs].find(([o, other]) => o !== r && runName.get(o) && other.filter((c) => values.has(key(c.value))).length >= 3);
    if (twin) runName.set(r, runName.get(twin[0])!);
  }

  for (const c of chainages) {
    if (c.run !== undefined) {
      c.alignment = runName.get(c.run) ?? fromTitle ?? main;
      continue;
    }
    const w = c.words[0]!;
    const s = Math.max(w.size, 4);
    const before = found.filter((f) => Math.abs(f.at.y1 - w.y1) < s * 0.6 && f.at.x0 < w.x0 && w.x0 - f.at.x1 < s * 40).sort((a, b) => b.at.x0 - a.at.x0)[0]?.name;
    const near = found.map((f) => ({ f, d: dist(f.at, w) })).filter((x) => x.d < s * 15).sort((a, b) => a.d - b.d)[0]?.f.name;
    if (!section || source === 'section') c.alignment = before ?? near ?? fromTitle ?? main;
    else if (source === 'title') c.alignment = fromTitle ?? before ?? main;
    else if (source === 'sheet') c.alignment = main ?? fromTitle ?? before ?? null;
    else c.alignment = before ?? fromTitle ?? near ?? main;
  }
  return section && source === 'sheet' ? (main ?? fromTitle) : (fromTitle ?? main);
}

/** The stretch of an alignment a plan sheet covers: its longest run of chainages, so a far-off note does not stretch it. */
interface Coverage {
  page: number;
  alignment: string;
  from: number;
  to: number;
  /** The chainages that make it up (for framing the nearest one). */
  marks: Chainage[];
}

function coverageOf(page: number, alignment: string, list: Chainage[]): Coverage | null {
  // One of each value: a plan and the long section under it print the same ticks twice.
  const sorted = [...list].sort((a, b) => a.value - b.value).filter((c, i, all) => i === 0 || Math.abs(c.value - all[i - 1]!.value) >= SAME);
  if (sorted.length < 2) return null;
  const gaps = sorted.slice(1).map((c, i) => c.value - sorted[i]!.value);
  const typical = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 1;
  const runs: Chainage[][] = [[sorted[0]!]];
  sorted.slice(1).forEach((c, i) => {
    if (gaps[i]! > typical * 5) runs.push([c]);
    else runs[runs.length - 1]!.push(c);
  });
  const run = runs.sort((a, b) => b.length - a.length)[0]!;
  const from = run[0]!.value;
  const to = run[run.length - 1]!.value;
  return to > from ? { page, alignment, from, to, marks: run } : null;
}

/** Whether a sheet is titled with any of `phrases`: in its title, or (with no title read) in the page's large text. */
export function sheetTitled(page: PageText, sheet: SheetInfo | null | undefined, phrases: readonly string[]): boolean {
  const wanted = phrases.map(upper).filter(Boolean);
  if (!wanted.length) return false;
  let title = sheet?.title ? upper(sheet.title) : '';
  if (!title) {
    const sizes = page.words.map((w) => w.size).sort((a, b) => a - b);
    const med = sizes[Math.floor(sizes.length / 2)] ?? 0;
    title = page.words
      .filter((w) => w.size >= med * 1.5)
      .map((w) => upper(w.text))
      .join(' ');
  }
  const norm = ` ${title.replace(/\s+/g, ' ')} `;
  return wanted.some((p) => norm.includes(` ${p.replace(/\s+/g, ' ')} `));
}

function frame(w: Word, k = 30): Rect {
  const s = Math.max(w.size, 6);
  return { x: w.x0 - s * k, y: w.y0 - s * k, w: s * k * 2, h: s * k * 2 };
}

function rectOf(words: readonly Word[]): Rect {
  const x0 = Math.min(...words.map((w) => w.x0));
  const y0 = Math.min(...words.map((w) => w.y0));
  const x1 = Math.max(...words.map((w) => w.x1));
  const y1 = Math.max(...words.map((w) => w.y1));
  const pad = words[0]!.size * 0.3;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/** Values closer than this are the same chainage (1+250 and CH 1250.000). */
const SAME = 0.05;

/** `CH 0-150`, `CH 0 TO CH 280`, `STA 10+00 - 15+00` in a sheet title. */
const TITLE_RANGE = /\b(?:CH|STA|CHAINAGE)\.?\s*(\d+(?:\+\d{2,3})?(?:\.\d+)?)\s*(?:-|–|TO)\s*(?:(?:CH|STA|CHAINAGE)\.?\s*)?(\d+(?:\+\d{2,3})?(?:\.\d+)?)/;

/** The stretch a sheet title names: `CROSS SECTIONS MC00 CH 0-150` → 0 to 150, `STA 10+00 TO 15+00` → 1000 to 1500. */
export function titleRange(title: string | null | undefined): { from: number; to: number } | null {
  const m = title ? TITLE_RANGE.exec(upper(title)) : null;
  if (!m) return null;
  const value = (t: string) => (t.includes('+') ? parsePlus(t) : Number(t));
  const a = value(m[1]!);
  const b = value(m[2]!);
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return { from: a, to: b };
}

/** A chainage that cross sections on more than one alignment are drawn at, on a sheet that does not say which alignment it is on. */
export interface ChainageAmbiguity {
  pageIndex: number;
  rect: Rect;
  value: number;
  /** The alignments with a cross section at this chainage. */
  alignments: string[];
}

/** Chainage links across a set, and what the setup wizard reports about them. */
export interface ChainageReport {
  links: DetectedLink[];
  /**
   * Chainages that should link: every cross section's own chainage (to its plan), and every
   * chainage elsewhere that a cross section is drawn at.
   */
  references: number;
  /** Of those, how many got a link. */
  linked: number;
  ambiguous: ChainageAmbiguity[];
}

/**
 * Chainage links across a set. With `fromStandard`, a person said how the client writes chainages
 * and which sheets cover the alignment, so links whose alignment is known are kept; otherwise
 * (the default title words, or an alignment that cannot be told) they wait for review. A chainage
 * whose alignment cannot be told on a sheet showing several alignments, or one outside the range
 * its target sheet's title names, scores lower still.
 */
export function detectChainageLinks(pages: readonly PageText[], sheets: readonly (SheetInfo | null | undefined)[], hints: ChainageHints = DEFAULT_CHAINAGE_HINTS, fromStandard = false): DetectedLink[] {
  return chainageReport(pages, sheets, hints, fromStandard).links;
}

/**
 * The chain from a chainage to the sheet that draws it: the chainage's alignment (the name along
 * its line on a plan, the sheet's own on a cross section), the cross-section sheets of that
 * alignment, and the section at that value, checked against the range the sheet's title gives. A
 * cross section's own chainage goes back to the plan of its alignment covering it.
 */
export function chainageReport(pages: readonly PageText[], sheets: readonly (SheetInfo | null | undefined)[], hints: ChainageHints = DEFAULT_CHAINAGE_HINTS, fromStandard = false): ChainageReport {
  const names = namesOf(hints);
  const isPlan = pages.map((p, i) => sheetTitled(p, sheets[i], hints.planTitles));
  const isSection = pages.map((p, i) => !isPlan[i] && sheetTitled(p, sheets[i], hints.sectionTitles));
  const read = pages.map((p, i) => {
    const list = readChainages(p, hints);
    // A plan's ticks are often bare numbers; elsewhere a bare number is too likely something else.
    if (isPlan[i]) list.push(...readTicks(p, new Set(list.flatMap((c) => c.words))));
    const main = assignAlignments(p, list, names, sheets[i]?.title, isSection[i]!, hints.alignmentSource);
    return { list, main };
  });

  const coverages: Coverage[] = [];
  read.forEach(({ list }, page) => {
    if (!isPlan[page]) return;
    const by = new Map<string, Chainage[]>();
    for (const c of list) if (c.alignment !== null) by.set(c.alignment, [...(by.get(c.alignment) ?? []), c]);
    for (const [alignment, cs] of by) {
      const cov = coverageOf(page, alignment, cs);
      if (cov) coverages.push(cov);
    }
  });
  const sections = read.flatMap(({ list }, page) => (isSection[page] ? list.map((c) => ({ page, c })) : []));
  const several = pages.map((p) => new Set(alignmentNames(p, names).map((f) => f.name)).size > 1);
  const ranges = sheets.map((s) => titleRange(s?.title));

  const links: DetectedLink[] = [];
  const ambiguous: ChainageAmbiguity[] = [];
  let references = 0;
  let linked = 0;
  read.forEach(({ list }, pageIndex) => {
    for (const c of list) {
      const known = c.alignment !== null;
      const sameLine = (a: string) => !known || a === c.alignment;
      const at = isSection[pageIndex] ? [] : sections.filter((s) => s.page !== pageIndex && Math.abs(s.c.value - c.value) < SAME);
      const lines = [...new Set(at.map((s) => s.c.alignment).filter((a): a is string => a !== null))];
      const unclear = !known && lines.length > 1;
      if (isSection[pageIndex] || at.length) references++;
      if (unclear) ambiguous.push({ pageIndex, rect: rectOf(c.words), value: c.value, alignments: lines.sort() });
      const w = c.words[0]!;
      const where = `${Math.round(w.x0)},${Math.round(w.y0)}`;
      let any = false;
      const push = (targetPage: number, targetRect: Rect, targetKnown = true) => {
        any = true;
        const label = c.words.map((x) => trimWord(x.text)).join(' ');
        const reasons: EvidenceKey[] = ['chainage'];
        if (fromStandard && known && targetKnown) reasons.push('alignmentAgrees');
        if (!known) {
          reasons.push('alignmentUnknown');
          if (several[pageIndex]) reasons.push('severalAlignments');
          if (unclear) reasons.push('sectionsOnSeveral');
        }
        const range = isSection[targetPage] ? ranges[targetPage] : null;
        // Inside the range says little when the alignment is unknown: another alignment's sheet can
        // cover the same chainages. Outside it always counts against.
        const inside = range && c.value >= range.from - SAME && c.value <= range.to + SAME;
        if (range && !inside) reasons.push('outsideSheetRange');
        else if (inside && known) reasons.push('inSheetRange');
        links.push({ id: `${pageIndex}:ch:${c.alignment ?? '?'}:${c.value}@${where}>${targetPage}`, pageIndex, rect: rectOf(c.words), label, kind: 'chainage', detail: null, targetPage, targetRect, confidence: scoreEvidence(reasons), evidence: reasons });
      };
      // 1. The cross section drawn at this chainage; a cross section's own chainage goes to the plan
      // (another cross section at the same value is most likely on another road).
      // One on the same alignment first, inside its sheet's range first; else one whose alignment
      // cannot be told, for review.
      const fits = (s: { page: number }) => {
        const r = ranges[s.page];
        return !r || (c.value >= r.from - SAME && c.value <= r.to + SAME);
      };
      const onLine = at.filter((s) => s.c.alignment !== null && sameLine(s.c.alignment));
      const section = onLine.find(fits) ?? onLine[0] ?? at.find((s) => s.c.alignment === null);
      if (section) {
        push(section.page, frame(section.c.words[0]!, 20), section.c.alignment !== null);
      } else {
        // 2. Else the plan that covers it, unless this is that plan.
        const touching = coverages.filter((v) => sameLine(v.alignment) && c.value >= v.from - SAME && c.value <= v.to + SAME);
        // Consecutive plans overlap by a tick: the value at one plan's last tick is better shown inside the next.
        const inside = touching.filter((v) => c.value > v.from + SAME && c.value < v.to - SAME);
        const covering = inside.length ? inside : touching;
        if (!covering.some((v) => v.page === pageIndex) && covering.length) {
          // The narrowest: a key plan spans everything, the plan at this chainage is what people want.
          const span = (v: Coverage) => v.to - v.from;
          const min = Math.min(...covering.map(span));
          for (const v of covering.filter((x) => span(x) <= min * 2)) {
            const tick = v.marks.reduce((best, m) => (Math.abs(m.value - c.value) < Math.abs(best.value - c.value) ? m : best));
            push(v.page, frame(tick.words[tick.words.length - 1]!));
          }
        }
      }
      if (any && (isSection[pageIndex] || at.length)) linked++;
    }
  });
  return { links, references, linked, ambiguous };
}
