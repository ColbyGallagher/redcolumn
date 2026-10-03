/**
 * Form calculations and formats, in the form Acrobat and Revu write them into a PDF: small
 * JavaScript calls to the standard AF* functions. We don't run JavaScript; we recognise these
 * calls, work them out ourselves, and write the same calls back so other readers keep working.
 */

export type CalcOp = 'SUM' | 'PRD' | 'AVG' | 'MIN' | 'MAX';

export interface Calculation {
  op: CalcOp;
  fields: string[];
}

export type FieldFormat =
  | { kind: 'number'; decimals: number; separator: boolean; currency: string; currencyFirst: boolean; negativeParens: boolean }
  | { kind: 'percent'; decimals: number }
  | { kind: 'date'; pattern: string };

export const CALC_LABELS: Record<CalcOp, string> = { SUM: 'Sum (+)', PRD: 'Product (×)', AVG: 'Average', MIN: 'Minimum', MAX: 'Maximum' };

const strings = (s: string) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1'));

/** `AFSimple_Calculate("SUM", new Array("a", "b"))` (or with `["a","b"]`, or a comma list in one string). */
export function parseCalculation(js: string): Calculation | null {
  const m = /AFSimple_Calculate\s*\(\s*["'](SUM|PRD|AVG|MIN|MAX)["']\s*,([\s\S]*)\)/.exec(js);
  if (!m) return null;
  let fields = strings(m[2]!);
  // A single string can list the fields, separated by commas.
  if (fields.length === 1 && fields[0]!.includes(',')) fields = fields[0]!.split(',');
  fields = fields.map((f) => f.trim()).filter(Boolean);
  return { op: m[1] as CalcOp, fields };
}

const q = (s: string) => JSON.stringify(s);

export function calculationScript(c: Calculation): string {
  return `AFSimple_Calculate(${q(c.op)}, new Array(${c.fields.map(q).join(', ')}));`;
}

/** Format scripts: AFNumber_Format, AFPercent_Format, AFDate_FormatEx (or AFDate_Format's numbered patterns). */
export function parseFormat(js: string): FieldFormat | null {
  let m = /AFNumber_Format\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*["']((?:[^"'\\]|\\.)*)["']\s*,\s*(true|false)/.exec(js);
  if (m) return { kind: 'number', decimals: Number(m[1]), separator: m[2] === '0' || m[2] === '2', negativeParens: m[3] === '2' || m[3] === '3', currency: m[5]!, currencyFirst: m[6] === 'true' };
  m = /AFPercent_Format\s*\(\s*(\d+)/.exec(js);
  if (m) return { kind: 'percent', decimals: Number(m[1]) };
  m = /AFDate_FormatEx\s*\(\s*["']([^"']+)["']/.exec(js);
  if (m) return { kind: 'date', pattern: m[1]! };
  m = /AFDate_Format\s*\(\s*(\d+)/.exec(js);
  if (m) return { kind: 'date', pattern: ['m/d', 'm/d/yy', 'mm/dd/yy', 'mm/yy', 'd-mmm', 'd-mmm-yy', 'dd-mmm-yy', 'yy-mm-dd', 'mmm-yy', 'mmmm-yy', 'mmm d, yyyy', 'mmmm d, yyyy', 'm/d/yy h:MM tt', 'm/d/yy HH:MM'][Number(m[1])] ?? 'mm/dd/yyyy' };
  return null;
}

/** The format script and the matching keystroke script (which Acrobat expects alongside it). */
export function formatScripts(f: FieldFormat): { format: string; keystroke: string } {
  if (f.kind === 'number') {
    const args = `${f.decimals}, ${f.separator ? 0 : 1}, ${f.negativeParens ? 2 : 0}, 0, ${q(f.currency)}, ${f.currencyFirst}`;
    return { format: `AFNumber_Format(${args});`, keystroke: `AFNumber_Keystroke(${args});` };
  }
  if (f.kind === 'percent') return { format: `AFPercent_Format(${f.decimals}, 0);`, keystroke: `AFPercent_Keystroke(${f.decimals}, 0);` };
  return { format: `AFDate_FormatEx(${q(f.pattern)});`, keystroke: `AFDate_KeystrokeEx(${q(f.pattern)});` };
}

/** A number from what someone typed: "1,234.50", "$12", "(3)" and "45%" all read. Null if none. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /^-/.test(t.replace(/^[^\d-]+/, ''));
  const digits = t.replace(/[^\d.]/g, '');
  if (!digits || digits === '.') return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return (negative ? -n : n) / (t.endsWith('%') ? 100 : 1);
}

/** Works out a calculation from other fields' values; blank fields count as 0 (as in Acrobat), except for AVG, MIN and MAX. */
export function calculate(c: Calculation, valueOf: (name: string) => string): number {
  const all = c.fields.map((f) => parseNumber(valueOf(f)));
  const nums = all.filter((n): n is number => n !== null);
  switch (c.op) {
    case 'SUM':
      return nums.reduce((a, b) => a + b, 0);
    case 'PRD':
      return all.reduce<number>((a, b) => a * (b ?? 0), all.length ? 1 : 0);
    case 'AVG':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'MIN':
      return nums.length ? Math.min(...nums) : 0;
    case 'MAX':
      return nums.length ? Math.max(...nums) : 0;
  }
}

/** A calculated number as it is stored: plain, with no more decimals than needed. */
export const numberValue = (n: number) => String(Math.round(n * 1e10) / 1e10);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Reads a date typed as ISO (2026-09-29), d/m/y or m/d/y (by the pattern's order), or "29 Sep 2026". */
export function parseDate(text: string, pattern = 'mm/dd/yyyy'): Date | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    const dayFirst = pattern.toLowerCase().indexOf('d') < pattern.toLowerCase().indexOf('m');
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    let y = Number(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return new Date(y, mo - 1, d);
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(t) ?? null;
  if (m) {
    const mo = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m![2]!.toLowerCase().slice(0, 3)));
    if (mo >= 0) return new Date(Number(m[3]), mo, Number(m[1]));
  }
  return null;
}

function formatDate(d: Date, pattern: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return pattern.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d|HH|MM|h|tt/g, (tok) => {
    switch (tok) {
      case 'yyyy':
        return String(d.getFullYear());
      case 'yy':
        return pad(d.getFullYear() % 100);
      case 'mmmm':
        return MONTHS[d.getMonth()]!;
      case 'mmm':
        return MONTHS[d.getMonth()]!.slice(0, 3);
      case 'mm':
        return pad(d.getMonth() + 1);
      case 'm':
        return String(d.getMonth() + 1);
      case 'dd':
        return pad(d.getDate());
      case 'd':
        return String(d.getDate());
      case 'HH':
        return pad(d.getHours());
      case 'MM':
        return pad(d.getMinutes());
      case 'h':
        return String(d.getHours() % 12 || 12);
      case 'tt':
        return d.getHours() < 12 ? 'am' : 'pm';
      default:
        return tok;
    }
  });
}

/** How a value is shown: formatted by the field's format, else as it is. */
export function displayValue(value: string, f: FieldFormat | null): string {
  if (!f || !value.trim()) return value;
  if (f.kind === 'date') {
    const d = parseDate(value, f.pattern);
    return d ? formatDate(d, f.pattern) : value;
  }
  const n = parseNumber(value);
  if (n === null) return value;
  if (f.kind === 'percent') return `${(n * 100).toFixed(f.decimals)}%`;
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals, useGrouping: f.separator });
  const money = f.currency ? (f.currencyFirst ? `${f.currency}${abs}` : `${abs}${f.currency}`) : abs;
  return n < 0 ? (f.negativeParens ? `(${money})` : `-${money}`) : money;
}

/**
 * Recalculates every calculated field, in calculation order, until nothing changes (a total of
 * totals settles in two passes). Returns the fields whose values changed.
 */
export function recalculate(order: readonly string[], calcs: ReadonlyMap<string, Calculation>, values: Map<string, string>): Map<string, string> {
  const changed = new Map<string, string>();
  const names = [...order.filter((n) => calcs.has(n)), ...[...calcs.keys()].filter((n) => !order.includes(n))];
  for (let pass = 0; pass < names.length + 1; pass++) {
    let any = false;
    for (const name of names) {
      const v = numberValue(calculate(calcs.get(name)!, (f) => values.get(f) ?? ''));
      if (values.get(name) !== v) {
        values.set(name, v);
        changed.set(name, v);
        any = true;
      }
    }
    if (!any) break;
  }
  return changed;
}
