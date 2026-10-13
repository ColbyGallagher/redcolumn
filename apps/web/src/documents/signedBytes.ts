import { settings } from '../settings/settings';

const BYTE_RANGE = new TextEncoder().encode('/ByteRange');

/** Whether the bytes hold a digital signature (a signature dictionary's /ByteRange). */
export function hasSignature(bytes: Uint8Array): boolean {
  const first = BYTE_RANGE[0]!;
  outer: for (let i = bytes.indexOf(first); i >= 0 && i <= bytes.length - BYTE_RANGE.length; i = bytes.indexOf(first, i + 1)) {
    for (let k = 1; k < BYTE_RANGE.length; k++) if (bytes[i + k] !== BYTE_RANGE[k]) continue outer;
    return true;
  }
  return false;
}

/** Whether `after` keeps every byte of `before` (changes appended as an incremental update). */
function appends(before: Uint8Array, after: Uint8Array): boolean {
  if (after.length < before.length) return false;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return false;
  return true;
}

/**
 * Preferences › Signature › Restrict changes that invalidate digital signatures: throws when
 * `before` is signed and `after` rewrites it instead of appending to it.
 */
export function assertKeepsSignatures(before: ArrayBuffer | Uint8Array, after: ArrayBuffer | Uint8Array) {
  if (!settings.get().restrictSignedChanges) return;
  const a = before instanceof Uint8Array ? before : new Uint8Array(before);
  const b = after instanceof Uint8Array ? after : new Uint8Array(after);
  if (!hasSignature(a) || appends(a, b)) return;
  throw new Error('This document is digitally signed, and this change would invalidate its signatures. To allow it, turn off Preferences › Signature › Restrict changes that invalidate digital signatures.');
}
