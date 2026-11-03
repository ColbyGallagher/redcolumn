/** How many user-saved colors the color pickers keep. */
export const MAX_CUSTOM_COLORS = 10;

/** A `#rrggbb` color (the only form the hex field accepts). */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The list with `color` first (lower-cased), any earlier copy removed and the list capped. */
export function addCustomColor(list: readonly string[], color: string): string[] {
  const c = color.toLowerCase();
  return [c, ...list.filter((x) => x.toLowerCase() !== c)].slice(0, MAX_CUSTOM_COLORS);
}

/** The list without `color`. */
export function removeCustomColor(list: readonly string[], color: string): string[] {
  const c = color.toLowerCase();
  return list.filter((x) => x.toLowerCase() !== c);
}

/** A saved `customColors` value made safe: only `#rrggbb` strings survive (profiles can come from shared files). */
export function cleanCustomColors(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean = value.filter((c): c is string => typeof c === 'string' && HEX_COLOR.test(c)).map((c) => c.toLowerCase());
  return [...new Set(clean)].slice(0, MAX_CUSTOM_COLORS);
}

/** What the hex field holds as a color: `123456` and `#123456` both give `#123456`; null if not a hex color. */
export function parseHex(text: string): string | null {
  const t = text.trim();
  const c = t.startsWith('#') ? t : `#${t}`;
  return HEX_COLOR.test(c) ? c.toLowerCase() : null;
}
