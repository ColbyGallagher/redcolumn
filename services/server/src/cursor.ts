import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD_PREFIX = 'rc-cursor-v1';

export interface CursorScope {
  userId: string;
  streamId: string;
}

/** Derives a 32-byte AES-256 key from a configured secret, or generates a fresh per-process key. */
export function deriveCursorKey(secret?: string): Buffer {
  if (secret && secret.length > 0) {
    return createHash('sha256').update(secret, 'utf8').digest();
  }
  return randomBytes(32);
}

function buildAad(scope: CursorScope): Buffer {
  return Buffer.from(`${AAD_PREFIX}\0${scope.userId}\0${scope.streamId}`, 'utf8');
}

/**
 * Seals a stream sequence number into an opaque, authenticated cursor bound to one user and
 * one stream. Clients cannot inspect the sequence number, forge a cursor, or move a cursor
 * across users or streams.
 */
export function sealCursor(key: Buffer, scope: CursorScope, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new Error('Cursor sequence must be a non-negative safe integer');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(buildAad(scope));
  const plaintext = Buffer.from(JSON.stringify({ s: seq }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/**
 * Verifies and unseals a cursor for `expected` user and stream. Returns `null` for any
 * tampered, malformed, cross-user, or cross-stream token.
 */
export function openCursor(key: Buffer, token: string, expected: CursorScope): number | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) return null;
  let raw: Buffer;
  try {
    raw = Buffer.from(token, 'base64url');
  } catch {
    return null;
  }
  if (raw.length < IV_BYTES + TAG_BYTES + 1) return null;
  // Reject non-canonical base64url encodings so tampered padding cannot slip through.
  if (raw.toString('base64url') !== token) return null;

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(buildAad(expected));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plaintext) as { s?: unknown };
    if (typeof parsed.s !== 'number' || !Number.isSafeInteger(parsed.s) || parsed.s < 0) return null;
    return parsed.s;
  } catch {
    return null;
  }
}
