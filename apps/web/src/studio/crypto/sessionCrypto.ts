import {
  aesKey,
  canonical,
  fingerprint,
  fromB64url,
  importIdentity,
  newIdentity,
  newKeyBytes,
  exportIdentity,
  seal,
  SEALED_JSON_KEY,
  sealedEpoch,
  sealedJsonBytes,
  signBytes,
  signed,
  toB64url,
  unseal,
  unwrapFrom,
  verified,
  verifyBytes,
  wrapFor,
  type Identity,
  type PublicIdentity,
  type SessionSecret,
} from './keys';
import type { HostKeys } from './store';

/** Someone the host has let into an encrypted session, with the keys their seat signs with. */
export interface AdmittedSeat {
  name: string;
  email?: string;
  keys: PublicIdentity;
  /** The host's own seat. */
  host?: boolean;
  /** Taken out of the session: their files are ignored and later keys are not wrapped for them. */
  revoked?: boolean;
  /** `email` is who the drive says made the seat, not what the seat claims: access is matched by it alone. */
  verified?: boolean;
}

/** The encryption part of a session's manifest, written and signed by the host only. */
export interface EncManifest {
  v: 1;
  /** The host's keys for this session (the link pins the signing key's fingerprint). */
  host: PublicIdentity;
  /** Admitted seats, by seat file ID. */
  seats: Record<string, AdmittedSeat>;
  /** Session keys after the link's own (epoch 0), each wrapped for every seat still in. */
  epochs: { n: number; wrapped: Record<string, string> }[];
}

const wrapInfo = (n: number) => `nb-session-epoch-${n}`;
const te = new TextEncoder();
const td = new TextDecoder();

/**
 * One encrypted session's keys in this browser: the link's key, any later ones unwrapped for this
 * person's seat, this person's identity (which signs their room files), and, for the host, the
 * host's keys (which sign the manifest and wrap later keys).
 */
export class SessionCrypto {
  readonly secret: SessionSecret;
  readonly me: Identity;
  host: Identity | null = null;
  private keys = new Map<number, CryptoKey>();
  /** Raw session keys, kept by the host to wrap them for new seats. */
  private raw = new Map<number, Uint8Array>();

  private constructor(secret: SessionSecret, me: Identity) {
    this.secret = secret;
    this.me = me;
  }

  static async create(secret: SessionSecret, me: Identity, epochs: Record<string, string> = {}): Promise<SessionCrypto> {
    const c = new SessionCrypto(secret, me);
    const first = fromB64url(secret.key);
    c.keys.set(0, await aesKey(first));
    c.raw.set(0, first);
    for (const [n, raw] of Object.entries(epochs)) await c.addEpoch(Number(n), fromB64url(raw));
    return c;
  }

  /** A new encrypted session: a fresh link key and host keys. */
  static async start(me: Identity): Promise<{ crypto: SessionCrypto; hostKeys: HostKeys; host: PublicIdentity }> {
    const host = await newIdentity(true);
    const key = newKeyBytes();
    const crypto = await SessionCrypto.create({ key: toB64url(key), host: host.fp }, me);
    crypto.host = host;
    const saved = await exportIdentity(host);
    return { crypto, hostKeys: { ...saved, epochs: { '0': toB64url(key) } }, host: host.pub };
  }

  /** Takes on the host's keys (from the host's app folder) after checking they match the link. */
  async adoptHost(keys: HostKeys): Promise<boolean> {
    const host = await importIdentity(keys);
    if (host.fp !== this.secret.host) return false;
    this.host = host;
    for (const [n, raw] of Object.entries(keys.epochs)) await this.addEpoch(Number(n), fromB64url(raw));
    return true;
  }

  /** The host's keys as saved in its app folder. */
  async hostKeys(): Promise<HostKeys> {
    if (!this.host) throw new Error('Only the host has these keys.');
    return { ...(await exportIdentity(this.host)), epochs: Object.fromEntries([...this.raw].map(([n, raw]) => [String(n), toB64url(raw)])) };
  }

  /** Session keys this person has beyond the link's, for this browser to remember. */
  knownEpochs(): Record<string, string> {
    return Object.fromEntries([...this.raw].filter(([n]) => n > 0).map(([n, raw]) => [String(n), toB64url(raw)]));
  }

  private async addEpoch(n: number, raw: Uint8Array) {
    this.raw.set(n, raw);
    this.keys.set(n, await aesKey(raw));
  }

  /** The newest session key this browser holds. */
  get latest(): number {
    return Math.max(...this.keys.keys());
  }

  /** Unwraps any session keys the host has wrapped for our seat. Returns true when a new one arrived. */
  async learn(enc: EncManifest | undefined, seatId: string | null): Promise<boolean> {
    if (!enc) return false;
    let added = false;
    for (const e of enc.epochs) {
      if (this.keys.has(e.n)) continue;
      const wrapped = seatId ? e.wrapped[seatId] : undefined;
      if (!wrapped) continue;
      try {
        await this.addEpoch(e.n, await unwrapFrom(this.me.dh, enc.host.dh, wrapped, wrapInfo(e.n)));
        added = true;
      } catch {
        // Wrapped for another key of ours (another browser on this seat): not readable here.
      }
    }
    return added;
  }

  // ---- Sealing ----

  async sealBytes(plain: Uint8Array, epoch = this.latest): Promise<Uint8Array> {
    return seal(this.keys.get(epoch)!, epoch, plain);
  }

  /** The plain bytes, or null when the key for that epoch is not ours (yet). Throws on tampering. */
  async openBytes(sealed: Uint8Array): Promise<Uint8Array | null> {
    const epoch = sealedEpoch(sealed);
    if (epoch === null) throw new Error('This file is not encrypted, but the session is.');
    const key = this.keys.get(epoch);
    return key ? unseal(key, sealed) : null;
  }

  /** JSON sealed with the link's key, so everyone with the link can read it (seats and the manifest). */
  async sealJson(value: unknown): Promise<Blob> {
    const sealed = await this.sealBytes(te.encode(JSON.stringify(value)), 0);
    return new Blob([JSON.stringify({ [SEALED_JSON_KEY]: toB64url(sealed) })], { type: 'application/json' });
  }

  async openJson<T>(raw: Uint8Array): Promise<T> {
    const sealed = sealedJsonBytes(raw);
    if (!sealed) throw new Error('This file is not encrypted, but the session is.');
    const plain = await this.openBytes(sealed);
    if (!plain) throw new Error('This file was encrypted with a key this browser does not have.');
    return JSON.parse(td.decode(plain)) as T;
  }

  // ---- Room files: signed by their seat, then sealed ----

  async sealRoom(update: Uint8Array): Promise<Uint8Array> {
    return this.sealBytes(await signed(this.me, update));
  }

  /** The update if `signer` wrote it; 'wait' when the key is not ours yet; 'bad' when it fails. */
  async openRoom(sealed: Uint8Array, signer: JsonWebKey): Promise<Uint8Array | 'wait' | 'bad'> {
    let plain: Uint8Array | null;
    try {
      plain = await this.openBytes(sealed);
    } catch {
      return 'bad';
    }
    if (!plain) return 'wait';
    return (await verified(signer, plain)) ?? 'bad';
  }

  // ---- The manifest: signed by the host, sealed with the link's key ----

  async sealManifest<M extends { sig?: string }>(manifest: M): Promise<Blob> {
    if (!this.host) throw new Error('This session is end-to-end encrypted: only the host’s keys can change it. Open it where you started it, signed in as the host.');
    const { sig: _sig, ...rest } = manifest;
    const sig = toB64url(await signBytes(this.host, te.encode(canonical(rest))));
    return this.sealJson({ ...rest, sig });
  }

  /** Opens the manifest and checks the host signed it with the key the link names. */
  async openManifest<M extends { enc?: EncManifest; sig?: string }>(raw: Uint8Array): Promise<M> {
    const m = await this.openJson<M>(raw);
    const { sig, ...rest } = m;
    if (!m.enc || !sig || (await fingerprint(m.enc.host.sign)) !== this.secret.host || !(await verifyBytes(m.enc.host.sign, te.encode(canonical(rest)), fromB64url(sig)))) {
      throw new Error('The session’s manifest is not signed by its host. It may have been changed by someone else.');
    }
    return m;
  }

  // ---- Host only ----

  /** Wraps every session key after the link's for a newly admitted seat. */
  async wrapAllFor(enc: EncManifest, seatId: string, keys: PublicIdentity): Promise<EncManifest> {
    const host = this.host!;
    const epochs = [];
    for (const e of enc.epochs) {
      const raw = this.raw.get(e.n);
      epochs.push(raw ? { ...e, wrapped: { ...e.wrapped, [seatId]: await wrapFor(host.dh, keys.dh, raw, wrapInfo(e.n)) } } : e);
    }
    return { ...enc, epochs };
  }

  /** A new session key, wrapped for every seat still in: what is written from now on, they alone can read. */
  async rotate(enc: EncManifest): Promise<EncManifest> {
    const host = this.host!;
    const n = Math.max(0, ...enc.epochs.map((e) => e.n), ...this.raw.keys()) + 1;
    const raw = newKeyBytes();
    await this.addEpoch(n, raw);
    const wrapped: Record<string, string> = {};
    for (const [seatId, seat] of Object.entries(enc.seats)) if (!seat.revoked) wrapped[seatId] = await wrapFor(host.dh, seat.keys.dh, raw, wrapInfo(n));
    return { ...enc, epochs: [...enc.epochs, { n, wrapped }] };
  }
}
