/**
 * Numbers as people read and type them: `1,234.5` in the US, `1.234,5` in Germany, `1 234,5` in
 * France. Preferences › General › Number Format sets the locale once, at start-up, like the
 * interface language (it can differ from it: an English interface with decimal commas is common).
 *
 * Only for text people read. Numbers written into files (PDF operators, JSON, CSV values) keep
 * JavaScript's own format.
 */

let current = 'en-US';

/** The locale `setNumberLocale(locale)` would use: the supported form of the tag, else US English. */
export function supportedNumberLocale(locale: string): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale])[0] ?? 'en-US';
  } catch {
    // Not a valid language tag.
    return 'en-US';
  }
}

/** Sets the locale numbers are shown and read in. */
export function setNumberLocale(locale: string): void {
  current = supportedNumberLocale(locale);
}

/** The locale numbers are shown and read in. */
export function numberLocale(): string {
  return current;
}

/**
 * The locale with Latin digits: Arabic (Egypt) and Persian systems default to their own digits,
 * which typed input and the rest of the app don't read. The separators still follow the locale.
 */
function latin(locale: string): string {
  if (!/-u-/.test(locale)) return `${locale}-u-nu-latn`;
  // Other Unicode extensions (a calendar, say) stay; the numbering system is always Latin.
  return /-nu-[a-z0-9]+/i.test(locale) ? locale.replace(/-nu-[a-z0-9]+/i, '-nu-latn') : locale.replace('-u-', '-u-nu-latn-');
}

const formats = new Map<string, Intl.NumberFormat>();

/**
 * `value` formatted for people, in `locale` (the number locale by default), always with Latin digits.
 * French's narrow no-break space between digit groups becomes a plain no-break space: the standard
 * PDF fonts that draw labels into saved files have no narrow one.
 */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}, locale = current): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(latin(locale), options);
    formats.set(key, f);
  }
  return f.format(value).replace(/\u202f/g, '\u00a0');
}

/** 0 for a value that rounds to zero at `digits` decimals, so it shows as 0 rather than -0. */
function noNegativeZero(value: number, digits: number): number {
  return Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
}

/** Like `toFixed`, in the number locale: exactly `digits` decimals, with digit groups unless `grouping` is false. */
export function formatFixed(value: number, digits: number, grouping = true, locale = current): string {
  return formatNumber(noNegativeZero(value, digits), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: grouping }, locale);
}

/** Up to `digits` decimals with trailing zeros dropped (`String(+v.toFixed(d))`), in the number locale. */
export function formatTrimmed(value: number, digits: number, grouping = false, locale = current): string {
  return formatNumber(noNegativeZero(value, digits), { maximumFractionDigits: digits, useGrouping: grouping }, locale);
}

const separatorCache = new Map<string, { decimal: string; group: string }>();

/** The locale's decimal and digit-group characters (with Latin digits). */
export function numberSeparators(locale = current): { decimal: string; group: string } {
  let s = separatorCache.get(locale);
  if (!s) {
    const parts = new Intl.NumberFormat(latin(locale), { useGrouping: true }).formatToParts(12345.6);
    s = { decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.', group: parts.find((p) => p.type === 'group')?.value ?? ',' };
    separatorCache.set(locale, s);
  }
  return s;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patterns = new Map<string, { grouped: RegExp; mark: RegExp; decimal: RegExp | null }>();

function patternsFor(locale: string) {
  let p = patterns.get(locale);
  if (!p) {
    const { decimal, group } = numberSeparators(locale);
    // Space-grouped locales (French, Russian…) are typed with a plain space as well as shown with a
    // no-break one; Swiss groups are written with either apostrophe.
    const marks = /\s/.test(group) ? ['\u00a0', '\u202f', ' '] : /['’]/.test(group) ? ["'", '’'] : [group];
    const g = `(?:${marks.map(escape).join('|')})`;
    p = {
      // A properly grouped number: 1–3 leading digits that don't start with 0, then groups of three
      // (or Indian twos before the last three: 12,34,567). Not followed by a digit or `/`, so `5 1/2`
      // and `0.250` are not digit groups.
      // Each group's digits are matched whole (2 or 3, no digit after), so matching stays linear.
      grouped: new RegExp(`(?<![\\d.,'’])[1-9]\\d{0,2}(?:${g}\\d{2,3}(?!\\d))+(?![\\d/])`, 'g'),
      mark: new RegExp(g, 'g'),
      decimal: decimal === '.' ? null : new RegExp(`${escape(decimal)}(?=\\d)`, 'g'),
    };
    patterns.set(locale, p);
  }
  return p;
}

/**
 * Rewrites the numbers in typed text into JavaScript's format (`.` decimal, no digit groups),
 * leaving everything else alone, so a parser for `1.5 m` or `25'-6 1/2"` also reads `1,5 m` and
 * `1.250,5 m` in a decimal-comma locale.
 *
 * - Digit-group marks are dropped from a properly grouped number (`1.250` → `1250` in German,
 *   `1,250` → `1250` in English, `1 250` → `1250` in French, `12,34,567` in Indian English).
 * - The locale's decimal mark before a digit becomes a point (`1,5` → `1.5`). A point that is not
 *   in a digit group stays a decimal point, so `1.5` and `0.250` typed the English way still work.
 */
export function normalizeNumberText(text: string, locale = current): string {
  const { grouped, mark, decimal } = patternsFor(locale);
  let t = text.replace(grouped, (m) => {
    // Every group three digits, or Indian twos before a last three.
    const lens = m.split(mark).slice(1).map((d) => d.length);
    const ok = lens.at(-1) === 3 && (lens.every((n) => n === 3) || lens.slice(0, -1).every((n) => n === 2));
    return ok ? m.replace(mark, '') : m;
  });
  if (decimal) t = t.replace(decimal, '.');
  return t;
}

/** A number typed in the number locale (`1,5` in German, `1.5` or `1,250.5` in English), or null. */
export function parseNumber(text: string, locale = current): number | null {
  const t = normalizeNumberText(text.trim(), locale).replace(/^\+/, '');
  // Digits, then optionally a point and more digits: each part is matched one way only, so it stays linear.
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
