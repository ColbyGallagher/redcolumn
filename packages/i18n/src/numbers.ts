/**
 * Numbers as people read and type them: `1,234.5` in the US, `1.234,5` in Germany, `1 234,5` in
 * France. Preferences › General › Number Format sets the locale once, at start-up, like the
 * interface language (it can differ from it: an English interface with decimal commas is common).
 *
 * Only for text people read. Numbers written into files (PDF operators, JSON, CSV values) keep
 * JavaScript's own format.
 */

let current = 'en-US';

/** Sets the locale numbers are shown and read in. */
export function setNumberLocale(locale: string): void {
  try {
    current = Intl.NumberFormat.supportedLocalesOf([locale])[0] ?? 'en-US';
  } catch {
    // Not a valid language tag.
    current = 'en-US';
  }
}

/** The locale numbers are shown and read in. */
export function numberLocale(): string {
  return current;
}

const formats = new Map<string, Intl.NumberFormat>();

/** `value` formatted for people, in `locale` (the number locale by default). */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}, locale = current): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    formats.set(key, f);
  }
  return f.format(value);
}

/** Like `toFixed`, in the number locale: exactly `digits` decimals, with digit groups unless `grouping` is false. */
export function formatFixed(value: number, digits: number, grouping = true, locale = current): string {
  return formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: grouping }, locale);
}

/** Up to `digits` decimals with trailing zeros dropped (`String(+v.toFixed(d))`), in the number locale. */
export function formatTrimmed(value: number, digits: number, grouping = false, locale = current): string {
  return formatNumber(value, { maximumFractionDigits: digits, useGrouping: grouping }, locale);
}

const separatorCache = new Map<string, { decimal: string; group: string }>();

/** The locale's decimal and digit-group characters. */
export function numberSeparators(locale = current): { decimal: string; group: string } {
  let s = separatorCache.get(locale);
  if (!s) {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(12345.6);
    s = { decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.', group: parts.find((p) => p.type === 'group')?.value ?? ',' };
    separatorCache.set(locale, s);
  }
  return s;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrites the numbers in typed text into JavaScript's format (`.` decimal, no digit groups),
 * leaving everything else alone, so a parser for `1.5 m` or `25'-6 1/2"` also reads `1,5 m` and
 * `1.250,5 m` in a decimal-comma locale.
 *
 * - The locale's digit-group mark between a digit and three more digits is dropped (`1.250` →
 *   `1250` in German, `1,250` → `1250` in English, `1 250` → `1250` in French with its no-break space).
 * - In a decimal-comma locale a comma before a digit becomes the decimal point (`1,5` → `1.5`).
 *   A point that is not a digit group stays a decimal point, so `1.5` typed the English way still works.
 */
export function normalizeNumberText(text: string, locale = current): string {
  const { decimal, group } = numberSeparators(locale);
  // A no-break space group (French, Russian…) is also typed as a plain space; only the no-break
  // forms are dropped, since a plain space separates `5 1/2` and similar.
  // Swiss digit groups are written with either apostrophe.
  const groups = /\s/.test(group) ? ['\u00a0', '\u202f'] : /['’]/.test(group) ? ["'", '’'] : [group];
  let t = text;
  for (const g of groups) t = t.replace(new RegExp(`(\\d)${escape(g)}(?=\\d{3}(?!\\d))`, 'g'), '$1');
  if (decimal === ',') t = t.replace(/,(?=\d)/g, '.');
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
