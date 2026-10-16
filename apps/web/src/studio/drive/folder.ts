import { desktop, type DesktopFolderFile, type DesktopFolders } from '../../desktop/host';
import type { DriveApi, DriveFile, DriveProps } from './DriveApi';

/**
 * A Project on a folder of this computer that the person's own sync client keeps in step
 * (OneDrive, Dropbox, a network share), through the desktop app's main process
 * (docs/SECURITY-HARDENING.md, E3). No sign-in and no token: the sync client moves the files.
 * Sharing is the sync client's too: this drive cannot share, and says so.
 */
export class FolderDrive implements DriveApi {
  private host: DesktopFolders;
  /** The folder new Projects are made in (the one the person chose). */
  private parent: string;

  constructor(parent: string, host: DesktopFolders | undefined = desktop()?.folder) {
    if (!host) throw new Error('Folders on this computer need the redcolumn desktop app.');
    this.host = host;
    this.parent = parent;
  }

  folderUrl(): string {
    return '';
  }

  /** Opens the folder in Explorer or Finder (to share it from the sync client). */
  show(folderId: string): Promise<void> {
    return this.host.show(folderId);
  }

  list(folderId: string): Promise<DriveFile[]> {
    return this.host.list(folderId);
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    return (await this.host.download(fileId)).slice().buffer;
  }

  createFolder(name: string): Promise<string> {
    return this.host.createFolder(this.parent, name);
  }

  async createFile(folderId: string, name: string, _mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    return this.host.createFile(folderId, name, new Uint8Array(await body.arrayBuffer()), properties);
  }

  async updateContent(fileId: string, body: Blob): Promise<string> {
    return this.host.updateContent(fileId, new Uint8Array(await body.arrayBuffer()));
  }

  updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    return this.host.updateProperties(fileId, properties);
  }

  /** A folder on this computer is shared from its sync client, not by redcolumn. */
  async shareWithLink(): Promise<void> {}

  async shareWithUser(): Promise<void> {
    throw new Error('This Project is a folder on your computer: share it from OneDrive, Dropbox or whichever app syncs it, then send the people you add its location.');
  }

  ownedByMe(fileId: string): Promise<boolean> {
    return this.host.ownedByMe(fileId);
  }

  remove(fileId: string): Promise<void> {
    return this.host.remove(fileId);
  }
}

/** Whether an ID is a folder on this computer. */
export const isLocalFolderId = (id: string) => id.startsWith('lf:');

/**
 * A Live Session kept in a folder on this computer that several people reach (a shared OneDrive,
 * Dropbox or Teams folder, a network share), through the desktop app's main process. No sign-in:
 * the sync client or file server moves the files, and decides who may read and write them.
 *
 * Unlike a Project, a session's file IDs travel between computers: room files are named after the
 * seat that wrote them, and documents are rooms and manifest entries by their ID. The IDs the
 * desktop app hands out are this computer's own (each person chose the folder in their own dialog),
 * so inside the session folder a file is known by a hash of its name, which every computer the
 * folder is copied to shares.
 */
export class SessionFolderDrive implements DriveApi {
  readonly backend = 'folder' as const;
  private host: DesktopFolders;
  /** Where a new session folder goes (the folder the host chose), when starting one. */
  private parent: string | null;
  /** Shared ID to this computer's ID, learned from every listing. */
  private local = new Map<string, string>();

  constructor(parent: string | null = null, host: DesktopFolders | undefined = desktop()?.folder) {
    if (!host) throw new Error('Sessions in a folder on this computer need the redcolumn desktop app.');
    this.host = host;
    this.parent = parent;
  }

  /** Opens the session folder in Explorer or Finder. */
  show(folderId: string): Promise<void> {
    return this.host.show(folderId);
  }

  private async adopt(f: DesktopFolderFile): Promise<DriveFile> {
    const id = await sharedFileId(f.name);
    this.local.set(id, f.id);
    return { ...f, id };
  }

  private path(id: string): string {
    const local = this.local.get(id);
    if (!local) throw new Error('That file is not in the session folder yet.');
    return local;
  }

  async list(folderId: string): Promise<DriveFile[]> {
    let files: DesktopFolderFile[];
    try {
      files = await this.host.list(folderId);
    } catch (err) {
      // Removed (the host ended the session) or moved away: DriveSession stops syncing on "could not find".
      if (err instanceof Error && /ENOENT|no longer chosen/.test(err.message)) throw new Error('This computer could not find the session folder.');
      throw err;
    }
    return Promise.all(files.map((f) => this.adopt(f)));
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    return (await this.host.download(this.path(fileId))).slice().buffer;
  }

  createFolder(name: string): Promise<string> {
    if (!this.parent) throw new Error('Choose a folder for the session first.');
    return this.host.createFolder(this.parent, name);
  }

  async createFile(folderId: string, name: string, _mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    return this.adopt(await this.host.createFile(folderId, name, new Uint8Array(await body.arrayBuffer()), properties));
  }

  async updateContent(fileId: string, body: Blob): Promise<string> {
    return this.host.updateContent(this.path(fileId), new Uint8Array(await body.arrayBuffer()));
  }

  updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    return this.host.updateProperties(this.path(fileId), properties);
  }

  /** The folder is shared by the sync client or file server, not by redcolumn. */
  async shareWithLink(): Promise<void> {}

  async shareWithUser(): Promise<void> {
    throw new Error('This session is a folder on your computer: share the folder from OneDrive, Dropbox or wherever it lives, then tell people where to find it.');
  }

  ownedByMe(fileId: string): Promise<boolean> {
    return this.host.ownedByMe(this.path(fileId));
  }

  removeFolder(folderId: string): Promise<void> {
    return this.host.removeSession(folderId);
  }
}

/** A file's ID inside a session folder: the same on every computer, and safe in a file name (no dots). */
export async function sharedFileId(name: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name)));
  return `f${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
