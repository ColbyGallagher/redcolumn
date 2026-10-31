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
}

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
  return out;
}

function sameRow(a: Word, b: Word): boolean {
  return Math.abs(a.y1 - b.y1) < Math.max(a.size, b.size) * 0.6 && b.x0 - a.x1 < Math.max(a.size, b.size) * 3 && b.x0 > a.x0;
}

/** Where each alignment's name is printed on a page (its first word). */
function alignmentNames(page: PageText, names: readonly string[]): { name: string; at: Word }[] {
  const out: { name: string; at: Word }[] = [];
  for (const name of names) {
    const parts = upper(name).split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    page.words.forEach((w, i) => {
      if (trimWord(w.text) !== parts[0]) return;
      let prev = w;
      for (let k = 1; k < parts.length; k++) {
        const next = page.words[i + k];
        if (!next || trimWord(next.text) !== parts[k] || !sameRow(prev, next)) return;
        prev = next;
      }
      out.push({ name, at: w });
    });
  }
  return out;
}

/**
 * Gives each chainage its alignment: the name printed on its row before it, else the nearest name
 * close by, else the one the page is mostly about. With no names in the standard every chainage
 * is on the one alignment ('').
 */
function assignAlignments(page: PageText, chainages: Chainage[], names: readonly string[]): string | null {
  if (!names.length) {
    for (const c of chainages) c.alignment = '';
    return '';
  }
  const found = alignmentNames(page, names);
  const counts = new Map<string, number>();
  for (const f of found) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  // The page's own alignment, when one name clearly dominates it.
  const main = ranked.length && (ranked.length === 1 || ranked[0]![1] >= ranked[1]![1] * 2) ? ranked[0]![0] : null;
  for (const c of chainages) {
    const w = c.words[0]!;
    const s = Math.max(w.size, 4);
    const before = found.filter((f) => Math.abs(f.at.y1 - w.y1) < s * 0.6 && f.at.x0 < w.x0 && w.x0 - f.at.x1 < s * 40).sort((a, b) => b.at.x0 - a.at.x0)[0];
    const near = found.map((f) => ({ f, d: Math.hypot((f.at.x0 + f.at.x1) / 2 - (w.x0 + w.x1) / 2, (f.at.y0 + f.at.y1) / 2 - (w.y0 + w.y1) / 2) })).filter((x) => x.d < s * 15).sort((a, b) => a.d - b.d)[0];
    c.alignment = before?.name ?? near?.f.name ?? main;
  }
  return main;
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
  const sorted = [...list].sort((a, b) => a.value - b.value);
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

/** Any of `phrases` in a sheet's title, or (with no title read) in the page's large text. */
function titled(page: PageText, sheet: SheetInfo | null | undefined, phrases: readonly string[]): boolean {
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
const STANDARD = 0.85;
/** Without a drawing standard, or with the alignment not told: worth checking, not applying. */
const UNSURE = 0.6;

/**
 * Chainage links across a set. With `fromStandard`, a person said how the client writes chainages
 * and which sheets cover the alignment, so links whose alignment is known are kept; otherwise
 * (the default title words, or an alignment that cannot be told) they wait for review.
 */
export function detectChainageLinks(pages: readonly PageText[], sheets: readonly (SheetInfo | null | undefined)[], hints: ChainageHints = DEFAULT_CHAINAGE_HINTS, fromStandard = false): DetectedLink[] {
  const read = pages.map((p) => {
    const list = readChainages(p, hints);
    const main = assignAlignments(p, list, hints.alignments);
    return { list, main };
  });
  const isPlan = pages.map((p, i) => titled(p, sheets[i], hints.planTitles));
  const isSection = pages.map((p, i) => !isPlan[i] && titled(p, sheets[i], hints.sectionTitles));

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

  const links: DetectedLink[] = [];
  read.forEach(({ list }, pageIndex) => {
    const seen = new Set<string>();
    for (const c of list) {
      const known = c.alignment !== null;
      const sameLine = (a: string) => !known || a === c.alignment;
      const conf = fromStandard && known ? STANDARD : UNSURE;
      const push = (targetPage: number, targetRect: Rect, key: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        const label = c.words.map((w) => trimWord(w.text)).join(' ');
        links.push({ id: `${pageIndex}:ch:${key}`, pageIndex, rect: rectOf(c.words), label, kind: 'chainage', detail: null, targetPage, targetRect, confidence: conf });
      };
      // 1. The cross section drawn at this chainage.
      const section = sections.find((s) => s.page !== pageIndex && Math.abs(s.c.value - c.value) < SAME && s.c.alignment !== null && sameLine(s.c.alignment));
      if (section) {
        push(section.page, frame(section.c.words[0]!, 20), `${c.alignment ?? '?'}:${c.value}>${section.page}`);
        continue;
      }
      // 2. Else the plan that covers it, unless this is that plan.
      const covering = coverages.filter((v) => sameLine(v.alignment) && c.value >= v.from - SAME && c.value <= v.to + SAME);
      if (covering.some((v) => v.page === pageIndex)) continue;
      if (!covering.length) continue;
      // The narrowest: a key plan spans everything, the plan at this chainage is what people want.
      const span = (v: Coverage) => v.to - v.from;
      const min = Math.min(...covering.map(span));
      for (const v of covering.filter((x) => span(x) <= min * 2)) {
        const tick = v.marks.reduce((best, m) => (Math.abs(m.value - c.value) < Math.abs(best.value - c.value) ? m : best));
        push(v.page, frame(tick.words[tick.words.length - 1]!), `${c.alignment ?? '?'}:${c.value}>${v.page}`);
      }
    }
  });
  return links;
}
