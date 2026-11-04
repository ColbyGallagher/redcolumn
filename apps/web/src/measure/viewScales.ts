import { parseScaleText, type Scale } from '@nb/measure';
import { textLines, type Word } from '@nb/sheets';

/**
 * Viewports proposed from a sheet's view titles. Sheets marked AS SHOWN, and sheets with details at
 * another scale, say each view's scale under (or beside) the view: `SCALE 1:100`, `DETAIL 3 1:20`,
 * `HORIZONTAL SCALE 1:500` with `VERTICAL SCALE 1:100`. Each title is paired with the drawing it
 * labels (the biggest block of linework just above it) and a viewport is proposed over that block.
 */

type Rect = { x: number; y: number; w: number; h: number };

/** A view's scale as written on the sheet, with the axis it is for when it gives one. */
export interface ViewLabel {
  text: string;
  scale: Scale;
  axis?: 'x' | 'y';
  rect: Rect;
}

/** A viewport to propose: a name for people, where it is and its scale (as written, before any resize). */
export interface ViewProposal {
  name: string;
  rect: Rect;
  scale: Scale;
}

const RATIO = String.raw`1 ?: ?[\d,]{1,7}`;

/**
 * View titles holding a scale: lines with `SCALE` and a scale on them, or a view name ending in a
 * ratio (`DETAIL 3 1:20`, `SECTION A-A 1:50`). `HORIZONTAL`/`H` and `VERTICAL`/`V` give the axis;
 * `H 1:500 V 1:100` on one line gives both.
 */
export function viewLabels(words: readonly Word[]): ViewLabel[] {
  const out: ViewLabel[] = [];
  for (const line of textLines(words)) {
    const t = line.text.toUpperCase().replace(/\s+/g, ' ').trim();
    const rect = { x: line.x0, y: line.y0, w: line.x1 - line.x0, h: line.y1 - line.y0 };
    const both = new RegExp(String.raw`\bH(?:ORIZ\w*)?\.? ?(?:SCALE)? ?:? ?(${RATIO}).*\bV(?:ERT\w*)?\.? ?(?:SCALE)? ?:? ?(${RATIO})`).exec(t);
    if (both) {
      const [x, y] = [parseScaleText(both[1]!), parseScaleText(both[2]!)];
      if (x && y) out.push({ text: t, scale: x, axis: 'x', rect }, { text: t, scale: y, axis: 'y', rect });
      continue;
    }
    const scaled = new RegExp(String.raw`\bSCALE ?:? ?(${RATIO}|\d[^ ]*" ?= ?[^ ]+)`).exec(t) ?? new RegExp(String.raw`^(?:DETAIL|SECTION|PLAN|ELEVATION|VIEW)\b.* (${RATIO})$`).exec(t);
    const scale = scaled ? parseScaleText(scaled[1]!) : null;
    if (!scale) continue;
    const axis = /\bHORIZ/.test(t) ? 'x' : /\bVERT/.test(t) ? 'y' : undefined;
    out.push({ text: t, scale, ...(axis ? { axis } : {}), rect });
  }
  return out;
}

const CELL = (4 * 72) / 25.4;

/**
 * Where the drawing is: inside the sheet's frame (its outermost long rules) and outside the title
 * block, found from the long rules between the frame and the sheet number (a strip down the right,
 * or a band along the bottom). Without a number, the frame alone.
 */
export function drawingArea(page: { width: number; height: number }, segments: ArrayLike<number>, number: Rect | null): Rect {
  const { width: W, height: H } = page;
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (let s = 0; s + 3 < segments.length; s += 4) {
    const [x1, y1, x2, y2] = [segments[s]!, segments[s + 1]!, segments[s + 2]!, segments[s + 3]!];
    if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) > H * 0.7) vertical.push((x1 + x2) / 2);
    if (Math.abs(y2 - y1) < 1 && Math.abs(x2 - x1) > W * 0.7) horizontal.push((y1 + y2) / 2);
  }
  const edge = (list: number[], from: number, to: number, pick: (...v: number[]) => number, fallback: number) => {
    const inside = list.filter((v) => v >= from && v <= to);
    return inside.length ? pick(...inside) : fallback;
  };
  let left = edge(vertical, 0, W * 0.15, Math.min, 0);
  let right = edge(vertical, W * 0.85, W, Math.max, W);
  let top = edge(horizontal, 0, H * 0.15, Math.min, 0);
  let bottom = edge(horizontal, H * 0.85, H, Math.max, H);
  if (number) {
    const strip = vertical.filter((x) => x > W * 0.5 && x < number.x);
    const band = horizontal.filter((y) => y > H * 0.5 && y < number.y);
    if (number.x > W * 0.6 && strip.length) right = Math.min(...strip);
    else if (number.y > H * 0.6 && band.length) bottom = Math.min(...band);
  }
  [left, right] = [Math.min(left, right), Math.max(left, right)];
  [top, bottom] = [Math.min(top, bottom), Math.max(top, bottom)];
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Linework cells in the drawing area: segments rasterised into 4 mm cells. Rules longer than half
 * the area (its frame, the title block's edge) are left out, so views are fitted to their drawings.
 */
function filledCells(area: Rect, segments: ArrayLike<number>): { cols: number; rows: number; filled: Uint8Array } {
  const cols = Math.max(1, Math.ceil(area.w / CELL));
  const rows = Math.max(1, Math.ceil(area.h / CELL));
  const filled = new Uint8Array(cols * rows);
  const longest = Math.max(area.w, area.h) / 2;
  for (let s = 0; s + 3 < segments.length; s += 4) {
    const [x1, y1, x2, y2] = [segments[s]!, segments[s + 1]!, segments[s + 2]!, segments[s + 3]!];
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length > longest) continue;
    const steps = Math.max(1, Math.ceil(length / (CELL / 2)));
    for (let k = 0; k <= steps; k++) {
      const c = Math.floor((x1 + ((x2 - x1) * k) / steps - area.x) / CELL);
      const r = Math.floor((y1 + ((y2 - y1) * k) / steps - area.y) / CELL);
      if (c >= 0 && c < cols && r >= 0 && r < rows) filled[r * cols + c] = 1;
    }
  }
  return { cols, rows, filled };
}

/** One view: its titles (one, or a horizontal and vertical pair) and where they sit. */
interface View {
  labels: ViewLabel[];
  at: readonly [number, number];
}

/**
 * Viewports for a page's view titles. Titles inside the drawing area are grouped into views (a
 * vertical scale joins the horizontal one written next to it); each view takes the linework nearer
 * its title than any other's, counting linework below a title as three times as far (titles go
 * under views), and the viewport is fitted to that linework. A sheet with one view gets the whole
 * drawing area. Titles at `except` (the page's own scale, without an axis) are skipped, since
 * those views already measure right. `number` is where the sheet number is printed, which tells
 * the title block from the drawing.
 */
export function proposeViews(page: { width: number; height: number }, words: readonly Word[], segments: ArrayLike<number>, except: Scale | null, number: Rect | null = null): ViewProposal[] {
  const area = drawingArea(page, segments, number);
  const inArea = (r: Rect) => r.x + r.w / 2 >= area.x && r.x + r.w / 2 <= area.x + area.w && r.y + r.h / 2 >= area.y && r.y + r.h / 2 <= area.y + area.h;
  const labels = viewLabels(words).filter((l) => inArea(l.rect) && (l.axis || !except || Math.abs(l.scale.metersPerPoint / except.metersPerPoint - 1) > 0.005));
  if (!labels.length) return [];
  const centre = (r: Rect) => [r.x + r.w / 2, r.y + r.h / 2] as const;
  const reach = (45 * 72) / 25.4;
  const views: View[] = [];
  for (const l of labels.filter((l) => l.axis !== 'y')) views.push({ labels: [l], at: centre(l.rect) });
  for (const l of labels.filter((l) => l.axis === 'y')) {
    const [x, y] = centre(l.rect);
    const near = views.filter((v) => v.labels.some((o) => o.axis === 'x') && !v.labels.some((o) => o.axis === 'y')).map((v) => ({ v, d: Math.hypot(v.at[0] - x, v.at[1] - y) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= reach) near.v.labels.push(l);
    else views.push({ labels: [l], at: [x, y] });
  }
  // Views with the same scales close together (one detail's title and its scale bar title) are one.
  const merged: View[] = [];
  const key = (v: View) => v.labels.map((l) => `${l.axis ?? ''}${l.scale.metersPerPoint.toPrecision(6)}`).sort().join();
  for (const v of views) {
    const same = merged.find((m) => key(m) === key(v) && Math.hypot(m.at[0] - v.at[0], m.at[1] - v.at[1]) <= reach);
    if (same) same.labels.push(...v.labels);
    else merged.push(v);
  }
  const { cols, rows, filled } = filledCells(area, segments);
  const boxes = merged.map(() => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!filled[r * cols + c]) continue;
      const [x, y] = [area.x + (c + 0.5) * CELL, area.y + (r + 0.5) * CELL];
      let best = 0;
      let bestD = Infinity;
      merged.forEach((v, i) => {
        const dy = y - v.at[1];
        const d = Math.hypot(x - v.at[0], dy > 0 ? dy * 3 : dy);
        if (d < bestD) [best, bestD] = [i, d];
      });
      const b = boxes[best]!;
      [b.x0, b.y0, b.x1, b.y1] = [Math.min(b.x0, x - CELL / 2), Math.min(b.y0, y - CELL / 2), Math.max(b.x1, x + CELL / 2), Math.max(b.y1, y + CELL / 2)];
    }
  const out: ViewProposal[] = [];
  merged.forEach((v, i) => {
    const x = v.labels.filter((l) => l.axis !== 'y');
    const y = v.labels.filter((l) => l.axis === 'y');
    const base = (x[0] ?? y[0])!.scale;
    const scale: Scale = x.length && y.length ? { ...base, yMetersPerPoint: y[0]!.scale.metersPerPoint, label: `H ${base.label} V ${y[0]!.scale.label}` } : base;
    const b = merged.length === 1 ? { x0: area.x, y0: area.y, x1: area.x + area.w, y1: area.y + area.h } : boxes[i]!;
    if (!(b.x1 > b.x0)) return;
    out.push({ name: v.labels[0]!.text, rect: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, scale });
  });
  return out.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}
