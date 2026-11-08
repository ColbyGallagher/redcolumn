import { disciplineOf, ignoredBy, readSheet, templateRegex, type SheetHints } from './standard.ts';
import type { PageText, SheetInfo, Word } from './types.ts';

/**
 * Sheet numbers as used on US construction drawings: a discipline prefix of 1-3 letters, an
 * optional separator, then digits with an optional sub-number and suffix letter.
 * Matches C-101, A1.01, S-201, E101, FP-101, M-3, L-1.0, C5.1A.
 */
// Up to four digits: agency and infrastructure sets number sheets C-4000, P-3008.
const SHEET_NUMBER = /^([A-Z]{1,3})[-.\s]?(\d{1,4})(?:[.-](\d{1,3}))?([A-Z])?$/;

/** US National CAD Standard discipline designators. */
const DISCIPLINES: [string, string][] = [
  ['FP', 'Fire Protection'],
  ['FA', 'Fire Alarm'],
  ['LS', 'Life Safety'],
  ['AD', 'Architectural Demolition'],
  ['CD', 'Civil Demolition'],
  ['ID', 'Interiors'],
  ['G', 'General'],
  ['H', 'Hazardous Materials'],
  ['V', 'Survey'],
  ['B', 'Geotechnical'],
  ['W', 'Civil Works'],
  ['C', 'Civil'],
  ['L', 'Landscape'],
  ['S', 'Structural'],
  ['A', 'Architectural'],
  ['I', 'Interiors'],
  ['Q', 'Equipment'],
  ['F', 'Fire Protection'],
  ['P', 'Plumbing'],
  ['D', 'Process'],
  ['M', 'Mechanical'],
  ['E', 'Electrical'],
  ['T', 'Telecommunications'],
  ['R', 'Resource'],
  ['X', 'Other Disciplines'],
  ['Z', 'Contractor/Shop Drawings'],
  ['O', 'Operations'],
];

/** Title-block field labels that are never a sheet title. */
const LABEL_WORDS = new Set([
  'SHEET',
  'SHEET NO',
  'SHEET NO.',
  'SHEET NUMBER',
  'SHEET TITLE',
  'DRAWING',
  'DRAWING NO',
  'DRAWING NO.',
  'DRAWING TITLE',
  'TITLE',
  'PROJECT',
  'PROJECT NO',
  'PROJECT NO.',
  'DATE',
  'SCALE',
  'DRAWN',
  'DRAWN BY',
  'CHECKED',
  'CHECKED BY',
  'DESIGNED BY',
  'APPROVED',
  'REVISIONS',
  'REVISION',
  'REV',
  'NO.',
  'OF',
  'JOB NO',
  'JOB NO.',
  'ISSUED FOR',
  'SEAL',
]);

export function normalizeSheetNumber(text: string): string | null {
  const t = text.trim().toUpperCase().replace(/[:,;]$/, '');
  return SHEET_NUMBER.test(t) ? t : null;
}

export function disciplineFor(sheetNumber: string): string | null {
  const m = SHEET_NUMBER.exec(sheetNumber.toUpperCase());
  if (!m) return null;
  const prefix = m[1]!;
  // Two-letter designators (FP, AD, ...) first, then the major discipline letter.
  return (DISCIPLINES.find(([code]) => code === prefix) ?? DISCIPLINES.find(([code]) => code === prefix[0]))?.[1] ?? null;
}

/** NCS sheet-set order of major discipline letters. */
const DISCIPLINE_ORDER = 'GHVBWCLSAIQFPDMETRXZO';

/**
 * Orders sheet numbers the way sheet indexes do: discipline order (G, C, L, S, A, ...), then
 * numerically (A-2 before A-10).
 */
export function compareSheetNumbers(a: string, b: string): number {
  const order = (n: string) => {
    const i = DISCIPLINE_ORDER.indexOf(n[0] ?? '');
    return i < 0 ? DISCIPLINE_ORDER.length : i;
  };
  return order(a) - order(b) || a.localeCompare(b, undefined, { numeric: true });
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
}

interface Candidate {
  word: Word;
  number: string;
  /** Normalized word center. */
  cx: number;
  cy: number;
  local: number;
  /** In the title-block zone (bottom-right corner, right edge, bottom strip). */
  zone: boolean;
  /** A "DRG No." / "SHEET No." label names this field. */
  labelled: boolean;
  /** Set larger than the page's body text. */
  large: boolean;
  /** The same value sits in the same place on other sheets: a set number, a running header. */
  repeated?: boolean;
}

/**
 * Whether a number is shaped like a drawing number on its own: a discipline-prefixed sheet number
 * (C-101, A2.01) or a document number with letters and separators (KST1RDS-ACMEA-...-300082,
 * 12345-C-001). Bare numbers and short codes (680, 2000, 1B) are not: in reports and letters they
 * are addresses, stages and quantities, and only a label next to them makes them a sheet number.
 */
export function isDrawingNumberShape(number: string): boolean {
  const n = number.trim().toUpperCase();
  if (normalizeSheetNumber(n)) return true;
  return n.length >= 5 && /[A-Z]/.test(n) && /\d/.test(n) && /[-._/]/.test(n);
}

/**
 * Drawing identifiers in any numbering scheme: US sheet numbers (C-101, A2.01) and document
 * numbers (KST1RDS-ACMEA-0508-MS-DRG-100011, 12345-C-001). Must contain a digit.
 */
const IDENTIFIER = /^(?=[^\d]*\d)[A-Z0-9][A-Z0-9._/-]{1,59}$/;
/** Tokens shaped like identifiers that are not: dates, scales, stations, measurements, times. */
const NOT_IDENTIFIER = [/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/, /^1:\d+$/, /^\d+\+\d+/, /^\d+(\.\d+)?(KM|M|MM|CM|FT|IN|%)$/, /^\d{1,2}$/, /^\d{1,2}:\d{2}$/];
/** Field labels that sit next to a drawing's own number. */
const NUMBER_LABEL = /^(DRG|DWG|DRAWING|SHEET|SHT|DOC|DOCUMENT)\.?$/;
/** "PLAN NO." labels the sheet number on many agency title blocks; "PLAN" alone is a view title. */
const PLAN_LABEL = /^PLAN$/;
const NO_LABEL = /^(NO\.?|NUMBER|#)$/;
/**
 * Field labels for the other numbers a title block prints: `DRAWING / FILE NO.`, `CONTRACT NO.`,
 * `PROJECT NO.`, `CAD REF`. A number under one of these is not the sheet's own, and a sheet label
 * that names one of them on its row (the DRAWING of `DRAWING / FILE NO.`) is one of them.
 */
const OTHER_NUMBER_LABEL = /^(FILE|CONTRACT|PROJECT|JOB|CAD|REF|REFERENCE|ORDER|CLIENT|PACKAGE)\.?$/;

const TRAILING = new Set([':', ',', ';', '.']);

function identifier(text: string): string | null {
  // Trailing punctuation trimmed by hand: a `[...]+$` regex is slow on long runs.
  const s = text.trim().toUpperCase();
  let end = s.length;
  while (end > 0 && TRAILING.has(s[end - 1]!)) end--;
  const t = s.slice(0, end);
  if (!IDENTIFIER.test(t) || NOT_IDENTIFIER.some((r) => r.test(t))) return null;
  return t;
}

function candidatesFor(page: PageText, hints?: SheetHints): Candidate[] {
  const ignored = hints ? ignoredBy(hints, page) : () => false;
  const pattern = hints?.template ? templateRegex(hints.template) : null;
  const med = median(page.words.map((w) => w.size)) || 1;
  // The words after a label on its row, up to its "NO.": `DRAWING / FILE NO.` gives `/ FILE NO.`.
  const rest = (w: Word) => {
    const after = page.words.filter((n) => n !== w && Math.abs(n.y0 - w.y0) < w.size && n.x0 > w.x1 - 1 && n.x0 - w.x1 < w.size * 8).sort((a, b) => a.x0 - b.x0);
    const no = after.findIndex((n) => NO_LABEL.test(n.text.toUpperCase()));
    return no < 0 ? after.slice(0, 2) : after.slice(0, no + 1);
  };
  const sheetLabels: Word[] = [];
  const otherLabels: Word[] = [];
  for (const w of page.words) {
    const t = w.text.toUpperCase();
    // Only as a field label (`PROJECT NO.`): `PROJECT` or `CLIENT` alone heads a box of names.
    if (OTHER_NUMBER_LABEL.test(t)) {
      if (rest(w).some((n) => NO_LABEL.test(n.text.toUpperCase()))) otherLabels.push(w);
    } else if (NUMBER_LABEL.test(t)) (rest(w).some((n) => OTHER_NUMBER_LABEL.test(n.text.toUpperCase())) ? otherLabels : sheetLabels).push(w);
    // "PLAN NO." only: the next word on the row must be "NO."
    else if (PLAN_LABEL.test(t) && page.words.some((n) => NO_LABEL.test(n.text.toUpperCase()) && Math.abs(n.y0 - w.y0) < w.size && n.x0 > w.x1 - 1 && n.x0 - w.x1 < w.size * 2)) sheetLabels.push(w);
  }
  const out: Candidate[] = [];
  for (const word of page.words) {
    const number = identifier(word.text);
    if (!number || ignored(word)) continue;
    const cx = (word.x0 + word.x1) / 2 / page.width;
    const cy = (word.y0 + word.y1) / 2 / page.height;
    // Title blocks sit bottom-right, along the right edge, or as a strip along the bottom.
    let local = Math.min(3, word.size / med);
    const zone = (cx > 0.65 && cy > 0.65) || cx > 0.8 || cy > 0.85;
    if (cx > 0.65 && cy > 0.65) local += 2;
    else if (zone) local += 1;
    if (normalizeSheetNumber(number)) local += disciplineFor(number) ? 1 : 0.5;
    // A "DRG No." / "SHEET No." label just above or to the left names this field. Where labels
    // for two fields are both in reach (SHEET NO. beside FILE NO.), the nearer one names it.
    const s = word.size;
    const reach = (l: Word) => {
      const dx = word.x0 - l.x0;
      const dy = word.y0 - l.y0;
      return (dy > -s * 0.5 && dy < s * 3 && dx > -s * 2 && dx < s * 12) || (Math.abs(dy) < s && dx > 0 && dx < s * 14) ? Math.hypot(dx, dy) : Infinity;
    };
    const nearest = (ls: Word[]) => Math.min(Infinity, ...ls.map(reach));
    const toSheet = nearest(sheetLabels);
    const toOther = nearest(otherLabels);
    const labelled = toSheet < Infinity && toSheet <= toOther;
    if (labelled) local += 1.5;
    else if (toOther < Infinity) local -= 1.5;
    // The client's own numbering scheme names it as surely as a label does.
    const fits = !!pattern?.test(number);
    if (fits) local += 3;
    out.push({ word, number, cx, cy, local, zone, labelled: labelled || fits, large: word.size / med >= 1.5 });
  }
  return out;
}

/** A page's horizontal words joined into lines, each a Word spanning its line (view titles, notes). */
export function textLines(words: readonly Word[]): Word[] {
  return lines([...words]);
}

/** Groups words into horizontal text lines (reading order), used to find the sheet title. */
function lines(words: Word[]): Word[] {
  // Lines are built per font size, so smaller text overlapping a line (labels, dimensions) can
  // neither split it nor capture its words. Within a size, cluster into rows before ordering by x:
  // glyph bottoms on one line differ slightly ("=", punctuation, descenders).
  const bySize = new Map<number, Word[]>();
  for (const w of words) {
    if (Math.abs(Math.sin(w.angle)) >= 0.1) continue;
    const key = Math.round(w.size * 2);
    if (!bySize.has(key)) bySize.set(key, []);
    bySize.get(key)!.push(w);
  }
  const out: Word[] = [];
  for (const group of bySize.values()) {
    const rows: Word[][] = [];
    for (const w of group.sort((a, b) => a.y1 - b.y1)) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row[0]!.y1 - w.y1) < w.size * 0.4) row.push(w);
      else rows.push([w]);
    }
    for (const row of rows) {
      let last: Word | null = null;
      for (const w of row.sort((a, b) => a.x0 - b.x0)) {
        if (last && w.x0 - last.x1 < w.size * 1.5) {
          last.text += ' ' + w.text;
          last.x1 = Math.max(last.x1, w.x1);
          last.y0 = Math.min(last.y0, w.y0);
          last.y1 = Math.max(last.y1, w.y1);
        } else {
          last = { ...w };
          out.push(last);
        }
      }
    }
  }
  return out;
}

function isTitleLike(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || LABEL_WORDS.has(t.toUpperCase().replace(/:$/, ''))) return false;
  // "SHEET: 6 OF 22", "STATUS: A": field labels with values, not titles.
  if (t.includes(':')) return false;
  // Notes and sentences: "1. FOR OTHER GENERAL NOTES ... SEE DRAWING No ...".
  if (t.length > 70 || /^\d+\.\s/.test(t) || /\.\s/.test(t) || /\.$/.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  // Titles are set in capitals; body notes and addresses mostly are not.
  const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upper < 0.8) return false;
  if (/\b(SHEET|DRAWING)\s+(NO|NUMBER)\b/i.test(t) || /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(t)) return false;
  if (normalizeSheetNumber(t)) return false;
  return true;
}

/**
 * Largest title-like text near the sheet number, joining a title set on two stacked lines. Text
 * printed on most sheets (the project name, the client) is not a sheet's title.
 */
function findTitle(page: PageText, numberWord: Word, repeated: (text: string) => boolean): string | null {
  // The title block around the number: a few text heights up or down, wide across.
  const rx = page.width * 0.3;
  const ry = Math.max(numberWord.size * 8, page.height * 0.05);
  const cx = (numberWord.x0 + numberWord.x1) / 2;
  const cy = (numberWord.y0 + numberWord.y1) / 2;
  const nearby = lines(page.words.filter((w) => w !== numberWord && Math.abs((w.x0 + w.x1) / 2 - cx) < rx && Math.abs((w.y0 + w.y1) / 2 - cy) < ry));
  const titles = nearby.filter((l) => isTitleLike(l.text) && !repeated(l.text)).sort((a, b) => b.size - a.size || Math.abs(a.y1 - cy) - Math.abs(b.y1 - cy));
  const best = titles[0];
  if (!best) return null;
  // A second line of the same size directly above or below continues the title.
  const next = titles.find((l) => l !== best && Math.abs(l.size - best.size) < 0.5 && Math.abs(l.x0 - best.x0) < best.size * 3 && Math.abs(l.y0 - best.y1) < best.size * 0.8);
  const prev = titles.find((l) => l !== best && Math.abs(l.size - best.size) < 0.5 && Math.abs(l.x0 - best.x0) < best.size * 3 && Math.abs(best.y0 - l.y1) < best.size * 0.8);
  // Revision dates in the same row can join onto a title's ends.
  const DATE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;
  const words = [prev?.text, best.text, next?.text].filter(Boolean).join(' ').split(' ');
  while (words.length && DATE.test(words[0]!)) words.shift();
  while (words.length && DATE.test(words.at(-1)!)) words.pop();
  return words.join(' ') || null;
}

/** Title-block lines near the sheet number. */
function titleBlockLines(page: PageText, numberWord: Word): Word[] {
  const cx = (numberWord.x0 + numberWord.x1) / 2;
  const cy = (numberWord.y0 + numberWord.y1) / 2;
  return lines(page.words.filter((w) => Math.abs((w.x0 + w.x1) / 2 - cx) < page.width * 0.3 && Math.abs((w.y0 + w.y1) / 2 - cy) < page.height * 0.25));
}

/** The line just under a title-block label that holds its value (`SCALE` over `1:500`), if one fits `value`. */
function valueBelow(label: Word, nearby: readonly Word[], value: RegExp): Word | null {
  const reach = Math.max(label.size, 6) * 4;
  const pad = label.size * 2;
  let best: Word | null = null;
  for (const l of nearby) {
    if (l === label || l.y0 < label.y1 - 1 || l.y0 - label.y1 > reach) continue;
    if (l.x0 > label.x1 + pad || l.x1 < label.x0 - pad || !value.test(oneSpaced(l.text))) continue;
    if (!best || l.y0 < best.y0) best = l;
  }
  return best;
}

const SCALE_VALUE = /(=|\d ?: ?\d|NTS|NOT TO SCALE|AS NOTED|AS SHOWN)/i;
const PAPER_VALUE = /^((?:ANSI|ARCH)[ -]{0,3}(?:E1|[A-E])|[AB][0-6])$/i;
const PAPER_LINE = /^(?:(?:SHEET|PAPER|ORIGINAL) )?SIZE[ :]*((?:ANSI|ARCH)[ -]{0,3}(?:E1|[A-E])|[AB][0-6])?$/i;

/** A line's text trimmed, with each run of white space as one space. */
function oneSpaced(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * The scale written after `SCALE` on a line (`SCALE: 1:500`), with a sheet size written first
 * moved after it (`SCALE @A1 1:500` reads `1:500 @ A1`). `atStart`: only where the line starts
 * with `SCALE`, as a title block's own label does.
 */
function inlineScale(text: string, atStart: boolean): string | null {
  const after = (atStart ? /^SCALE\b[ :]*(.*)$/i : /\bSCALE\b[ :]*(.*)$/i).exec(text)?.[1];
  if (!after || !SCALE_VALUE.test(after)) return null;
  const sized = /^(?:@|AT\b) ?(\S+) (.+)$/i.exec(after);
  if (!sized) return after;
  return SCALE_VALUE.test(sized[2]!) ? `${sized[2]} @ ${sized[1]!.toUpperCase()}` : null;
}

function findScaleText(page: PageText, numberWord: Word): string | null {
  const nearby = titleBlockLines(page, numberWord);
  const texts = nearby.map((l) => oneSpaced(l.text));
  // Best first: a line that starts with SCALE and holds the value; then a SCALE label cell with
  // its value underneath (the label can name the sheet size, `SCALE @ A1`); last, SCALE inside a
  // line. A key plan's `KEY PLAN SCALE 1:10000` or an inset's NOT TO SCALE is not the sheet's.
  for (const t of texts) {
    const inline = inlineScale(t, true);
    if (inline) return inline;
  }
  const i = texts.findIndex((t) => /^SCALE\b/i.test(t));
  const value = i >= 0 ? valueBelow(nearby[i]!, nearby, SCALE_VALUE) : null;
  if (value) {
    const paper = /(?:@|\bAT\b) ?(\S+)/i.exec(texts[i]!)?.[1];
    const v = oneSpaced(value.text);
    return paper && !/@|\bAT\b/i.test(v) ? `${v} @ ${paper.toUpperCase()}` : v;
  }
  for (const t of texts) {
    const inline = inlineScale(t, false);
    if (inline) return inline;
  }
  return null;
}

/**
 * A sheet size in its own title-block box near the sheet number: `SHEET SIZE A1` or `SIZE: ANSI D`
 * as a whole line, or a `SHEET SIZE` label with the size underneath. Not a note that mentions one
 * (`IF PRINTED AT REDUCED SIZE A3 ...`).
 */
function findPaperText(page: PageText, numberWord: Word): string | null {
  const nearby = titleBlockLines(page, numberWord);
  const lines = nearby.map((l) => PAPER_LINE.exec(oneSpaced(l.text)));
  const hit = lines.find((m) => m?.[1]);
  if (hit) return hit[1]!.toUpperCase().replace(/[ -]+/g, ' ');
  const i = lines.findIndex(Boolean);
  const value = i >= 0 ? valueBelow(nearby[i]!, nearby, PAPER_VALUE) : null;
  return value ? PAPER_VALUE.exec(oneSpaced(value.text))![1]!.toUpperCase().replace(/[ -]+/g, ' ') : null;
}

/**
 * Offline sheet identification from the text layer. Candidates are scored per page (size relative
 * to body text, title-block position, known discipline prefix), then by consensus across the set:
 * title blocks sit in the same place on every sheet, so a candidate at a location shared by many
 * pages is far more likely to be the sheet number than a callout that happens to match.
 */
export function detectSheets(pages: PageText[], hints?: SheetHints): SheetInfo[] {
  // A drawing standard's title-block boxes read the pages they fit; the rest are worked out below.
  const read = hints ? pages.map((p) => readSheet(p, hints)) : [];
  const perPage = pages.map((p) => candidatesFor(p, hints));
  const withText = pages.filter((p) => p.words.length > 0).length || 1;

  // Text that appears on most sheets (project name, drawing-set number, status) identifies the
  // set, not the sheet. Only meaningful once there are a few sheets to compare.
  const pagesWith = (items: string[][]) => {
    const count = new Map<string, number>();
    for (const list of items) for (const t of new Set(list)) count.set(t, (count.get(t) ?? 0) + 1);
    return count;
  };
  // Sheet numbers are unique to their sheet, so a value repeated in the same place on several
  // sheets (the drawing-set number, a note that cites another drawing) is not one. The same value
  // elsewhere on the page says nothing: notes cite other sheets by number all the time.
  const at = (c: Candidate) => `${Math.floor(c.cx / 0.04)},${Math.floor(c.cy / 0.04)}:${c.number}`;
  const numberCounts = pagesWith(perPage.map((c) => c.map(at)));
  const lineCounts = pagesWith(pages.map((p) => lines(p.words).map((l) => l.text)));
  const common = (n: number | undefined) => withText >= 3 && (n ?? 0) > withText * 0.5;
  const repeatedLine = (text: string) => common(lineCounts.get(text));
  for (const cands of perPage)
    for (const c of cands)
      if (withText >= 3 && (numberCounts.get(at(c)) ?? 0) >= 2) {
        c.local -= 4;
        c.repeated = true;
      }
  // A sheet's own number is the one other sheets cite: callouts, match lines and the index all
  // name it. A drawing-file number printed beside it in the title block (SFPUC's E-35863, a
  // document-control number) is never cited by a callout, so citation elsewhere breaks the tie.
  const citedOn = new Map<string, Set<number>>();
  perPage.forEach((cands, pageIndex) => {
    for (const c of cands) {
      if (c.cx > 0.65 && c.cy > 0.65) continue;
      if (!citedOn.has(c.number)) citedOn.set(c.number, new Set());
      citedOn.get(c.number)!.add(pageIndex);
    }
  });
  const citations = (c: Candidate, self: number) => {
    const pagesCiting = citedOn.get(c.number);
    if (!pagesCiting) return 0;
    return pagesCiting.size - (pagesCiting.has(self) ? 1 : 0);
  };
  // Which pages have a candidate in each cell of a coarse grid over normalized page positions.
  const CELL = 0.04;
  const cellKey = (x: number, y: number) => `${x},${y}`;
  const grid = new Map<string, Set<number>>();
  perPage.forEach((cands, pageIndex) => {
    for (const c of cands) {
      const key = cellKey(Math.floor(c.cx / CELL), Math.floor(c.cy / CELL));
      if (!grid.has(key)) grid.set(key, new Set());
      grid.get(key)!.add(pageIndex);
    }
  });
  const pagesNear = (c: Candidate, self: number) => {
    const found = new Set<number>();
    const gx = Math.floor(c.cx / CELL);
    const gy = Math.floor(c.cy / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const p of grid.get(cellKey(gx + dx, gy + dy)) ?? []) if (p !== self) found.add(p);
    return found.size;
  };

  return pages.map((page, pageIndex) => {
    const standard = read[pageIndex];
    if (standard) return standard;
    const empty: SheetInfo = { number: null, title: null, discipline: null, scaleText: null, revision: null, source: 'text', confidence: 0 };
    const cands = perPage[pageIndex]!;
    if (!cands.length) return empty;
    let best: { c: Candidate; score: number; consensus: number } | null = null;
    for (const c of cands) {
      const consensus = pages.length > 1 ? pagesNear(c, pageIndex) / (withText - 1 || 1) : 0;
      // Every page has some number on it; only one that reads as this sheet's own is taken. Pages
      // without a title block (reports, letters, specs) get none, rather than an address or a stage.
      if (c.repeated) continue;
      if (!c.labelled && !(isDrawingNumberShape(c.number) && (c.zone || (c.large && consensus >= 0.5)))) continue;
      const cited = citations(c, pageIndex);
      const score = c.local + consensus * 3 + (cited >= 2 ? 1.5 : cited === 1 ? 0.75 : 0);
      if (!best || score > best.score) best = { c, score, consensus };
    }
    if (!best) return empty;
    const { c, consensus } = best;
    // Confidence: strong when the candidate is big, in the title-block corner and consistent.
    const confidence = Math.max(0.1, Math.min(0.9, (best.score - 1) / 7 + (pages.length > 1 ? consensus * 0.2 : 0)));
    return {
      number: c.number,
      title: findTitle(page, c.word, repeatedLine),
      discipline: hints ? disciplineOf(c.number, hints) : disciplineFor(c.number),
      scaleText: findScaleText(page, c.word),
      paperText: findPaperText(page, c.word),
      revision: null,
      source: 'text',
      confidence: Math.round(confidence * 100) / 100,
    };
  });
}
