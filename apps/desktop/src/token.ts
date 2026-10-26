import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pkcs11js from 'pkcs11js';

/**
 * Smart cards and USB tokens, through their PKCS#11 driver (OpenSC, YubiKey, SafeNet, Thales…).
 * The private key never leaves the card: the page sends the bytes to sign and gets the signature
 * value back (apps/web/src/documents/pdfSign.ts, Signer).
 *
 * A driver is native code that runs in this process, so the page never names one: drivers are
 * the common install paths below that exist on this computer, or files the person picked in a
 * native dialog (kept in userData). The page only ever sees their IDs.
 *
 * The PIN is used for one signature and forgotten; it is never stored. Each operation loads the
 * driver, does its work and unloads it, so a card pulled out or swapped is simply seen again.
 */

export interface TokenModule {
  id: string;
  name: string;
  /** Picked by the person (can be removed), not one of the common install paths. */
  added: boolean;
}

export interface TokenCertificate {
  /** Which key to sign with: opaque to the page. */
  ref: string;
  /** The certificate's label on the token. */
  label: string;
  /** The token's label (the card's name). */
  token: string;
  module: string;
  certificate: Uint8Array;
  /** The other certificates on the same token (often the issuing CAs), to complete the chain. */
  others: Uint8Array[];
  /** A private key with the certificate's ID is visible; null when keys only show after the PIN. */
  hasKey: boolean | null;
  /** The PIN is entered on the reader's own keypad. */
  pinPad: boolean;
}

export interface TokenProblem {
  module: string;
  problem: string;
}

export type TokenHash = 'SHA-256' | 'SHA-384' | 'SHA-512';

/** Common install paths of PKCS#11 drivers, by platform. Only those that exist are offered. */
const KNOWN: Record<string, [string, string][]> = {
  win32: [
    ['OpenSC', 'C:\\Windows\\System32\\opensc-pkcs11.dll'],
    ['OpenSC', 'C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll'],
    ['SafeNet Authentication Client', 'C:\\Windows\\System32\\eTPKCS11.dll'],
    ['Thales IDPrime', 'C:\\Windows\\System32\\IDPrimePKCS11.dll'],
    ['YubiKey', 'C:\\Program Files\\Yubico\\Yubico PIV Tool\\bin\\libykcs11.dll'],
  ],
  darwin: [
    ['OpenSC', '/Library/OpenSC/lib/opensc-pkcs11.so'],
    ['OpenSC', '/opt/homebrew/lib/opensc-pkcs11.so'],
    ['OpenSC', '/usr/local/lib/opensc-pkcs11.so'],
    ['YubiKey', '/opt/homebrew/lib/libykcs11.dylib'],
    ['YubiKey', '/usr/local/lib/libykcs11.dylib'],
    ['SafeNet Authentication Client', '/usr/local/lib/libeTPkcs11.dylib'],
  ],
  linux: [
    ['OpenSC', '/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so'],
    ['OpenSC', '/usr/lib64/opensc-pkcs11.so'],
    ['OpenSC', '/usr/lib/opensc-pkcs11.so'],
    ['YubiKey', '/usr/lib/x86_64-linux-gnu/libykcs11.so'],
    ['SafeNet Authentication Client', '/usr/lib/libeTPkcs11.so'],
  ],
};

/** DigestInfo prefixes (RFC 8017, 9.2): CKM_RSA_PKCS signs DigestInfo, which every RSA card supports. */
const DIGEST_INFO: Record<TokenHash, Buffer> = {
  'SHA-256': Buffer.from('3031300d060960864801650304020105000420', 'hex'),
  'SHA-384': Buffer.from('3041300d060960864801650304020205000430', 'hex'),
  'SHA-512': Buffer.from('3051300d060960864801650304020305000440', 'hex'),
};

const MAX_TO_SIGN = 8 * 1024;
const MAX_PIN = 256;

interface Stored {
  id: string;
  path: string;
  name: string;
}

interface Driver extends Stored {
  added: boolean;
}

type Lib = pkcs11js.PKCS11;
type Handle = Buffer;

/** A token's identity across sessions: its serial number and label (padded fields, trimmed). */
const tokenKey = (info: pkcs11js.TokenInfo) => `${info.serialNumber.trim()}\u0000${info.label.trim()}`;

/** A DER INTEGER for an unsigned big-endian value. */
function derInt(b: Buffer): Buffer {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b[i]! & 0x80 ? Buffer.concat([Buffer.from([0]), b.subarray(i)]) : b.subarray(i);
  return Buffer.concat([Buffer.from([0x02]), derLength(v.length), v]);
}
function derLength(n: number): Buffer {
  return n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
}
/** PKCS#11 ECDSA's r‖s as the DER SEQUENCE a CMS carries. */
export function ecdsaToDer(raw: Buffer): Buffer {
  const half = raw.length / 2;
  const body = Buffer.concat([derInt(raw.subarray(0, half)), derInt(raw.subarray(half))]);
  return Buffer.concat([Buffer.from([0x30]), derLength(body.length), body]);
}

/** A PKCS#11 failure in words a person can act on. */
function explain(err: unknown): Error {
  const code = (err as { code?: number }).code;
  const words: Record<number, string> = {
    [pkcs11js.CKR_PIN_INCORRECT]: 'The PIN is not right.',
    [pkcs11js.CKR_PIN_LOCKED]: 'The card is locked after too many wrong PINs. Unlock it with its PUK or administrator tool.',
    [pkcs11js.CKR_PIN_EXPIRED]: 'The card’s PIN has expired. Change it with the card’s own tool first.',
    [pkcs11js.CKR_PIN_LEN_RANGE]: 'The PIN is too short or too long for this card.',
    [pkcs11js.CKR_TOKEN_NOT_PRESENT]: 'The card or token is not inserted.',
    [pkcs11js.CKR_DEVICE_REMOVED]: 'The card or token was removed.',
    [pkcs11js.CKR_FUNCTION_CANCELED]: 'Cancelled on the reader.',
    [pkcs11js.CKR_KEY_FUNCTION_NOT_PERMITTED]: 'This key is not allowed to sign.',
    [pkcs11js.CKR_MECHANISM_INVALID]: 'This card cannot sign that way.',
  };
  if (typeof code === 'number' && words[code]) return new Error(words[code]);
  return new Error(`The card did not sign: ${err instanceof Error ? err.message : String(err)}`);
}

export class TokenService {
  private added: Stored[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly known: Driver[];
  private readonly storeFile: string;

  /** `known` replaces the common install paths (tests). */
  constructor(storeFile: string, known?: [string, string][]) {
    this.storeFile = storeFile;
    this.known = (known ?? KNOWN[process.platform] ?? []).map(([name, p]) => ({ id: `known:${p}`, name, path: p, added: false }));
  }

  async restore() {
    try {
      const saved = JSON.parse(await fs.readFile(this.storeFile, 'utf8')) as Stored[];
      this.added = Array.isArray(saved) ? saved.filter((s) => s && typeof s.id === 'string' && typeof s.path === 'string' && typeof s.name === 'string' && path.isAbsolute(s.path)) : [];
    } catch {
      this.added = [];
    }
  }

  private async drivers(): Promise<Driver[]> {
    const exists = async (p: string) => fs.stat(p).then((s) => s.isFile(), () => false);
    const known: Driver[] = [];
    for (const d of this.known) if (await exists(d.path)) known.push(d);
    return [...known.filter((k) => !this.added.some((a) => a.path === k.path)), ...this.added.map((a) => ({ ...a, added: true }))];
  }

  async modules(): Promise<TokenModule[]> {
    return (await this.drivers()).map(({ id, name, added }) => ({ id, name, added }));
  }

  /** A driver file the person picked in a native dialog (never a path from the page). */
  async addModule(file: string): Promise<TokenModule> {
    if (!path.isAbsolute(file) || !(await fs.stat(file).then((s) => s.isFile(), () => false))) throw new Error('That driver file cannot be read.');
    const existing = this.added.find((a) => a.path === file);
    if (existing) return { id: existing.id, name: existing.name, added: true };
    // One of the common install paths: keep its own ID, which card IDs already added refer to.
    const known = this.known.find((k) => k.path.toLowerCase() === file.toLowerCase());
    if (known) return { id: known.id, name: known.name, added: false };
    // Check it really is a PKCS#11 driver before keeping it.
    const name = await this.run({ id: '', name: '', path: file }, (lib) => {
      const info = lib.C_GetInfo();
      return info.manufacturerID.trim() || info.libraryDescription.trim() || path.basename(file);
    });
    const stored = { id: randomBytes(8).toString('hex'), name, path: file };
    this.added.push(stored);
    await this.save();
    return { id: stored.id, name: stored.name, added: true };
  }

  async removeModule(id: string) {
    this.added = this.added.filter((a) => a.id !== id);
    await this.save();
  }

  private async save() {
    await fs.mkdir(path.dirname(this.storeFile), { recursive: true });
    await fs.writeFile(this.storeFile, JSON.stringify(this.added));
  }

  /**
   * Loads a driver, runs `job` and unloads it; one at a time, as drivers and cards expect.
   * PKCS#11 calls block (pkcs11js has no asynchronous C_Login), so the main process waits while a
   * card checks its PIN: usually well under a second, but as long as the person takes on a reader
   * with its own keypad. Moving this into a utility process would keep the window responsive.
   */
  private run<T>(driver: Stored, job: (lib: Lib) => T): Promise<T> {
    const next = this.queue.then(() => {
      const lib = new pkcs11js.PKCS11();
      try {
        lib.load(driver.path);
      } catch (err) {
        throw new Error(`The driver ${driver.name || path.basename(driver.path)} did not load: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        // Initialised by something else in this process (Chromium's NSS can load the same driver):
        // use it, and leave finalising it to whoever set it up.
        let mine = true;
        try {
          lib.C_Initialize({ flags: pkcs11js.CKF_OS_LOCKING_OK });
        } catch (err) {
          if ((err as { code?: number }).code !== pkcs11js.CKR_CRYPTOKI_ALREADY_INITIALIZED) throw err;
          mine = false;
        }
        try {
          return job(lib);
        } finally {
          try {
            if (mine) lib.C_Finalize();
          } catch {
            // Already finalised or the card went away; unloading is what matters.
          }
        }
      } finally {
        lib.close();
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Every certificate on every inserted token, with what to sign with; drivers that fail are reported. */
  async certificates(): Promise<{ certificates: TokenCertificate[]; problems: TokenProblem[] }> {
    const certificates: TokenCertificate[] = [];
    const problems: TokenProblem[] = [];
    for (const driver of await this.drivers()) {
      try {
        certificates.push(...(await this.run(driver, (lib) => listOn(lib, driver))));
      } catch (err) {
        problems.push({ module: driver.name, problem: err instanceof Error ? err.message : String(err) });
      }
    }
    return { certificates, problems };
  }

  /**
   * Signs `data` (the DER of a signature's signed attributes) with the key `ref` names: the hash
   * is made here, the card signs it. `pin` is null on a reader with its own keypad.
   */
  async sign(ref: unknown, hash: unknown, data: unknown, pin: unknown): Promise<Uint8Array> {
    if (typeof ref !== 'string' || ref.length > 1024) throw new Error('That key is not on this computer.');
    if (hash !== 'SHA-256' && hash !== 'SHA-384' && hash !== 'SHA-512') throw new Error('That digest is not supported.');
    if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_TO_SIGN) throw new Error('That is not something to sign.');
    if (pin !== null && (typeof pin !== 'string' || pin.length === 0 || pin.length > MAX_PIN)) throw new Error('Enter the PIN.');
    let parsed: { m: string; t: string; k: string };
    try {
      parsed = JSON.parse(ref) as typeof parsed;
    } catch {
      throw new Error('That key is not on this computer.');
    }
    const driver = (await this.drivers()).find((d) => d.id === parsed.m);
    if (!driver || typeof parsed.t !== 'string' || typeof parsed.k !== 'string' || !/^[0-9a-f]*$/.test(parsed.k)) throw new Error('That card’s driver is no longer set up on this computer.');
    const digest = createHash(hash.replace('-', '').toLowerCase()).update(data).digest();
    return this.run(driver, (lib) => signOn(lib, parsed.t, Buffer.from(parsed.k, 'hex'), hash, digest, pin as string | null));
  }
}

function find(lib: Lib, session: Handle, template: pkcs11js.Template): Handle[] {
  lib.C_FindObjectsInit(session, template);
  try {
    const out: Handle[] = [];
    for (;;) {
      const batch = lib.C_FindObjects(session, 32);
      out.push(...batch);
      if (batch.length < 32) return out;
    }
  } finally {
    lib.C_FindObjectsFinal(session);
  }
}

function attrs(lib: Lib, session: Handle, object: Handle, types: number[]): Map<number, pkcs11js.Attribute['value']> {
  const out = new Map<number, pkcs11js.Attribute['value']>();
  for (const type of types) {
    // One at a time: a card may refuse one attribute and answer the rest.
    try {
      out.set(type, lib.C_GetAttributeValue(session, object, [{ type }])[0]?.value);
    } catch {
      // Not readable on this card.
    }
  }
  return out;
}

/** A CK_ULONG attribute: pkcs11js hands it back as the native bytes (little-endian on every platform we ship). */
const ulong = (v: pkcs11js.Attribute['value']) => (typeof v === 'number' ? v : Buffer.isBuffer(v) && v.length ? v.readUIntLE(0, Math.min(v.length, 6)) : null);
/** A CK_BBOOL attribute, as one byte. */
const bool = (v: pkcs11js.Attribute['value']) => (typeof v === 'boolean' ? v : Buffer.isBuffer(v) ? v.some((b) => b !== 0) : false);

/** The slot holding the token, by serial number and label. */
function slotOf(lib: Lib, token: string): { slot: Handle; info: pkcs11js.TokenInfo } {
  for (const slot of lib.C_GetSlotList(true)) {
    const info = lib.C_GetTokenInfo(slot);
    if (tokenKey(info) === token) return { slot, info };
  }
  throw new Error('The card or token is not inserted.');
}

/** A CA certificate that issued another certificate on the same token: the chain, not an ID. */
function issuerOfAnother(ders: Uint8Array[], k: number): boolean {
  try {
    const ca = new X509Certificate(ders[k]!);
    if (!ca.ca) return false;
    return ders.some((d, j) => {
      if (j === k) return false;
      try {
        return new X509Certificate(d).checkIssued(ca);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function listOn(lib: Lib, driver: Driver): TokenCertificate[] {
  const out: TokenCertificate[] = [];
  for (const slot of lib.C_GetSlotList(true)) {
    let info: pkcs11js.TokenInfo;
    let session: Handle;
    // A blank card (or a reader slot that is not a token) is skipped, not an error for the others.
    try {
      info = lib.C_GetTokenInfo(slot);
      if (!(info.flags & pkcs11js.CKF_TOKEN_INITIALIZED)) continue;
      session = lib.C_OpenSession(slot, pkcs11js.CKF_SERIAL_SESSION);
    } catch {
      continue;
    }
    try {
      const certs = find(lib, session, [{ type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_CERTIFICATE }])
        .map((h) => attrs(lib, session, h, [pkcs11js.CKA_VALUE, pkcs11js.CKA_ID, pkcs11js.CKA_LABEL]))
        .filter((a) => Buffer.isBuffer(a.get(pkcs11js.CKA_VALUE)));
      const keyIds = new Set(
        find(lib, session, [{ type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PRIVATE_KEY }]).map((h) => {
          const id = attrs(lib, session, h, [pkcs11js.CKA_ID]).get(pkcs11js.CKA_ID);
          return Buffer.isBuffer(id) ? id.toString('hex') : '';
        }),
      );
      const ders = certs.map((a) => new Uint8Array(a.get(pkcs11js.CKA_VALUE) as Buffer));
      certs.forEach((a, k) => {
        // The issuing CAs a card carries complete the chain; they are not IDs to sign with. Keys
        // usually only show after the PIN, so hasKey cannot tell them apart.
        if (issuerOfAnother(ders, k)) return;
        const id = a.get(pkcs11js.CKA_ID);
        const keyId = Buffer.isBuffer(id) ? id.toString('hex') : '';
        const label = a.get(pkcs11js.CKA_LABEL);
        out.push({
          ref: JSON.stringify({ m: driver.id, t: tokenKey(info), k: keyId }),
          label: Buffer.isBuffer(label) ? label.toString('utf8') : typeof label === 'string' ? label : '',
          token: info.label.trim(),
          module: driver.name,
          certificate: ders[k]!,
          others: ders.filter((_, j) => j !== k),
          hasKey: keyIds.has(keyId) ? true : keyIds.size ? false : null,
          pinPad: (info.flags & pkcs11js.CKF_PROTECTED_AUTHENTICATION_PATH) !== 0,
        });
      });
    } finally {
      lib.C_CloseSession(session);
    }
  }
  return out;
}

function signOn(lib: Lib, token: string, keyId: Buffer, hash: TokenHash, digest: Buffer, pin: string | null): Uint8Array {
  const { slot, info } = slotOf(lib, token);
  const pinPad = (info.flags & pkcs11js.CKF_PROTECTED_AUTHENTICATION_PATH) !== 0;
  if (pin === null && !pinPad) throw new Error('Enter the PIN.');
  const session = lib.C_OpenSession(slot, pkcs11js.CKF_SERIAL_SESSION);
  let loggedIn = false;
  try {
    const login = () => {
      lib.C_Login(session, pkcs11js.CKU_USER, pin ?? undefined);
      loggedIn = true;
    };
    try {
      login();
    } catch (err) {
      if ((err as { code?: number }).code !== pkcs11js.CKR_USER_ALREADY_LOGGED_IN) throw explain(err);
      // Someone else's login would let any PIN sign: log out and check this one.
      try {
        lib.C_Logout(session);
        login();
      } catch (again) {
        throw explain(again);
      }
    }
    const [key] = find(lib, session, [
      { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PRIVATE_KEY },
      { type: pkcs11js.CKA_ID, value: keyId },
    ]);
    if (!key) throw new Error('The key for this certificate is not on the card.');
    const a = attrs(lib, session, key, [pkcs11js.CKA_KEY_TYPE, pkcs11js.CKA_ALWAYS_AUTHENTICATE]);
    const type = ulong(a.get(pkcs11js.CKA_KEY_TYPE));
    const rsa = type === pkcs11js.CKK_RSA;
    if (!rsa && type !== pkcs11js.CKK_EC) throw new Error('The card’s key is neither RSA nor ECDSA.');
    try {
      lib.C_SignInit(session, { mechanism: rsa ? pkcs11js.CKM_RSA_PKCS : pkcs11js.CKM_ECDSA }, key);
      // Signature keys on PIV cards and qualified signature cards want the PIN for every signature.
      if (bool(a.get(pkcs11js.CKA_ALWAYS_AUTHENTICATE))) lib.C_Login(session, pkcs11js.CKU_CONTEXT_SPECIFIC, pin ?? undefined);
      const signature = lib.C_Sign(session, rsa ? Buffer.concat([DIGEST_INFO[hash], digest]) : digest, Buffer.alloc(1024));
      return new Uint8Array(rsa ? signature : ecdsaToDer(signature));
    } catch (err) {
      throw explain(err);
    }
  } finally {
    if (loggedIn) {
      try {
        lib.C_Logout(session);
      } catch {
        // The session is closed next anyway.
      }
    }
    lib.C_CloseSession(session);
  }
}
