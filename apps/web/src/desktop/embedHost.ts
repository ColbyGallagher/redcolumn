import { settings } from '../settings/settings';
import { desktop } from './host';

/**
 * Experimental hooks for an application that runs RedColumn inside it (Preferences › Advanced ›
 * Experimental, off by default). Off, or without a host that has them, every answer here is null
 * and RedColumn behaves as it does on its own. The hooks may change or go away.
 */
function hooks() {
  return settings.get().embedHostHooks ? desktop() : null;
}

/** Ids the library already gives a meaning to: the SHA-256 of a file's bytes, and Live Session documents. */
const RESERVED_ID = /^(?:[0-9a-f]{64}|studio:.*)$/;

/**
 * The library id the host assigns to a file it launched (by the file's launch token), or null to
 * keep the file under the hash of its bytes. Ids the library uses for its own files are refused.
 */
export function hostDocumentId(token: string | null | undefined): string | null {
  const host = hooks();
  if (!token || !host?.documentIdFor) return null;
  const id = host.documentIdFor(token);
  if (typeof id !== 'string' || !id || RESERVED_ID.test(id)) {
    if (id) console.warn(`The embedding application's document id ${JSON.stringify(id)} is not usable; the file is kept under its contents' hash.`);
    return null;
  }
  return id;
}

/** The host's reason the command `id` must not run here, or null when it may (asked on every build of the command table, so it must be quick). */
export function hostRefusal(id: string): string | null {
  const reason = hooks()?.commandPolicy?.(id)?.disabledReason;
  return typeof reason === 'string' && reason ? reason : null;
}
