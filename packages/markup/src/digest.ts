import type { Markup } from './model';

/**
 * Fields that do not change what a saved annotation looks like or says. The markup ID is ours: an
 * imported markup given one is not changed.
 */
const IGNORED = new Set(['pdfAnnot', 'pageIndex', 'createdAt', 'modifiedAt', 'seq']);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A fingerprint of everything about a markup that saving writes, so an imported markup that has not
 * been changed can leave its original annotation untouched.
 */
export function markupDigest(m: Markup): string {
  const s = stable(Object.fromEntries(Object.entries(m).filter(([k]) => !IGNORED.has(k))));
  // FNV-1a, 32-bit, twice with different offsets for 64 bits.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Whether an imported markup still matches what was imported. */
export function unchangedSinceImport(m: Markup): boolean {
  return !!m.pdfAnnot?.digest && markupDigest(m) === m.pdfAnnot.digest;
}
