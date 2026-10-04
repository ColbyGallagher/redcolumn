import { DriveAuthError, DriveForbiddenError, type DriveApi, type DriveFile, type DriveProps } from './DriveApi';
import { requireOnline } from '../../offline/network';

/**
 * Google configuration from the build (apps/web/.env.local, or GitHub Actions variables). None of
 * these is secret: browser apps ship them publicly, and the API key is restricted to this site.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
/** The Cloud project number; lets the Picker grant this app access to the folder a user picks. */
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;

export const googleConfigured = !!(CLIENT_ID && API_KEY && APP_ID);
/** Google sign-in (identity in sessions) needs only the OAuth client. */
export const googleSignInConfigured = !!CLIENT_ID;

// Drive access for Drive sessions, plus the signed-in person's email to identify them in sessions.
const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'nb.google.token';
const USER_KEY = 'nb.google.user';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,version,size,createdTime,properties';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Minimal typings for the two Google scripts (Identity Services and the Picker).
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface PickerDoc {
  id: string;
  name: string;
  mimeType: string;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      revoke(token: string, done?: () => void): void;
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string; message?: string }) => void;
      }): TokenClient;
    };
  };
  picker: {
    Action: { PICKED: string; CANCEL: string };
    Response: { ACTION: string; DOCUMENTS: string };
    ViewId: { FOLDERS: string };
    DocsView: new (viewId?: string) => {
      setIncludeFolders(v: boolean): unknown;
      setSelectFolderEnabled(v: boolean): unknown;
      setMimeTypes(m: string): unknown;
      setFileIds(ids: string): unknown;
      setMode(m: unknown): unknown;
    };
    DocsViewMode: { LIST: unknown };
    PickerBuilder: new () => PickerBuilder;
  };
}
interface PickerBuilder {
  setAppId(id: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  addView(view: unknown): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(cb: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: { load(lib: string, cb: () => void): void };
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        scripts.delete(src);
        reject(new Error('Could not load Google sign-in. Check your connection.'));
      };
      document.head.append(el);
    });
    scripts.set(src, p);
  }
  return p;
}

/**
 * Access tokens from Google Identity Services. A token lasts about an hour; asking for another
 * opens (and, once consented, immediately closes) a popup, which browsers only allow from a click.
 */
class GoogleAuth {
  private token: string | null = null;
  private expiresAt = 0;
  private client: TokenClient | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  constructor() {
    // Kept for this tab only (sessionStorage), so a reload stays signed in until the token expires.
    try {
      const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as { token: string; expiresAt: number } | null;
      if (saved && saved.expiresAt > Date.now()) {
        this.token = saved.token;
        this.expiresAt = saved.expiresAt;
      }
    } catch {
      // Not remembered.
    }
  }

  valid(): string | null {
    return this.token && Date.now() < this.expiresAt - 60_000 ? this.token : null;
  }

  invalidate() {
    this.token = null;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing stored.
    }
  }

  /** Signs out: revokes the token with Google and forgets it. */
  revoke() {
    const t = this.token;
    this.invalidate();
    if (t) window.google?.accounts.oauth2.revoke(t);
  }

  /** Returns a token, asking Google for one if needed. Call from a click when possible. */
  async get(): Promise<string> {
    const valid = this.valid();
    if (valid) return valid;
    if (!CLIENT_ID) throw new Error('Google sign-in is not configured for this site.');
    await loadScript('https://accounts.google.com/gsi/client');
    const google = window.google!;
    this.client ??= google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      callback: (r) => {
        const p = this.pending;
        this.pending = null;
        if (r.access_token) {
          this.token = r.access_token;
          this.expiresAt = Date.now() + (r.expires_in ?? 3600) * 1000;
          try {
            sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: this.token, expiresAt: this.expiresAt }));
          } catch {
            // Kept in memory only.
          }
          p?.resolve(r.access_token);
        } else p?.reject(new DriveAuthError(r.error_description ?? r.error ?? 'Google sign-in failed.'));
      },
      error_callback: (e) => {
        const p = this.pending;
        this.pending = null;
        p?.reject(new DriveAuthError(e.type === 'popup_closed' ? 'Google sign-in was closed.' : 'Google sign-in was blocked. Click Reconnect to try again.'));
      },
    });
    return new Promise<string>((resolve, reject) => {
      this.pending?.reject(new DriveAuthError('Superseded'));
      this.pending = { resolve, reject };
      this.client!.requestAccessToken({ prompt: '' });
    });
  }
}

export const googleAuth = new GoogleAuth();

/** The Google account signed in on this tab. */
export interface GoogleUser {
  email: string;
  name: string;
}

const userListeners = new Set<() => void>();
let user: GoogleUser | null = (() => {
  try {
    return googleAuth.valid() ? (JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null') as GoogleUser | null) : null;
  } catch {
    return null;
  }
})();

function setUser(next: GoogleUser | null) {
  user = next;
  try {
    if (next) sessionStorage.setItem(USER_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(USER_KEY);
  } catch {
    // Kept in memory only.
  }
  for (const l of userListeners) l();
}

/** The signed-in Google account, if its sign-in is still valid. */
export function googleUser(): GoogleUser | null {
  return user && googleAuth.valid() ? user : null;
}

export function subscribeGoogleUser(listener: () => void): () => void {
  userListeners.add(listener);
  return () => userListeners.delete(listener);
}

/** Signs in with Google (a popup, so call it from a click) and reads who the account is. */
export async function signInWithGoogle(): Promise<GoogleUser> {
  requireOnline('Signing in with Google');
  const token = await googleAuth.get();
  const cur = googleUser();
  if (cur) return cur;
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token}` } });
  const info = (await res.json().catch(() => null)) as { email?: string; name?: string; email_verified?: boolean } | null;
  if (!res.ok || !info?.email) throw new Error('Google did not share this account\'s email address. Sign in again and allow it.');
  const next = { email: info.email.toLowerCase(), name: info.name || info.email };
  setUser(next);
  return next;
}

export function signOutOfGoogle() {
  googleAuth.revoke();
  setUser(null);
}

/**
 * Opens Google's Picker to choose a session folder. Picking grants this app access to the folder,
 * which it needs to add the attendee's own file to it. `folderId` (from an invite link) limits the
 * Picker to that one folder. Resolves null if the user cancels.
 */
export async function pickSessionFolder(folderId?: string): Promise<{ id: string; name: string } | null> {
  const token = await googleAuth.get();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((resolve) => window.gapi!.load('picker', resolve));
  const picker = window.google!.picker;
  const view = new picker.DocsView(picker.ViewId.FOLDERS);
  view.setIncludeFolders(true);
  view.setSelectFolderEnabled(true);
  view.setMimeTypes(FOLDER_MIME);
  view.setMode(picker.DocsViewMode.LIST);
  if (folderId) view.setFileIds(folderId);
  return new Promise((resolve) => {
    new picker.PickerBuilder()
      .setAppId(APP_ID!)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY!)
      .addView(view)
      .setTitle(folderId ? 'Select the session folder to join' : 'Choose a redcolumn session folder')
      .setCallback((data) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.PICKED) {
          const doc = (data[picker.Response.DOCUMENTS] as PickerDoc[])[0];
          resolve(doc ? { id: doc.id, name: doc.name } : null);
        } else if (action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

function toFile(f: { id: string; name: string; mimeType: string; version?: string; size?: string; createdTime?: string; properties?: DriveProps }): DriveFile {
  return { id: f.id, name: f.name, mimeType: f.mimeType, version: f.version ?? '0', size: Number(f.size ?? 0), createdTime: f.createdTime ?? '', properties: f.properties ?? {} };
}

async function failure(res: Response, what: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  const detail = body?.error?.message;
  if (res.status === 401) {
    googleAuth.invalidate();
    return new DriveAuthError('Google sign-in has expired.');
  }
  if (res.status === 403 && /insufficient|permission|forbidden/i.test(detail ?? '')) return new DriveForbiddenError(detail ?? `Not allowed to ${what}.`);
  if (res.status === 404) return new Error(`Google Drive could not find what was needed to ${what}. Is the session folder still shared?`);
  return new Error(`Google Drive could not ${what}${detail ? `: ${detail}` : ` (${res.status})`}.`);
}

/** The Drive REST API, from the browser. Reads use the API key; writes use the signed-in user. */
export class GoogleDrive implements DriveApi {
  private async authed(url: string, init: RequestInit, what: string): Promise<Response> {
    const token = googleAuth.valid();
    if (!token) throw new DriveAuthError('Sign in to Google to save your changes.');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch {
      throw new TypeError(`Offline: could not ${what}.`);
    }
    if (!res.ok) throw await failure(res, what);
    return res;
  }

  private async keyed(url: string, what: string): Promise<Response> {
    const u = new URL(url);
    u.searchParams.set('key', API_KEY!);
    let res: Response;
    try {
      res = await fetch(u, { cache: 'no-store' });
    } catch {
      throw new TypeError(`Offline: could not ${what}.`);
    }
    if (!res.ok) throw await failure(res, what);
    return res;
  }

  async list(folderId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken = '';
    do {
      const u = new URL(`${API}/files`);
      u.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
      u.searchParams.set('fields', `nextPageToken,files(${FILE_FIELDS})`);
      u.searchParams.set('pageSize', '1000');
      u.searchParams.set('supportsAllDrives', 'true');
      u.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const body = (await (await this.keyed(u.href, 'read the session folder')).json()) as { files: Parameters<typeof toFile>[0][]; nextPageToken?: string };
      out.push(...body.files.map(toFile));
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    return (await this.keyed(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`, 'download a session file')).arrayBuffer();
  }

  private appFolder: Promise<string> | null = null;

  /** A folder of this name in `parent` that this app made (drive.file sees no others), or a new one. */
  private async folderIn(parent: string, name: string): Promise<string> {
    const u = new URL(`${API}/files`);
    u.searchParams.set('q', `name = '${name}' and '${parent}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`);
    u.searchParams.set('fields', 'files(id)');
    u.searchParams.set('spaces', 'drive');
    const found = ((await (await this.authed(u.href, {}, 'find the Apps folder')).json()) as { files: { id: string }[] }).files[0];
    if (found) return found.id;
    return this.makeFolder(name, parent, {});
  }

  private async makeFolder(name: string, parent: string, properties: DriveProps): Promise<string> {
    const res = await this.authed(
      `${API}/files?fields=id&supportsAllDrives=true`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], properties }) },
      'create the session folder',
    );
    return ((await res.json()) as { id: string }).id;
  }

  /** Apps/redcolumn in My Drive, where session folders go (made on first use). */
  private appFolderId(): Promise<string> {
    this.appFolder ??= this.folderIn('root', 'Apps')
      .then((apps) => this.folderIn(apps, 'redcolumn'))
      .catch((err: unknown) => {
        this.appFolder = null;
        throw err;
      });
    return this.appFolder;
  }

  async createFolder(name: string, properties: DriveProps): Promise<string> {
    return this.makeFolder(name, await this.appFolderId(), properties);
  }

  /** The file of this name in Apps/redcolumn (drive.file sees only the ones this app made). */
  private async appFile(name: string): Promise<string | null> {
    const u = new URL(`${API}/files`);
    u.searchParams.set('q', `name = '${name}' and '${await this.appFolderId()}' in parents and trashed = false`);
    u.searchParams.set('fields', 'files(id)');
    u.searchParams.set('spaces', 'drive');
    return ((await (await this.authed(u.href, {}, 'find your saved settings')).json()) as { files: { id: string }[] }).files[0]?.id ?? null;
  }

  async readAppFile(name: string): Promise<string | null> {
    const id = await this.appFile(name);
    if (!id) return null;
    return (await this.authed(`${API}/files/${id}?alt=media&supportsAllDrives=true`, {}, 'read your saved settings')).text();
  }

  async writeAppFile(name: string, text: string): Promise<void> {
    const body = new Blob([text], { type: 'application/json' });
    const id = await this.appFile(name);
    if (id) await this.updateContent(id, body);
    else await this.createFile(await this.appFolderId(), name, 'application/json', body, {});
  }

  async createFile(folderId: string, name: string, mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    // Resumable upload: one request for the metadata, one for the bytes. Works for any size.
    const start = await this.authed(
      `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=${FILE_FIELDS}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mimeType },
        body: JSON.stringify({ name, mimeType, parents: [folderId], properties }),
      },
      `upload ${name}`,
    );
    const location = start.headers.get('location');
    if (!location) throw new Error(`Google Drive did not accept the upload of ${name}.`);
    const res = await this.authed(location, { method: 'PUT', headers: { 'content-type': mimeType }, body }, `upload ${name}`);
    return toFile(await res.json());
  }

  async updateContent(fileId: string, body: Blob): Promise<string> {
    const res = await this.authed(`${UPLOAD}/files/${fileId}?uploadType=media&supportsAllDrives=true&fields=version`, { method: 'PATCH', body }, 'save your changes');
    return ((await res.json()) as { version: string }).version;
  }

  async updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    const res = await this.authed(
      `${API}/files/${fileId}?supportsAllDrives=true&fields=version`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ properties }) },
      'update your status',
    );
    return ((await res.json()) as { version: string }).version;
  }

  async shareWithLink(fileId: string, role: 'reader' | 'writer'): Promise<void> {
    await this.authed(
      `${API}/files/${fileId}/permissions?supportsAllDrives=true`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'anyone', role, allowFileDiscovery: false }) },
      'share the session folder by link (your Google Workspace may not allow link sharing)',
    );
  }

  async shareWithUser(fileId: string, email: string, message: string): Promise<void> {
    const u = new URL(`${API}/files/${fileId}/permissions`);
    u.searchParams.set('supportsAllDrives', 'true');
    u.searchParams.set('sendNotificationEmail', 'true');
    u.searchParams.set('emailMessage', message);
    await this.authed(
      u.href,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }) },
      `invite ${email}`,
    );
  }

  /** Moves a folder (and so everything in it) to the trash, where Google Drive keeps it for 30 days. */
  async removeFolder(folderId: string): Promise<void> {
    await this.authed(
      `${API}/files/${folderId}?supportsAllDrives=true&fields=id`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) },
      'remove the session folder',
    );
  }

  async ownedByMe(fileId: string): Promise<boolean> {
    try {
      const res = await this.authed(`${API}/files/${fileId}?fields=ownedByMe&supportsAllDrives=true`, {}, 'check the session host');
      return ((await res.json()) as { ownedByMe?: boolean }).ownedByMe === true;
    } catch (err) {
      if (err instanceof DriveAuthError) throw err;
      return false;
    }
  }
}
