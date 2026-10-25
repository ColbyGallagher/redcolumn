import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { DriveAuthError, DriveForbiddenError, DriveLockedError, type DriveApi, type DriveFile, type DrivePermission, type DriveProps, type LinkOptions } from './DriveApi';
import { desktop } from '../../desktop/host';
import { requireOnline } from '../../offline/network';
import { logCloudAction } from './cloudLog';
import { noteCloudActivity } from './idle';
import { firstUse } from './notices';

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
 * Whether Projects and Live Sessions may be kept in OneDrive and shared through it. Off unless the
 * build sets VITE_ENABLE_ONEDRIVE_SHARING=true; folders on this computer work either way. Profile
 * backup only needs `oneDriveConfigured`.
 */
export const oneDriveSharingEnabled = oneDriveConfigured && import.meta.env.VITE_ENABLE_ONEDRIVE_SHARING === 'true';

/**
 * Least access first, stepping up only for sharing or opening someone else's folder, and only for
 * those calls (MSAL adds openid, profile and offline_access for sign-in):
 *   0. Files.ReadWrite.AppFolder: only the app's own folder, Apps/redcolumn, where sessions live.
 *   1. Files.ReadWrite: the person's own OneDrive (if sharing the session folder needs it).
 *   2. Files.ReadWrite.All: also files others share with them (if joining someone's session needs it).
 */
const ACCESS_LEVELS = [['Files.ReadWrite.AppFolder'], ['Files.ReadWrite'], ['Files.ReadWrite.All']];
const LEGACY_LEVEL_KEY = 'nb.onedrive.level';
/** Set when the person chose to stay signed in on this device; otherwise the sign-in lasts as long as the tab. */
const STAY_KEY = 'nb.onedrive.staySignedIn';
const GRAPH_HOST = 'graph.microsoft.com';
const GRAPH = `https://${GRAPH_HOST}/v1.0`;
/** Graph accepts simple uploads up to 4 MB; bigger files go up in chunks through an upload session. */
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
/** Upload session chunks must be multiples of 320 KiB. */
const CHUNK = 320 * 1024 * 20;
/** Where Drive-style properties live inside a JSON file (Graph has no custom file properties). */
const PROPS_KEY = '_nb';
/** The only files `remove` deletes: Project check-out locks (OneDrive may add " 1" on a name clash). */
const REMOVABLE = /^lock-[^/\\]+\.json$/i;
/** A Live Session folder's manifest; `removeFolder` deletes only folders that hold one. */
const SESSION_MANIFEST = 'session.json';

let msal: Promise<IPublicClientApplication> | null = null;

/** Whether the Microsoft sign-in is kept on this device across visits (off unless the person chose it). */
export function staySignedInToMicrosoft(): boolean {
  try {
    return localStorage.getItem(STAY_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Chooses where the next Microsoft sign-in is kept: this tab only (the default), or this device.
 * Takes effect at the next sign-in, so it is offered while signed out.
 */
export function setStaySignedInToMicrosoft(stay: boolean) {
  try {
    if (stay) localStorage.setItem(STAY_KEY, '1');
    else localStorage.removeItem(STAY_KEY);
  } catch {
    // Storage is blocked; the sign-in stays per tab.
  }
  // Signed in, the choice waits for the next sign-in (signing out drops the sign-in either way).
  if (user) return;
  if (!stay) forgetDeviceSignIn();
  msal = null;
}

/**
 * Removes a Microsoft sign-in kept in this device's storage (MSAL's keys, which name the client ID
 * or start with `msal.`), so the refresh token does not outlive a choice to keep it per tab.
 */
function forgetDeviceSignIn() {
  if (!CLIENT_ID) return;
  try {
    const id = CLIENT_ID.toLowerCase();
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('msal.') || key.toLowerCase().includes(id))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

function app(): Promise<IPublicClientApplication> {
  if (!CLIENT_ID) return Promise.reject(new Error('Microsoft sign-in is not configured for this site.'));
  msal ??= import('@azure/msal-browser').then(async ({ PublicClientApplication }) => {
    const stay = staySignedInToMicrosoft();
    // A sign-in kept on the device by an earlier version, or before the person turned this off.
    if (!stay) forgetDeviceSignIn();
    // Earlier versions kept the widest access ever needed and used it for every call.
    try {
      localStorage.removeItem(LEGACY_LEVEL_KEY);
    } catch {
      // Nothing stored.
    }
    const pca = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT}`,
        redirectUri: new URL(`${import.meta.env.BASE_URL}msal-redirect.html`, window.location.origin).href,
      },
      // Per tab by default, so closing it forgets the refresh token; on the device only by choice.
      cache: { cacheLocation: stay ? 'localStorage' : 'sessionStorage' },
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

// Pick up an account remembered from an earlier visit. The desktop app asks the main process,
// which keeps the refresh token; the browser uses MSAL's cache.
const restored = (async () => {
  if (typeof window === 'undefined') return;
  const host = desktop();
  if (host) {
    if (!CLIENT_ID) return;
    const account = await host.microsoftAccount(CLIENT_ID).catch(() => null);
    if (account) setUser({ email: account.email.toLowerCase(), name: account.name || account.email });
    return;
  }
  if (!CLIENT_ID) return;
  try {
    const pca = await app();
    setUser(toUser(pca.getActiveAccount()));
  } catch {
    // Not remembered.
  }
})();

/** Resolves once the account remembered from an earlier visit (if any) is known to `microsoftUser`. */
export const microsoftUserRestored = (): Promise<void> => restored;

export function microsoftUser(): MicrosoftUser | null {
  return user;
}

export function subscribeMicrosoftUser(listener: () => void): () => void {
  userListeners.add(listener);
  return () => userListeners.delete(listener);
}

/**
 * What a Graph call reaches, which decides the access it asks for: the app folder (`own`),
 * sharing settings (`share`), or someone else's drive or a sharing link (`shared`).
 */
export type AccessKind = 'own' | 'share' | 'shared';

/** A step up in access that a call needs and Microsoft has not been asked for yet. */
export interface StepUp {
  /** Index into the access levels: 1 (the person's OneDrive) or 2 (also files shared with them). */
  level: number;
  kind: AccessKind;
  /** What the app was doing, as "share the session folder by link". */
  what: string;
}

/**
 * The access each kind of call has needed in this tab. Not kept across visits, and only the calls
 * of that kind ask for it: settings backup and the app's own folders always ask
 * for the app folder alone (docs/SECURITY-HARDENING.md, 3.4).
 */
let reached: Record<AccessKind, number> = { own: 0, share: 0, shared: 0 };
let pending: StepUp | null = null;
let accessSnapshot: { level: number; pending: StepUp | null } = { level: 0, pending: null };
const accessListeners = new Set<() => void>();

function accessChanged() {
  accessSnapshot = { level: Math.max(reached.own, reached.share, reached.shared), pending };
  for (const l of accessListeners) l();
}

/** The widest access this tab has used, and any step up waiting for the next sign-in. */
export function microsoftAccess(): { level: number; pending: StepUp | null } {
  return accessSnapshot;
}

export function subscribeMicrosoftAccess(listener: () => void): () => void {
  accessListeners.add(listener);
  return () => accessListeners.delete(listener);
}

/** Drops every step up, so the next calls ask for the app folder alone again. */
export function dropMicrosoftStepUps() {
  reached = { own: 0, share: 0, shared: 0 };
  pending = null;
  accessChanged();
}

/** The access level a call of this kind uses now. */
const levelFor = (kind: AccessKind) => reached[kind];

/** The level to try after Microsoft refused a call, or null when more access would not help. */
function nextLevel(kind: AccessKind, level: number, status: number): number | null {
  if (kind === 'share' && status === 403 && level === 0) return 1;
  if (kind === 'shared' && (status === 403 || status === 404) && level < ACCESS_LEVELS.length - 1) return level + 1;
  return null;
}

function stepUpMessage(step: StepUp): string {
  if (step.kind === 'share') return 'Allow access to your OneDrive to share the folder.';
  return step.level === 1 ? 'Allow access to your OneDrive to open this folder.' : 'Allow access to files shared with you to open this folder.';
}

const SINCE_KEY = 'nb.onedrive.since';
const sinceStore = (): Storage | null => {
  try {
    return staySignedInToMicrosoft() || desktop() ? localStorage : sessionStorage;
  } catch {
    return null;
  }
};

/** When this browser signed in to Microsoft (ms since 1970), if the app saw it happen. */
export function microsoftSignedInSince(): number | null {
  const v = Number(sinceStore()?.getItem(SINCE_KEY));
  return v > 0 ? v : null;
}

/** Where the Microsoft sign-in is kept, in words for the Access page. */
export function microsoftTokenPlace(): string {
  if (desktop()) return "In the desktop app's main process, encrypted by the system key store, until you sign out. The app's pages never see it: OneDrive calls go through the main process.";
  return staySignedInToMicrosoft()
    ? 'In this browser until you sign out (Stay signed in is on). Microsoft ends it after about a day without use.'
    : 'In this tab only; closing the tab, or 30 minutes without cloud work, signs you out.';
}

/** Shows the app's own explanation before Microsoft is asked for more; resolves false to cancel. */
export type StepUpConfirm = (step: StepUp) => Promise<boolean>;
let confirmStepUp: StepUpConfirm | null = null;

/** Registers the dialog that explains a step up (StepUpHost does this once mounted). */
export function setStepUpConfirm(confirm: StepUpConfirm | null) {
  confirmStepUp = confirm;
}

/**
 * On the desktop app, makes sure the main process holds a token for these scopes (signing in when
 * `interactive`). The page never receives it: Graph calls go through the main process.
 */
async function desktopGraphToken(scopes: string[], interactive: boolean): Promise<string> {
  const host = desktop();
  if (!host || !CLIENT_ID) throw new DriveAuthError('Microsoft sign-in is not configured for this app.');
  try {
    const result = await host.microsoftToken(CLIENT_ID, TENANT, scopes, interactive);
    if (!result) throw new DriveAuthError(interactive ? 'Microsoft sign-in was closed.' : 'Sign in to Microsoft to open OneDrive sessions.');
    setUser({ email: result.email.toLowerCase(), name: result.name || result.email });
    return '';
  } catch (err) {
    if (err instanceof DriveAuthError) throw err;
    const message = err instanceof Error ? err.message : 'Microsoft sign-in failed.';
    throw new DriveAuthError(/closed/i.test(message) ? 'Microsoft sign-in was closed.' : message);
  }
}

/** A Graph token for these scopes without any popup, or a DriveAuthError when the user has to sign in. */
async function silentToken(scopes: string[] = ACCESS_LEVELS[0]!): Promise<string> {
  noteCloudActivity();
  if (desktop()) return desktopGraphToken(scopes, false);
  const pca = await app();
  const account = pca.getActiveAccount();
  if (!account) throw new DriveAuthError('Sign in to Microsoft to open OneDrive sessions.');
  try {
    return (await pca.acquireTokenSilent({ scopes, account })).accessToken;
  } catch {
    throw new DriveAuthError('Microsoft sign-in has expired.');
  }
}

/**
 * Signs in with Microsoft (a popup, so call it from a click); does nothing when already signed in
 * with the access needed. When a call needed more access, this explains why in the app's own
 * dialog first, then asks Microsoft for that access only.
 */
export async function signInWithMicrosoft(): Promise<MicrosoftUser> {
  requireOnline('Signing in with Microsoft');
  const step = pending;
  const scopes = ACCESS_LEVELS[step?.level ?? 0]!;
  const confirm = async () => {
    await firstUse('microsoft');
    if (step && confirmStepUp && !(await confirmStepUp(step))) throw new DriveAuthError('Microsoft was not asked for more access.');
  };
  if (desktop()) {
    try {
      await desktopGraphToken(scopes, false);
    } catch {
      await confirm();
      await desktopGraphToken(scopes, true);
    }
  } else {
    const pca = await app();
    try {
      await silentToken(scopes);
    } catch {
      await confirm();
      try {
        const account = pca.getActiveAccount();
        const result = await pca.acquireTokenPopup({ scopes, ...(account ? { account } : { prompt: 'select_account' }) });
        pca.setActiveAccount(result.account);
      } catch (err) {
        const code = (err as { errorCode?: string }).errorCode;
        throw new DriveAuthError(code === 'user_cancelled' ? 'Microsoft sign-in was closed.' : `Microsoft sign-in failed${err instanceof Error ? `: ${err.message}` : '.'}`);
      }
    }
    setUser(toUser(pca.getActiveAccount()));
  }
  if (step && pending === step) pending = null;
  accessChanged();
  const next = microsoftUser();
  if (!next) throw new DriveAuthError('Microsoft sign-in failed.');
  if (!microsoftSignedInSince()) sinceStore()?.setItem(SINCE_KEY, String(Date.now()));
  return next;
}

/**
 * Signs out of Microsoft in this app: forgets the tokens and every step up. `everywhere` also ends
 * the Microsoft session in this browser (a Microsoft sign-out window), so the next sign-in asks
 * for the account again.
 */
export async function signOutOfMicrosoft(options: { everywhere?: boolean } = {}) {
  const host = desktop();
  setUser(null);
  for (const store of [localStorage, sessionStorage]) {
    try {
      store.removeItem(SINCE_KEY);
    } catch {
      // Nothing stored.
    }
  }
  dropMicrosoftStepUps();
  if (host) {
    await host.signOut('microsoft');
    // The system browser holds the Microsoft session; its sign-out page ends it.
    if (options.everywhere) window.open(`https://login.microsoftonline.com/${encodeURIComponent(TENANT)}/oauth2/v2.0/logout`, '_blank');
    return;
  }
  const pca = await app();
  const account = pca.getActiveAccount();
  pca.setActiveAccount(null);
  if (account) {
    if (options.everywhere) {
      const redirect = new URL(`${import.meta.env.BASE_URL}msal-redirect.html`, window.location.origin).href;
      await pca.logoutPopup({ account, postLogoutRedirectUri: redirect }).catch(() => {});
    }
    await pca.clearCache({ account });
  }
  // A changed "stay signed in" choice applies from the next sign-in.
  msal = null;
}

/** Whether a URL is Microsoft Graph's, the only host the token may be sent to. */
export function isGraphUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === GRAPH_HOST;
  } catch {
    return false;
  }
}

/** Graph calls that manage sharing, which need access to the person's own OneDrive. */
function isSharingCall(url: string): boolean {
  const path = url.split('?')[0]!;
  return /\/(createLink|invite)$/.test(path) || /\/permissions(\/[^/]+)?$/.test(path);
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

/** SharePoint shows an app's access as a claims login, `i:0i.t|ms.sp.ext|<clientId>@<tenantId>`; say which app it is. */
function friendlyPrincipal(s: string | undefined): string | undefined {
  const m = s && /^i:0i\.t\|ms\.sp\.ext\|([0-9a-f-]+)@/i.exec(s);
  if (!m) return s;
  return CLIENT_ID && m[1]?.toLowerCase() === CLIENT_ID.toLowerCase() ? 'Redcolumn (this app)' : 'An app with access';
}

interface GraphPermission {
  id: string;
  roles?: string[];
  grantedToV2?: { user?: { displayName?: string; email?: string } };
  grantedToIdentitiesV2?: { user?: { displayName?: string; email?: string } }[];
  grantedTo?: { user?: { displayName?: string; email?: string } };
  invitation?: { email?: string };
  link?: { type?: string; scope?: string };
  inheritedFrom?: unknown;
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
  parentReference?: { driveId?: string; id?: string; driveType?: string };
  webUrl?: string;
  '@microsoft.graph.downloadUrl'?: string;
}

/** What a file's role is, for files whose properties cannot be stored inside them. */
/** A name OneDrive accepts: no reserved characters, no edge dots or spaces, and a sane length. */
function folderName(name: string): string {
  const safe = name.replace(/["*:<>?/\\|\u0000-\u001f]/g, '_').replace(/^\s+|[\s.]+$/g, '').slice(0, 200).replace(/[\s.]+$/, '');
  return safe || 'redcolumn session';
}

function isJson(name: string) {
  return /\.(json|nbseat)$/i.test(name);
}

async function failure(res: Response, what: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  const detail = body?.error?.message;
  if (res.status === 401) return new DriveAuthError('Microsoft sign-in has expired.');
  if (res.status === 403) return new DriveForbiddenError(detail ?? `Not allowed to ${what}.`);
  if (res.status === 404) return new Error(`OneDrive could not find what was needed to ${what}. Is the session folder still shared?`);
  if (res.status === 423) return new DriveLockedError(`OneDrive could not ${what}: the file is open in Excel, so it is locked. Close it and the update is saved.`);
  return new Error(`OneDrive could not ${what}${detail ? `: ${detail}` : ` (${res.status})`}.`);
}

/**
 * OneDrive (personal or work) over Microsoft Graph, as a DriveApi so Drive sessions run on it
 * unchanged. What it papers over:
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
  /** The name of each file listed in or added to a session or Project folder, so deletes can be limited to app files. */
  private names = new Map<string, string>();
  /** Folder names as the app knows them (by item or share ID), for the activity list. */
  private folderNames = new Map<string, string>();
  /** Last known content and properties of JSON files, by item ID. */
  private json = new Map<string, { version: string; body: Record<string, unknown>; props: DriveProps }>();
  /** Writes to one file run one after another, so each starts from the last. */
  private writes = new Map<string, Promise<unknown>>();
  private myDrive: Promise<NonNullable<GraphItem['parentReference']>> | null = null;
  /** Session folders created but not yet shared, by name. */
  private unshared = new Map<string, string>();
  private token: (scopes: string[]) => Promise<string>;

  /** On the desktop app, Graph calls go through the main process, which holds the token. */
  private brokered: boolean;

  /** `token` stands in for Microsoft sign-in in tests. */
  constructor(token?: (scopes: string[]) => Promise<string>) {
    this.token = token ?? silentToken;
    this.brokered = !token;
  }

  /** One Graph call made by the desktop app's main process (apps/desktop/src/graph.ts). */
  private async viaMainProcess(host: NonNullable<ReturnType<typeof desktop>>, url: string, init: RequestInit, level: number, what: string): Promise<Response> {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const body = init.body == null ? undefined : new Uint8Array(await new Response(init.body).arrayBuffer());
    let reply;
    try {
      reply = await host.graphRequest(CLIENT_ID!, TENANT, { url, method: init.method ?? 'GET', headers, ...(body ? { body } : {}), level });
    } catch {
      throw new TypeError(`Offline: could not ${what}.`);
    }
    if (reply.authNeeded) throw new DriveAuthError('Sign in to Microsoft to open OneDrive sessions.');
    const nullBody = reply.status === 204 || reply.status === 304;
    return new Response(nullBody ? null : (reply.body as BodyInit), { status: reply.status, statusText: reply.statusText, headers: reply.headers });
  }

  folderUrl(folderId: string): string {
    return urlFromShareId(folderId) ?? 'https://onedrive.live.com/';
  }

  /** What a Graph call reaches, for the access it asks for. */
  private async kindOf(url: string): Promise<AccessKind> {
    if (isSharingCall(url)) return 'share';
    return (await this.isShared(url)) ? 'shared' : 'own';
  }

  /**
   * Calls Graph with a token for just the access this kind of call needs. When Microsoft refuses a
   * sharing call, or a call into someone else's drive, it tries the next level up for that kind of
   * call only: at once if Microsoft already allowed it, otherwise by asking for a sign-in (the
   * session shows Reconnect, which explains the step up first). Any other refusal is reported as
   * it is, never answered with wider access.
   */
  private async fetch(url: string, init: RequestInit, what: string): Promise<Response> {
    // Absolute URLs (such as `@odata.nextLink`) come back from Graph; anything elsewhere never gets the token.
    if (/^[a-z][a-z\d+.-]*:/i.test(url) && !isGraphUrl(url)) throw new Error(`OneDrive gave an unexpected address, so redcolumn did not ${what}.`);
    const kind = await this.kindOf(url);
    let level = levelFor(kind);
    for (;;) {
      let res: Response;
      const host = this.brokered ? desktop() : null;
      if (host && CLIENT_ID) {
        noteCloudActivity();
        res = await this.viaMainProcess(host, url.startsWith('/') ? `${GRAPH}${url}` : url, init, level, what);
      } else {
        const token = await this.token(ACCESS_LEVELS[level]!);
        const headers = new Headers(init.headers);
        headers.set('authorization', `Bearer ${token}`);
        try {
          res = await fetch(url.startsWith('/') ? `${GRAPH}${url}` : url, { cache: 'no-store', ...init, headers });
        } catch {
          throw new TypeError(`Offline: could not ${what}.`);
        }
      }
      if (res.ok) return res;
      const next = nextLevel(kind, level, res.status);
      if (next === null) throw await failure(res, what);
      reached[kind] = Math.max(reached[kind], next);
      try {
        await this.token(ACCESS_LEVELS[next]!);
      } catch (err) {
        if (!(err instanceof DriveAuthError)) throw err;
        pending = { level: next, kind, what };
        accessChanged();
        throw new DriveAuthError(stepUpMessage(pending));
      }
      accessChanged();
      level = next;
    }
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
    return this.myDriveRef().then((r) => r.driveId ?? '');
  }

  /** The signed-in person's drive and its type (`personal`, or `business` for work and school accounts). */
  private myDriveRef(): Promise<NonNullable<GraphItem['parentReference']>> {
    this.myDrive ??= this.fetch('/me/drive/special/approot?$select=id,parentReference', {}, 'check the session host')
      .then(async (r) => ((await r.json()) as GraphItem).parentReference ?? {})
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
    const res = await this.fetch(`/shares/${folderId}/driveItem?$select=id,name,parentReference`, { headers: { prefer: 'redeemSharingLink' } }, 'open the session folder');
    const item = (await res.json()) as GraphItem;
    if (item.name) {
      this.folderNames.set(folderId, item.name);
      this.folderNames.set(item.id, item.name);
    }
    const ref = { driveId: item.parentReference?.driveId ?? '', itemId: item.id };
    if (!ref.driveId) throw new Error('OneDrive did not say where the session folder is.');
    this.folders.set(folderId, ref);
    this.drives.set(item.id, ref.driveId);
    return ref;
  }

  /** A file or folder's name for the activity list. */
  private label(id: string): string {
    return this.names.get(id) ?? this.folderNames.get(id) ?? 'a file';
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
      ...(item.createdBy?.user?.email ? { createdBy: item.createdBy.user.email.toLowerCase() } : {}),
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
      if (item.file) this.names.set(item.id, item.name);
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
    // Reading the app folder first makes OneDrive create it; POSTing to its path alone can 400 ("invalidRequest") on personal accounts.
    const root = (await (await this.fetch('/me/drive/special/approot?$select=id,parentReference', {}, 'open the app folder')).json()) as GraphItem;
    const res = await this.fetch(
      `/drives/${root.parentReference?.driveId ?? ''}/items/${root.id}/children`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: folderName(name), folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }) },
      'create the session folder',
    );
    const item = (await res.json()) as GraphItem;
    const driveId = item.parentReference?.driveId ?? '';
    this.drives.set(item.id, driveId);
    this.folders.set(item.id, { driveId, itemId: item.id });
    this.unshared.set(name, item.id);
    this.folderNames.set(item.id, item.name);
    logCloudAction('onedrive', 'create folder', item.name);
    return item.id;
  }

  /** The app folder's own item; reading it first makes OneDrive create the folder. */
  private async appRoot(): Promise<{ driveId: string; itemId: string }> {
    const root = (await (await this.fetch('/me/drive/special/approot?$select=id,parentReference', {}, 'open the app folder')).json()) as GraphItem;
    return { driveId: root.parentReference?.driveId ?? '', itemId: root.id };
  }

  async readAppFile(name: string): Promise<string | null> {
    const { driveId, itemId } = await this.appRoot();
    const kids = (await (await this.fetch(`/drives/${driveId}/items/${itemId}/children?$select=id,name&$top=999`, {}, 'find your saved settings')).json()) as { value: { id: string; name: string }[] };
    const file = kids.value.find((k) => k.name === name);
    if (!file) return null;
    return (await this.fetch(`/drives/${driveId}/items/${file.id}/content`, {}, 'read your saved settings')).text();
  }

  async writeAppFile(name: string, text: string): Promise<void> {
    const { driveId, itemId } = await this.appRoot();
    // A PUT to a path replaces a file of that name.
    await this.upload(`/drives/${driveId}/items/${itemId}:/${encodeURIComponent(name)}:`, new Blob([text], { type: 'application/json' }), 'save your settings');
    logCloudAction('onedrive', 'save app file', name);
  }

  /**
   * Uploads bytes as a new file in a folder (`create`) or over an existing file, and returns the
   * item. A new file never replaces another of the same name: OneDrive gives it a free name instead.
   */
  private async upload(target: string, body: Blob, what: string, create = false): Promise<GraphItem> {
    if (body.size <= SIMPLE_UPLOAD_MAX) {
      const url = `${target}/content${create ? '?@microsoft.graph.conflictBehavior=rename' : ''}`;
      return (await (await this.fetch(url, { method: 'PUT', body }, what)).json()) as GraphItem;
    }
    const conflictBehavior = create ? 'rename' : 'replace';
    const session = (await (
      await this.fetch(`${target}/createUploadSession`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': conflictBehavior } }) }, what)
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

  async createFile(folderId: string, name: string, mimeType: string, body: Blob, properties: DriveProps): Promise<DriveFile> {
    const { driveId, itemId } = await this.resolve(folderId);
    let safe = name.replace(/["*:<>?/\\|]/g, '_');
    // Documents are recognised by their extension, as Graph keeps no properties on them.
    if (mimeType === 'application/pdf' && !/\.pdf$/i.test(safe)) safe += '.pdf';
    const what = `upload ${name}`;
    let parsed: Record<string, unknown> | null = null;
    if (isJson(safe)) ({ blob: body, parsed } = await this.withProps(body, properties));
    const item = await this.upload(`/drives/${driveId}/items/${itemId}:/${encodeURIComponent(safe)}:`, body, what, true);
    this.drives.set(item.id, item.parentReference?.driveId ?? driveId);
    this.names.set(item.id, item.name);
    logCloudAction('onedrive', 'upload', item.name);
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

  /** Replaces a file's content: JSON keeps the properties stored inside it; anything else goes up as is. */
  updateContent(fileId: string, body: Blob): Promise<string> {
    return this.serial(fileId, async () => {
      if (body.type !== 'application/json') {
        const item = await this.upload(this.itemPath(fileId), body, 'save your changes');
        logCloudAction('onedrive', 'replace', this.label(fileId));
        return item.eTag ?? '';
      }
      const cur = this.json.get(fileId);
      // Written unread, the file would lose its properties, and with them its role in the session.
      if (!cur) throw new Error('OneDrive has not read that file yet.');
      const parsed = JSON.parse(await body.text()) as Record<string, unknown>;
      const version = await this.writeJson(fileId, parsed, cur.props, 'save your changes');
      logCloudAction('onedrive', 'replace', this.label(fileId));
      return version;
    });
  }

  updateProperties(fileId: string, properties: DriveProps): Promise<string> {
    return this.serial(fileId, async () => {
      const cur = this.json.get(fileId);
      if (!cur) throw new Error('OneDrive has not read that file yet.');
      return this.writeJson(fileId, cur.body, { ...cur.props, ...properties }, 'update your status');
    });
  }

  /**
   * Makes a sharing link for the folder; its share ID becomes the session's ID. Work and school
   * accounts get a link for people in the organization first (anyone else is invited by email);
   * personal accounts get a link for anyone. `expires` is set where Microsoft accepts it (it needs
   * Microsoft 365 on personal accounts) and left off where it does not.
   */
  async shareWithLink(fileId: string, role: 'reader' | 'writer', options: LinkOptions = {}): Promise<string> {
    const type = role === 'writer' ? 'edit' : 'view';
    const business = await this.myDriveRef().then((r) => r.driveType === 'business', () => false);
    const scopes = business ? ['organization', 'anonymous'] : ['anonymous', 'organization'];
    const expirationDateTime = options.expires ? new Date(options.expires).toISOString() : undefined;
    const create = (scope: string, expires?: string) =>
      this.fetch(
        `${this.itemPath(fileId)}/createLink`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, scope, ...(expires ? { expirationDateTime: expires } : {}) }) },
        'share the session folder by link',
      );
    let res: Response | null = null;
    let last: unknown = null;
    for (const scope of scopes) {
      for (const expires of expirationDateTime ? [expirationDateTime, undefined] : [undefined]) {
        try {
          res = await create(scope, expires);
          break;
        } catch (err) {
          // A sign-in or a lost connection is not answered with another kind of link.
          if (err instanceof DriveAuthError || err instanceof TypeError) throw err;
          last = err;
        }
      }
      if (res) break;
    }
    if (!res) throw last instanceof Error ? last : new Error('OneDrive could not share the session folder by link.');
    const url = ((await res.json()) as { link?: { webUrl?: string } }).link?.webUrl;
    if (!url) throw new Error('OneDrive did not return a sharing link for the session folder.');
    const shareId = shareIdFromUrl(url);
    this.folders.set(shareId, { driveId: this.drives.get(fileId)!, itemId: fileId });
    for (const [name, id] of this.unshared) if (id === fileId) this.unshared.delete(name);
    if (this.folderNames.has(fileId)) this.folderNames.set(shareId, this.folderNames.get(fileId)!);
    logCloudAction('onedrive', 'share by link', `${this.label(fileId)} (${type === 'edit' ? 'can edit' : 'can view'})`);
    return shareId;
  }

  /** Invites someone by email. Without a role they may only read, so a missing role fails safe. */
  async shareWithUser(fileId: string, email: string, message: string, role: 'reader' | 'writer' = 'reader'): Promise<void> {
    const { driveId, itemId } = await this.resolve(fileId);
    await this.fetch(
      `/drives/${driveId}/items/${itemId}/invite`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipients: [{ email }], message, requireSignIn: true, sendInvitation: true, roles: [role === 'reader' ? 'read' : 'write'] }),
      },
      `invite ${email}`,
    );
    logCloudAction('onedrive', 'invite', `${email} to ${this.label(fileId)} (${role === 'reader' ? 'can view' : 'can edit'})`);
  }

  /** Who the folder is shared with. Only people who can manage its sharing may ask. */
  async listPermissions(folderId: string): Promise<DrivePermission[]> {
    const { driveId, itemId } = await this.resolve(folderId);
    // Only the fields the app shows (docs/SECURITY-HARDENING.md, 4.4).
    const res = await this.fetch(`/drives/${driveId}/items/${itemId}/permissions?$select=id,roles,grantedToV2,grantedToIdentitiesV2,grantedTo,invitation,link,inheritedFrom`, {}, 'see who the folder is shared with');
    const { value } = (await res.json()) as { value: GraphPermission[] };
    return value.map((p) => {
      const people = [p.grantedToV2?.user, ...(p.grantedToIdentitiesV2 ?? []).map((i) => i.user), p.grantedTo?.user].filter((u): u is { displayName?: string; email?: string } => !!u);
      const person = people[0];
      const roles = p.roles ?? [];
      const role = roles.includes('owner') ? 'owner' : roles.includes('write') ? 'writer' : 'reader';
      // Someone invited by email shows up as a link limited to them ("users"); that is a person, not a shareable link.
      const named = !!person || !!p.invitation?.email;
      if (p.link && (!named || p.link.scope === 'anonymous' || p.link.scope === 'organization')) {
        const scope = p.link.scope === 'anonymous' ? 'Anyone with the link' : p.link.scope === 'organization' ? 'Your organization, with the link' : 'People with the link';
        return { id: p.id, kind: 'link' as const, name: scope, role: p.link.type === 'edit' ? 'writer' : role, inherited: !!p.inheritedFrom };
      }
      const email = people.map((u) => u.email).find(Boolean) ?? p.invitation?.email;
      const names = [...new Set(people.map((u) => friendlyPrincipal(u.displayName)).filter(Boolean))].join(', ');
      return {
        id: p.id,
        kind: role === 'owner' ? ('owner' as const) : ('user' as const),
        name: names || friendlyPrincipal(email) || 'Someone',
        ...(email ? { email } : {}),
        role: p.link?.type === 'edit' && role === 'reader' ? ('writer' as const) : role,
        inherited: !!p.inheritedFrom,
      };
    });
  }

  async setPermissionRole(folderId: string, permissionId: string, role: 'reader' | 'writer'): Promise<void> {
    const { driveId, itemId } = await this.resolve(folderId);
    await this.fetch(
      `/drives/${driveId}/items/${itemId}/permissions/${permissionId}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roles: [role === 'reader' ? 'read' : 'write'] }) },
      'change who can edit the folder',
    );
    logCloudAction('onedrive', 'change access', `${this.label(folderId)} (${role === 'reader' ? 'can view' : 'can edit'})`);
  }

  async removePermission(folderId: string, permissionId: string): Promise<void> {
    const { driveId, itemId } = await this.resolve(folderId);
    await this.fetch(`/drives/${driveId}/items/${itemId}/permissions/${permissionId}`, { method: 'DELETE' }, 'stop sharing the folder');
    logCloudAction('onedrive', 'stop sharing', this.label(folderId));
  }

  /**
   * Deletes a file. Only the app's own lock files can go, and only ones listed in or added to a
   * folder this object opened; anything else is refused here, whatever the caller asks. One already
   * gone counts as deleted.
   */
  async remove(fileId: string): Promise<void> {
    const name = this.names.get(fileId);
    if (!name || !REMOVABLE.test(name)) throw new Error('redcolumn only deletes its own lock files.');
    try {
      await this.serial(fileId, () => this.fetch(this.itemPath(fileId), { method: 'DELETE' }, 'delete a file'));
    } catch (err) {
      if (!(err instanceof Error) || !/could not find/.test(err.message)) throw err;
    }
    logCloudAction('onedrive', 'delete', name);
    this.json.delete(fileId);
    this.drives.delete(fileId);
    this.names.delete(fileId);
  }

  /**
   * Deletes a session folder and everything in it; OneDrive keeps it in the recycle bin for a while.
   * Refused unless the folder sits directly in this person's own app folder and holds a session
   * manifest, so no other folder can be deleted through this.
   */
  async removeFolder(folderId: string): Promise<void> {
    const { driveId, itemId } = await this.resolve(folderId);
    const root = await this.appRoot();
    const item = (await (await this.fetch(`/drives/${driveId}/items/${itemId}?$select=id,parentReference`, {}, 'check the session folder')).json()) as GraphItem;
    const inAppFolder = driveId.toLowerCase() === root.driveId.toLowerCase() && item.parentReference?.id === root.itemId;
    if (!inAppFolder || !(await this.hasChild(driveId, itemId, SESSION_MANIFEST))) throw new Error('redcolumn only removes session folders it made in your OneDrive.');
    // Take the links off first, so the copy OneDrive keeps in the recycle bin cannot be reached by one.
    const links = await this.listPermissions(folderId).then((all) => all.filter((p) => p.kind === 'link' && !p.inherited), () => []);
    for (const link of links) await this.removePermission(folderId, link.id).catch(() => {});
    await this.fetch(`/drives/${driveId}/items/${itemId}`, { method: 'DELETE' }, 'remove the session folder');
    logCloudAction('onedrive', 'delete folder', this.label(folderId));
    this.folders.delete(folderId);
  }

  /** Whether a folder holds a file of this name. */
  private async hasChild(driveId: string, itemId: string, name: string): Promise<boolean> {
    try {
      await this.fetch(`/drives/${driveId}/items/${itemId}:/${encodeURIComponent(name)}?$select=id`, {}, 'check the session folder');
      return true;
    } catch (err) {
      if (err instanceof Error && /could not find/.test(err.message)) return false;
      throw err;
    }
  }

  /** The host owns the session folder, so the manifest sits in their own drive. */
  async ownedByMe(fileId: string): Promise<boolean> {
    const mine = await this.myDriveId();
    return (this.drives.get(fileId) ?? '').toLowerCase() === mine.toLowerCase();
  }
}
