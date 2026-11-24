/**
 * Interface text the main process shows (dialog titles, file type names, the sign-in page), in the
 * interface language. The page translates these (apps/web/src/desktop/mainStrings.ts, keyed by the
 * English) and sends them once it has chosen its language; until then, and for anything missing,
 * the English is used.
 */

const MAX_STRINGS = 500;
const MAX_LENGTH = 2000;

let strings = new Map<string, string>();

/** The English text in the interface language. */
export function t(english: string): string {
  return strings.get(english) ?? english;
}

/** Takes the page's translations. Anything that is not a short string-to-string table is ignored. */
export function setStrings(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_STRINGS) return false;
  const next = new Map<string, string>();
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || k.length > MAX_LENGTH || v.length > MAX_LENGTH) return false;
    next.set(k, v);
  }
  strings = next;
  return true;
}
