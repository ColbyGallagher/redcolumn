import { DEFAULT_SCALE, formatMeasure, isMeasureKind, measureValue, QUANTITY, type MeasureKind, type Scale } from '@nb/measure';
import { contentBox, MARKUP_LABELS, measureProps, type Markup, type Point, type Rect } from './model';
import { TYPE_INFO } from './types';

/** One line of a legend: a kind of markup (type, subject and look), how many and how much. */
export interface LegendRow {
  key: string;
  /** A markup of this kind, for drawing its symbol. */
  sample: Markup;
  label: string;
  count: number;
  /** Total measurement at the legend page's scale, or '' for markups that do not measure. */
  measure: string;
}

/** Measurements whose values add up: lengths, areas and volumes (not counts or angles). */
function totals(m: Markup): m is Markup & { type: MeasureKind } {
  if (!isMeasureKind(m.type)) return false;
  const q = QUANTITY[m.type];
  return q === 'length' || q === 'area' || q === 'volume';
}

/** Markups a legend lists: not legends themselves, signatures or pictures. */
function listed(m: Markup): boolean {
  return !m.legendHidden && m.type !== 'legend' && m.type !== 'signature' && m.type !== 'image' && m.type !== 'space' && m.type !== 'redaction';
}

/**
 * The rows of a legend: the markups on its page (or the whole document), one row per type,
 * subject and colour, in the order each first appears.
 */
export function legendRows(
  legend: Markup,
  all: readonly Markup[],
  scaleFor: (pageIndex: number) => Scale = () => DEFAULT_SCALE,
  scaleOf: (m: Markup) => Scale = (m) => scaleFor(m.pageIndex),
): LegendRow[] {
  const scope = legend.legend?.scope ?? 'page';
  const rows = new Map<string, LegendRow & { meters: number }>();
  for (const m of [...all].sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt)) {
    if (!listed(m) || (scope === 'page' && m.pageIndex !== legend.pageIndex)) continue;
    const key = `${m.type}|${m.subject ?? ''}|${m.style.stroke}|${m.style.fill ?? ''}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, sample: m, label: m.subject || MARKUP_LABELS[m.type], count: 0, measure: '', meters: 0 };
      rows.set(key, row);
    }
    // A count markup holds one point per item counted.
    row.count += m.type === 'count' ? m.points.length : 1;
    if (totals(m)) row.meters += measureValue(m.type, m.points, scaleOf(m).metersPerPoint, measureProps(m), scaleOf(m).yMetersPerPoint);
  }
  const scale = scaleFor(legend.pageIndex);
  return [...rows.values()].map(({ meters, ...row }) =>
    totals(row.sample) ? { ...row, measure: formatMeasure(row.sample.type, meters, scale) } : row,
  );
}

/** Where a legend's parts go in its box: a title band, then one band per row. */
export interface LegendLayout {
  box: Rect;
  fontSize: number;
  title: { x: number; y: number };
  rows: { y: number; h: number; symbol: Rect; labelX: number; countX: number; measureX: number }[];
}

export function legendLayout(m: Markup, rowCount: number): LegendLayout {
  const box = contentBox(m);
  const bands = rowCount + 1;
  const h = box.h / bands;
  const fontSize = Math.min(m.style.fontSize ?? 10, h * 0.6);
  const pad = fontSize * 0.5;
  const symbolW = Math.min(h * 1.6, box.w * 0.2);
  return {
    box,
    fontSize,
    title: { x: box.x + pad, y: box.y + h / 2 },
    rows: Array.from({ length: rowCount }, (_, i) => {
      const y = box.y + h * (i + 1);
      return {
        y,
        h,
        symbol: { x: box.x + pad, y: y + h * 0.2, w: symbolW, h: h * 0.6 },
        labelX: box.x + pad * 2 + symbolW,
        countX: box.x + box.w * 0.62,
        measureX: box.x + box.w - pad,
      };
    }),
  };
}

/** A small copy of a row's markup drawn inside `r`, for the legend's symbol column. */
export function legendSymbol(sample: Markup, r: Rect): Markup {
  const info = TYPE_INFO[sample.type];
  const { x, y, w, h } = r;
  const mid = y + h / 2;
  let points: Point[];
  if (sample.type === 'count') points = [[x + w / 2, mid]];
  else if (sample.type === 'callout') points = [[x, y + h], [x + w * 0.3, mid], [x + w * 0.45, y], [x + w, y + h * 0.7]];
  else if (info.draw === 'text') points = [[x, y + h * 0.25], [x + w, y + h * 0.75]];
  else if (info.closed || info.content || info.draw === 'place')
    points = info.draw === 'click' ? [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] : [[x, y], [x + w, y + h]];
  else if (info.draw === 'freehand') points = Array.from({ length: 9 }, (_, i) => [x + (w * i) / 8, mid + Math.sin(i) * h * 0.35] as Point);
  else if (sample.type === 'radius') points = [[x + w / 2, mid], [x + w / 2 + h * 0.45, mid]];
  else if (sample.type === 'diameter') points = [[x + w / 2 - h * 0.45, mid], [x + w / 2 + h * 0.45, mid]];
  else if (sample.type === 'arc' || sample.type === 'angle' || sample.type === 'arcLength') points = [[x, y + h], [x + w / 2, y], [x + w, y + h]];
  else if (info.draw === 'click') points = [[x, y + h], [x + w * 0.5, y], [x + w, y + h * 0.6]];
  else points = [[x, mid], [x + w, mid]];
  const style = { ...sample.style, width: Math.min(sample.style.width, h * 0.2), showLabel: false, arcRadius: Math.min(h * 0.3, sample.style.arcRadius ?? h * 0.3), leader: undefined };
  return { ...sample, points, holes: undefined, style, text: info.content === 'text' ? 'Aa' : sample.text, replies: undefined };
}
