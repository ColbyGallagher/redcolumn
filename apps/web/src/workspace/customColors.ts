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
