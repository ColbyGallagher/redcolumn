import { settings } from '../settings/settings';

/**
 * Preferences › Signature › Password Time-out: a Digital ID's password, once it has unlocked the
 * ID, is remembered (in memory only, never stored) for this many minutes, so signing again in that
 * time does not ask for it. 0 asks every time.
 */
const remembered = new Map<string, { password: string; until: number }>();

export function rememberPassword(idId: string, password: string) {
  const minutes = settings.get().signaturePasswordTimeout;
  if (minutes > 0) remembered.set(idId, { password, until: Date.now() + minutes * 60_000 });
  else remembered.delete(idId);
}

/** The ID's remembered password while its time-out lasts, else null. */
export function recalledPassword(idId: string): string | null {
  const r = remembered.get(idId);
  if (!r) return null;
  if (Date.now() < r.until && settings.get().signaturePasswordTimeout > 0) return r.password;
  remembered.delete(idId);
  return null;
}
