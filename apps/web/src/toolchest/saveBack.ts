import type { MarkupStyle } from '@nb/markup';
import { identityPatch, IDENTITY_FIELDS, toolIdentity, type ToolFields } from '../markup/selectionFormat';
import { profiles, updateWorkspace, type ToolChestItem } from '../workspace/profiles';

/**
 * Save back to Tool Chest: a tool armed from a Tool Chest item can be edited while its command runs
 * (Subject, Label, Layer, style). This is the item as it should be stored once those edits are kept.
 */
export function savedToolItem(item: ToolChestItem, edited: { fields: ToolFields; style?: MarkupStyle }): ToolChestItem {
  const base = { subject: item.subject, label: item.markupLabel, layer: item.layer };
  const value = (f: (typeof IDENTITY_FIELDS)[number]) => toolIdentity(base, edited.fields, f);
  const { subject: _s, markupLabel: _l, layer: _y, ...rest } = item;
  const saved: ToolChestItem = {
    ...rest,
    ...(value('subject').trim() ? { subject: value('subject').trim() } : {}),
    ...(value('label').trim() ? { markupLabel: value('label').trim() } : {}),
    ...(value('layer') ? { layer: value('layer') } : {}),
    ...(edited.style ? { style: { ...edited.style } } : {}),
  };
  // A tool that places saved markups gives them the same subject, label and layer.
  if (item.markups?.length) {
    saved.markups = item.markups.map((m) => {
      let next = { ...m };
      for (const f of IDENTITY_FIELDS) next = { ...next, ...identityPatch(next, f, value(f)) };
      return next;
    });
  }
  return saved;
}

/** Whether `id` is a Tool Chest item of the active profile. */
export function toolChestItem(id: string | undefined): ToolChestItem | null {
  if (!id) return null;
  for (const set of profiles.active().state.toolChests) {
    const found = set.items.find((i) => i.id === id);
    if (found) return found;
  }
  return null;
}

/** Stores the edited tool over its Tool Chest item (found by the id the armed tool carries). Returns false when the item is gone. */
export function saveToolBack(id: string, edited: { fields: ToolFields; style?: MarkupStyle }): boolean {
  if (!toolChestItem(id)) return false;
  updateWorkspace((w) => ({
    ...w,
    toolChests: w.toolChests.map((set) => (set.items.some((i) => i.id === id) ? { ...set, items: set.items.map((i) => (i.id === id ? savedToolItem(i, edited) : i)) } : set)),
  }));
  return true;
}
