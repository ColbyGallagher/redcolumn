export type DropPosition = 'before' | 'after';
export type SortDirection = 'asc' | 'desc';

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Natural, case-insensitive comparison for display names ("Item 2" before "Item 10"). */
export function compareNames(a: string, b: string): number {
  return nameCollator.compare(a.trim(), b.trim());
}

/**
 * Moves the item at `fromIndex` before or after `toIndex`.
 * Returns the original array when indices are out of bounds or the order would not change.
 */
export function reorderAt<T>(list: readonly T[], fromIndex: number, toIndex: number, position: DropPosition = 'before'): T[] {
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length || fromIndex === toIndex) {
    return list as T[];
  }
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  let insertAt = position === 'after' ? toIndex + 1 : toIndex;
  if (fromIndex < insertAt) insertAt--;
  if (insertAt === fromIndex) return list as T[];
  next.splice(insertAt, 0, moved!);
  return next;
}

/**
 * Moves the item with `fromId` before or after the item with `toId`.
 * Works on the full array even when the UI displays a filtered subset.
 */
export function reorderById<T extends { id: string }>(list: readonly T[], fromId: string, toId: string, position: DropPosition = 'before'): T[] {
  if (fromId === toId) return list as T[];
  const fromIndex = list.findIndex((x) => x.id === fromId);
  const toIndex = list.findIndex((x) => x.id === toId);
  return reorderAt(list, fromIndex, toIndex, position);
}

/** Returns a new array sorted alphabetically by `getName` (natural, case-insensitive). */
export function sortAlphabetically<T>(list: readonly T[], getName: (item: T) => string, direction: SortDirection = 'asc'): T[] {
  const sign = direction === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => sign * compareNames(getName(a), getName(b)));
}

/**
 * The direction a sort button should apply next: `'desc'` if the list is already in ascending
 * alphabetical order (with at least two distinct names), otherwise `'asc'`.
 */
export function nextSortDirection<T>(list: readonly T[], getName: (item: T) => string): SortDirection {
  if (list.length < 2) return 'asc';
  let hasDistinct = false;
  for (let i = 1; i < list.length; i++) {
    const cmp = compareNames(getName(list[i - 1]!), getName(list[i]!));
    if (cmp > 0) return 'asc';
    if (cmp < 0) hasDistinct = true;
  }
  return hasDistinct ? 'desc' : 'asc';
}

/**
 * Computes whether a pointer at `clientY` is in the top half (`'before'`) or bottom half
 * (`'after'`) of `rect`. At the exact midpoint, favors `'before'` when moving up and `'after'`
 * when moving down (helpful for synthetic drag-to-center drops).
 */
export function dropPositionFromPoint(clientY: number, rect: Pick<DOMRect, 'top' | 'height'>, movingDown = false): DropPosition {
  const mid = rect.top + rect.height / 2;
  if (Math.abs(clientY - mid) < 0.5) return movingDown ? 'after' : 'before';
  return clientY < mid ? 'before' : 'after';
}
