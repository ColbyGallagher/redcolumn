import { LOCALES, localeInfo, matchLocale, type LocaleInfo } from '@nb/i18n';

/**
 * The interface language: Preferences › General › Language, or with 'auto' the best match for the
 * browser's (on the desktop, the system's) languages. Unknown codes fall back to English.
 */
export function resolveLanguage(choice: string, requested: readonly string[]): string {
  if (choice !== 'auto') return localeInfo(choice)?.code ?? 'en';
  return matchLocale(requested, LOCALES.filter((l) => l.status !== 'pseudo'));
}

/** The languages Preferences offers: every real one, and the pseudo-locales in development or when one is in use. */
export function offeredLanguages(dev: boolean, current: string): LocaleInfo[] {
  return LOCALES.filter((l) => l.status !== 'pseudo' || dev || l.code === current);
}
