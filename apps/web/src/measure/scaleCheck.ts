import { METERS_PER_UNIT, type LengthUnit, type Scale } from '@nb/measure';
import type { Word } from '@nb/sheets';

/**
 * Checks a page's scale against things drawn on the page that state lengths of their own: scale
 * bars (`0 10 20 40m` under alternating blocks) and dimension strings (a number centred over the
 * line it measures). A title block can be misread or out of date; these are drawn at the same size
 * as the drawing, so they shrink with it when a sheet is saved smaller.
 */

/** A length read off the page: how much real-world length one PDF point is, by one witness. */
export interface ScaleReading {
  kind: 'bar' | 'dimensions';
  metersPerPoint: number;
  /** Where it was read, in page points. */
  rect: { x: number; y: number; w: number; h: number };
  /** What was read, for people: `0 10 20 40m`, or `12 dimensions`. */
  text: string;
  /** How many dimensions agreed, for a dimensions reading. */
  count?: number;
  /** Unit the reading assumed, when the page did not say (bars without a unit, dimensions). */
  assumed?: boolean;
}

const UNIT_WORDS: Record<string, LengthUnit> = {
  M: 'm',
  METRE: 'm',
  METRES: 'm',
  METER: 'm',
  METERS: 'm',
  MM: 'mm',
  KM: 'km',
  FT: 'ft',
  FEET: 'ft',
  FOOT: 'ft',
  "'": 'ft',
};

const horizontal = (w: Word) => Math.abs(Math.sin(w.angle)) < 0.1;
const cx = (w: Word) => (w.x0 + w.x1) / 2;

/** A scale-bar tick label: a number, perhaps with its unit run on (`40m`, `100'`). */
function tickValue(text: string): { value: number; unit?: LengthUnit } | null {
  const m = /^(\d{1,5}(?:\.\d{1,3})?)(M|MM|KM|FT|')?$/i.exec(text.trim());
  if (!m) return null;
  return { value: Number(m[1]), ...(m[2] ? { unit: UNIT_WORDS[m[2].toUpperCase()] } : {}) };
}

/**
 * Scale bars: a row of at least three numbers starting at 0, increasing, and spaced in proportion
 * to their values (a straight line through their centres to within 1% of the bar). The unit is the
 * one run on to a number (`40m`) or the word just after the last; without either, `fallback`.
 */
export function scaleBars(words: readonly Word[], fallback: LengthUnit = 'm'): ScaleReading[] {
  const rows: Word[][] = [];
  for (const w of [...words].filter(horizontal).sort((a, b) => a.y1 - b.y1)) {
    const row = rows.find((r) => Math.abs(r[0]!.y1 - w.y1) < w.size * 0.3 && Math.abs(r[0]!.size / w.size - 1) < 0.15);
    if (row) row.push(w);
    else rows.push([w]);
  }
  const out: ScaleReading[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < row.length; i++) {
      if (tickValue(row[i]!.text)?.value !== 0) continue;
      const ticks: { w: Word; value: number; unit?: LengthUnit }[] = [];
      for (let j = i; j < row.length; j++) {
        const t = tickValue(row[j]!.text);
        if (!t || (ticks.length && t.value <= ticks.at(-1)!.value)) break;
        ticks.push({ w: row[j]!, ...t });
      }
      if (ticks.length < 3) continue;
      // Least-squares line x = a + b·value through the label centres.
      const n = ticks.length;
      const mv = ticks.reduce((s, t) => s + t.value, 0) / n;
      const mx = ticks.reduce((s, t) => s + cx(t.w), 0) / n;
      const b = ticks.reduce((s, t) => s + (t.value - mv) * (cx(t.w) - mx), 0) / ticks.reduce((s, t) => s + (t.value - mv) ** 2, 0);
      const span = b * ticks.at(-1)!.value;
      if (!(b > 0) || ticks.some((t) => Math.abs(mx + b * (t.value - mv) - cx(t.w)) > Math.max(1, span * 0.01))) continue;
      const last = ticks.at(-1)!.w;
      const next = row[i + n];
      const word = next && next.x0 - last.x1 < next.size * 2 ? UNIT_WORDS[next.text.trim().toUpperCase()] : undefined;
      const unit = ticks.find((t) => t.unit)?.unit ?? word;
      const x0 = ticks[0]!.w.x0;
      const y0 = Math.min(...ticks.map((t) => t.w.y0));
      out.push({
        kind: 'bar',
        metersPerPoint: METERS_PER_UNIT[unit ?? fallback] / b,
        rect: { x: x0, y: y0, w: last.x1 - x0, h: Math.max(...ticks.map((t) => t.w.y1)) - y0 },
        text: ticks.map((t) => t.w.text).join(' ') + (word ? ` ${next!.text}` : ''),
        ...(unit ? {} : { assumed: true }),
      });
      i += n - 1;
    }
  }
  return out;
}

/** A dimension value: whole numbers of 100 and up are millimetres, decimals metres (`3500`, `3.5`, `3.5m`). */
function dimensionMeters(text: string): number | null {
  const m = /^(\d{1,6})(\.\d{1,3})?(MM|M)?$/i.exec(text.trim());
  if (!m) return null;
  const value = Number(m[1] + (m[2] ?? ''));
  if (!(value > 0)) return null;
  const unit = m[3]?.toUpperCase();
  if (unit === 'MM' || (!unit && !m[2] && value >= 100)) return value / 1000;
  if (unit === 'M' || m[2]) return value;
  return null;
}

const CELL = 64;

/**
 * Dimension strings: a metric number centred over a straight line parallel to it, within two text
 * heights, the line longer than the number. Many such pairs are not dimensions (labels over road
 * edges), so only a cluster of at least `minAgree` readings within 1% of each other counts; the
 * largest cluster is returned. `segments` is page geometry, `[x1, y1, x2, y2, ...]` in points.
 */
export function dimensionScale(words: readonly Word[], segments: ArrayLike<number>, minAgree = 3): ScaleReading | null {
  // Segments by grid cell, so each number looks only at lines near it.
  const grid = new Map<string, number[]>();
  for (let s = 0; s + 3 < segments.length; s += 4) {
    const [x1, y1, x2, y2] = [segments[s]!, segments[s + 1]!, segments[s + 2]!, segments[s + 3]!];
    if (Math.hypot(x2 - x1, y2 - y1) < 4) continue;
    for (let gx = Math.floor(Math.min(x1, x2) / CELL); gx <= Math.floor(Math.max(x1, x2) / CELL); gx++)
      for (let gy = Math.floor(Math.min(y1, y2) / CELL); gy <= Math.floor(Math.max(y1, y2) / CELL); gy++) {
        const key = `${gx},${gy}`;
        const list = grid.get(key);
        if (list) list.push(s);
        else grid.set(key, [s]);
      }
  }
  const readings: { mpp: number; w: Word }[] = [];
  for (const w of words) {
    const meters = dimensionMeters(w.text);
    if (meters === null) continue;
    const [dx, dy] = [Math.cos(w.angle), Math.sin(w.angle)];
    const [mx, my] = [cx(w), (w.y0 + w.y1) / 2];
    const textLength = Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
    let best: { length: number; off: number } | null = null;
    const seen = new Set<number>();
    for (let gx = Math.floor((mx - w.size * 2) / CELL); gx <= Math.floor((mx + w.size * 2) / CELL); gx++)
      for (let gy = Math.floor((my - w.size * 2) / CELL); gy <= Math.floor((my + w.size * 2) / CELL); gy++)
        for (const s of grid.get(`${gx},${gy}`) ?? []) {
          if (seen.has(s)) continue;
          seen.add(s);
          const [x1, y1, x2, y2] = [segments[s]!, segments[s + 1]!, segments[s + 2]!, segments[s + 3]!];
          const length = Math.hypot(x2 - x1, y2 - y1);
          const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
          if (Math.abs(ux * dy - uy * dx) > 0.035 || length < textLength * 1.2) continue;
          const along = ((mx - x1) * ux + (my - y1) * uy) / length;
          const off = Math.abs((mx - x1) * uy - (my - y1) * ux);
          if (Math.abs(along - 0.5) > 0.2 || off > w.size * 2) continue;
          if (!best || off < best.off) best = { length, off };
        }
    if (best) readings.push({ mpp: meters / best.length, w });
  }
  // The largest group of readings within 1% of one another.
  readings.sort((a, b) => a.mpp - b.mpp);
  let top: { from: number; to: number } | null = null;
  for (let i = 0, j = 0; i < readings.length; i++) {
    while (readings[j]!.mpp < readings[i]!.mpp / 1.01) j++;
    if (!top || i - j > top.to - top.from) top = { from: j, to: i };
  }
  if (!top || top.to - top.from + 1 < minAgree) return null;
  const group = readings.slice(top.from, top.to + 1);
  const mpp = group[Math.floor(group.length / 2)]!.mpp;
  const x0 = Math.min(...group.map((r) => r.w.x0));
  const y0 = Math.min(...group.map((r) => r.w.y0));
  return {
    kind: 'dimensions',
    metersPerPoint: mpp,
    rect: { x: x0, y: y0, w: Math.max(...group.map((r) => r.w.x1)) - x0, h: Math.max(...group.map((r) => r.w.y1)) - y0 },
    text: `${group.length} dimensions`,
    count: group.length,
    assumed: true,
  };
}

/**
 * What the page's own lengths say about a proposed scale:
 * - `agrees`: a scale bar or a group of dimensions measures within 1.5% of it.
 * - `disagrees`: a scale bar, or a group of at least five dimensions, measures otherwise and none
 *   agrees. `reading` is the one closest to the proposal.
 * - `none`: nothing on the page states a length.
 */
export interface ScaleCheck {
  result: 'agrees' | 'disagrees' | 'none';
  reading?: ScaleReading;
  /** Reading ÷ proposal (2 when the page measures at twice the proposed length per point). */
  ratio?: number;
}

export function checkScale(proposed: Scale, readings: readonly ScaleReading[]): ScaleCheck {
  const ratio = (r: ScaleReading) => r.metersPerPoint / proposed.metersPerPoint;
  const off = (r: ScaleReading) => Math.abs(Math.log(ratio(r)));
  const sorted = [...readings].sort((a, b) => off(a) - off(b));
  const agree = sorted.find((r) => off(r) < Math.log(1.015));
  if (agree) return { result: 'agrees', reading: agree, ratio: ratio(agree) };
  const against = sorted.find((r) => r.kind === 'bar' || (r.count ?? 0) >= 5);
  return against ? { result: 'disagrees', reading: against, ratio: ratio(against) } : { result: 'none' };
}

/** Every reading on a page: its scale bars, then its dimensions when there are enough. */
export function pageReadings(words: readonly Word[], segments: ArrayLike<number> | null, unit: LengthUnit): ScaleReading[] {
  const metric = unit === 'mm' || unit === 'cm' || unit === 'm' || unit === 'km';
  const bars = scaleBars(words, metric ? 'm' : 'ft');
  const dims = metric && segments ? dimensionScale(words, segments) : null;
  return dims ? [...bars, dims] : bars;
}
