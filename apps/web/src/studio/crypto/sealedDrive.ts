import type { DriveApi, DriveFile, DriveProps, LinkOptions } from '../drive/DriveApi';
import { readLocal, writeLocal } from '../local';
import { aesKey, fromB64url, isSealed, newKeyBytes, SEALED_JSON_KEY, seal, sealedJsonBytes, toB64url, unseal } from './keys';

/**
 * An encrypted Project's drive (docs/SECURITY-HARDENING.md, phase 5, "Encrypted Project"): every
 * file's content is sealed with the Project's key before it goes up, and opened as it comes down.
 * The key travels in the Project's invite link after `#pk=`, so OneDrive stores only ciphertext.
 * File names and properties (roles, who made what) stay readable, as Projects find files by them.
 * Without a key it passes everything through, but refuses to hand back a file that is sealed.
 */

export class ProjectLockedError extends Error {
  constructor() {
    super('This Project is encrypted, and the link you opened is missing its key (the part after #). Ask the owner for the full Project link.');
  }
}


export class SealedDrive implements DriveApi {
  readonly backend: DriveApi['backend'];
  private inner: DriveApi;
  private key: Promise<CryptoKey> | null;

  constructor(inner: DriveApi, key: string | null) {
    this.inner = inner;
    this.backend = inner.backend;
    this.key = key ? aesKey(fromB64url(key)) : null;
    // Optional verbs exist here only where the drive has them.
    for (const verb of ['readAppFile', 'writeAppFile', 'remove', 'removeFolder', 'listPermissions', 'setPermissionRole', 'removePermission'] as const) {
      if (!inner[verb]) (this as Record<string, unknown>)[verb] = undefined;
    }
  }

  get encrypted() {
    return !!this.key;
  }

  private async sealBody(body: Blob): Promise<Blob> {
    if (!this.key) return body;
    const sealed = await seal(await this.key, 0, new Uint8Array(await body.arrayBuffer()));
    // JSON stays JSON, so drives that keep properties inside JSON files still can.
    if (body.type === 'application/json') return new Blob([JSON.stringify({ [SEALED_JSON_KEY]: toB64url(sealed) })], { type: 'application/json' });
    return new Blob([sealed as Uint8Array<ArrayBuffer>], { type: body.type });
  }

  private async open(data: ArrayBuffer): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(data);
    const sealed = isSealed(bytes) ? bytes : sealedJsonBytes(bytes);
    if (!sealed) return data;
    if (!this.key) throw new ProjectLockedError();
    return (await unseal(await this.key, sealed)).slice().buffer;
  }

  folderUrl(folderId: string): string {
    return this.inner.folderUrl?.(folderId) ?? '';
  }
  list(folderId: string): Promise<DriveFile[]> {
    return this.inner.list(folderId);
  }
  async download(fileId: string): Promise<ArrayBuffer> {
    return this.open(await this.inner.download(fileId));
  }
  createFolder(name: string, properties: DriveProps): Promise<string> {
    return this.inner.createFolder(name, properties);
  }
  async createFile(folderId: string, name: string, mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    return this.inner.createFile(folderId, name, mimeType, await this.sealBody(body), this.key ? { ...properties, nbEnc: '1' } : properties);
  }
  async updateContent(fileId: string, body: Blob): Promise<string> {
    return this.inner.updateContent(fileId, await this.sealBody(body));
  }
  updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    return this.inner.updateProperties(fileId, properties);
  }
  shareWithLink(fileId: string, role: 'reader' | 'writer', options?: LinkOptions): Promise<string | void> {
    return this.inner.shareWithLink(fileId, role, options);
  }
  shareWithUser(fileId: string, email: string, message: string, role?: 'reader' | 'writer'): Promise<void> {
    return this.inner.shareWithUser(fileId, email, message, role);
  }
  ownedByMe(fileId: string): Promise<boolean> {
    return this.inner.ownedByMe(fileId);
  }
  readAppFile?(name: string): Promise<string | null> {
    return this.inner.readAppFile!(name);
  }
  writeAppFile?(name: string, text: string): Promise<void> {
    return this.inner.writeAppFile!(name, text);
  }
  remove?(fileId: string): Promise<void> {
    return this.inner.remove!(fileId);
  }
  removeFolder?(folderId: string): Promise<void> {
    return this.inner.removeFolder!(folderId);
  }
  listPermissions?(folderId: string) {
    return this.inner.listPermissions!(folderId);
  }
  setPermissionRole?(folderId: string, permissionId: string, role: 'reader' | 'writer') {
    return this.inner.setPermissionRole!(folderId, permissionId, role);
  }
  removePermission?(folderId: string, permissionId: string) {
    return this.inner.removePermission!(folderId, permissionId);
  }
}

// ---- Project keys in this browser and in links ----

const KEYS = 'nb.projects.keys';

export const newProjectKey = () => toB64url(newKeyBytes());
export const projectKey = (projectId: string): string | null => readLocal<Record<string, string>>(KEYS, {})[projectId] ?? null;
export function rememberProjectKey(projectId: string, key: string) {
  writeLocal(KEYS, { ...readLocal<Record<string, string>>(KEYS, {}), [projectId]: key });
}

/** The key in a Project link or pasted text (`#pk=<key>`), or null. */
export function parseProjectKey(text: string): string | null {
  return /(?:^|[#&?\s])pk=([\w-]{43})(?![\w-])/.exec(text)?.[1] ?? null;
}

