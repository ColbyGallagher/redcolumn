import { mapIcuText, type IcuNode } from './icu.ts';

const ACCENTS: Record<string, string> = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c, i) => [c, [...'åƀçđéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇĐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ'][i]!]),
);

/** How much longer pseudo-localized text is: German and Russian run about 30% over English. */
const EXPANSION = 0.4;

/**
 * Pseudo-localizes a parsed message, keeping its arguments working.
 * - `accents`: `Save all` → `[[Šåṽé åļļ ~~~]]`: accented, 40% longer, bracketed so clipped or
 *   untranslated text stands out.
 * - `bidi`: each text run is wrapped in right-to-left override marks, so English reads mirrored as
 *   Arabic would, and layout bugs in right-to-left show up.
 */
export function pseudoLocalize(nodes: readonly IcuNode[], kind: 'accents' | 'bidi'): IcuNode[] {
  if (kind === 'bidi') {
    // The closing "…" stays last, outside the marks (see below).
    return mapIcuText(nodes, (t) => (t.endsWith('…') ? `‮${t.slice(0, -1)}‬…` : `‮${t}‬`));
  }
  let length = 0;
  const mapped = mapIcuText(nodes, (t) => {
    length += t.length;
    return t.replace(/[a-zA-Z]/g, (c) => ACCENTS[c] ?? c);
  });
  const pad = '~'.repeat(Math.max(1, Math.round(length * EXPANSION)));
  // A closing "…" stays last, as every translation keeps it (checkCatalog): it marks commands that
  // open a dialog, and code reads it (the assistant's "needs you", the ribbon dropping it).
  const last = mapped.at(-1);
  if (typeof last === 'string' && last.endsWith('…')) return ['[[', ...mapped.slice(0, -1), last.slice(0, -1), ` ${pad}]]…`];
  return ['[[', ...mapped, ` ${pad}]]`];
}
