import { LOCALES, localeInfo, matchLocale, type LocaleInfo } from '@nb/i18n';

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
