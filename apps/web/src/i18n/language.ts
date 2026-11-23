import { formatFixed, LOCALES, localeInfo, matchLocale, type LocaleInfo } from '@nb/i18n';

/**
 * The interface language: Preferences › General › Language, or with 'auto' the best match for the
 * browser's (on the desktop, the system's) languages. Unknown codes fall back to English.
 */
export function resolveLanguage(choice: unknown, requested: readonly string[]): string {
  // A stored setting of the wrong type (an old or hand-edited profile) counts as 'auto'.
  if (typeof choice === 'string' && choice !== 'auto') return localeInfo(choice)?.code ?? 'en';
  return matchLocale(requested, LOCALES.filter((l) => l.status !== 'pseudo'));
}

/** The languages Preferences offers: every real one, and the pseudo-locales in development or when one is chosen or running. */
export function offeredLanguages(dev: boolean, current: readonly string[]): LocaleInfo[] {
  return LOCALES.filter((l) => l.status !== 'pseudo' || dev || current.includes(l.code));
}

/** The browser's (on the desktop, the system's) preferred languages, most preferred first. */
export function browserLanguages(): readonly string[] {
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

/** Number formats Preferences offers, each named by how it writes a sample number. */
export const NUMBER_FORMATS = ['en-US', 'de-DE', 'fr-FR', 'de-CH'] as const;

/** A number format's sample, e.g. `1.234.567,89` for 'de-DE'. */
export const numberSample = (locale: string): string => formatFixed(1234567.89, 2, true, locale);

/** The locale numbers are written in: Preferences › General › Number Format, or with 'auto' the system's (`systemLocale`). */
export function resolveNumberFormat(choice: unknown, systemLocale: string): string {
  return typeof choice === 'string' && choice !== 'auto' ? choice : systemLocale;
}

/** The system's formatting locale (the browser's, or on the desktop the operating system's). */
export function systemNumberLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
}
