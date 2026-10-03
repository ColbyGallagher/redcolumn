import { profiles } from '../workspace/profiles';
import { formatCombo, keysFor } from './keys';

/** A command's first shortcut in the active profile, as shown in menus and tooltips. */
export function shortcutLabel(id: string): string | undefined {
  const key = keysFor(id, profiles.active().state.shortcuts)[0];
  return key ? formatCombo(key) : undefined;
}
