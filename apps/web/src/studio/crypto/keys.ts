/**
 * End-to-end encryption and signing for Live Sessions, in the browser with WebCrypto
 * (docs/SECURITY-HARDENING.md, phase 5). Nothing here talks to a server.
 *
 * - A session key (AES-GCM, 256 bits) travels in the invite link's #fragment, which browsers do not
 *   send to any server. Files are sealed with it before upload, so Microsoft stores only
 *   ciphertext. Later keys ("epochs", after someone is removed) are wrapped for each attendee.
 * - Each person has an identity: an ECDSA P-256 key that signs what they write, and an ECDH P-256
 *   key that later session keys are wrapped for. The host's signing key's fingerprint is in the
 *   link too, so the session's manifest (who is in, with which keys) cannot be forged.
 */

const subtle = () => globalThis.crypto.subtle;
const te = new TextEncoder();

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

// ---- The secret in the link ----

/** What an encrypted session's invite link carries after `#`: the first key, and the host's fingerprint. */
export interface SessionSecret {
  /** The epoch 0 session key, 32 bytes as base64url (43 characters). */
  key: string;
  /** The host's signing key fingerprint, 16 bytes as base64url (22 characters). */
  host: string;
}

export const secretFragment = (s: SessionSecret) => `rk=${s.key}.${s.host}`;

/** The secret in a link or pasted text (`rk=<key>.<host>`), or null. */
export function parseSecret(text: string): SessionSecret | null {
  const m = /(?:^|[#&?\s])rk=([\w-]{43})\.([\w-]{22})(?![\w-])/.exec(text);
  return m ? { key: m[1]!, host: m[2]! } : null;
}

export function newKeyBytes(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', buf(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// ---- Sealed bytes: "NBS1" | epoch (uint32) | iv (12) | AES-GCM ciphertext ----

const MAGIC = te.encode('NBS1');
const HEADER = MAGIC.byteLength + 4 + 12;

export function isSealed(bytes: Uint8Array): boolean {
  return bytes.byteLength >= HEADER + 16 && MAGIC.every((b, i) => bytes[i] === b);
}

/** The epoch a sealed file was written under, or null when it is not sealed. */
export function sealedEpoch(bytes: Uint8Array): number | null {
  return isSealed(bytes) ? new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0) : null;
}

export async function seal(key: CryptoKey, epoch: number, plain: Uint8Array): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const head = new Uint8Array(8);
  head.set(MAGIC);
  new DataView(head.buffer).setUint32(4, epoch);
  // The header is authenticated too, so a file cannot be relabelled with another epoch.
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: head }, key, buf(plain)));
  return concat(head, iv, ct);
}

export async function unseal(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array> {
  if (!isSealed(sealed)) throw new Error('Not an encrypted file.');
  const head = sealed.subarray(0, 8);
  const iv = sealed.subarray(8, HEADER);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(head) }, key, buf(sealed.subarray(HEADER))));
}

/** A sealed JSON file stays JSON (drives that keep properties inside JSON files still can). */
export const SEALED_JSON_KEY = 'nbSealed';

export function sealedJsonBytes(raw: Uint8Array): Uint8Array | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    return typeof value?.[SEALED_JSON_KEY] === 'string' ? fromB64url(value[SEALED_JSON_KEY]) : null;
  } catch {
    return null;
  }
}

// ---- Identities ----

export interface PublicIdentity {
  sign: JsonWebKey;
  dh: JsonWebKey;
}

export interface Identity {
  pub: PublicIdentity;
  sign: CryptoKey;
  dh: CryptoKey;
  /** The signing key's fingerprint. */
  fp: string;
}

const SIGN_ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const DH_ALG = { name: 'ECDH', namedCurve: 'P-256' } as const;
const SIG_ALG = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** Only the curve point, so a JWK with extra fields has the same fingerprint. */
const pubOnly = (jwk: JsonWebKey): JsonWebKey => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });

export async function fingerprint(sign: JsonWebKey): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', te.encode(`${sign.crv}.${sign.x}.${sign.y}`)));
  return toB64url(digest.subarray(0, 16));
}

/** A new identity. `extractable` only for a host's keys, which are kept in the host's own drive. */
export async function newIdentity(extractable = false): Promise<Identity> {
  const sign = await subtle().generateKey(SIGN_ALG, extractable, ['sign', 'verify']);
  const dh = await subtle().generateKey(DH_ALG, extractable, ['deriveBits']);
  const pub = { sign: pubOnly(await subtle().exportKey('jwk', sign.publicKey)), dh: pubOnly(await subtle().exportKey('jwk', dh.publicKey)) };
  return { pub, sign: sign.privateKey, dh: dh.privateKey, fp: await fingerprint(pub.sign) };
}

/** An identity as JSON (private keys included), for a host's keys file. */
export async function exportIdentity(id: Identity): Promise<{ sign: JsonWebKey; dh: JsonWebKey }> {
  return { sign: await subtle().exportKey('jwk', id.sign), dh: await subtle().exportKey('jwk', id.dh) };
}

export async function importIdentity(saved: { sign: JsonWebKey; dh: JsonWebKey }): Promise<Identity> {
  const sign = await subtle().importKey('jwk', saved.sign, SIGN_ALG, true, ['sign']);
  const dh = await subtle().importKey('jwk', saved.dh, DH_ALG, true, ['deriveBits']);
  const pub = { sign: pubOnly(saved.sign), dh: pubOnly(saved.dh) };
  return { pub, sign, dh, fp: await fingerprint(pub.sign) };
}

/** A 64-byte ECDSA signature. */
export async function signBytes(id: Identity, bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().sign(SIG_ALG, id.sign, buf(bytes)));
}

export async function verifyBytes(pub: JsonWebKey, bytes: Uint8Array, sig: Uint8Array): Promise<boolean> {
  try {
    const key = await subtle().importKey('jwk', pubOnly(pub), SIGN_ALG, false, ['verify']);
    return await subtle().verify(SIG_ALG, key, buf(sig), buf(bytes));
  } catch {
    return false;
  }
}

/** A key for wrapping, agreed between one person's private ECDH key and another's public one. */
async function agreed(mine: CryptoKey, theirs: JsonWebKey, info: string): Promise<CryptoKey> {
  const pub = await subtle().importKey('jwk', pubOnly(theirs), DH_ALG, false, []);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pub }, mine, 256);
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Wraps a session key for one person (only they, and the wrapper, can unwrap it). */
export async function wrapFor(mine: CryptoKey, theirs: JsonWebKey, raw: Uint8Array, info: string): Promise<string> {
  const key = await agreed(mine, theirs, info);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return toB64url(concat(iv, new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, buf(raw)))));
}

export async function unwrapFrom(mine: CryptoKey, theirs: JsonWebKey, wrapped: string, info: string): Promise<Uint8Array> {
  const key = await agreed(mine, theirs, info);
  const bytes = fromB64url(wrapped);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(bytes.subarray(0, 12)) }, key, buf(bytes.subarray(12))));
}

// ---- Signed payloads: signature (64) | bytes ----

export async function signed(id: Identity, bytes: Uint8Array): Promise<Uint8Array> {
  return concat(await signBytes(id, bytes), bytes);
}

/** The payload, if `pub` signed it; null otherwise. */
export async function verified(pub: JsonWebKey, bytes: Uint8Array): Promise<Uint8Array | null> {
  if (bytes.byteLength < 64) return null;
  const body = bytes.subarray(64);
  return (await verifyBytes(pub, body, bytes.subarray(0, 64))) ? body : null;
}

/** Canonical JSON (sorted keys), so a signature over an object survives a round trip. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
