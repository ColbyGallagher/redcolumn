import type { PageText, SheetInfo, Word } from './types.ts';

/**
 * Sheet numbers as used on US construction drawings: a discipline prefix of 1-3 letters, an
 * optional separator, then digits with an optional sub-number and suffix letter.
 * Matches C-101, A1.01, S-201, E101, FP-101, M-3, L-1.0, C5.1A.
 */
const SHEET_NUMBER = /^([A-Z]{1,3})[-.\s]?(\d{1,3})(?:[.-](\d{1,3}))?([A-Z])?$/;

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
}

/**
 * Drawing identifiers in any numbering scheme: US sheet numbers (C-101, A2.01) and document
 * numbers (HLD1BDD-WSPAU-0508-MS-DRG-100011, 12345-C-001). Must contain a digit.
 */
const IDENTIFIER = /^(?=[^\d]*\d)[A-Z0-9][A-Z0-9._/-]{1,59}$/;
/** Tokens shaped like identifiers that are not: dates, scales, stations, measurements, times. */
const NOT_IDENTIFIER = [/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/, /^1:\d+$/, /^\d+\+\d+/, /^\d+(\.\d+)?(KM|M|MM|CM|FT|IN|%)$/, /^\d{1,2}$/, /^\d{1,2}:\d{2}$/];
/** Field labels that sit next to a drawing's own number. */
const NUMBER_LABEL = /^(DRG|DWG|DRAWING|SHEET|SHT|DOC|DOCUMENT)\.?$/;

function identifier(text: string): string | null {
  const t = text.trim().toUpperCase().replace(/[:,;.]+$/, '');
  if (!IDENTIFIER.test(t) || NOT_IDENTIFIER.some((r) => r.test(t))) return null;
  return t;
}

function candidatesFor(page: PageText): Candidate[] {
  const med = median(page.words.map((w) => w.size)) || 1;
  const labels = page.words.filter((w) => NUMBER_LABEL.test(w.text.toUpperCase()));
  const out: Candidate[] = [];
  for (const word of page.words) {
    const number = identifier(word.text);
    if (!number) continue;
    const cx = (word.x0 + word.x1) / 2 / page.width;
    const cy = (word.y0 + word.y1) / 2 / page.height;
    // Title blocks sit bottom-right, along the right edge, or as a strip along the bottom.
    let local = Math.min(3, word.size / med);
    if (cx > 0.65 && cy > 0.65) local += 2;
    else if (cx > 0.8 || cy > 0.85) local += 1;
    if (normalizeSheetNumber(number)) local += disciplineFor(number) ? 1 : 0.5;
    // A "DRG No." / "SHEET No." label just above or to the left names this field.
    const s = word.size;
    const labelled = labels.some((l) => {
      const dx = word.x0 - l.x0;
      const dy = word.y0 - l.y0;
      return (dy > -s * 0.5 && dy < s * 3 && dx > -s * 2 && dx < s * 12) || (Math.abs(dy) < s && dx > 0 && dx < s * 14);
    });
    if (labelled) local += 1.5;
    out.push({ word, number, cx, cy, local });
  }
  return out;
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

function findScaleText(page: PageText, numberWord: Word): string | null {
  const cx = (numberWord.x0 + numberWord.x1) / 2;
  const cy = (numberWord.y0 + numberWord.y1) / 2;
  const nearby = lines(page.words.filter((w) => Math.abs((w.x0 + w.x1) / 2 - cx) < page.width * 0.3 && Math.abs((w.y0 + w.y1) / 2 - cy) < page.height * 0.25));
  const hit = nearby.find((l) => /SCALE/i.test(l.text) && /(=|:|NTS|NOT TO SCALE|AS NOTED)/i.test(l.text));
  return hit ? hit.text.replace(/^.*?SCALE\s*:?\s*/i, '').trim() || null : null;
}

/**
 * Offline sheet identification from the text layer. Candidates are scored per page (size relative
 * to body text, title-block position, known discipline prefix), then by consensus across the set:
 * title blocks sit in the same place on every sheet, so a candidate at a location shared by many
 * pages is far more likely to be the sheet number than a callout that happens to match.
 */
export function detectSheets(pages: PageText[]): SheetInfo[] {
  const perPage = pages.map(candidatesFor);
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
  for (const cands of perPage) for (const c of cands) if (withText >= 3 && (numberCounts.get(at(c)) ?? 0) >= 2) c.local -= 4;
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
    const empty: SheetInfo = { number: null, title: null, discipline: null, scaleText: null, revision: null, source: 'text', confidence: 0 };
    const cands = perPage[pageIndex]!;
    if (!cands.length) return empty;
    let best: { c: Candidate; score: number; consensus: number } | null = null;
    for (const c of cands) {
      const consensus = pages.length > 1 ? pagesNear(c, pageIndex) / (withText - 1 || 1) : 0;
      const score = c.local + consensus * 3;
      if (!best || score > best.score) best = { c, score, consensus };
    }
    const { c, consensus } = best!;
    // Confidence: strong when the candidate is big, in the title-block corner and consistent.
    const confidence = Math.max(0.1, Math.min(0.9, (best!.score - 1) / 7 + (pages.length > 1 ? consensus * 0.2 : 0)));
    return {
      number: c.number,
      title: findTitle(page, c.word, repeatedLine),
      discipline: disciplineFor(c.number),
      scaleText: findScaleText(page, c.word),
      revision: null,
      source: 'text',
      confidence: Math.round(confidence * 100) / 100,
    };
  });
}
