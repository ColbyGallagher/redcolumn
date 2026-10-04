/**
 * The cloud-drive operations a Drive session needs. `GoogleDrive` implements them over the Google
 * Drive REST API and `OneDrive` over Microsoft Graph; tests use an in-memory fake.
 *
 * Access model (the `drive.file` scope): this app may write only files it created and folders the
 * user picked. Everything in a session folder is shared "anyone with the link", so every attendee
 * reads it with the API key, without needing per-file access.
 */

/** Custom properties on a file; each key plus value must fit in 124 bytes. */
export type DriveProps = Record<string, string>;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Increases on every content or metadata change. */
  version: string;
  size: number;
  createdTime: string;
  properties: DriveProps;
}

export interface DriveApi {
  /** Which drive this is (Google Drive when absent). */
  readonly backend?: 'drive' | 'onedrive';
  /** A web link that opens the session folder (Google Drive's folder page when absent). */
  folderUrl?(folderId: string): string;
  /** Lists a public folder's files (read with the API key). */
  list(folderId: string): Promise<DriveFile[]>;
  /** Downloads a file in a public folder (read with the API key). */
  download(fileId: string): Promise<ArrayBuffer>;
  createFolder(name: string, properties: DriveProps): Promise<string>;
  createFile(folderId: string, name: string, mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile>;
  /** Replaces a file's content; returns the new version. */
  updateContent(fileId: string, body: Blob): Promise<string>;
  /** Merges properties; returns the new version. */
  updateProperties(fileId: string, properties: DriveProps): Promise<string>;
  /**
   * Shares a file or folder with anyone who has the link. May return the ID others open the
   * folder by from then on (OneDrive: the link's share ID), which becomes the session's ID.
   */
  shareWithLink(fileId: string, role: 'reader' | 'writer'): Promise<string | void>;
  /** Shares with one person (an editor unless `role` says reader), emailing them `message`. */
  shareWithUser(fileId: string, email: string, message: string, role?: 'reader' | 'writer'): Promise<void>;
  /** Whether this user owns the file (the host owns the session's manifest). */
  ownedByMe(fileId: string): Promise<boolean>;
  /** Deletes a file (Projects release their check-out locks this way). */
  remove?(fileId: string): Promise<void>;
  /** Who a folder is shared with, as the drive reports it (for those allowed to see). */
  listPermissions?(folderId: string): Promise<DrivePermission[]>;
  /** Changes what one of those people (or the link) may do. */
  setPermissionRole?(folderId: string, permissionId: string, role: 'reader' | 'writer'): Promise<void>;
  /** Stops sharing with one of those people (or the link). */
  removePermission?(folderId: string, permissionId: string): Promise<void>;
}

/** One way a folder is shared. */
export interface DrivePermission {
  id: string;
  kind: 'owner' | 'user' | 'link';
  /** The person's name, or what the link is. */
  name: string;
  email?: string;
  role: 'owner' | 'reader' | 'writer';
  /** Passed down from a folder above, so it cannot be changed here. */
  inherited: boolean;
}

/** Sign-in lapsed (or was never given); retry after `reconnect`. */
export class DriveAuthError extends Error {}

/** The user may view but not change this file or folder. */
export class DriveForbiddenError extends Error {}
