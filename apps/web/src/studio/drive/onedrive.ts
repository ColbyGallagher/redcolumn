import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { DriveAuthError, DriveForbiddenError, type DriveApi, type DriveFile, type DriveProps } from './DriveApi';
import { requireOnline } from '../../offline/network';

/**
 * Microsoft configuration from the build (apps/web/.env.local, or GitHub Actions variables). The
 * client ID is not secret: it is an Entra ID "Single-page application" registration whose redirect
 * URI is this site's msal-redirect.html.
 */
const CLIENT_ID = import.meta.env.VITE_MICROSOFT_CLIENT_ID as string | undefined;
/** `common` (work and personal accounts), `consumers`, `organizations`, or one tenant's ID. */
const TENANT = (import.meta.env.VITE_MICROSOFT_TENANT as string | undefined) || 'common';

export const oneDriveConfigured = !!CLIENT_ID;

/**
 * Least access first, stepping up only when Microsoft refuses something (MSAL adds openid, profile
 * and offline_access for sign-in):
 *   0. Files.ReadWrite.AppFolder: only the app's own folder, Apps/redcolumn, where sessions live.
 *   1. Files.ReadWrite: the person's own OneDrive (if sharing the session folder needs it).
 *   2. Files.ReadWrite.All: also files others share with them (if joining someone's session needs it).
 */
const ACCESS_LEVELS = [['Files.ReadWrite.AppFolder'], ['Files.ReadWrite'], ['Files.ReadWrite.All']];
const LEVEL_KEY = 'nb.onedrive.level';
const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Graph accepts simple uploads up to 4 MB; bigger files go up in chunks through an upload session. */
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
/** Upload session chunks must be multiples of 320 KiB. */
const CHUNK = 320 * 1024 * 20;
/** Where Drive-style properties live inside a JSON file (Graph has no custom file properties). */
const PROPS_KEY = '_nb';

let msal: Promise<IPublicClientApplication> | null = null;

function app(): Promise<IPublicClientApplication> {
  if (!CLIENT_ID) return Promise.reject(new Error('Microsoft sign-in is not configured for this site.'));
  msal ??= import('@azure/msal-browser').then(async ({ PublicClientApplication }) => {
    const pca = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT}`,
        redirectUri: new URL(`${import.meta.env.BASE_URL}msal-redirect.html`, window.location.origin).href,
      },
      // Remembered across visits, so rejoining a session on page load signs in silently.
      cache: { cacheLocation: 'localStorage' },
    });
    await pca.initialize();
    const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
    if (account) pca.setActiveAccount(account);
    return pca;
  });
  return msal;
}

/** The Microsoft account signed in on this browser. */
export interface MicrosoftUser {
  email: string;
  name: string;
}

const userListeners = new Set<() => void>();
let user: MicrosoftUser | null = null;

function toUser(a: AccountInfo | null): MicrosoftUser | null {
  return a ? { email: a.username.toLowerCase(), name: a.name || a.username } : null;
}

function setUser(next: MicrosoftUser | null) {
  user = next;
  for (const l of userListeners) l();
}

// Pick up an account remembered from an earlier visit.
if (CLIENT_ID && typeof window !== 'undefined') void app().then((pca) => setUser(toUser(pca.getActiveAccount())), () => {});

export function microsoftUser(): MicrosoftUser | null {
  return user;
}

export function subscribeMicrosoftUser(listener: () => void): () => void {
  userListeners.add(listener);
  return () => userListeners.delete(listener);
}

/** The access this browser has needed so far (remembered across visits). */
function accessLevel(): number {
  try {
    return Math.min(ACCESS_LEVELS.length - 1, Math.max(0, Number(localStorage.getItem(LEVEL_KEY)) || 0));
  } catch {
    return 0;
  }
}

function raiseAccess(level: number) {
  try {
    localStorage.setItem(LEVEL_KEY, String(level));
  } catch {
    // Asked again next visit.
  }
}

const scopes = () => ACCESS_LEVELS[accessLevel()]!;

/** A Graph token without any popup, or a DriveAuthError when the user has to sign in. */
async function silentToken(): Promise<string> {
  const pca = await app();
  const account = pca.getActiveAccount();
  if (!account) throw new DriveAuthError('Sign in to Microsoft to open OneDrive sessions.');
  try {
    return (await pca.acquireTokenSilent({ scopes: scopes(), account })).accessToken;
  } catch {
    throw new DriveAuthError('Microsoft sign-in has expired.');
  }
}

/**
 * Signs in with Microsoft (a popup, so call it from a click); does nothing when already signed in
 * with the access needed. After Microsoft refused something, this asks for the next access level.
 */
export async function signInWithMicrosoft(): Promise<MicrosoftUser> {
  requireOnline('Signing in with Microsoft');
  const pca = await app();
  try {
    await silentToken();
  } catch {
    try {
      const account = pca.getActiveAccount();
      const result = await pca.acquireTokenPopup({ scopes: scopes(), ...(account ? { account } : { prompt: 'select_account' }) });
      pca.setActiveAccount(result.account);
    } catch (err) {
      const code = (err as { errorCode?: string }).errorCode;
      throw new DriveAuthError(code === 'user_cancelled' ? 'Microsoft sign-in was closed.' : `Microsoft sign-in failed${err instanceof Error ? `: ${err.message}` : '.'}`);
    }
  }
  const next = toUser(pca.getActiveAccount());
  if (!next) throw new DriveAuthError('Microsoft sign-in failed.');
  setUser(next);
  return next;
}

export async function signOutOfMicrosoft() {
  const pca = await app();
  const account = pca.getActiveAccount();
  setUser(null);
  pca.setActiveAccount(null);
  if (account) await pca.clearCache({ account });
}

/** A sharing URL as the ID Graph's /shares endpoint takes (`u!` plus unpadded base64url). */
export function shareIdFromUrl(url: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(url)));
  return `u!${b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
}

/** The sharing URL inside a share ID, for "Open in OneDrive". */
export function urlFromShareId(id: string): string | null {
  if (!id.startsWith('u!')) return null;
  try {
    const b64 = id.slice(2).replace(/_/g, '/').replace(/-/g, '+');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/**
 * A OneDrive session invite, from what someone pasted: this app's `?onedrive=` link, a share ID,
 * or the OneDrive / SharePoint sharing link to the folder itself.
 */
export function parseOneDriveInvite(text: string): string | null {
  const t = text.trim();
  if (/^u![\w-]{8,}$/.test(t)) return t;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  const param = url.searchParams.get('onedrive');
  if (param && /^u![\w-]{8,}$/.test(param)) return param;
  if (/(^|\.)(1drv\.ms|onedrive\.live\.com|sharepoint\.com)$/i.test(url.hostname)) return shareIdFromUrl(t);
  return null;
}

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  createdDateTime?: string;
  file?: { mimeType?: string };
  folder?: unknown;
  createdBy?: { user?: { displayName?: string; email?: string } };
  parentReference?: { driveId?: string };
  '@microsoft.graph.downloadUrl'?: string;
}

/** What a file's role is, for files whose properties cannot be stored inside them. */
function isJson(name: string) {
  return /\.(json|nbseat)$/i.test(name);
}

async function failure(res: Response, what: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  const detail = body?.error?.message;
  if (res.status === 401) return new DriveAuthError('Microsoft sign-in has expired.');
  if (res.status === 403) return new DriveForbiddenError(detail ?? `Not allowed to ${what}.`);
  if (res.status === 404) return new Error(`OneDrive could not find what was needed to ${what}. Is the session folder still shared?`);
  return new Error(`OneDrive could not ${what}${detail ? `: ${detail}` : ` (${res.status})`}.`);
}

/**
 * OneDrive (personal or work) over Microsoft Graph, as a DriveApi so Drive sessions run on it
 * unchanged. Differences from Google Drive that this papers over:
 *
 * - Everyone signs in: Graph has no API-key reads, so attendees read the shared folder as themselves.
 * - The session folder's ID is its sharing link as a share ID (`u!…`), which works for anyone the
 *   link lets in; opening it redeems the link, giving the attendee lasting access.
 * - Graph has no custom file properties. JSON files (the manifest and seats) carry theirs inside
 *   under `_nb`, hidden from callers; PDFs are recognised by extension, added by their creator.
 */
export class OneDrive implements DriveApi {
  readonly backend = 'onedrive' as const;
  /** Share IDs to the folder they open. */
  private folders = new Map<string, { driveId: string; itemId: string }>();
  /** The drive each file seen so far lives in. */
  private drives = new Map<string, string>();
  /** Last known content and properties of JSON files, by item ID. */
  private json = new Map<string, { version: string; body: Record<string, unknown>; props: DriveProps }>();
  /** Writes to one file run one after another, so each starts from the last. */
  private writes = new Map<string, Promise<unknown>>();
  private myDrive: Promise<string> | null = null;
  /** Session folders created but not yet shared, by name. */
  private unshared = new Map<string, string>();

  folderUrl(folderId: string): string {
    return urlFromShareId(folderId) ?? 'https://onedrive.live.com/';
  }

  private async fetch(url: string, init: RequestInit, what: string): Promise<Response> {
    const token = await silentToken();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, { cache: 'no-store', ...init, headers });
    } catch {
      throw new TypeError(`Offline: could not ${what}.`);
    }
    if (!res.ok) {
      const next = await this.accessNeeded(res.status, url);
      if (next !== null) {
        // Sign in again asking for more (the session shows Reconnect; starting or joining asks at once).
        raiseAccess(next);
        throw new DriveAuthError(next === 1 ? 'Allow access to your OneDrive to share the session folder.' : 'Allow access to files shared with you to open this session.');
      }
      throw await failure(res, what);
    }
    return res;
  }

  /**
   * The access level to ask for after a refusal, or null when more access would not help. With the
   * app folder only, any refusal (sharing, other people's links) moves to the person's own files;
   * with those, a refusal inside someone else's drive moves to files shared with them.
   */
  private async accessNeeded(status: number, url: string): Promise<number | null> {
    const level = accessLevel();
    if (level >= ACCESS_LEVELS.length - 1) return null;
    const shared = status === 403 || status === 404 ? await this.isShared(url) : false;
    if (level === 0 && (status === 403 || shared)) return 1;
    if (level === 1 && shared) return 2;
    return null;
  }

  /** Whether a Graph URL reaches into another person's drive (or through a sharing link). */
  private async isShared(url: string): Promise<boolean> {
    if (url.includes('/shares/')) return true;
    const drive = /\/drives\/([^/]+)\//.exec(url)?.[1];
    if (!drive) return false;
    try {
      return drive.toLowerCase() !== (await this.myDriveId()).toLowerCase();
    } catch {
      return false;
    }
  }

  /** The signed-in person's drive, found through the app folder (readable at every access level). */
  private myDriveId(): Promise<string> {
    this.myDrive ??= this.fetch('/me/drive/special/approot?$select=id,parentReference', {}, 'check the session host')
      .then(async (r) => ((await r.json()) as GraphItem).parentReference?.driveId ?? '')
      .catch((err: unknown) => {
        this.myDrive = null;
        throw err;
      });
    return this.myDrive;
  }

  private async resolve(folderId: string): Promise<{ driveId: string; itemId: string }> {
    const known = this.folders.get(folderId);
    if (known) return known;
    if (!folderId.startsWith('u!')) {
      const driveId = this.drives.get(folderId);
      if (!driveId) throw new Error('OneDrive could not find the session folder.');
      return { driveId, itemId: folderId };
    }
    const res = await this.fetch(`/shares/${folderId}/driveItem?$select=id,parentReference`, { headers: { prefer: 'redeemSharingLink' } }, 'open the session folder');
    const item = (await res.json()) as GraphItem;
    const ref = { driveId: item.parentReference?.driveId ?? '', itemId: item.id };
    if (!ref.driveId) throw new Error('OneDrive did not say where the session folder is.');
    this.folders.set(folderId, ref);
    this.drives.set(item.id, ref.driveId);
    return ref;
  }

  private itemPath(fileId: string): string {
    const driveId = this.drives.get(fileId);
    if (!driveId) throw new Error('OneDrive has not listed that file yet.');
    return `/drives/${driveId}/items/${fileId}`;
  }

  private toFile(item: GraphItem, props: DriveProps): DriveFile {
    return {
      id: item.id,
      name: item.name,
      mimeType: item.file?.mimeType ?? (item.folder ? 'folder' : 'application/octet-stream'),
      version: item.eTag ?? '0',
      size: item.size ?? 0,
      createdTime: item.createdDateTime ?? '',
      properties: props,
    };
  }

  /** Reads a JSON file's body and properties, from memory when its version has not moved. */
  private async readJson(item: GraphItem) {
    const cached = this.json.get(item.id);
    if (cached && cached.version === item.eTag) return cached;
    const url = item['@microsoft.graph.downloadUrl'];
    let res: Response;
    if (url) {
      try {
        res = await fetch(url, { cache: 'no-store' });
      } catch {
        throw new TypeError('Offline: could not download a session file.');
      }
      if (!res.ok) throw await failure(res, 'download a session file');
    } else res = await this.fetch(`${this.itemPath(item.id)}/content`, {}, 'download a session file');
    const parsed = (await res.json()) as Record<string, unknown>;
    const { [PROPS_KEY]: props, ...body } = parsed;
    const entry = { version: item.eTag ?? '', body, props: (props as DriveProps | undefined) ?? {} };
    this.json.set(item.id, entry);
    return entry;
  }

  private propsFor(item: GraphItem, json: DriveProps | null): DriveProps {
    if (json) return json;
    if (/\.pdf$/i.test(item.name)) return { nbRole: 'document', nbBy: item.createdBy?.user?.displayName ?? '' };
    return {};
  }

  async list(folderId: string): Promise<DriveFile[]> {
    const { driveId, itemId } = await this.resolve(folderId);
    const items: GraphItem[] = [];
    let next: string | undefined = `/drives/${driveId}/items/${itemId}/children?$top=999`;
    while (next) {
      const body = (await (await this.fetch(next, {}, 'read the session folder')).json()) as { value: GraphItem[]; '@odata.nextLink'?: string };
      items.push(...body.value);
      next = body['@odata.nextLink'];
    }
    const out: DriveFile[] = [];
    for (const item of items) {
      this.drives.set(item.id, item.parentReference?.driveId ?? driveId);
      const props = isJson(item.name) && item.file ? (await this.readJson(item)).props : null;
      out.push(this.toFile(item, this.propsFor(item, props)));
    }
    return out;
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    const cached = this.json.get(fileId);
    if (cached) return new TextEncoder().encode(JSON.stringify(cached.body)).buffer as ArrayBuffer;
    return (await this.fetch(`${this.itemPath(fileId)}/content`, {}, 'download a session file')).arrayBuffer();
  }

  /**
   * Creates the session folder in the app's folder, Apps/redcolumn. A folder made but not yet
   * shared (sharing needed more access and is being retried) is reused rather than made twice.
   */
  async createFolder(name: string): Promise<string> {
    const pending = this.unshared.get(name);
    if (pending) return pending;
    const res = await this.fetch(
      '/me/drive/special/approot/children',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }) },
      'create the session folder',
    );
    const item = (await res.json()) as GraphItem;
    const driveId = item.parentReference?.driveId ?? '';
    this.drives.set(item.id, driveId);
    this.folders.set(item.id, { driveId, itemId: item.id });
    this.unshared.set(name, item.id);
    return item.id;
  }

  /** Uploads bytes as a file in a folder (or over an existing file) and returns the item. */
  private async upload(target: string, body: Blob, what: string): Promise<GraphItem> {
    if (body.size <= SIMPLE_UPLOAD_MAX) {
      return (await (await this.fetch(`${target}/content`, { method: 'PUT', body }, what)).json()) as GraphItem;
    }
    const session = (await (
      await this.fetch(`${target}/createUploadSession`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) }, what)
    ).json()) as { uploadUrl: string };
    let item: GraphItem | null = null;
    for (let start = 0; start < body.size; start += CHUNK) {
      const end = Math.min(body.size, start + CHUNK);
      let res: Response;
      try {
        // The upload URL is pre-authorised; it must not be sent the token.
        res = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'content-range': `bytes ${start}-${end - 1}/${body.size}` }, body: body.slice(start, end) });
      } catch {
        throw new TypeError(`Offline: could not ${what}.`);
      }
      if (!res.ok) throw await failure(res, what);
      if (res.status === 200 || res.status === 201) item = (await res.json()) as GraphItem;
    }
    if (!item) throw new Error(`OneDrive did not finish the upload (${what}).`);
    return item;
  }

  private async withProps(body: Blob, props: DriveProps): Promise<{ blob: Blob; parsed: Record<string, unknown> }> {
    const parsed = JSON.parse(await body.text()) as Record<string, unknown>;
    return { blob: new Blob([JSON.stringify({ ...parsed, [PROPS_KEY]: props })], { type: 'application/json' }), parsed };
  }

  async createFile(folderId: string, name: string, _mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    const { driveId, itemId } = await this.resolve(folderId);
    const safe = name.replace(/["*:<>?/\\|]/g, '_');
    const what = `upload ${name}`;
    let parsed: Record<string, unknown> | null = null;
    if (isJson(safe)) ({ blob: body, parsed } = await this.withProps(body, properties));
    const item = await this.upload(`/drives/${driveId}/items/${itemId}:/${encodeURIComponent(safe)}:`, body, what);
    this.drives.set(item.id, item.parentReference?.driveId ?? driveId);
    if (parsed) this.json.set(item.id, { version: item.eTag ?? '', body: parsed, props: properties });
    return this.toFile(item, parsed ? properties : this.propsFor(item, null));
  }

  private serial<T>(fileId: string, job: () => Promise<T>): Promise<T> {
    const run = (this.writes.get(fileId) ?? Promise.resolve()).then(job, job);
    this.writes.set(fileId, run.catch(() => {}));
    return run;
  }

  private async writeJson(fileId: string, body: Record<string, unknown>, props: DriveProps, what: string): Promise<string> {
    const blob = new Blob([JSON.stringify({ ...body, [PROPS_KEY]: props })], { type: 'application/json' });
    const item = await this.upload(this.itemPath(fileId), blob, what);
    this.json.set(fileId, { version: item.eTag ?? '', body, props });
    return item.eTag ?? '';
  }

  updateContent(fileId: string, body: Blob): Promise<string> {
    return this.serial(fileId, async () => {
      const props = this.json.get(fileId)?.props ?? {};
      const parsed = JSON.parse(await body.text()) as Record<string, unknown>;
      return this.writeJson(fileId, parsed, props, 'save your changes');
    });
  }

  updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    return this.serial(fileId, async () => {
      const cur = this.json.get(fileId);
      if (!cur) throw new Error('OneDrive has not read that file yet.');
      return this.writeJson(fileId, cur.body, { ...cur.props, ...properties }, 'update your status');
    });
  }

  /** Makes a sharing link for the folder; its share ID becomes the session's ID. */
  async shareWithLink(fileId: string, role: 'reader' | 'writer'): Promise<string> {
    const type = role === 'writer' ? 'edit' : 'view';
    const create = (scope: string) =>
      this.fetch(
        `${this.itemPath(fileId)}/createLink`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, scope }) },
        'share the session folder by link',
      );
    let res: Response;
    try {
      res = await create('anonymous');
    } catch (err) {
      // Work accounts may not allow links for anyone; fall back to people in the organization.
      if (err instanceof DriveAuthError || err instanceof TypeError) throw err;
      res = await create('organization');
    }
    const url = ((await res.json()) as { link?: { webUrl?: string } }).link?.webUrl;
    if (!url) throw new Error('OneDrive did not return a sharing link for the session folder.');
    const shareId = shareIdFromUrl(url);
    this.folders.set(shareId, { driveId: this.drives.get(fileId)!, itemId: fileId });
    for (const [name, id] of this.unshared) if (id === fileId) this.unshared.delete(name);
    return shareId;
  }

  async shareWithUser(fileId: string, email: string, message: string): Promise<void> {
    const { driveId, itemId } = await this.resolve(fileId);
    await this.fetch(
      `/drives/${driveId}/items/${itemId}/invite`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipients: [{ email }], message, requireSignIn: true, sendInvitation: true, roles: ['write'] }),
      },
      `invite ${email}`,
    );
  }

  /** The host owns the session folder, so the manifest sits in their own drive. */
  async ownedByMe(fileId: string): Promise<boolean> {
    const mine = await this.myDriveId();
    return (this.drives.get(fileId) ?? '').toLowerCase() === mine.toLowerCase();
  }
}
