import { currentLocale } from '@nb/i18n';

/**
 * A table of interface text built on first use and kept while the language stays the same, so its
 * text is translated (never built at module load) and its objects keep their identity between calls.
 */
export function lazy<T>(build: () => T): () => T {
  let locale: unknown = null;
  let value: T;
  return () => {
    if (locale !== currentLocale()) {
      value = build();
      locale = currentLocale();
    }
    return value;
  };
}
