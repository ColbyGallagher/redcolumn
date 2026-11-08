import { labelPatch, markupLabel, styleCapabilities, type Markup, type MarkupStyle, type MarkupType, type StyleCapabilities } from '@nb/markup';

/**
 * Pure parts of the Markup Format tab's follow-the-selection behaviour: which style fields a
 * mixed selection shares, which of those differ between the markups, and when the ribbon goes
 * to the tab and back.
 */

/** The style capabilities every one of `types` has: a field shows only if it means something for all. */
export function commonCapabilities(types: Iterable<MarkupType>): StyleCapabilities {
  const all = [...new Set(types)].map(styleCapabilities);
  if (!all.length) return { fill: false, hatch: false, dash: false, lineEnds: false, font: false, textLayout: false, label: false, leader: false, blend: false, arcRadius: null };
  const every = (k: Exclude<keyof StyleCapabilities, 'arcRadius'>) => all.every((c) => c[k]);
  const radius = all[0]!.arcRadius;
  return {
    fill: every('fill'),
    hatch: every('hatch'),
    dash: every('dash'),
    lineEnds: every('lineEnds'),
    font: every('font'),
    textLayout: every('textLayout'),
    label: every('label'),
    leader: every('leader'),
    blend: every('blend'),
    arcRadius: all.every((c) => c.arcRadius === radius) ? radius : null,
  };
}

/** Whether the values are not all the same (compared by content, so two equal objects agree). */
export function isMixed(values: readonly unknown[]): boolean {
  if (values.length < 2) return false;
  const first = JSON.stringify(values[0] ?? null);
  return values.some((v) => JSON.stringify(v ?? null) !== first);
}

/** Whether the markups disagree on a style field; `resolve` gives a field its default when unset. */
export function styleMixed<K extends keyof MarkupStyle>(markups: readonly Pick<Markup, 'style'>[], key: K, resolve?: (v: MarkupStyle[K]) => unknown): boolean {
  return isMixed(markups.map((m) => (resolve ? resolve(m.style[key]) : m.style[key])));
}

/** The ribbon's tab following the selection. `onFormat`: showing the Markup Format tab. */
export interface FormatFollow {
  onFormat: boolean;
  /** The Format tab is showing because a selection switched to it (it goes back when that ends). */
  auto: boolean;
  /** The selection already followed (empty: none). */
  seen: string;
}

export const FOLLOW_START: FormatFollow = { onFormat: false, auto: false, seen: '' };

export type FormatFollowEvent =
  /** The selection (its ids joined) changed, or something that held the switch back has ended. */
  | { type: 'selection'; key: string; contextual: boolean; busy: boolean }
  /** The user picked a tab. */
  | { type: 'pick'; format: boolean }
  /** The Format tab has nothing to show any more. */
  | { type: 'gone' };

/**
 * A new selection switches to the Format tab, unless a gesture or drawing tool is mid-way. The
 * selection clearing goes back to the tab the user was on, but only if the switch was automatic:
 * a tab the user picked while markups stayed selected is respected until the next new selection.
 */
export function followFormat(s: FormatFollow, e: FormatFollowEvent): FormatFollow {
  switch (e.type) {
    case 'pick':
      // Picking Format while it already shows keeps it automatic; coming back to it later is the user's choice.
      return { ...s, onFormat: e.format, auto: e.format && s.onFormat ? s.auto : false };
    case 'gone':
      return { ...s, onFormat: false, auto: false };
    case 'selection': {
      // Going back is never held up; only the switch waits for the gesture to end.
      if (!e.key) return { onFormat: s.auto ? false : s.onFormat, auto: false, seen: '' };
      if (e.busy || !e.contextual || e.key === s.seen) return s;
      if (s.onFormat) return { ...s, seen: e.key };
      return { onFormat: true, auto: true, seen: e.key };
    }
  }
}

// --- Subject, Label and Layer -----------------------------------------------------------------

/** The three identifying fields the Markup Format tab edits, for a selection or for the active tool. */
export type IdentityField = 'subject' | 'label' | 'layer';
export const IDENTITY_FIELDS: readonly IdentityField[] = ['subject', 'label', 'layer'];

/** What the active tool stamps on the markups it places; a field left out keeps the tool's own. */
export type ToolFields = Partial<Record<IdentityField, string>>;

type Identified = Pick<Markup, 'type' | 'text' | 'label' | 'subject' | 'layer'>;

/** A markup's value of one field ('' when it has none). */
export function identityOf(m: Identified, field: IdentityField): string {
  if (field === 'subject') return (m.subject ?? '').trim();
  if (field === 'layer') return m.layer ?? '';
  return markupLabel(m);
}

/** The value a selection shares for a field; where the markups disagree it is mixed and the value empty. */
export function sharedIdentity(markups: readonly Identified[], field: IdentityField): { value: string; mixed: boolean } {
  const values = markups.map((m) => identityOf(m, field));
  return isMixed(values) ? { value: '', mixed: true } : { value: values[0] ?? '', mixed: false };
}

/** The change that sets one field on a markup (an empty value clears it). */
export function identityPatch(m: Pick<Markup, 'type'>, field: IdentityField, value: string): Partial<Markup> {
  if (field === 'label') return labelPatch(m, value);
  if (field === 'subject') return { subject: value.trim() || undefined };
  return { layer: value || undefined };
}

/** The sorted, distinct non-empty values a field takes across markups (subject suggestions, layer choices). */
export function distinctIdentities(markups: readonly Identified[], field: IdentityField, extra: readonly string[] = []): string[] {
  return [...new Set([...markups.map((m) => identityOf(m, field)), ...extra].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** What a tool shows for a field: its edit if it has one, else the value the armed Tool Chest tool carries. */
export function toolIdentity(base: Partial<Record<IdentityField, string>> | undefined, edits: ToolFields | undefined, field: IdentityField): string {
  return edits?.[field] ?? base?.[field] ?? '';
}

/** The change that stamps the tool's edited fields on a markup it is placing (nothing for fields not edited). */
export function toolFieldsPatch(m: Pick<Markup, 'type'>, edits: ToolFields | undefined): Partial<Markup> {
  let patch: Partial<Markup> = {};
  for (const f of IDENTITY_FIELDS) if (edits && f in edits) patch = { ...patch, ...identityPatch(m, f, edits[f] ?? '') };
  return patch;
}
