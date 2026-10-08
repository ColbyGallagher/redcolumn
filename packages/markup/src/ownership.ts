import type { Markup } from './model';

/**
 * Who may change which markups. In a Live Session, people may edit only the markups they drew
 * unless they were given the right to edit anyone's; everyone who can markup may still set any
 * markup's status and reply to it. Markups with no author (imported from a file, say) count as
 * someone else's.
 */
export type EditRule = (m: Pick<Markup, 'author'>) => boolean;

/** The fields anyone who can markup may change on someone else's markup. */
export const OPEN_FIELDS = ['status', 'statusHistory', 'replies', 'checked'] as const;

/** A rule letting `me` edit only markups authored by `me` (names compared without regard to case or edge spaces). */
export function ownMarkupsOnly(me: string): EditRule {
  const mine = me.trim().toLowerCase();
  return (m) => !!mine && (m.author ?? '').trim().toLowerCase() === mine;
}

/** The part of `patch` allowed on a markup its editor may not edit: only its open fields, or null when none. */
export function openPatch<T extends Partial<Markup>>(patch: T): Partial<Markup> | null {
  const out: Partial<Markup> = {};
  for (const k of OPEN_FIELDS) if (k in patch) (out as Record<string, unknown>)[k] = patch[k];
  return Object.keys(out).length ? out : null;
}
