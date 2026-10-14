import { desktop, type DesktopFolders } from '../../desktop/host';
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
