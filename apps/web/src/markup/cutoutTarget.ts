import { isMeasureKind, QUANTITY } from '@nb/measure';
import type { Markup } from '@nb/markup';

/** Whether a markup is an area or volume measurement, the kinds that can have cutouts (holes). */
export function canHaveCutout(m: Pick<Markup, 'type'>): boolean {
  return isMeasureKind(m.type) && (QUANTITY[m.type] === 'area' || QUANTITY[m.type] === 'volume');
}

/** Why the selection can't take a cutout, in words for a tooltip; null when it can. `mayEdit` is the document's edit rule. */
export function cutoutBlocker(selected: readonly Markup[], mayEdit: (m: Markup) => boolean = () => true): string | null {
  if (selected.length > 1) return 'Select only one area or volume';
  const only = selected[0];
  if (!only || !canHaveCutout(only)) return 'Select one unlocked area or volume first';
  if (only.locked) return 'The selected area is locked';
  if (!mayEdit(only)) return 'You can’t edit the selected area';
  return null;
}

/** The area a Cutout command works on: the one selected area or volume that may be edited; otherwise none. */
export function cutoutTargetOf(selected: readonly Markup[], mayEdit?: (m: Markup) => boolean): Markup | null {
  return cutoutBlocker(selected, mayEdit) ? null : selected[0]!;
}
