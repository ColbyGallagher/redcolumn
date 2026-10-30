import { compareSheetNumbers, disciplineFor } from './detect.ts';
import type { DetectedLink, Rect } from './links.ts';
import type { PageText, Word } from './types.ts';

/**
 * Stations on linear work (pipelines, roads, rail): `598+59.00` is 59,859 ft along the alignment.
 * Plan and profile sheets print a run of station ticks, which says what stretch each sheet covers;
 * everywhere else a station names a spot on that stretch (a section cut, a note, a table row).
 * Linking the mention to the sheet that covers it is the cross-reference people make most on a
 * linear job, and no callout bubble ever draws it.
 */

/** `598+59`, `598+59.00`, `12+00`; also `STA:598+59.00` and `STA.598+59` run together as one word. */
const STATION = /^(?:STA\.?:?)?(\d{1,4})\+(\d{2}(?:\.\d{1,2})?)$/i;

export interface StationRange {
  /** First and last tick, in feet along the alignment. */
  from: number;
  to: number;
  /** How many even-station ticks were read; the range may end on an odd one (a match line). */
  ticks: number;
}

/** A station's value in feet, or null when the text is not a station. */
export function parseStation(text: string): number | null {
  const m = STATION.exec(text.trim().replace(/[,;:)]+$/, '').replace(/^\(+/, ''));
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2]);
}

/** A station as sheets print it: `598+59.00`. */
export function formatStation(feet: number): string {
  const whole = Math.floor(feet / 100);
  const rest = feet - whole * 100;
  return `${whole}+${rest.toFixed(2).padStart(5, '0')}`;
}

/** Fewer ticks than this, or a shorter run, is a local dimension string, not sheet coverage. */
const MIN_TICKS = 4;
const MIN_SPAN = 100;
/** Plan ticks fall on even stations (every 25, 50 or 100 ft); a run of odd ones is a list of sections or a table. */
const isTick = (feet: number) => Math.abs(feet / 25 - Math.round(feet / 25)) < 1e-6;

/**
 * The stretch of alignment each page covers, read from its station ticks, or null for pages that
 * are not plan/profile sheets. Ticks are the bare stations (`600+00`), not ones introduced by `STA`,
 * which are mentions. Where a page carries two runs (a section's own 0+00 chainage beside the
 * alignment), the longer run wins.
 */
export function sheetStationRanges(pages: readonly PageText[]): (StationRange | null)[] {
  return pages.map((page) => {
    const values = new Set<number>();
    for (const w of page.words) {
      if (/STA/i.test(w.text)) continue;
      const v = parseStation(w.text);
      if (v !== null) values.add(v);
    }
    if (values.size < MIN_TICKS) return null;
    const sorted = [...values].sort((a, b) => a - b);
    // Split where the gap between ticks jumps: that is a different chainage, not the same run.
    const gaps = sorted.slice(1).map((v, i) => v - sorted[i]!);
    const typical = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
    const runs: number[][] = [[sorted[0]!]];
    sorted.slice(1).forEach((v, i) => {
      if (gaps[i]! > Math.max(typical * 5, MIN_SPAN * 5)) runs.push([v]);
      else runs[runs.length - 1]!.push(v);
    });
    const run = runs.sort((a, b) => b.filter(isTick).length - a.filter(isTick).length)[0]!;
    const from = run[0]!;
    const to = run[run.length - 1]!;
    const ticks = run.filter(isTick).length;
    if (ticks < MIN_TICKS || to - from < MIN_SPAN) return null;
    return { from, to, ticks };
  });
}

/** Frames the tick nearest a station on the covering sheet, so a preview opens there. */
function tickFrame(page: PageText, feet: number): Rect | null {
  let best: { w: Word; d: number } | null = null;
  for (const w of page.words) {
    if (/STA/i.test(w.text)) continue;
    const v = parseStation(w.text);
    if (v === null) continue;
    const d = Math.abs(v - feet);
    if (!best || d < best.d) best = { w, d };
  }
  if (!best) return null;
  const s = Math.max(best.w.size, 6);
  return { x: best.w.x0 - s * 30, y: best.w.y0 - s * 30, w: s * 60, h: s * 60 };
}

/**
 * The most specific covering sheets: a key plan or index spans the whole alignment and covers every
 * station, but the sheet people want is the plan at that station. Two adjacent plans both covering
 * a boundary station are kept together.
 */
function narrowest(targets: number[], ranges: readonly (StationRange | null)[]): number[] {
  const span = (i: number) => ranges[i]!.to - ranges[i]!.from;
  const min = Math.min(...targets.map(span));
  return targets.filter((i) => span(i) <= min * 2);
}

// Both kept as links, not review: which sheet covers a station is arithmetic, not a guess.
const SAME_DISCIPLINE = 0.85;
const OTHER_DISCIPLINE = 0.8;

/**
 * Links every station mentioned on a page to the sheet(s) whose ticks cover it: the mention's own
 * discipline when it has plans, else whichever discipline carries the alignment (the pipeline plan
 * for a station in a demolition note). A sheet's own ticks are its coverage, not links out.
 */
export function detectStationLinks(pages: readonly PageText[], sheetNumbers: readonly (string | null)[], ranges: readonly (StationRange | null)[] = sheetStationRanges(pages)): DetectedLink[] {
  const links: DetectedLink[] = [];
  const covering = (feet: number, self: number) =>
    ranges
      .map((r, i) => (r && i !== self && feet >= r.from - 1 && feet <= r.to + 1 ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => compareSheetNumbers(sheetNumbers[a] ?? '', sheetNumbers[b] ?? ''));

  pages.forEach((page, pageIndex) => {
    const own = ranges[pageIndex];
    const discipline = sheetNumbers[pageIndex] ? disciplineFor(sheetNumbers[pageIndex]!) : null;
    const seen = new Set<string>();
    for (const w of page.words) {
      const feet = parseStation(w.text);
      if (feet === null) continue;
      // On a plan sheet, a station inside its own coverage is a tick or a callout to this sheet, not a link out.
      if (own && feet >= own.from - 1 && feet <= own.to + 1) continue;
      const targets = covering(feet, pageIndex);
      if (!targets.length) continue;
      const same = targets.filter((t) => sheetNumbers[t] && disciplineFor(sheetNumbers[t]!) === discipline);
      const chosen = narrowest(same.length ? same : targets, ranges);
      const anchor = formatStation(feet);
      for (const targetPage of chosen) {
        // One link per station and sheet, however many times the page prints it.
        const key = `${anchor}>${targetPage}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pad = w.size * 0.3;
        const rect = { x: w.x0 - pad, y: w.y0 - pad, w: w.x1 - w.x0 + pad * 2, h: w.y1 - w.y0 + pad * 2 };
        links.push({
          id: `${pageIndex}:sta:${anchor}:${targetPage}`,
          pageIndex,
          rect,
          label: w.text.trim().replace(/[,;:)]+$/, '').replace(/^\(+/, ''),
          kind: 'station',
          detail: null,
          anchor,
          targetPage,
          targetRect: tickFrame(pages[targetPage]!, feet),
          confidence: same.length ? SAME_DISCIPLINE : OTHER_DISCIPLINE,
        });
      }
    }
  });
  return links;
}
