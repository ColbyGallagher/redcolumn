import { isMeasureKind, QUANTITY } from '@nb/measure';
import type { Markup } from '@nb/markup';

/** Whether a markup is an area or volume measurement, the kinds that can have cutouts (holes). */
export function canHaveCutout(m: Pick<Markup, 'type' | 'locked'>): boolean {
  return isMeasureKind(m.type) && (QUANTITY[m.type] === 'area' || QUANTITY[m.type] === 'volume');
}

/** The area a Cutout command works on: the one selected area or volume, unlocked; otherwise none. */
export function cutoutTargetOf(selected: readonly Markup[]): Markup | null {
  const only = selected.length === 1 ? selected[0]! : null;
  return only && !only.locked && canHaveCutout(only) ? only : null;
}
