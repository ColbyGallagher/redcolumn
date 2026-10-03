import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject } from 'pdf-lib';

/**
 * Document security: PDFs protected with an open password and/or permissions, written with the
 * standard security handler at its strongest level (revision 6: AES-256, as Acrobat X and later
 * write it). Every string and stream in the file is encrypted.
 */

export type PrintPermission = 'none' | 'low' | 'high';

export interface Permissions {
  print: PrintPermission;
  /** Change the document (other than the operations below). */
  modify: boolean;
  /** Copy text and pictures. */
  copy: boolean;
  /** Add or change markups and fill in forms. */
  annotate: boolean;
  /** Fill in forms (even when markups are not allowed). */
  fillForms: boolean;
  /** Insert, delete and rotate pages; bookmarks and thumbnails. */
  assemble: boolean;
  /** Text for screen readers. */
  accessibility: boolean;
}

export interface SecuritySettings {
  /** Needed to open the document; empty for none. */
  openPassword: string;
  /** Needed to change the security and permissions; empty makes a random one (nobody can lift the limits). */
  permissionsPassword: string;
  permissions: Permissions;
}

export const ALL_ALLOWED: Permissions = { print: 'high', modify: true, copy: true, annotate: true, fillForms: true, assemble: true, accessibility: true };

/** The /P value: bit numbers are those of the PDF specification (bit 1 is the lowest). */
export function permissionBits(p: Permissions): number {
  let bits = 0xfffff0c0; // bits 7–8 and 13–32 set, as required
  const set = (bit: number, on: boolean) => {
    if (on) bits |= 1 << (bit - 1);
  };
  set(3, p.print !== 'none');
  set(4, p.modify);
  set(5, p.copy);
  set(6, p.annotate);
  set(9, p.fillForms || p.annotate);
  set(10, p.accessibility || p.copy);
  set(11, p.assemble || p.modify);
  set(12, p.print === 'high');
  return bits | 0;
}

export function permissionsFromBits(bits: number): Permissions {
  const on = (bit: number) => (bits & (1 << (bit - 1))) !== 0;
  return {
    print: on(3) ? (on(12) ? 'high' : 'low') : 'none',
    modify: on(4),
    copy: on(5),
    annotate: on(6),
    fillForms: on(9),
    assemble: on(11),
    accessibility: on(10),
  };
}

// --- Primitives ---------------------------------------------------------------------------------

const subtle = () => globalThis.crypto.subtle;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function digest(algo: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest(algo, data as BufferSource));
}

/** AES-CBC over data that is a whole number of blocks, without padding. */
async function aesCbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt']);
  // WebCrypto always pads; the padding is one extra block at the end, dropped here.
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, data as BufferSource));
  return out.slice(0, data.length);
}

async function aesCbcDecryptNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt', 'decrypt']);
  // Add a padding block that decrypts to sixteen 16s, so WebCrypto's padding check passes.
  const last = data.slice(data.length - 16);
  const pad = await aesCbcNoPad(key, last, new Uint8Array(16).fill(16));
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, concat(data, pad) as BufferSource));
}

/** Passwords as UTF-8, at most 127 bytes (the specification's limit). */
const passwordBytes = (s: string) => new TextEncoder().encode(s).slice(0, 127);

/** Algorithm 2.B of ISO 32000-2: the revision 6 password hash. */
export async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array = new Uint8Array(0)): Promise<Uint8Array> {
  let k: Uint8Array = await digest('SHA-256', concat(password, salt, udata));
  let e: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < 64 || e[e.length - 1]! > i - 32; i++) {
    const one = concat(password, k, udata);
    const k1 = new Uint8Array(one.length * 64);
    for (let j = 0; j < 64; j++) k1.set(one, j * one.length);
    e = await aesCbcNoPad(k.slice(0, 16), k.slice(16, 32), k1);
    // The first 16 bytes as a big number, mod 3 (256 ≡ 1 mod 3, so the byte sum mod 3 is the same).
    const mod = e.slice(0, 16).reduce((a, b) => a + b, 0) % 3;
    k = await digest(mod === 0 ? 'SHA-256' : mod === 1 ? 'SHA-384' : 'SHA-512', e);
  }
  return k.slice(0, 32);
}

// --- Writing ------------------------------------------------------------------------------------

async function encryptBytes(fileKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = random(16);
  return concat(iv, new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, fileKey, data as BufferSource)));
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Encrypts the strings inside an object (recursively), in place. */
async function encryptStrings(obj: PDFObject, key: CryptoKey): Promise<void> {
  if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) {
      if (v instanceof PDFString || v instanceof PDFHexString) obj.set(k, PDFHexString.of(hex(await encryptBytes(key, v.asBytes()))));
      else await encryptStrings(v, key);
    }
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i);
      if (v instanceof PDFString || v instanceof PDFHexString) obj.set(i, PDFHexString.of(hex(await encryptBytes(key, v.asBytes()))));
      else await encryptStrings(v, key);
    }
  } else if (obj instanceof PDFStream) {
    await encryptStrings(obj.dict, key);
  }
}

/** A copy of the PDF protected by `settings` (AES-256). The input must not be encrypted already. */
export async function encryptPdf(bytes: ArrayBuffer | Uint8Array, settings: SecuritySettings): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const fileKeyBytes = random(32);
  const fileKey = await subtle().importKey('raw', fileKeyBytes as BufferSource, 'AES-CBC', false, ['encrypt']);

  // Every indirect object: streams' data and all strings.
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      const data = obj.getContents();
      const dict = obj.dict.clone(ctx);
      await encryptStrings(dict, fileKey);
      dict.delete(PDFName.of('Length'));
      ctx.assign(ref, PDFRawStream.of(dict, await encryptBytes(fileKey, data)));
    } else {
      await encryptStrings(obj, fileKey);
    }
  }

  // The keys: user (open) and owner (permissions) entries, and the encrypted permissions.
  const user = passwordBytes(settings.openPassword);
  const owner = passwordBytes(settings.permissionsPassword || hex(random(16)));
  const uvs = random(8);
  const uks = random(8);
  const U = concat(await hash2B(user, uvs), uvs, uks);
  const UE = await aesCbcNoPad(await hash2B(user, uks), new Uint8Array(16), fileKeyBytes);
  const ovs = random(8);
  const oks = random(8);
  const O = concat(await hash2B(owner, ovs, U), ovs, oks);
  const OE = await aesCbcNoPad(await hash2B(owner, oks, U), new Uint8Array(16), fileKeyBytes);
  const P = permissionBits(settings.permissions);
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, P, true);
  perms.set([0xff, 0xff, 0xff, 0xff, 0x54, 0x61, 0x64, 0x62], 4); // FFFFFFFF, 'T' (metadata encrypted), 'adb'
  perms.set(random(4), 12);
  const Perms = await aesCbcNoPad(fileKeyBytes, new Uint8Array(16), perms);

  const encrypt = ctx.obj({
    Filter: 'Standard',
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF',
    StrF: 'StdCF',
    O: PDFHexString.of(hex(O)),
    U: PDFHexString.of(hex(U)),
    OE: PDFHexString.of(hex(OE)),
    UE: PDFHexString.of(hex(UE)),
    P: PDFNumber.of(P),
    Perms: PDFHexString.of(hex(Perms)),
    EncryptMetadata: true,
  });
  ctx.trailerInfo.Encrypt = ctx.register(encrypt);
  const id = PDFHexString.of(hex(random(16)));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  // Object streams would hide objects from per-object encryption; appearances must not be rebuilt unencrypted.
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

// --- Reading (checks) ---------------------------------------------------------------------------

export interface SecurityInfo {
  encrypted: boolean;
  /** Revision of the standard security handler (2–6), when encrypted. */
  revision: number | null;
  permissions: Permissions | null;
}

/** Whether a PDF is encrypted, and with what. Works without the password. */
export async function readSecurity(bytes: ArrayBuffer | Uint8Array): Promise<SecurityInfo> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const e = doc.context.trailerInfo.Encrypt;
  const dict = e instanceof PDFRef ? doc.context.lookup(e, PDFDict) : e instanceof PDFDict ? e : null;
  if (!dict) return { encrypted: false, revision: null, permissions: null };
  const num = (k: string) => {
    const v = dict.lookup(PDFName.of(k));
    return v instanceof PDFNumber ? v.asNumber() : null;
  };
  const p = num('P');
  return { encrypted: true, revision: num('R'), permissions: p === null ? null : permissionsFromBits(p) };
}

/**
 * Checks a password against a revision 6 file: 'open' (the user password), 'permissions' (the
 * owner password) or null. Used by tests and to tell someone which password they typed.
 */
export async function checkPassword(bytes: ArrayBuffer | Uint8Array, password: string): Promise<'open' | 'permissions' | null> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const e = doc.context.trailerInfo.Encrypt;
  const dict = e instanceof PDFRef ? doc.context.lookup(e, PDFDict) : null;
  if (!dict) return null;
  const get = (k: string) => (dict.lookup(PDFName.of(k)) as PDFHexString | PDFString).asBytes();
  const U = get('U');
  const O = get('O');
  const pw = passwordBytes(password);
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (same(await hash2B(pw, O.slice(32, 40), U.slice(0, 48)), O.slice(0, 32))) return 'permissions';
  if (same(await hash2B(pw, U.slice(32, 40)), U.slice(0, 32))) return 'open';
  return null;
}

/** The file key from the open password (Algorithm 2.A), for tests that read an encrypted file back. */
export async function fileKeyFor(bytes: ArrayBuffer | Uint8Array, password: string): Promise<Uint8Array | null> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const e = doc.context.trailerInfo.Encrypt;
  const dict = e instanceof PDFRef ? doc.context.lookup(e, PDFDict) : null;
  if (!dict) return null;
  const get = (k: string) => (dict.lookup(PDFName.of(k)) as PDFHexString | PDFString).asBytes();
  const U = get('U');
  const pw = passwordBytes(password);
  if ((await checkPassword(bytes, password)) !== 'open') return null;
  return aesCbcDecryptNoPad(await hash2B(pw, U.slice(40, 48)), new Uint8Array(16), get('UE'));
}

/** Decrypts one encrypted string or stream's data with the file key. */
export async function decryptBytes(fileKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', fileKey as BufferSource, 'AES-CBC', false, ['decrypt']);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: data.slice(0, 16) as BufferSource }, k, data.slice(16) as BufferSource));
}
