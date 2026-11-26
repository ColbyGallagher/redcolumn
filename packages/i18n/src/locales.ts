/**
 * The languages redcolumn's interface can show. This list is the only place a language is
 * declared: adding one is an entry here plus `catalogs/<code>.po` (docs/i18n-plan.md).
 */

export type LocaleStatus =
  /** English, the language the app is written in. */
  | 'source'
  /** Machine translated; a native speaker has not signed it off. The picker shows a badge. */
  | 'preview'
  /** Signed off by a native-speaking reviewer. */
  | 'reviewed'
  /** Generated from English for testing layout; offered only in development. */
  | 'pseudo';

export interface LocaleInfo {
  /** BCP 47 tag, e.g. `de` or `pt-BR`. Also the catalog's file name. */
  code: string;
  /** The language's name in itself, as the picker lists it. */
  name: string;
  /** Its English name. */
  english: string;
  dir: 'ltr' | 'rtl';
  status: LocaleStatus;
  /** The locale whose plural and number rules apply, when not `code` (pseudo-locales). */
  rules?: string;
  /** Pseudo-localization applied to the English text. */
  pseudo?: 'accents' | 'bidi';
  /** Writing systems (ISO 15924), for picking fonts that can draw the language. */
  scripts: readonly string[];
  /** Hunspell dictionary package for spell checking, when one exists. */
  spelling?: string;
  /** Tesseract language for OCR, when one exists. */
  ocr?: string;
}

export const SOURCE_LOCALE = 'en';

export const LOCALES: readonly LocaleInfo[] = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr', status: 'source', scripts: ['Latn'], spelling: 'dictionary-en', ocr: 'eng' },
  { code: 'de', name: 'Deutsch', english: 'German', dir: 'ltr', status: 'preview', scripts: ['Latn'], spelling: 'dictionary-de', ocr: 'deu' },
  { code: 'fr', name: 'Français', english: 'French', dir: 'ltr', status: 'preview', scripts: ['Latn'], spelling: 'dictionary-fr', ocr: 'fra' },
  // Pseudo-locales: English made longer and accented (finds untranslated text and overflow), and
  // English shown right to left (exercises the direction switch).
  { code: 'en-XA', name: '[Ƥşéûđö Åççéñţş]', english: 'Pseudo (accents)', dir: 'ltr', status: 'pseudo', rules: 'en', pseudo: 'accents', scripts: ['Latn'] },
  { code: 'ar-XB', name: 'Pseudo RTL', english: 'Pseudo (right to left)', dir: 'rtl', status: 'pseudo', rules: 'ar', pseudo: 'bidi', scripts: ['Latn'] },
];

const byCode = new Map(LOCALES.map((l) => [l.code.toLowerCase(), l]));

/** A registered locale by code (case-insensitive). */
export function localeInfo(code: string): LocaleInfo | undefined {
  return byCode.get(code.toLowerCase());
}

/** Locales with a catalog file (not English, not pseudo). */
export function translatedLocales(): LocaleInfo[] {
  return LOCALES.filter((l) => l.status === 'preview' || l.status === 'reviewed');
}

/** `de-AT` → `['de-AT', 'de', 'en']`: where to look for a message, most specific first. */
export function fallbackChain(code: string): string[] {
  const chain: string[] = [];
  const parts = code.split('-');
  for (let n = parts.length; n > 0; n--) chain.push(parts.slice(0, n).join('-'));
  if (!chain.includes(SOURCE_LOCALE)) chain.push(SOURCE_LOCALE);
  return chain;
}

/**
 * The best registered locale for the user's preferred languages (`navigator.languages`, or the
 * operating system's on the desktop): an exact match, else the same language in another region,
 * else English. Pseudo-locales only match exactly.
 */
export function matchLocale(requested: readonly string[], available: readonly LocaleInfo[] = LOCALES): string {
  const real = available.filter((l) => l.status !== 'pseudo');
  for (const tag of requested) {
    const exact = available.find((l) => l.code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.code;
    const lang = tag.split('-')[0]!.toLowerCase();
    const sameLang = real.find((l) => l.code.toLowerCase() === lang) ?? real.find((l) => l.code.split('-')[0]!.toLowerCase() === lang);
    if (sameLang) return sameLang.code;
  }
  return SOURCE_LOCALE;
}
