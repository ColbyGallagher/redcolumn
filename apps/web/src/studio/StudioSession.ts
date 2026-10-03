import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { MarkupStore } from '@nb/markup';
import { RoomConnection } from './RoomConnection';
import { accessFor, isExpired, SESSION_ROOM, type AccessPolicy, type Permissions, type RecordEntry, type SessionDocument, type SessionMeta } from './protocol';
import { googleAuth, signInWithGoogle } from './drive/google';
import { forgetCurrentSession, inviteLink, readLocal as read, rememberSession, writeLocal as write } from './local';
import { attendeeColor, StudioError, type CollabSession, type Presence, type SessionUpdate, type StudioSnapshot } from './types';
import { isOnline, offlineReason } from '../offline/network';

const SERVER_KEY = 'nb.studio.server';
const HOST_KEYS = 'nb.studio.hostKeys';

/**
 * The redcolumn server's base URL: one the user entered, else the build's `VITE_STUDIO_URL`, else the
 * same origin at /studio (proxied to services/studio by the dev server).
 */
export function studioServer(): string {
  const custom = read<string | null>(SERVER_KEY, null);
  const env = import.meta.env.VITE_STUDIO_URL as string | undefined;
  return (custom || env || new URL(`${import.meta.env.BASE_URL}studio`, location.href).href).replace(/\/+$/, '');
}

export function customStudioServer(): string {
  return read<string>(SERVER_KEY, '');
}

export function setStudioServer(url: string) {
  write(SERVER_KEY, url.trim() || null);
}

function hostKeyFor(id: string): string | null {
  return read<Record<string, string>>(HOST_KEYS, {})[id] ?? null;
}

/** Request headers that identify the attendee: name, host key, and Google sign-in when there is one. */
function identity(headers: Headers, hostKey?: string | null, attendee?: string) {
  if (hostKey) headers.set('x-studio-host-key', hostKey);
  if (attendee) headers.set('x-studio-attendee', attendee);
  const token = googleAuth.valid();
  if (token) headers.set('authorization', `Bearer ${token}`);
}

/** WebSocket subprotocols carrying the Google token (sockets cannot send headers). */
function socketProtocols(): string[] | undefined {
  const token = googleAuth.valid();
  return token ? ['nb-studio', `nb-auth.${token}`] : undefined;
}

let config: Promise<{ google: boolean }> | null = null;

/** What the redcolumn server supports (Google sign-in). */
export function studioConfig(): Promise<{ google: boolean }> {
  config ??= fetch(`${studioServer()}/v1/config`)
    .then((r) => (r.ok ? (r.json() as Promise<{ google: boolean }>) : { google: false }))
    .catch(() => {
      config = null;
      return { google: false };
    });
  return config;
}

async function api<T>(path: string, init: RequestInit & { hostKey?: string | null; attendee?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  identity(headers);
  if (init.hostKey) headers.set('x-studio-host-key', init.hostKey);
  if (init.attendee) headers.set('x-studio-attendee', init.attendee);
  let res: Response;
  try {
    res = await fetch(`${studioServer()}${path}`, { ...init, headers });
  } catch {
    throw new StudioError(isOnline() ? `Cannot reach the redcolumn server at ${studioServer()}.` : offlineReason('Live Sessions'), 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new StudioError(body?.error ?? `redcolumn server error (${res.status}).`, res.status);
  }
  return (await res.json()) as T;
}

interface Attached {
  store: MarkupStore;
  connection: RoomConnection;
}

/**
 * A joined Live Session: the shared documents, who is here and where, the
 * Record (every markup change, plus chat), and live markup sync for each document opened from it.
 */
export class StudioSession implements CollabSession {
  readonly backend = 'server' as const;
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  private connection: RoomConnection;
  private record: Y.Array<RecordEntry>;
  private listeners = new Set<() => void>();
  private snap: StudioSnapshot;
  private attached = new Map<string, Attached>();
  private hostKey: string | null;
  private onRemoved: (docId: string) => void;

  private constructor(meta: SessionMeta, me: string, hostKey: string | null, isHost: boolean, email: string | null, onRemoved: (docId: string) => void) {
    this.hostKey = hostKey;
    this.onRemoved = onRemoved;
    this.record = this.doc.getArray<RecordEntry>('record');
    this.snap = { backend: 'server', meta, isHost, me, email, status: 'connecting', record: [], presence: [], inviteLink: inviteLink({ backend: 'server', id: meta.id }) };
    this.awareness.setLocalState({ name: me, email, color: attendeeColor(me), docId: null, page: null });
    this.connection = new RoomConnection(this.socketUrl(SESSION_ROOM), this.doc, this.awareness, {
      onStatus: (status) => this.set({ status }),
      onMeta: (json) => this.applyMeta(JSON.parse(json) as SessionMeta),
      onDenied: () => this.deny(),
      onSignIn: () => this.set({ needsAuth: true }),
      protocols: socketProtocols,
    });
    this.record.observe(() => this.set({ record: this.record.toArray() }));
    this.awareness.on('change', () => this.set({ presence: this.readPresence() }));
    this.set({ presence: this.readPresence() });
  }

  static async create(
    name: string,
    me: string,
    permissions: Permissions,
    access: AccessPolicy,
    requireGoogle: boolean,
    onRemoved: (docId: string) => void,
    expiresAt: number | null = null,
  ): Promise<StudioSession> {
    const { session, hostKey } = await api<{ session: SessionMeta; hostKey: string }>('/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, host: me, permissions, access, requireGoogle, ...(expiresAt ? { expiresAt } : {}) }),
    });
    write(HOST_KEYS, { ...read<Record<string, string>>(HOST_KEYS, {}), [session.id]: hostKey });
    return StudioSession.remember(new StudioSession(session, me, hostKey, true, session.hostEmail ?? null, onRemoved));
  }

  static async join(id: string, me: string, onRemoved: (docId: string) => void): Promise<StudioSession> {
    const { session, isHost, email } = await StudioSession.peek(id, me);
    return StudioSession.remember(new StudioSession(session, me, isHost ? hostKeyFor(id) : null, isHost, email ?? null, onRemoved));
  }

  /**
   * Reads a session's details without joining it (for the Sessions list). A 401 means the session
   * is for Google accounts and this person is not signed in.
   */
  static peek(id: string, me: string): Promise<{ session: SessionMeta; isHost: boolean; email?: string | null }> {
    return api<{ session: SessionMeta; isHost: boolean; email?: string | null }>(`/v1/sessions/${id}`, { hostKey: hostKeyFor(id), attendee: me });
  }

  private static remember(s: StudioSession): StudioSession {
    rememberSession({ backend: 'server', id: s.id }, s.meta.name);
    return s;
  }

  get id() {
    return this.snap.meta.id;
  }

  get meta() {
    return this.snap.meta;
  }

  get me() {
    return this.snap.me;
  }

  /** Whether this attendee's markup edits are accepted right now. */
  get canMarkup(): boolean {
    const { meta, isHost, me, email, denied } = this.snap;
    return !denied && meta.status === 'active' && !isExpired(meta) && accessFor(meta, me, isHost, email) === 'markup';
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

  private applyMeta(meta: SessionMeta) {
    const gone = this.snap.meta.documents.filter((d) => !meta.documents.some((n) => n.id === d.id));
    this.set({ meta });
    if (accessFor(meta, this.me, this.snap.isHost, this.snap.email) === 'none') {
      if (meta.requireGoogle && !this.snap.email) this.set({ needsAuth: true });
      else this.deny();
    }
    for (const a of this.attached.values()) a.store.setReadOnly(!this.canMarkup);
    for (const d of gone) this.onRemoved(d.id);
  }

  /** The host took this attendee's access away: stop syncing and lock their copies. */
  private deny() {
    if (this.snap.denied) return;
    this.set({ denied: true, status: 'offline' });
    for (const a of this.attached.values()) {
      a.store.setReadOnly(true);
      a.connection.destroy();
    }
    this.connection.destroy();
  }

  private readPresence(): Presence[] {
    const out: Presence[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      const s = state as Partial<Omit<Presence, 'clientId' | 'self'>>;
      if (!s.name) continue;
      out.push({ clientId, name: s.name, email: s.email ?? null, color: s.color ?? attendeeColor(s.name), docId: s.docId ?? null, page: s.page ?? null, self: clientId === this.doc.clientID });
    }
    return out;
  }

  private socketUrl(room: string): string {
    const url = new URL(`${studioServer()}/v1/sessions/${this.id}/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('room', room);
    url.searchParams.set('name', this.me);
    if (this.hostKey) url.searchParams.set('key', this.hostKey);
    return url.href;
  }

  /** Where this attendee is, shown to the others in the attendee list. */
  setPresence(docId: string | null, page: number | null) {
    const cur = this.awareness.getLocalState() as { docId: string | null; page: number | null } | null;
    if (cur && cur.docId === docId && cur.page === page) return;
    this.awareness.setLocalStateField('docId', docId);
    this.awareness.setLocalStateField('page', page);
  }

  sendChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed || this.meta.status !== 'active') return;
    const id = `${Date.now().toString(36)}-${this.doc.clientID.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.record.push([{ id, at: Date.now(), author: this.me, kind: 'chat', text: trimmed.slice(0, 2000) }]);
  }

  sendAlert(docId: string, markupId: string, page: number, text: string) {
    if (this.meta.status !== 'active') return;
    const id = `${Date.now().toString(36)}-${this.doc.clientID.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.record.push([{ id, at: Date.now(), author: this.me, kind: 'alert', text: text.trim().slice(0, 500), docId, page, markupId }]);
  }

  /**
   * Syncs a document's markups with the session. Resolves once the first sync has finished (or
   * after a short wait when offline), so callers see everyone's markups before analysing the page.
   */
  async attach(docId: string, store: MarkupStore): Promise<void> {
    this.attached.get(docId)?.connection.destroy();
    store.setReadOnly(!this.canMarkup);
    const connection = new RoomConnection(this.socketUrl(docId), store.doc, null, {
      onRemoved: () => this.onRemoved(docId),
      onDenied: () => this.deny(),
      onSignIn: () => this.set({ needsAuth: true }),
      protocols: socketProtocols,
    });
    const entry = { store, connection };
    this.attached.set(docId, entry);
    // Closing the document (its markups discarded) closes its live connection too.
    store.doc.on('destroy', () => {
      if (this.attached.get(docId) !== entry) return;
      entry.connection.destroy();
      this.attached.delete(docId);
    });
    await Promise.race([connection.whenSynced, new Promise((r) => setTimeout(r, 4000))]);
  }

  /** Fetches a session document's bytes. */
  async fetchDocument(docId: string): Promise<ArrayBuffer> {
    let res: Response;
    try {
      const headers = new Headers();
      identity(headers, this.hostKey, this.me);
      // The version in the address: a new revision is a new address, so no cached copy is used.
      const version = this.meta.documents.find((d) => d.id === docId)?.version ?? 1;
      res = await fetch(`${studioServer()}/v1/sessions/${this.id}/documents/${docId}?v=${version}`, { headers });
    } catch {
      throw new StudioError('Cannot reach the redcolumn server to download this document.', 0);
    }
    if (res.status === 401) throw new StudioError('Sign in with Google to open this session\'s documents.', 401);
    if (res.status === 403) throw new StudioError('You do not have access to this session.', 403);
    if (!res.ok) throw new StudioError(`Could not download the document (${res.status}).`, res.status);
    return res.arrayBuffer();
  }

  async addDocument(name: string, bytes: ArrayBuffer): Promise<SessionDocument> {
    const { document } = await api<{ document: SessionDocument }>(`/v1/sessions/${this.id}/documents?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: bytes,
      hostKey: this.hostKey,
      attendee: this.me,
    });
    // The server's meta broadcast may arrive after the caller wants to open the document.
    const { meta } = this.snap;
    if (!meta.documents.some((d) => d.id === document.id)) this.set({ meta: { ...meta, documents: [...meta.documents, document] } });
    return document;
  }

  async updateDocument(docId: string, bytes: ArrayBuffer, name?: string): Promise<SessionDocument> {
    const { document } = await api<{ document: SessionDocument }>(`/v1/sessions/${this.id}/documents/${docId}${name ? `?name=${encodeURIComponent(name)}` : ''}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: bytes,
      hostKey: this.hostKey,
    });
    const { meta } = this.snap;
    this.set({ meta: { ...meta, documents: meta.documents.map((d) => (d.id === docId ? document : d)) } });
    return document;
  }

  /** Invites people by email; `sent: false` when the server cannot send mail. */
  async emailInvite(emails: string[], note: string): Promise<{ sent: boolean; failed: string[] }> {
    const r = await api<{ session: SessionMeta; sent: boolean; failed: string[] }>(`/v1/sessions/${this.id}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emails, note }),
      hostKey: this.hostKey,
      attendee: this.me,
    });
    this.applyMeta(r.session);
    return { sent: r.sent, failed: r.failed };
  }

  async removeDocument(docId: string) {
    const { session } = await api<{ session: SessionMeta }>(`/v1/sessions/${this.id}/documents/${docId}`, { method: 'DELETE', hostKey: this.hostKey });
    this.applyMeta(session);
  }

  async update(patch: SessionUpdate) {
    const { session } = await api<{ session: SessionMeta }>(`/v1/sessions/${this.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
      hostKey: this.hostKey,
    });
    this.applyMeta(session);
  }

  /** Signs in with Google again (a popup: call from a click) and reconnects. */
  async reconnect() {
    await signInWithGoogle();
    const { session, isHost, email } = await StudioSession.peek(this.id, this.me);
    this.set({ needsAuth: false, email: email ?? null, isHost: this.snap.isHost || isHost });
    this.awareness.setLocalStateField('email', email ?? null);
    this.applyMeta(session);
    this.retry();
  }

  retry() {
    this.connection.retry();
    for (const a of this.attached.values()) a.connection.retry();
  }

  /** Leaves the session. Documents opened from it should be closed by the caller first. */
  leave() {
    forgetCurrentSession(this.id);
    this.destroy();
  }

  private destroyed = false;

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const a of this.attached.values()) a.connection.destroy();
    this.attached.clear();
    this.connection.destroy();
    this.awareness.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }
}
