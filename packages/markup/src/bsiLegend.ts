import { DEFAULT_SCALE, isMeasureKind, measureValue, toDisplayQuantity, type MeasureKind, type Scale } from '@nb/measure';
import { arr, dict, num, PdfName, PdfRefNum, str, type PdfDictValue, type PdfValue } from './bluebeam';
import { CLOUD_PLUS_CLOUD_TYPE, CLOUD_PLUS_TYPE, CLOUD_TYPE, cloudPlusGroups, legendKeyOf } from './bluebeamTypes';
import { inLegendKeys, listed, onLegendPage } from './legend';
import { measureProps, type Markup } from './model';
import { lineEnds, type LineEnding } from './style';

/** JSON-like values, as Bluebeam's legend dictionary is kept in a markup. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Bluebeam stores colours as signed ARGB integers. */
function colorInt(hex: string | null | undefined): number {
  const n = parseInt((hex ?? '#000000').replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return (0xff000000 | n) | 0;
}

/** Bluebeam's line ending numbers: 3 an open arrow, 4 a closed one, 5 none. */
function endNumber(cap: LineEnding): number {
  if (cap === 'openArrow') return 3;
  if (cap === 'closedArrow' || cap === 'filledArrow') return 4;
  return 5;
}

const SHAPES = new Set([9, 10, 11, 13, 14, 15, 17, 43, 36, 37, 41, 46, 53]);
const POLYS = new Set([12, 16, 55, 39, 40]);
const LINES = new Set([6, 8, 7, 45]);

/** One legend key: the kind of markup it counts and the look its symbol is drawn with. */
function keyFor(type: number, subject: string, unit: string, sample: Markup, cloud?: Markup): Record<string, Json> {
  const s = sample.style;
  const stroke = colorInt(s.stroke);
  const fill = colorInt(s.fill ?? s.stroke);
  const text = colorInt(s.textColor ?? s.stroke);
  const hatch = { HatchColor: colorInt(s.hatchColor ?? s.stroke), HatchScale: (s.hatchScale ?? 100) / 100 };
  const [startCap, endCap] = lineEnds(sample);
  const ends = { StartLine: endNumber(startCap), EndLine: endNumber(endCap), StartLineScale: 0, EndLineScale: 0 };
  const out: Record<string, Json> = { Type: type, AdditionalData: [subject, '', unit] };
  if (SHAPES.has(type)) {
    Object.assign(out, { Color: stroke, BorderWidth: s.width, ...(type === CLOUD_TYPE || type === CLOUD_PLUS_CLOUD_TYPE ? { BorderEffect: 1, BorderEffectIntensity: 2 } : {}), BlendMode: 0, OpacityFill: s.opacity, ...hatch });
  } else if (POLYS.has(type)) {
    Object.assign(out, { Color: stroke, FillColor: fill, BorderWidth: s.width, BlendMode: 0, OpacityFill: s.opacity, ...hatch, ...ends });
  } else if (LINES.has(type)) {
    Object.assign(out, { Color: stroke, ...(type === 6 ? {} : { FillColor: fill }), BorderWidth: s.width, BlendMode: 0, LineType: type === 6 ? 0 : type === 8 ? 1 : 2, ...ends });
  } else if (type === 18) Object.assign(out, { Color: stroke, BorderWidth: s.width, BlendMode: 1 });
  else if (type === 24) Object.assign(out, { Color: stroke, BorderWidth: s.width, BlendMode: 0 });
  else if (type === 0) Object.assign(out, { Color: fill, BorderWidth: s.width });
  else if (type === 2 || type === 3) Object.assign(out, { OpacityFill: s.opacity, LineColor: stroke, TextColor: text, FreeTextType: type === 2 ? 0 : 2, FreeTextShape: 0, FontSize: s.fontSize ?? 12 });
  else if (type === 4 || type === CLOUD_PLUS_TYPE) {
    Object.assign(out, { OpacityFill: s.opacity, EndLine: endNumber(endCap), EndLineScale: 0, LineColor: stroke, LineEndColor: 16777215, TextColor: text, FreeTextType: type === 4 ? 1 : 4, FontSize: s.fontSize ?? 12 });
    if (cloud) out.Subkeys = [keyFor(CLOUD_PLUS_CLOUD_TYPE, subject, unit, cloud)];
  } else if (type === 5) Object.assign(out, { Color: fill, FillColor: fill, OpacityFill: s.fillOpacity ?? s.opacity, LineColor: stroke, TextColor: text, FreeTextType: 3, FontSize: s.fontSize ?? 8 });
  else if (type === 35) Object.assign(out, { Color: stroke, BlendMode: 0, OpacityFill: s.opacity, ...hatch });
  else if (type === 38) Object.assign(out, { Color: stroke, CountStyle: 4, CountScale: 1 });
  else Object.assign(out, { Color: stroke });
  return out;
}

/** A unit as Bluebeam's legend writes it. */
function unitLabel(unit: string): string {
  return unit === 'deg' ? '°' : unit === 'ea' ? 'Count' : unit;
}

/** A key as Bluebeam wrote it, its unit brought in line with the totals computed here. */
function withUnit(key: Json, unit: string): Json {
  const k = key as { [name: string]: Json };
  const data = k.AdditionalData;
  return Array.isArray(data) && data.length >= 3 && data[2] !== unit ? { ...k, AdditionalData: [data[0]!, data[1]!, unit] } : key;
}

/** Sixteen capital letters from the legend's id: Bluebeam's name for the legend. */
function nameIdOf(id: string): string {
  let h = 2166136261;
  let out = '';
  for (let i = 0; out.length < 16; i++) {
    h = Math.imul(h ^ (id.charCodeAt(i % id.length) + i), 16777619) >>> 0;
    out += String.fromCharCode(65 + (h % 26));
  }
  return out;
}

/**
 * Bluebeam's own record of a legend (/BSILegend): its settings, one key per kind of markup it
 * counts, and the current totals. With it Bluebeam keeps the legend up to date as markups change,
 * as it does its own. Kinds Bluebeam has no key for (text markup, spaces, ...) are left out.
 */
export function bsiLegendValue(
  legend: Markup,
  all: readonly Markup[],
  pageCount: number,
  scaleFor: (pageIndex: number) => Scale = () => DEFAULT_SCALE,
  scaleOf: (m: Markup) => Scale = (m) => scaleFor(m.pageIndex),
): Json {
  const scope = legend.legend?.scope ?? 'page';
  const plus = cloudPlusGroups(all);
  interface Row {
    type: number;
    subject: string;
    sample: Markup | null;
    cloud: Markup | null;
    count: number;
    measured: MeasureKind | null;
    amount: number;
    key: unknown;
  }
  const rows = new Map<string, Row>();
  const at = (type: number, subject: string, key?: unknown): Row => {
    const id = `${type}|${subject}`;
    let row = rows.get(id);
    if (!row) rows.set(id, (row = { type, subject, sample: null, cloud: null, count: 0, measured: null, amount: 0, key }));
    return row;
  };
  // A legend that came from Bluebeam lists its keys in its order, even those nothing matches now.
  for (const k of legend.legend?.keys ?? []) at(k.type, k.subject, k.key);
  for (const m of [...all].sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt)) {
    if (!listed(m, legend) || !onLegendPage(legend, m.pageIndex) || !inLegendKeys(legend, m, plus)) continue;
    const k = legendKeyOf(m, plus);
    if (!k) continue;
    const row = at(k.type, k.subject);
    if (k.type === CLOUD_PLUS_TYPE) {
      // The callout leads the pair; the cloud only gives the key its sub-key.
      if (m.type === 'cloud') row.cloud ??= m;
      else {
        row.sample ??= m;
        row.count += 1;
      }
      continue;
    }
    row.sample ??= m;
    const kind: string = m.type;
    if (isMeasureKind(kind) && kind !== 'arcLength') {
      row.measured = kind;
      if (kind === 'count') row.count += m.points.length;
      else row.amount += measureValue(kind, m.points, scaleOf(m).metersPerPoint, measureProps(m), scaleOf(m).yMetersPerPoint);
    } else row.count += 1;
  }
  const scale = scaleFor(legend.pageIndex);
  const keys: Json[] = [];
  const sums: number[] = [];
  for (const row of rows.values()) {
    let unit = 'Count';
    let quantity = row.count;
    if (row.measured && row.measured !== 'count') {
      const q = toDisplayQuantity(row.measured, row.amount, scale);
      unit = unitLabel(q.unit);
      quantity = Math.round(q.value * 100) / 100;
    }
    sums.push(quantity);
    if (row.key) keys.push(withUnit(row.key as Json, unit));
    else if (row.sample) keys.push(keyFor(row.type, row.subject, unit, row.sample, row.cloud ?? undefined));
  }
  return {
    MajorVersion: 1,
    MinorVersion: 0,
    NameID: legend.legend?.nameId ?? nameIdOf(legend.id),
    Title: 'Legend',
    DescriptionColumn: 'Subject',
    AdditionalColumns: ['DescriptionColumn', 'QuantityColumn', 'Units'],
    PageRangeType: 2,
    PageRange: legend.legend?.pages ?? (scope === 'document' ? Array.from({ length: pageCount }, (_, i) => i) : [legend.pageIndex]),
    Keys: keys,
    Sums: { QuantityColumn: sums },
  };
}

/** A raw PDF value as plain JSON (names become strings, references nothing). */
function plain(v: PdfValue | undefined): Json {
  if (v instanceof PdfName) return v.name;
  if (v instanceof PdfRefNum || v === undefined) return null;
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x as PdfValue)]));
  return v;
}

/** What a Bluebeam legend annotation says about which markups it lists and where. */
export function readBsiLegend(raw: PdfDictValue): { scope: 'page' | 'document'; pages: number[]; nameId?: string; keys: { type: number; subject: string; key: unknown }[] } | null {
  const legend = dict(raw.BSILegend);
  if (!legend) return null;
  const keys = arr(legend.Keys).flatMap((v) => {
    const k = dict(v);
    const type = num(k?.Type);
    const subject = str(arr(k?.AdditionalData)[0]);
    return k && type !== null && subject !== null ? [{ type, subject, key: plain(k) }] : [];
  });
  const pages = arr(legend.PageRange).flatMap((p) => (typeof p === 'number' ? [p] : []));
  const nameId = str(legend.NameID);
  return { scope: pages.length > 1 ? 'document' : 'page', pages, ...(nameId ? { nameId } : {}), keys };
}
