import { DriveAuthError, DriveForbiddenError, type DriveApi, type DriveFile, type DrivePermission } from '../drive/DriveApi';
import {
  MANIFEST_NAME,
  ROLE,
  applyFolderEdits,
  buildFiles,
  cleanItemName,
  descendantFolders,
  liveView,
  wouldCycle,
  type EditRecord,
  LEVEL_LABELS,
  folderChain,
  keyForFileName,
  mergeRecord,
  newId,
  pdfName,
  personKey,
  sidecarName,
  type Grant,
  type Level,
  type LockClaim,
  type Person,
  type ProjectFile,
  type ProjectFolder,
  type ProjectManifest,
  type ProjectRecordEntry,
  type ProjectRevision,
  type RecordKind,
} from './model';

/** A Project needs a drive that can delete (check-out locks are released by deleting them). */
export type ProjectDrive = DriveApi & Required<Pick<DriveApi, 'remove'>>;

export class ProjectError extends Error {}

/** The file is checked out by someone else. */
export class CheckedOutError extends ProjectError {
  readonly by: string;
  constructor(by: string) {
    super(`${by} has this file checked out.`);
    this.by = by;
  }
}

export interface ProjectSnapshot {
  manifest: ProjectManifest;
  folders: ProjectFolder[];
  files: ProjectFile[];
  record: ProjectRecordEntry[];
  /** What this person can do. `viewer` once OneDrive refuses a write. */
  level: Level;
  loadedAt: number;
}

export interface ProjectOptions {
  /** Signs in (a click) before the drive is used. */
  authorize: () => Promise<void>;
}

const dec = new TextDecoder();
const jsonBlob = (v: unknown) => new Blob([JSON.stringify(v)], { type: 'application/json' });

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Properties have a small size limit, so long values are cut. */
const fit = (v: string, max = 60) => v.slice(0, max);

interface Lock {
  by: string;
  key: string;
  at: number;
  note?: string;
}

interface Shard {
  entries: ProjectRecordEntry[];
}

/**
 * One person's view of a Project folder in OneDrive. Reads list the folder and rebuild the view;
 * writes only ever add files of their own (or delete their own lock), so people never overwrite
 * each other. Who may write is decided by the folder's sharing in OneDrive; a refusal there makes
 * this a read-only view.
 */
export class Project {
  private readonly api: ProjectDrive;
  private readonly me: Person;
  private readonly folderId: string;
  private readonly isOwner: boolean;
  private readonly opts: ProjectOptions;
  private snap: ProjectSnapshot;
  private listeners = new Set<() => void>();
  /** Bodies of files that are read once, by file ID and version. */
  private bodies = new Map<string, { version: string; body: unknown }>();
  private shardId: string | null = null;
  private myEntries: ProjectRecordEntry[] = [];

  private constructor(api: ProjectDrive, me: Person, folderId: string, isOwner: boolean, snap: ProjectSnapshot, opts: ProjectOptions) {
    this.api = api;
    this.me = me;
    this.folderId = folderId;
    this.isOwner = isOwner;
    this.snap = snap;
    this.opts = opts;
  }

  /** The ID others open the Project by (a share ID on OneDrive). */
  get id() {
    return this.folderId;
  }

  get level(): Level {
    return this.snap.level;
  }

  get canWrite(): boolean {
    return this.snap.level !== 'viewer';
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<ProjectSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  /** Makes a Project: a folder in the host's OneDrive, shared by link. */
  static async create(api: ProjectDrive, name: string, me: Person, opts: ProjectOptions & { linkCanEdit?: boolean }): Promise<Project> {
    const clean = cleanItemName(name, 120);
    if (!clean) throw new ProjectError('Give the Project a name.');
    await opts.authorize();
    const created = await api.createFolder(`${clean} (redcolumn project)`, { nbStudio: 'project' });
    const folderId = (await api.shareWithLink(created, opts.linkCanEdit === false ? 'reader' : 'writer')) || created;
    const manifest: ProjectManifest = { v: 1, name: clean, owner: me.name, ...(me.email ? { ownerEmail: me.email } : {}), createdAt: Date.now(), members: [] };
    await api.createFile(folderId, MANIFEST_NAME, 'application/json', jsonBlob(manifest), { nbRole: ROLE.manifest });
    const project = new Project(api, me, folderId, true, { manifest, folders: [], files: [], record: [], level: 'owner', loadedAt: Date.now() }, opts);
    await project.note('project', `made the Project “${clean}”`);
    return project;
  }

  /** Opens a Project by its ID (the link's share ID). Signs in first when `interactive`. */
  static async open(api: ProjectDrive, folderId: string, me: Person, opts: ProjectOptions & { interactive?: boolean }): Promise<Project> {
    if (opts.interactive) await opts.authorize();
    const files = await api.list(folderId);
    const mf = files.find((f) => f.properties.nbRole === ROLE.manifest);
    if (!mf) throw new ProjectError('That folder is not a redcolumn Project.');
    const manifest = JSON.parse(dec.decode(await api.download(mf.id))) as ProjectManifest;
    const isOwner = await api.ownedByMe(mf.id).catch(() => false);
    const project = new Project(api, me, folderId, isOwner, { manifest, folders: [], files: [], record: [], level: isOwner ? 'owner' : 'editor', loadedAt: 0 }, opts);
    await project.poll();
    return project;
  }

  /** Reads one file's JSON body, once per version. */
  private async body<T>(f: DriveFile): Promise<T | null> {
    const cached = this.bodies.get(f.id);
    if (cached && cached.version === f.version) return cached.body as T;
    try {
      const body = JSON.parse(dec.decode(await this.api.download(f.id))) as T;
      this.bodies.set(f.id, { version: f.version, body });
      return body;
    } catch (err) {
      if (err instanceof TypeError || err instanceof DriveAuthError) throw err;
      return null;
    }
  }

  /** Reads the folder again and rebuilds the view. */
  async poll(): Promise<void> {
    const listed = await this.api.list(this.folderId);
    const role = (f: DriveFile) => f.properties.nbRole;
    const manifestFile = listed.find((f) => role(f) === ROLE.manifest);
    const manifest = manifestFile ? ((await this.body<ProjectManifest>(manifestFile)) ?? this.snap.manifest) : this.snap.manifest;

    const dirs: (ProjectFolder & { created: string })[] = [];
    for (const f of listed.filter((x) => role(x) === ROLE.dir)) {
      const body = await this.body<ProjectFolder>(f);
      if (body?.id && body.name) dirs.push({ ...body, created: f.createdTime });
    }

    const edits: EditRecord[] = [];
    for (const f of listed.filter((x) => role(x) === ROLE.edit)) {
      const body = await this.body<Omit<EditRecord, 'created' | 'key'>>(f);
      if (body?.id && (body.target === 'file' || body.target === 'folder')) edits.push({ ...body, created: f.createdTime, key: f.id });
    }

    const revisions: (ProjectRevision & { fileId: string; created: string })[] = [];
    for (const f of listed.filter((x) => role(x) === ROLE.rev)) {
      const body = await this.body<ProjectRevision>(f);
      const fileId = f.properties.nbF;
      // A revision counts only with its PDF alongside.
      if (body && fileId && listed.some((p) => p.name === pdfName(fileId, body.n))) revisions.push({ ...body, fileId, created: f.createdTime });
    }

    const claims: LockClaim[] = [];
    for (const f of listed.filter((x) => role(x) === ROLE.lock)) {
      const body = await this.body<Lock>(f);
      const fileId = f.properties.nbF;
      if (body && fileId) claims.push({ lockId: f.id, fileId, by: body.by, key: body.key, at: body.at, ...(body.note ? { note: body.note } : {}), created: f.createdTime });
    }

    const shards: ProjectRecordEntry[][] = [];
    const mine = `rec-${keyForFileName(personKey(this.me))}`;
    for (const f of listed.filter((x) => role(x) === ROLE.record)) {
      const body = await this.body<Shard>(f);
      if (f.properties.nbKey === mine) {
        this.shardId = f.id;
        this.myEntries = body?.entries ?? [];
      }
      if (body?.entries) shards.push(body.entries);
    }

    const view = liveView(applyFolderEdits(dirs, edits), buildFiles(revisions, claims, edits));
    view.folders.sort((a, b) => a.name.localeCompare(b.name));
    this.set({ manifest, folders: view.folders, files: view.files, record: mergeRecord(shards), loadedAt: Date.now() });
  }

  /** Runs a write; OneDrive refusing it means this person can only view. */
  private async write<T>(job: () => Promise<T>): Promise<T> {
    try {
      return await job();
    } catch (err) {
      if (err instanceof DriveForbiddenError) {
        if (!this.isOwner) this.set({ level: 'viewer' });
        throw new ProjectError('You can view this Project but not change it. Ask the owner to let you edit the OneDrive folder.');
      }
      throw err;
    }
  }

  private requireWrite() {
    if (!this.canWrite) throw new ProjectError('You can view this Project but not change it.');
  }

  /** Adds an entry to the Project Record (this person's own share of it). */
  async note(kind: RecordKind, text: string, ref: { fileId?: string; folderId?: string } = {}): Promise<void> {
    const entry: ProjectRecordEntry = { id: newId(), at: Date.now(), who: this.me.name, kind, text, ...ref };
    this.myEntries = [...this.myEntries, entry];
    const mineIds = new Set(this.myEntries.map((e) => e.id));
    this.set({ record: mergeRecord([this.snap.record.filter((e) => !mineIds.has(e.id)), this.myEntries]) });
    try {
      await this.write(async () => {
        const body = jsonBlob({ entries: this.myEntries } satisfies Shard);
        if (this.shardId) await this.api.updateContent(this.shardId, body);
        else {
          const key = `rec-${keyForFileName(personKey(this.me))}`;
          const f = await this.api.createFile(this.folderId, `${key}.json`, 'application/json', body, { nbRole: ROLE.record, nbKey: fit(key) });
          this.shardId = f.id;
        }
      });
    } catch (err) {
      // The Record is a convenience: a failed write must not fail the action it describes.
      if (err instanceof TypeError || err instanceof DriveAuthError) throw err;
    }
  }

  /** Makes a folder. */
  async addFolder(name: string, parentId: string | null): Promise<ProjectFolder> {
    this.requireWrite();
    const clean = cleanItemName(name);
    if (!clean) throw new ProjectError('Give the folder a name.');
    if (parentId && !this.snap.folders.some((f) => f.id === parentId)) throw new ProjectError('That folder is gone.');
    if (this.snap.folders.some((f) => f.parentId === parentId && f.name.toLowerCase() === clean.toLowerCase())) throw new ProjectError(`There is already a folder called “${clean}” here.`);
    const folder: ProjectFolder = { id: newId(), name: clean, parentId, by: this.me.name, at: Date.now() };
    await this.write(() => this.api.createFile(this.folderId, `dir-${folder.id}.json`, 'application/json', jsonBlob(folder), { nbRole: ROLE.dir, nbId: folder.id }));
    this.set({ folders: [...this.snap.folders, folder].sort((a, b) => a.name.localeCompare(b.name)) });
    await this.note('folder', `added the folder “${clean}”`, { folderId: folder.id });
    return folder;
  }

  /** Uploads one revision of a file: the PDF first, then the sidecar that makes it count. */
  private async putRevision(fileId: string, rev: ProjectRevision, bytes: ArrayBuffer): Promise<void> {
    await this.write(async () => {
      await this.api.createFile(this.folderId, pdfName(fileId, rev.n), 'application/pdf', new Blob([bytes], { type: 'application/pdf' }), { nbRole: 'document' });
      await this.api.createFile(this.folderId, sidecarName(fileId, rev.n), 'application/json', jsonBlob(rev), { nbRole: ROLE.rev, nbF: fileId, nbN: String(rev.n) });
    });
  }

  /** Adds a PDF to a folder as revision 1. */
  async addFile(name: string, folderId: string | null, bytes: ArrayBuffer): Promise<ProjectFile> {
    this.requireWrite();
    const clean = cleanItemName(name);
    if (!clean) throw new ProjectError('Give the file a name.');
    if (folderId && !this.snap.folders.some((f) => f.id === folderId)) throw new ProjectError('That folder is gone.');
    if (this.snap.files.some((f) => f.folderId === folderId && f.name.toLowerCase() === clean.toLowerCase())) throw new ProjectError(`“${clean}” is already in this folder. Check it out and in to add a revision.`);
    const id = newId();
    const rev: ProjectRevision = { n: 1, name: clean, folderId, size: bytes.byteLength, sha256: await sha256(bytes), at: Date.now(), by: this.me.name, comment: 'First revision' };
    await this.putRevision(id, rev, bytes);
    await this.note('file', `added ${clean}`, { fileId: id, ...(folderId ? { folderId } : {}) });
    await this.poll();
    return this.snap.files.find((f) => f.id === id)!;
  }

  private file(fileId: string): ProjectFile {
    const f = this.snap.files.find((x) => x.id === fileId);
    if (!f) throw new ProjectError('That file is gone.');
    return f;
  }

  /** Whether this person holds the file's check-out. */
  heldByMe(file: ProjectFile): boolean {
    return file.checkout?.key === personKey(this.me);
  }

  /**
   * Checks a file out. Claims go in as files, and the earliest claim wins, so two people checking
   * out at once cannot both succeed: the later one removes their claim and is told who has it.
   */
  async checkOut(fileId: string, note?: string): Promise<void> {
    this.requireWrite();
    let file = this.file(fileId);
    if (file.checkout) {
      if (this.heldByMe(file)) return;
      throw new CheckedOutError(file.checkout.by);
    }
    const lock: Lock = { by: this.me.name, key: personKey(this.me), at: Date.now(), ...(note?.trim() ? { note: note.trim().slice(0, 200) } : {}) };
    const claim = await this.write(() => this.api.createFile(this.folderId, `lock-${fileId}-${newId()}.json`, 'application/json', jsonBlob(lock), { nbRole: ROLE.lock, nbF: fileId }));
    await this.poll();
    file = this.file(fileId);
    if (file.checkout?.lockId !== claim.id) {
      await this.api.remove(claim.id).catch(() => {});
      await this.poll();
      throw new CheckedOutError(file.checkout?.by ?? 'Someone');
    }
    await this.note('checkout', `checked out ${file.name}`, { fileId });
  }

  /**
   * Gives up a check-out without checking in. Your own is always released; someone else's only
   * with `force` (the owner, or a lock left behind), and the Record says so.
   */
  async undoCheckOut(fileId: string, force = false): Promise<void> {
    this.requireWrite();
    const file = this.file(fileId);
    if (!file.checkout) return;
    const mine = this.heldByMe(file);
    if (!mine && !force) throw new CheckedOutError(file.checkout.by);
    const { lockId, by } = file.checkout;
    await this.write(() => this.api.remove(lockId));
    await this.note('checkout', mine ? `undid the check-out of ${file.name}` : `released ${by}’s check-out of ${file.name}`, { fileId });
    await this.poll();
  }

  /** Checks in the next revision. Only whoever has the file checked out can. */
  async checkIn(fileId: string, bytes: ArrayBuffer, comment: string, edit: { name?: string; folderId?: string | null } = {}): Promise<ProjectRevision> {
    this.requireWrite();
    // Renames and moves by others since the last read are carried into the new revision.
    await this.poll();
    const file = this.file(fileId);
    if (file.checkout && !this.heldByMe(file)) throw new CheckedOutError(file.checkout.by);
    if (!file.checkout) throw new ProjectError('Check the file out before checking it in.');
    const last = file.revisions[file.revisions.length - 1]!;
    const name = edit.name ? cleanItemName(edit.name) || file.name : file.name;
    const rev: ProjectRevision = {
      n: last.n + 1,
      name,
      folderId: edit.folderId === undefined ? file.folderId : edit.folderId,
      size: bytes.byteLength,
      sha256: await sha256(bytes),
      at: Date.now(),
      by: this.me.name,
      comment: comment.trim().slice(0, 500) || `Revision ${last.n + 1}`,
    };
    await this.putRevision(fileId, rev, bytes);
    // Released only once the revision is safely in.
    await this.write(() => this.api.remove(file.checkout!.lockId));
    await this.note('checkin', `checked in ${name} as revision ${rev.n}${rev.comment ? `: ${rev.comment}` : ''}`, { fileId });
    await this.poll();
    return rev;
  }

  /** Makes an older revision the newest again, as a new revision (checking the file out first if need be). */
  async restore(fileId: string, n: number): Promise<ProjectRevision> {
    const { bytes, revision } = await this.download(fileId, n);
    await this.checkOut(fileId, `Restoring revision ${n}`);
    return this.checkIn(fileId, bytes, `Restored revision ${revision.n}`);
  }

  /** The bytes of one revision (the latest by default), checked against its hash. */
  async download(fileId: string, n?: number): Promise<{ bytes: ArrayBuffer; revision: ProjectRevision }> {
    const file = this.file(fileId);
    const revision = file.revisions.find((r) => r.n === (n ?? file.revisions[file.revisions.length - 1]!.n));
    if (!revision) throw new ProjectError('That revision does not exist.');
    const listed = await this.api.list(this.folderId);
    const pdf = listed.find((f) => f.name === pdfName(fileId, revision.n));
    if (!pdf) throw new ProjectError('That revision’s PDF is missing from the folder.');
    const bytes = await this.api.download(pdf.id);
    if ((await sha256(bytes)) !== revision.sha256) throw new ProjectError('That revision’s PDF does not match what was checked in. It may still be syncing; try again.');
    return { bytes, revision };
  }

  /** Invites someone by email to edit the OneDrive folder, and lists them as a member. Owner only. */
  async invite(email: string, level: Grant['level'] = 'editor'): Promise<void> {
    if (!this.isOwner) throw new ProjectError('Only the owner can invite people.');
    const who = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(who)) throw new ProjectError('Enter an email address.');
    await this.write(() => this.api.shareWithUser(this.folderId, who, `You are invited to the redcolumn Project “${this.snap.manifest.name}”.`, level === 'viewer' ? 'reader' : 'writer'));
    const manifest: ProjectManifest = { ...this.snap.manifest, members: [...this.snap.manifest.members.filter((m) => m.who.toLowerCase() !== who.toLowerCase()), { who, level }] };
    await this.writeManifest(manifest);
    await this.note('members', `invited ${who} (${LEVEL_LABELS[level].toLowerCase()})`);
  }

  /** Who the OneDrive folder is shared with. Only the owner can see this. */
  async members(): Promise<DrivePermission[]> {
    if (!this.isOwner) throw new ProjectError('Only the owner can see who the Project is shared with.');
    if (!this.api.listPermissions) throw new ProjectError('This drive cannot list who a folder is shared with.');
    return this.api.listPermissions(this.folderId);
  }

  /** Lets someone view or edit. Their access is changed in OneDrive itself. */
  async setLevel(permissionId: string, level: Grant['level']): Promise<void> {
    if (!this.isOwner) throw new ProjectError('Only the owner can change who can edit.');
    if (!this.api.setPermissionRole) throw new ProjectError('This drive cannot change access.');
    const who = (await this.members()).find((p) => p.id === permissionId);
    await this.write(() => this.api.setPermissionRole!(this.folderId, permissionId, level === 'viewer' ? 'reader' : 'writer'));
    await this.note('members', `changed ${who?.email ?? who?.name ?? 'access'} to ${LEVEL_LABELS[level].toLowerCase()}`);
  }

  /** Stops sharing the folder with one person (or the link). */
  async removeMember(permissionId: string): Promise<void> {
    if (!this.isOwner) throw new ProjectError('Only the owner can remove people.');
    if (!this.api.removePermission) throw new ProjectError('This drive cannot change access.');
    const who = (await this.members()).find((p) => p.id === permissionId);
    if (who?.kind === 'owner') throw new ProjectError('The owner cannot be removed.');
    await this.write(() => this.api.removePermission!(this.folderId, permissionId));
    const email = who?.email?.toLowerCase();
    if (email && this.snap.manifest.members.some((m) => m.who.toLowerCase() === email)) await this.writeManifest({ ...this.snap.manifest, members: this.snap.manifest.members.filter((m) => m.who.toLowerCase() !== email) });
    await this.note('members', `${who?.kind === 'link' ? 'turned off' : 'removed'} ${who?.email ?? who?.name ?? 'access'}`);
  }

  private async writeManifest(manifest: ProjectManifest) {
    const listed = await this.api.list(this.folderId);
    const mf = listed.find((f) => f.properties.nbRole === ROLE.manifest);
    if (!mf) throw new ProjectError('The Project’s settings file is missing.');
    await this.write(() => this.api.updateContent(mf.id, jsonBlob(manifest)));
    this.set({ manifest });
  }


  /** Writes one edit (rename, move or delete) as a file of its own. */
  private async putEdit(edit: Pick<EditRecord, 'target' | 'id' | 'name' | 'to' | 'deleted'>): Promise<void> {
    const body = { target: edit.target, id: edit.id, ...(edit.name !== undefined ? { name: edit.name } : {}), ...('to' in edit && edit.to !== undefined ? { to: edit.to } : {}), ...(edit.deleted !== undefined ? { deleted: edit.deleted } : {}) };
    await this.write(() => this.api.createFile(this.folderId, `edit-${edit.id}-${newId()}.json`, 'application/json', jsonBlob(body), { nbRole: ROLE.edit, nbT: edit.id }));
  }

  /** A file that may be renamed or moved by this person: nobody else has it checked out. */
  private editableFile(fileId: string): ProjectFile {
    this.requireWrite();
    const file = this.file(fileId);
    if (file.checkout && !this.heldByMe(file)) throw new CheckedOutError(file.checkout.by);
    return file;
  }

  private checkFileName(name: string, folderId: string | null, exceptId: string): string {
    const clean = cleanItemName(name);
    if (!clean) throw new ProjectError('Give the file a name.');
    if (this.snap.files.some((f) => f.id !== exceptId && f.folderId === folderId && f.name.toLowerCase() === clean.toLowerCase())) throw new ProjectError(`“${clean}” is already in that folder.`);
    return clean;
  }

  private checkFolderName(name: string, parentId: string | null, exceptId: string): string {
    const clean = cleanItemName(name);
    if (!clean) throw new ProjectError('Give the folder a name.');
    if (this.snap.folders.some((f) => f.id !== exceptId && f.parentId === parentId && f.name.toLowerCase() === clean.toLowerCase())) throw new ProjectError(`There is already a folder called “${clean}” there.`);
    return clean;
  }

  private checkFolderExists(id: string | null) {
    if (id && !this.snap.folders.some((f) => f.id === id)) throw new ProjectError('That folder is gone.');
  }

  async renameFile(fileId: string, name: string): Promise<void> {
    const file = this.editableFile(fileId);
    const clean = this.checkFileName(name, file.folderId, fileId);
    if (clean === file.name) return;
    await this.putEdit({ target: 'file', id: fileId, name: clean });
    await this.note('file', `renamed ${file.name} to ${clean}`, { fileId });
    await this.poll();
  }

  async moveFile(fileId: string, folderId: string | null): Promise<void> {
    const file = this.editableFile(fileId);
    this.checkFolderExists(folderId);
    if (folderId === file.folderId) return;
    this.checkFileName(file.name, folderId, fileId);
    await this.putEdit({ target: 'file', id: fileId, to: folderId });
    await this.note('file', `moved ${file.name} to ${this.where(folderId)}`, { fileId, ...(folderId ? { folderId } : {}) });
    await this.poll();
  }

  /**
   * Removes a file from the Project. Its revisions stay in the OneDrive folder (nothing is
   * destroyed), so the owner can still find them there. A checked-out file must be released first.
   */
  async deleteFile(fileId: string): Promise<void> {
    this.requireWrite();
    const file = this.file(fileId);
    if (file.checkout && !this.heldByMe(file)) throw new CheckedOutError(file.checkout.by);
    if (file.checkout) throw new ProjectError('Undo your check-out before deleting the file.');
    await this.putEdit({ target: 'file', id: fileId, deleted: true });
    await this.note('file', `deleted ${file.name}`, { fileId });
    await this.poll();
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    this.requireWrite();
    const folder = this.snap.folders.find((f) => f.id === folderId);
    if (!folder) throw new ProjectError('That folder is gone.');
    const clean = this.checkFolderName(name, folder.parentId, folderId);
    if (clean === folder.name) return;
    await this.putEdit({ target: 'folder', id: folderId, name: clean });
    await this.note('folder', `renamed the folder ${folder.name} to ${clean}`, { folderId });
    await this.poll();
  }

  async moveFolder(folderId: string, parentId: string | null): Promise<void> {
    this.requireWrite();
    const folder = this.snap.folders.find((f) => f.id === folderId);
    if (!folder) throw new ProjectError('That folder is gone.');
    this.checkFolderExists(parentId);
    if (wouldCycle(this.snap.folders, folderId, parentId)) throw new ProjectError('A folder cannot be moved into itself.');
    if (parentId === folder.parentId) return;
    this.checkFolderName(folder.name, parentId, folderId);
    await this.putEdit({ target: 'folder', id: folderId, to: parentId });
    await this.note('folder', `moved the folder ${folder.name} to ${this.where(parentId)}`, { folderId });
    await this.poll();
  }

  /** What deleting a folder takes with it: the folders and files inside, at any depth. */
  contentsOf(folderId: string): { folders: number; files: number } {
    const ids = new Set([folderId, ...descendantFolders(this.snap.folders, folderId).map((f) => f.id)]);
    return { folders: ids.size - 1, files: this.snap.files.filter((f) => f.folderId && ids.has(f.folderId)).length };
  }

  /**
   * Removes a folder and everything in it from the Project. Files stay in the OneDrive folder, and
   * none inside may be checked out.
   */
  async deleteFolder(folderId: string): Promise<void> {
    this.requireWrite();
    const folder = this.snap.folders.find((f) => f.id === folderId);
    if (!folder) throw new ProjectError('That folder is gone.');
    const ids = new Set([folderId, ...descendantFolders(this.snap.folders, folderId).map((f) => f.id)]);
    const out = this.snap.files.find((f) => f.folderId && ids.has(f.folderId) && f.checkout);
    if (out) throw new ProjectError(`${out.name} is checked out${out.checkout ? ` by ${this.heldByMe(out) ? 'you' : out.checkout.by}` : ''}. Release it before deleting the folder.`);
    await this.putEdit({ target: 'folder', id: folderId, deleted: true });
    await this.note('folder', `deleted the folder ${folder.name}`, { folderId });
    await this.poll();
  }

  private where(folderId: string | null): string {
    return folderId ? `the folder ${this.pathOf(folderId).map((f) => f.name).join(' / ')}` : 'the top of the Project';
  }

  /** Folders a file sits in, outermost first (for breadcrumbs). */
  pathOf(folderId: string | null): ProjectFolder[] {
    return folderChain(this.snap.folders, folderId).reverse();
  }
}
