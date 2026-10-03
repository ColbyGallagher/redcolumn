import * as Y from 'yjs';
import type { MarkupStore } from '@nb/markup';
import { accessFor, isExpired, sameName, SESSION_ROOM, type AccessPolicy, type Attendee, type Permissions, type RecordEntry, type SessionDocument, type SessionMeta } from '../protocol';
import { forgetCurrentSession, inviteLink, readLocal, rememberSession, writeLocal } from '../local';
import { appendRecord, describeChanges, recordId, watchMarkups } from '../record';
import { attendeeColor, type CollabSession, type ConnectionStatus, type Presence, type SessionUpdate, type StudioSnapshot } from '../types';
import { DriveAuthError, DriveForbiddenError, type DriveApi, type DriveFile, type DriveProps } from './DriveApi';

/**
 * A Live Session kept in a Google Drive or OneDrive folder, with no server of ours in between:
 *
 *   Apps/redcolumn/<name> (redcolumn session)/     shared "anyone with the link"
 *     session.json                     name, host, status, permissions (written by the host only)
 *     *.pdf                            the session's documents
 *     <attendee>.nbseat                one per attendee browser: that attendee's copy of everything
 *
 * Each attendee writes only their own seat file, so nobody's writes collide. A seat holds the
 * attendee's merged Yjs state for every room (the Record and chat, and each document's markups);
 * reading everyone else's seats and merging them gives everyone the same state. Presence (who is
 * where) rides on each seat's file properties. Everyone polls the folder every few seconds.
 */

const MANIFEST = 'manifest';
const SEAT = 'seat';
const DOCUMENT = 'document';
/** A seat not heard from for this long shows as away. */
const ONLINE_MS = 60_000;
const HEARTBEAT_MS = 20_000;
const FLUSH_DELAY_MS = 1200;
const PRESENCE_DELAY_MS = 800;
/** Transaction origin for state merged in from other attendees' seats. */
const REMOTE = Symbol('remote');

interface Manifest {
  v: 1;
  name: string;
  host: string;
  createdAt: number;
  status: 'active' | 'finished';
  endedAt: number | null;
  permissions: Permissions;
  /** Who may view or markup (advisory: each app respects it; Drive sharing is what enforces). */
  access?: AccessPolicy;
  /** Documents the host removed (their files may belong to other attendees, so they stay). */
  removed: string[];
  /** Emails the host invited, listed as attendees until they join. */
  invited?: string[];
  /** When the session ends by itself; the host's app finishes it then. */
  expiresAt?: number | null;
}

interface SeatContent {
  v: 1;
  rooms: Record<string, string>;
}

const SEATS_KEY = 'nb.drive.seats';

/** This browser's seat in a session folder, if it has joined before. */
export function rememberedSeat(folderId: string): string | null {
  return readLocal<Record<string, string>>(SEATS_KEY, {})[folderId] ?? null;
}

function rememberSeat(folderId: string, seatId: string) {
  writeLocal(SEATS_KEY, { ...readLocal<Record<string, string>>(SEATS_KEY, {}), [folderId]: seatId });
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Drive allows 124 bytes per property (key plus value, UTF-8); names are cut to fit. */
function fit(key: string, value: string): string {
  const enc = new TextEncoder();
  let v = value;
  while (enc.encode(key + v).length > 124) v = v.slice(0, -1);
  return v;
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });

export interface DriveSessionOptions {
  /** Signs the user in (Google's popup); only succeeds from a click. */
  authorize: () => Promise<void>;
  /** Poll interval while visible; 0 disables the timers (tests drive `poll`/`flush` directly). */
  pollMs?: number;
  onRemoved: (docId: string) => void;
  /** The attendee's Google email, which identifies them for access (Drive sessions are all signed in). */
  email?: string | null;
  /** The signed-in Google email now (after a reconnect signs in again). */
  identify?: () => string | null;
}

interface Init {
  folderId: string;
  manifestId: string;
  manifest: Manifest;
  isHost: boolean;
  seatId: string | null;
  viewOnly: boolean;
  needsAuth: boolean;
}

export class DriveSession implements CollabSession {
  readonly backend: 'drive' | 'onedrive';
  private api: DriveApi;
  private opts: DriveSessionOptions;
  private folderId: string;
  private manifestId: string;
  private manifest: Manifest;
  private manifestVersion = '';
  private seatId: string | null;
  private ownVersions = new Set<string>();
  private seatVersions = new Map<string, string>();
  private rooms = new Map<string, Y.Doc>();
  private listeners = new Set<() => void>();
  private snap: StudioSnapshot;
  private files: DriveFile[] = [];
  private attached = new Map<string, { store: MarkupStore; detach: () => void }>();
  private here: { docId: string | null; page: number | null } = { docId: null, page: null };
  private dirty = false;
  private flushing: Promise<void> | null = null;
  private polling: Promise<void> | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private presenceTimer: ReturnType<typeof setTimeout> | undefined;
  private loaded: Promise<void>;
  private markLoaded!: () => void;
  private destroyed = false;

  private constructor(api: DriveApi, me: string, init: Init, opts: DriveSessionOptions) {
    this.api = api;
    this.backend = api.backend ?? 'drive';
    this.opts = opts;
    this.folderId = init.folderId;
    this.manifestId = init.manifestId;
    this.manifest = init.manifest;
    this.seatId = init.seatId;
    this.loaded = new Promise((r) => (this.markLoaded = r));
    const meta = this.buildMeta([]);
    this.snap = {
      backend: this.backend,
      meta,
      isHost: init.isHost,
      me,
      status: 'connecting',
      record: [],
      presence: [],
      inviteLink: inviteLink({ backend: this.backend, id: init.folderId }),
      needsAuth: init.needsAuth,
      viewOnly: init.viewOnly,
      email: opts.email ?? null,
      folderUrl: api.folderUrl?.(init.folderId) ?? `https://drive.google.com/drive/folders/${init.folderId}`,
    };
    const record = this.room(SESSION_ROOM).getArray<RecordEntry>('record');
    record.observe(() => this.set({ record: record.toArray() }));
    rememberSession({ backend: this.backend, id: init.folderId }, init.manifest.name);
    if (init.seatId) rememberSeat(init.folderId, init.seatId);
    if (opts.pollMs !== 0) {
      void this.pollLoop();
      this.every(HEARTBEAT_MS, () => void this.pushPresence());
      document.addEventListener('visibilitychange', this.onVisible);
    }
  }

  /** Starts a session: a new shared folder in the host's Drive with the manifest and the host's seat. */
  static async create(api: DriveApi, name: string, me: string, permissions: Permissions, opts: DriveSessionOptions & { linkCanEdit: boolean; access?: AccessPolicy; expiresAt?: number | null }): Promise<DriveSession> {
    await opts.authorize();
    const created = await api.createFolder(`${name} (redcolumn session)`, { nbStudio: 'session' });
    // Everyone reads with the API key, so the folder must be readable by link; editing by link is optional.
    const folderId = (await api.shareWithLink(created, opts.linkCanEdit ? 'writer' : 'reader')) || created;
    const manifest: Manifest = { v: 1, name, host: me, createdAt: Date.now(), status: 'active', endedAt: null, permissions, removed: [], ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}) };
    if (opts.access) {
      manifest.access = opts.access;
      manifest.permissions = { ...permissions, markup: opts.access.default === 'markup' };
    }
    const mf = await api.createFile(folderId, 'session.json', 'application/json', json(manifest), { nbRole: MANIFEST });
    const seat = await DriveSession.createSeat(api, folderId, me, opts.email);
    const session = new DriveSession(api, me, { folderId, manifestId: mf.id, manifest, isHost: true, seatId: seat.id, viewOnly: false, needsAuth: false }, opts);
    session.manifestVersion = mf.version;
    // A brand-new folder has nothing to read yet.
    session.markLoaded();
    session.note('session', `started the session “${name}”`);
    return session;
  }

  /**
   * Joins a session folder. With `interactive` (a click), signs in and adds this attendee's seat;
   * without (rejoining on page load), it reads straight away and asks to reconnect before writing.
   */
  static async join(api: DriveApi, folderId: string, me: string, opts: DriveSessionOptions & { interactive: boolean }): Promise<DriveSession> {
    // OneDrive has no key-based reads, so there a click signs in before the folder can be read.
    const signInFirst = opts.interactive && api.backend === 'onedrive';
    if (signInFirst) await opts.authorize();
    let files: DriveFile[];
    try {
      files = await api.list(folderId);
    } catch (err) {
      if (err instanceof TypeError || err instanceof DriveAuthError) throw err;
      throw new Error('Cannot open that session folder. The host needs to share it with “Anyone with the link”.');
    }
    const mf = files.find((f) => f.properties.nbRole === MANIFEST);
    if (!mf) throw new Error('That folder is not a redcolumn session.');
    const manifest = JSON.parse(new TextDecoder().decode(await api.download(mf.id))) as Manifest;

    let needsAuth = false;
    if (opts.interactive && !signInFirst) await opts.authorize();
    let isHost = false;
    let seatId = rememberedSeat(folderId);
    if (seatId && !files.some((f) => f.id === seatId)) seatId = null;
    let viewOnly = false;
    try {
      isHost = await api.ownedByMe(mf.id);
      if (!seatId) seatId = (await DriveSession.createSeat(api, folderId, me, opts.email)).id;
    } catch (err) {
      if (err instanceof DriveAuthError) needsAuth = true;
      else if (err instanceof DriveForbiddenError) viewOnly = true;
      else throw err;
    }
    if (accessFor(manifest, me, isHost, opts.email) === 'none') throw new Error('You do not have access to this session. Ask the host to add you.');
    const session = new DriveSession(api, me, { folderId, manifestId: mf.id, manifest, isHost, seatId, viewOnly, needsAuth }, opts);
    session.manifestVersion = mf.version;
    await session.poll(files);
    return session;
  }

  private static async createSeat(api: DriveApi, folderId: string, me: string, email?: string | null): Promise<DriveFile> {
    const content: SeatContent = { v: 1, rooms: {} };
    const tag = Math.random().toString(36).slice(2, 6);
    return api.createFile(folderId, `${me} (${tag}).nbseat`, 'application/json', json(content), {
      nbRole: SEAT,
      nbName: fit('nbName', me),
      ...(email ? { nbEmail: fit('nbEmail', email) } : {}),
      nbSeen: String(Date.now()),
    });
  }

  get id() {
    return this.folderId;
  }

  get meta() {
    return this.snap.meta;
  }

  get me() {
    return this.snap.me;
  }

  private get writable(): boolean {
    return !!this.seatId && !this.snap.viewOnly;
  }

  get canMarkup(): boolean {
    const { meta, isHost, me, email } = this.snap;
    return this.writable && meta.status === 'active' && !isExpired(meta) && accessFor(meta, me, isHost, email) === 'markup';
  }

  get canAddDocuments(): boolean {
    const { meta, isHost } = this.snap;
    return this.canMarkup && (isHost || meta.permissions.addDocuments);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<StudioSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  /** The shared doc for a room, created on first use; local edits to it are saved to our seat. */
  private room(name: string): Y.Doc {
    let doc = this.rooms.get(name);
    if (!doc) {
      doc = new Y.Doc();
      doc.on('update', (_u: Uint8Array, origin: unknown) => {
        if (origin !== REMOTE) this.markDirty();
      });
      this.rooms.set(name, doc);
    }
    return doc;
  }

  private note(kind: RecordEntry['kind'], text: string, extra: Partial<RecordEntry> = {}) {
    appendRecord(this.room(SESSION_ROOM).getArray<RecordEntry>('record'), [{ id: recordId(), at: Date.now(), author: this.me, kind, text, ...extra }]);
  }

  // ---- Reading: poll the folder and merge what changed ----

  private onVisible = () => {
    if (!document.hidden) void this.poll();
  };

  private async pollLoop() {
    while (!this.destroyed) {
      await this.poll();
      const visible = typeof document === 'undefined' || !document.hidden;
      await new Promise<void>((r) => this.later(visible ? (this.opts.pollMs ?? 3000) : 15_000, r));
    }
  }

  /** Reads the folder once and merges any changed seats and the manifest. */
  poll(prefetched?: DriveFile[]): Promise<void> {
    this.polling ??= this.readFolder(prefetched).finally(() => (this.polling = null));
    return this.polling;
  }

  private async readFolder(prefetched?: DriveFile[]) {
    if (this.destroyed) return;
    try {
      const files = prefetched ?? (await this.api.list(this.folderId));
      const mf = files.find((f) => f.id === this.manifestId);
      if (mf && mf.version !== this.manifestVersion) {
        this.manifest = JSON.parse(new TextDecoder().decode(await this.api.download(mf.id))) as Manifest;
        this.manifestVersion = mf.version;
      }
      for (const f of files) {
        if (f.properties.nbRole !== SEAT) continue;
        if (this.seatVersions.get(f.id) === f.version) continue;
        // Our own seat changes only when we write it, unless this person has another tab open.
        if (f.id === this.seatId && this.ownVersions.has(f.version)) {
          this.seatVersions.set(f.id, f.version);
          continue;
        }
        const content = JSON.parse(new TextDecoder().decode(await this.api.download(f.id))) as SeatContent;
        for (const [room, b64] of Object.entries(content.rooms ?? {})) Y.applyUpdate(this.room(room), fromBase64(b64), REMOTE);
        this.seatVersions.set(f.id, f.version);
      }
      this.files = files;
      const before = this.snap.meta.documents;
      const meta = this.buildMeta(files);
      this.set({ meta, presence: this.buildPresence(files), status: 'online' });
      // Drive sessions have no server: the host's app finishes the session at its end date.
      if (this.snap.isHost && this.writable && isExpired(meta)) void this.update({ status: 'finished' }).catch(() => undefined);
      for (const a of this.attached.values()) a.store.setReadOnly(!this.canMarkup);
      for (const d of before) if (!meta.documents.some((n) => n.id === d.id)) this.opts.onRemoved(d.id);
    } catch (err) {
      if (this.destroyed) return;
      if (!(err instanceof TypeError)) console.warn('Drive session:', err);
      if (err instanceof DriveAuthError) this.set({ needsAuth: true });
      this.set({ status: 'offline' });
    } finally {
      this.markLoaded();
    }
  }

  private buildMeta(files: DriveFile[]): SessionMeta {
    const m = this.manifest;
    const documents: SessionDocument[] = files
      .filter((f) => f.properties.nbRole === DOCUMENT && !m.removed.includes(f.id))
      .map((f) => ({ id: f.id, name: f.name, size: f.size, addedBy: f.properties.nbBy ?? '', addedAt: Date.parse(f.createdTime) || 0, version: Number(f.properties.nbRev ?? 1) || 1 }))
      .sort((a, b) => a.addedAt - b.addedAt);
    const attendees: Attendee[] = [];
    for (const f of files) {
      if (f.properties.nbRole !== SEAT || !f.properties.nbName) continue;
      const seen = Number(f.properties.nbSeen ?? 0);
      const a = attendees.find((x) => x.name === f.properties.nbName);
      if (a) a.lastSeen = Math.max(a.lastSeen, seen);
      else attendees.push({ name: f.properties.nbName, ...(f.properties.nbEmail ? { email: f.properties.nbEmail } : {}), firstJoined: Date.parse(f.createdTime) || seen, lastSeen: seen });
    }
    return { id: this.folderId, name: m.name, host: m.host, createdAt: m.createdAt, status: m.status, endedAt: m.endedAt, permissions: m.permissions, access: m.access, documents, attendees, invited: m.invited ?? [], expiresAt: m.expiresAt ?? null };
  }

  private buildPresence(files: DriveFile[]): Presence[] {
    const now = Date.now();
    const out: Presence[] = [];
    for (const f of files) {
      if (f.properties.nbRole !== SEAT || !f.properties.nbName) continue;
      const self = f.id === this.seatId;
      if (!self && now - Number(f.properties.nbSeen ?? 0) > ONLINE_MS) continue;
      const name = f.properties.nbName;
      const page = f.properties.nbPage ? Number(f.properties.nbPage) : null;
      out.push({
        clientId: hash(f.id),
        name,
        color: attendeeColor(name),
        docId: self ? this.here.docId : f.properties.nbDoc || null,
        page: self ? this.here.page : page,
        self,
      });
    }
    if (!this.seatId) out.push({ clientId: 0, name: this.me, color: attendeeColor(this.me), docId: this.here.docId, page: this.here.page, self: true });
    return out;
  }

  // ---- Writing: our seat file (content and presence) and, for the host, the manifest ----

  private markDirty() {
    this.dirty = true;
    if (this.opts.pollMs === 0 || this.destroyed) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = this.later(FLUSH_DELAY_MS, () => void this.flush());
  }

  /** Saves our merged state to our seat file (debounced after edits). */
  flush(): Promise<void> {
    if (this.flushing) {
      // Save again once the current write finishes, so the last edit is never left behind.
      return this.flushing.then(() => (this.dirty ? this.flush() : undefined));
    }
    if (!this.dirty || !this.writable || this.snap.needsAuth) return Promise.resolve();
    this.dirty = false;
    // Encoded now, synchronously, so a flush started just before leaving still has everything.
    const content: SeatContent = { v: 1, rooms: Object.fromEntries([...this.rooms].map(([name, doc]) => [name, toBase64(Y.encodeStateAsUpdate(doc))])) };
    const seatId = this.seatId!;
    this.flushing = this.api
      .updateContent(seatId, json(content))
      .then((version) => {
        this.ownVersions.add(version);
      })
      .catch((err: unknown) => this.writeFailed(err))
      .finally(() => (this.flushing = null));
    return this.flushing;
  }

  private writeFailed(err: unknown) {
    this.dirty = true;
    if (err instanceof DriveAuthError) this.set({ needsAuth: true });
    else if (err instanceof DriveForbiddenError) this.set({ viewOnly: true });
    else {
      if (!(err instanceof TypeError)) console.warn('Drive session:', err);
      this.set({ status: 'offline' });
      // Try again shortly.
      if (this.opts.pollMs !== 0 && !this.destroyed) this.flushTimer = this.later(5000, () => void this.flush());
    }
  }

  setPresence(docId: string | null, page: number | null) {
    if (this.here.docId === docId && this.here.page === page) return;
    this.here = { docId, page };
    this.set({ presence: this.buildPresence(this.files) });
    if (this.opts.pollMs === 0) return;
    clearTimeout(this.presenceTimer);
    this.presenceTimer = this.later(PRESENCE_DELAY_MS, () => void this.pushPresence());
  }

  private async pushPresence(seen = Date.now()) {
    if (!this.writable || this.snap.needsAuth) return;
    const props: DriveProps = { nbSeen: String(seen), nbDoc: this.here.docId ?? '', nbPage: this.here.page != null ? String(this.here.page) : '' };
    try {
      this.ownVersions.add(await this.api.updateProperties(this.seatId!, props));
    } catch (err) {
      if (err instanceof DriveAuthError) this.set({ needsAuth: true });
    }
  }

  private async writeManifest(patch: Partial<Manifest>) {
    if (!this.snap.isHost) throw new Error('Only the session host can change the session.');
    const next = { ...this.manifest, ...patch };
    this.manifestVersion = await this.api.updateContent(this.manifestId, json(next));
    this.manifest = next;
    this.set({ meta: this.buildMeta(this.files) });
    for (const a of this.attached.values()) a.store.setReadOnly(!this.canMarkup);
  }

  sendChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed || this.meta.status !== 'active' || !this.writable) return;
    appendRecord(this.room(SESSION_ROOM).getArray<RecordEntry>('record'), [{ id: recordId(), at: Date.now(), author: this.me, kind: 'chat', text: trimmed.slice(0, 2000) }]);
  }

  /** Links a document's store to its room: edits flow both ways, and our own edits go in the Record. */
  async attach(docId: string, store: MarkupStore): Promise<void> {
    this.attached.get(docId)?.detach();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.loaded, new Promise((r) => (timer = setTimeout(r, 4000)))]);
    clearTimeout(timer);
    const room = this.room(docId);
    const fromStore = Symbol('store');
    const fromRoom = Symbol('room');
    Y.applyUpdate(store.doc, Y.encodeStateAsUpdate(room), fromRoom);
    Y.applyUpdate(room, Y.encodeStateAsUpdate(store.doc), fromStore);
    const toRoom = (u: Uint8Array, origin: unknown) => {
      if (origin !== fromRoom) Y.applyUpdate(room, u, fromStore);
    };
    const toStore = (u: Uint8Array, origin: unknown) => {
      if (origin !== fromStore) Y.applyUpdate(store.doc, u, fromRoom);
    };
    store.doc.on('update', toRoom);
    room.on('update', toStore);
    const unwatch = watchMarkups(room, (origin) => origin === fromStore, (changes) => {
      const name = this.meta.documents.find((d) => d.id === docId)?.name ?? 'a document';
      appendRecord(this.room(SESSION_ROOM).getArray<RecordEntry>('record'), describeChanges(changes, this.me, docId, name, Date.now()));
    });
    const detach = () => {
      store.doc.off('update', toRoom);
      room.off('update', toStore);
      unwatch();
      if (this.attached.get(docId)?.store === store) this.attached.delete(docId);
    };
    store.doc.on('destroy', detach);
    this.attached.set(docId, { store, detach });
    store.setReadOnly(!this.canMarkup);
  }

  fetchDocument(docId: string): Promise<ArrayBuffer> {
    return this.api.download(docId);
  }

  async addDocument(name: string, bytes: ArrayBuffer): Promise<SessionDocument> {
    if (!this.canAddDocuments) throw new Error(this.writable ? 'The host has not allowed attendees to add documents.' : 'You can only view this session.');
    const file = await this.api.createFile(this.folderId, name, 'application/pdf', new Blob([bytes], { type: 'application/pdf' }), {
      nbRole: DOCUMENT,
      nbBy: fit('nbBy', this.me),
    });
    this.files = [...this.files, file];
    this.set({ meta: this.buildMeta(this.files) });
    this.note('document', `added ${name}`, { docId: file.id });
    return this.meta.documents.find((d) => d.id === file.id)!;
  }

  async updateDocument(docId: string, bytes: ArrayBuffer, name?: string): Promise<SessionDocument> {
    if (!this.snap.isHost) throw new Error('Only the session host can update documents.');
    const doc = this.meta.documents.find((d) => d.id === docId);
    if (!doc) throw new Error('No such document in this session');
    const version = (doc.version ?? 1) + 1;
    await this.api.updateContent(docId, new Blob([bytes], { type: 'application/pdf' }));
    await this.api.updateProperties(docId, { nbRev: String(version) });
    this.files = this.files.map((f) => (f.id === docId ? { ...f, size: bytes.byteLength, properties: { ...f.properties, nbRev: String(version) } } : f));
    this.set({ meta: this.buildMeta(this.files) });
    this.note('document', `updated ${name ?? doc.name} to revision ${version}`, { docId });
    return this.meta.documents.find((d) => d.id === docId)!;
  }

  sendAlert(docId: string, markupId: string, page: number, text: string) {
    if (this.meta.status !== 'active') return;
    this.note('alert', text.trim().slice(0, 500), { docId, page, markupId });
  }

  async removeDocument(docId: string) {
    const doc = this.meta.documents.find((d) => d.id === docId);
    await this.writeManifest({ removed: [...this.manifest.removed, docId] });
    if (doc) this.note('document', `removed ${doc.name}`, { docId });
    this.opts.onRemoved(docId);
  }

  async update(patch: SessionUpdate) {
    const before = this.manifest;
    const next: Partial<Manifest> = {};
    if (patch.permissions) next.permissions = { ...before.permissions, ...patch.permissions };
    // Before access policies, the markup lock was the default for everyone.
    if (patch.permissions?.markup !== undefined && before.access && !patch.access) next.access = { ...before.access, default: patch.permissions.markup ? 'markup' : 'view' };
    if (patch.access) {
      next.access = patch.access;
      next.permissions = { ...(next.permissions ?? before.permissions), markup: patch.access.default === 'markup' };
    }
    if (patch.name?.trim()) next.name = patch.name.trim().slice(0, 120);
    if (patch.expiresAt !== undefined) {
      if (patch.expiresAt !== null && patch.expiresAt <= Date.now()) throw new Error('The end date must be in the future.');
      next.expiresAt = patch.expiresAt;
    }
    if (patch.status === 'finished' && before.status !== 'finished') Object.assign(next, { status: 'finished', endedAt: Date.now() });
    // Record lines first: once finished, the session no longer takes edits.
    const p = next.permissions;
    if (p && !next.access && p.markup !== before.permissions.markup) this.note('session', p.markup ? 'allowed attendees to markup' : 'locked markups to the host');
    if (p && p.addDocuments !== before.permissions.addDocuments) this.note('session', p.addDocuments ? 'allowed attendees to add documents' : 'stopped attendees adding documents');
    if (next.access) this.note('session', 'updated attendee permissions');
    if (next.name) this.note('session', `renamed the session to “${next.name}”`);
    if (next.expiresAt !== undefined) this.note('session', next.expiresAt ? `set the session to end ${new Date(next.expiresAt).toLocaleString()}` : 'removed the session’s end date');
    const np = next.permissions;
    if (np && (np.saveCopy ?? true) !== (before.permissions.saveCopy ?? true)) this.note('session', np.saveCopy === false ? 'stopped attendees saving copies' : 'allowed attendees to save copies');
    if (np && (np.invite ?? true) !== (before.permissions.invite ?? true)) this.note('session', np.invite === false ? 'stopped attendees inviting others' : 'allowed attendees to invite others');
    if (next.status) this.note('session', patch.expiresAt === undefined && isExpired(this.meta) ? 'the session reached its end date and finished' : 'finished the session');
    await this.flush();
    await this.writeManifest(next);
  }

  async invite(emails: string[]) {
    const message = `Join the Live Session “${this.meta.name}” in redcolumn: ${this.snap.inviteLink}`;
    const failed: string[] = [];
    for (const email of emails) {
      try {
        await this.api.shareWithUser(this.folderId, email, message);
      } catch (err) {
        if (err instanceof DriveAuthError) {
          this.set({ needsAuth: true });
          throw err;
        }
        failed.push(email);
      }
    }
    // Only the host writes the manifest; others' invites still share the folder but are not listed.
    const known = this.manifest.invited ?? [];
    const invited = [...known];
    for (const e of emails) if (!failed.includes(e) && !invited.some((k) => sameName(k, e))) invited.push(e);
    if (this.snap.isHost && invited.length > known.length) await this.writeManifest({ invited });
    if (failed.length) throw new Error(`Could not invite ${failed.join(', ')}.`);
  }

  async reconnect() {
    await this.opts.authorize();
    this.set({ needsAuth: false, email: this.opts.identify?.() ?? this.snap.email ?? null });
    try {
      const isHost = await this.api.ownedByMe(this.manifestId);
      if (!this.seatId && !this.snap.viewOnly) {
        this.seatId = (await DriveSession.createSeat(this.api, this.folderId, this.me, this.snap.email)).id;
        rememberSeat(this.folderId, this.seatId);
      }
      this.set({ isHost });
    } catch (err) {
      if (err instanceof DriveForbiddenError) this.set({ viewOnly: true });
      else throw err;
    }
    for (const a of this.attached.values()) a.store.setReadOnly(!this.canMarkup);
    await Promise.all([this.flush(), this.pushPresence(), this.poll()]);
  }

  retry() {
    void this.poll();
    void this.flush();
  }

  leave() {
    forgetCurrentSession(this.folderId);
    void this.flush();
    // Show as away straight away rather than after the timeout.
    void this.pushPresence(0);
    this.destroy();
  }

  private later(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  private every(ms: number, fn: () => void) {
    const tick = () => {
      fn();
      if (!this.destroyed) this.later(ms, tick);
    };
    this.later(ms, tick);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    for (const a of [...this.attached.values()]) a.detach();
    this.listeners.clear();
  }
}
