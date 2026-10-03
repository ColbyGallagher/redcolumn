import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as Y from 'yjs';
import { accessFor, CLOSE_DENIED, formatSessionId, isExpired, policyOf, SESSION_ROOM, type Access, type AccessPolicy, type Permissions, type RecordEntry, type SessionDocument, type SessionMeta } from './protocol.ts';
import { coalesces, describeChanges, type MarkupChange, type MarkupLike } from './record.ts';
import { Room, type Conn } from './room.ts';

interface StoredSession {
  meta: SessionMeta;
  hostKey: string;
}

const ACCESS_TEXT: Record<Access, string> = { none: 'no access', view: 'view only', markup: 'markup' };

/** Room state is written this long after the last edit. */
const SAVE_DELAY_MS = 500;
/** Rooms nobody is connected to are unloaded after this long. */
const IDLE_MS = 60_000;

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${randomBytes(3).toString('hex')}`;

async function writeAtomic(path: string, data: string | Uint8Array) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** A Live Session: its metadata, its documents on disk, and the live rooms attendees are in. */
export class Session {
  private rooms = new Map<string, Room>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  private idleTimers = new Map<string, NodeJS.Timeout>();
  private dir: string;
  private stored: StoredSession;

  constructor(dir: string, stored: StoredSession) {
    this.dir = dir;
    this.stored = stored;
  }

  get meta(): SessionMeta {
    return this.stored.meta;
  }

  get id() {
    return this.stored.meta.id;
  }

  isHostKey(key: string | null | undefined): boolean {
    if (!key) return false;
    const a = Buffer.from(key);
    const b = Buffer.from(this.stored.hostKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async saveMeta() {
    await writeAtomic(join(this.dir, 'session.json'), JSON.stringify(this.stored));
    this.rooms.get(SESSION_ROOM)?.broadcastMeta(JSON.stringify(this.meta));
  }

  private record(entries: RecordEntry[], room?: Room) {
    const target = room ?? this.rooms.get(SESSION_ROOM);
    if (!target || !entries.length) {
      // Session room not loaded: load it so the line is kept.
      if (entries.length) void this.room(SESSION_ROOM).then((r) => this.record(entries, r));
      return;
    }
    const log = target.doc.getArray<RecordEntry>('record');
    target.doc.transact(() => {
      for (const e of entries) {
        const last = log.length ? log.get(log.length - 1) : undefined;
        if (coalesces(last, e)) log.delete(log.length - 1, 1);
        log.push([e]);
      }
    }, 'server');
  }

  /** What an attendee may do; hosts are identified by their key, everyone else by name. */
  accessOf(name: string, isHost: boolean, email: string | null = null): Access {
    return accessFor(this.meta, name, isHost, email);
  }

  /** The host: holds the host key, or is signed in with the host's Google account. */
  isHost(key: string | null | undefined, email: string | null): boolean {
    return this.isHostKey(key) || (!!email && !!this.meta.hostEmail && email === this.meta.hostEmail);
  }

  note(author: string, kind: RecordEntry['kind'], text: string, extra: Partial<RecordEntry> = {}) {
    this.record([{ id: newId(), at: Date.now(), author, kind, text, ...extra }]);
  }

  async setPermissions(p: Partial<Permissions>, by: string) {
    const before = this.meta.permissions;
    this.meta.permissions = { ...before, ...p };
    // Before access policies, the markup lock was the default for everyone.
    if (p.markup !== undefined && this.meta.access) this.meta.access = { ...this.meta.access, default: p.markup ? 'markup' : 'view' };
    const changes: string[] = [];
    if (before.markup !== this.meta.permissions.markup) changes.push(this.meta.permissions.markup ? 'allowed attendees to markup' : 'locked markups to the host');
    if (before.addDocuments !== this.meta.permissions.addDocuments)
      changes.push(this.meta.permissions.addDocuments ? 'allowed attendees to add documents' : 'stopped attendees adding documents');
    if ((before.saveCopy ?? true) !== (this.meta.permissions.saveCopy ?? true)) changes.push(this.meta.permissions.saveCopy === false ? 'stopped attendees saving copies' : 'allowed attendees to save copies');
    if ((before.invite ?? true) !== (this.meta.permissions.invite ?? true)) changes.push(this.meta.permissions.invite === false ? 'stopped attendees inviting others' : 'allowed attendees to invite others');
    await this.saveMeta();
    if (changes.length) this.note(by, 'session', changes.join('; '));
  }

  /** Replaces who may do what, and disconnects anyone who has lost access. */
  async setAccess(policy: AccessPolicy, by: string) {
    const before = policyOf(this.meta);
    this.meta.access = policy;
    this.meta.permissions = { ...this.meta.permissions, markup: policy.default === 'markup' };
    await this.saveMeta();
    for (const room of this.rooms.values()) {
      for (const conn of room.conns) if (this.accessOf(conn.name, conn.isHost, conn.email) === 'none') conn.ws.close(CLOSE_DENIED, 'No access');
    }
    const changes: string[] = [];
    if (before.default !== policy.default) changes.push(`set access for everyone else to ${ACCESS_TEXT[policy.default]}`);
    for (const g of policy.groups) if (!before.groups.some((x) => x.id === g.id)) changes.push(`created the group “${g.name}”`);
    for (const g of before.groups) if (!policy.groups.some((x) => x.id === g.id)) changes.push(`deleted the group “${g.name}”`);
    for (const p of policy.people) if (!before.people.some((x) => x.name === p.name)) changes.push(`invited ${p.name}`);
    this.note(by, 'session', changes.length ? changes.join('; ') : 'updated attendee permissions');
  }

  async rename(name: string, by: string) {
    this.meta.name = name;
    await this.saveMeta();
    this.note(by, 'session', `renamed the session to “${name}”`);
  }

  /** Sets (or clears) when the session ends by itself. */
  async setExpiry(expiresAt: number | null, by: string) {
    this.meta.expiresAt = expiresAt;
    await this.saveMeta();
    this.note(by, 'session', expiresAt ? `set the session to end ${new Date(expiresAt).toISOString().replace('T', ' ').slice(0, 16)} UTC` : 'removed the session’s end date');
    this.scheduleExpiry();
  }

  private expiryTimer: NodeJS.Timeout | null = null;

  /** Finishes the session when its end date comes (and at once if it has passed). */
  scheduleExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    const at = this.meta.expiresAt;
    if (this.meta.status !== 'active' || typeof at !== 'number') return;
    // setTimeout holds at most ~24.8 days; longer waits re-arm when they fire.
    const wait = Math.min(Math.max(0, at - Date.now()), 2 ** 31 - 1);
    this.expiryTimer = setTimeout(() => void this.checkExpiry(), wait).unref();
  }

  /** Finishes an expired session; true if it has ended. */
  async checkExpiry(): Promise<boolean> {
    if (isExpired(this.meta)) {
      await this.finish('Server', 'the session reached its end date and finished');
      return true;
    }
    if (this.meta.status === 'active') this.scheduleExpiry();
    return this.meta.status !== 'active';
  }

  /** Ends the session: it becomes read-only, and attendees can still open it to review and report. */
  async finish(by: string, text = 'finished the session') {
    if (this.meta.status === 'finished') return;
    this.note(by, 'session', text);
    this.meta.status = 'finished';
    this.meta.endedAt = Date.now();
    await this.saveMeta();
  }

  async addDocument(name: string, bytes: Uint8Array, by: string): Promise<SessionDocument> {
    const id = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
    const existing = this.meta.documents.find((d) => d.id === id);
    if (existing) return existing;
    await mkdir(join(this.dir, 'docs'), { recursive: true });
    await writeAtomic(join(this.dir, 'docs', `${id}.pdf`), bytes);
    const doc: SessionDocument = { id, name, size: bytes.byteLength, addedBy: by, addedAt: Date.now() };
    this.meta.documents.push(doc);
    await this.saveMeta();
    this.note(by, 'document', `added ${name}`, { docId: id });
    return doc;
  }

  /**
   * Replaces a document with a new revision. Its id, and so its markups, stay: markups are on the
   * same pages of the new revision. Everyone with it open is told to load the new bytes.
   */
  async updateDocument(id: string, bytes: Uint8Array, by: string, name?: string): Promise<SessionDocument | null> {
    const doc = this.meta.documents.find((d) => d.id === id);
    if (!doc) return null;
    await writeAtomic(join(this.dir, 'docs', `${id}.pdf`), bytes);
    doc.size = bytes.byteLength;
    doc.version = (doc.version ?? 1) + 1;
    doc.updatedAt = Date.now();
    if (name) doc.name = name;
    await this.saveMeta();
    this.note(by, 'document', `updated ${doc.name} to revision ${doc.version}`, { docId: id });
    return doc;
  }

  async removeDocument(id: string, by: string) {
    const doc = this.meta.documents.find((d) => d.id === id);
    if (!doc) return;
    this.meta.documents = this.meta.documents.filter((d) => d.id !== id);
    this.rooms.get(id)?.close(4404, 'Document removed');
    await this.saveMeta();
    this.note(by, 'document', `removed ${doc.name}`, { docId: id });
  }

  documentPath(id: string): string | null {
    return this.meta.documents.some((d) => d.id === id) ? join(this.dir, 'docs', `${id}.pdf`) : null;
  }

  /** Loads (or returns) a room. Room names are the session room or a document id. */
  async room(name: string): Promise<Room> {
    const existing = this.rooms.get(name);
    if (existing) return existing;
    const file = join(this.dir, 'rooms', `${name}.ydoc`);
    const initial = await readFile(file).catch(() => null);
    // Another call may have loaded it while we read.
    const raced = this.rooms.get(name);
    if (raced) return raced;
    const room = new Room(
      name,
      initial,
      (conn) => {
        if (this.meta.status !== 'active' || isExpired(this.meta)) return false;
        const access = this.accessOf(conn.name, conn.isHost, conn.email);
        // Viewers still chat in the session room; only markup access changes documents.
        return name === SESSION_ROOM ? access !== 'none' : access === 'markup';
      },
      () => this.scheduleSave(name),
    );
    this.rooms.set(name, room);
    if (name !== SESSION_ROOM) this.watchMarkups(room);
    this.scheduleIdle(name);
    return room;
  }

  /** Writes Record lines for markup edits made in a document room. */
  private watchMarkups(room: Room) {
    const docName = () => this.meta.documents.find((d) => d.id === room.name)?.name ?? 'a document';
    room.doc.getMap<MarkupLike>('markups').observe((event, tx) => {
      const author = tx.origin && typeof tx.origin === 'object' && 'name' in tx.origin ? (tx.origin as Conn).name : null;
      if (!author) return;
      const map = event.target as Y.Map<MarkupLike>;
      const changes: MarkupChange[] = [];
      for (const [id, change] of event.changes.keys) {
        const value = map.get(id);
        if (change.action === 'add' && value) changes.push({ action: 'add', id, value });
        else if (change.action === 'update' && value) changes.push({ action: 'update', id, value, old: change.oldValue as MarkupLike });
        else if (change.action === 'delete') changes.push({ action: 'delete', id, old: change.oldValue as MarkupLike });
      }
      this.record(describeChanges(changes, author, room.name, docName(), Date.now(), newId));
    });
  }

  attach(room: Room, conn: Conn) {
    clearTimeout(this.idleTimers.get(room.name));
    room.join(conn, room.name === SESSION_ROOM ? JSON.stringify(this.meta) : null);
  }

  detach(room: Room, conn: Conn) {
    room.leave(conn);
    if (!room.conns.size) this.scheduleIdle(room.name);
  }

  /** Whether `name` has another socket open in the session room (a second tab). */
  present(name: string, except?: Conn): boolean {
    const room = this.rooms.get(SESSION_ROOM);
    return !!room && [...room.conns].some((c) => c !== except && c.name === name);
  }

  async attendeeJoined(name: string, email: string | null = null) {
    const now = Date.now();
    const a = this.meta.attendees.find((x) => (email && x.email ? x.email === email : x.name === name));
    if (a) {
      a.lastSeen = now;
      a.name = name;
      if (email) a.email = email;
    } else this.meta.attendees.push({ name, ...(email ? { email } : {}), firstJoined: now, lastSeen: now });
    await this.saveMeta();
    this.note(name, 'join', 'joined the session');
  }

  async attendeeLeft(name: string) {
    const a = this.meta.attendees.find((x) => x.name === name);
    if (a) a.lastSeen = Date.now();
    await this.saveMeta();
    this.note(name, 'leave', 'left the session');
  }

  private scheduleSave(name: string) {
    if (this.saveTimers.has(name)) return;
    this.saveTimers.set(
      name,
      setTimeout(() => {
        this.saveTimers.delete(name);
        void this.saveRoom(name);
      }, SAVE_DELAY_MS),
    );
  }

  private async saveRoom(name: string) {
    const room = this.rooms.get(name);
    if (!room) return;
    await mkdir(join(this.dir, 'rooms'), { recursive: true });
    await writeAtomic(join(this.dir, 'rooms', `${name}.ydoc`), Y.encodeStateAsUpdate(room.doc));
  }

  private scheduleIdle(name: string) {
    clearTimeout(this.idleTimers.get(name));
    this.idleTimers.set(
      name,
      // Unref'd: an idle room never keeps the process alive.
      setTimeout(() => void this.unload(name), IDLE_MS).unref(),
    );
  }

  private async unload(name: string) {
    const room = this.rooms.get(name);
    if (!room || room.conns.size) return;
    clearTimeout(this.saveTimers.get(name));
    this.saveTimers.delete(name);
    await this.saveRoom(name);
    this.rooms.delete(name);
    room.destroy();
  }

  /** Saves everything and closes every socket (server shutdown). */
  async close() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    for (const t of this.idleTimers.values()) clearTimeout(t);
    for (const t of this.saveTimers.values()) clearTimeout(t);
    for (const [name, room] of this.rooms) {
      room.close(1001, 'Server shutting down');
      await this.saveRoom(name);
      room.destroy();
    }
    this.rooms.clear();
  }
}

/** All sessions, stored one directory each under `dataDir`. */
export class SessionRegistry {
  private sessions = new Map<string, Session>();
  private loading = new Map<string, Promise<Session | null>>();
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private dirFor(id: string) {
    return join(this.dataDir, id);
  }

  async create(
    name: string,
    host: string,
    permissions: Permissions,
    access: AccessPolicy | null = null,
    google: { requireGoogle: boolean; hostEmail: string | null } = { requireGoogle: false, hostEmail: null },
    expiresAt: number | null = null,
  ): Promise<{ session: Session; hostKey: string }> {
    await mkdir(this.dataDir, { recursive: true });
    const taken = new Set(await readdir(this.dataDir).catch(() => []));
    let id: string;
    do id = formatSessionId(String(randomInt(100_000_000, 1_000_000_000)));
    while (taken.has(id) || this.sessions.has(id));
    const hostKey = randomBytes(24).toString('base64url');
    const now = Date.now();
    const meta: SessionMeta = { id, name, host, createdAt: now, status: 'active', endedAt: null, permissions, documents: [], attendees: [] };
    if (google.hostEmail) meta.hostEmail = google.hostEmail;
    if (google.requireGoogle) meta.requireGoogle = true;
    if (expiresAt) meta.expiresAt = expiresAt;
    if (access) {
      meta.access = access;
      meta.permissions = { ...permissions, markup: access.default === 'markup' };
    }
    await mkdir(this.dirFor(id), { recursive: true });
    const session = new Session(this.dirFor(id), { meta, hostKey });
    await session.saveMeta();
    this.sessions.set(id, session);
    session.note(host, 'session', `started the session “${name}”`);
    session.scheduleExpiry();
    return { session, hostKey };
  }

  get(id: string): Promise<Session | null> {
    const live = this.sessions.get(id);
    if (live) return Promise.resolve(live);
    let pending = this.loading.get(id);
    if (!pending) {
      pending = readFile(join(this.dirFor(id), 'session.json'), 'utf8')
        .then((text) => {
          const session = new Session(this.dirFor(id), JSON.parse(text) as StoredSession);
          this.sessions.set(id, session);
          session.scheduleExpiry();
          return session;
        })
        .catch(() => null)
        .finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    return pending;
  }

  async close() {
    await Promise.all([...this.sessions.values()].map((s) => s.close()));
  }
}
