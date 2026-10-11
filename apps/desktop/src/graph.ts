/**
 * The desktop app's Microsoft Graph broker (docs/SECURITY-HARDENING.md, E2). The page never holds a
 * Microsoft token: it asks the main process to make each Graph call, and the main process attaches
 * the token here, after checking the call against the same rules the web app keeps for itself:
 *
 * - only https://graph.microsoft.com/v1.0 is ever sent the token (3.6);
 * - a call asks for the app folder alone, unless it manages sharing (the person's OneDrive) or
 *   reaches into someone else's drive or a sharing link (also files shared with them) (3.4, 3.5);
 * - only the app's own lock files, and session folders in the person's own app folder, are deleted,
 *   plus link and sharing permissions (4.3).
 *
 * A script injected into the page could still ask for these calls, but only these, and it cannot
 * take a token away to use anywhere else.
 */

export const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0/';
export const ACCESS_LEVELS = [['Files.ReadWrite.AppFolder'], ['Files.ReadWrite'], ['Files.ReadWrite.All']] as const;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
/** Request headers passed on to Graph; anything else (an Authorization header above all) is dropped. */
const REQUEST_HEADERS = ['content-type', 'prefer', 'if-match'];
/** Response headers handed back to the page. */
const RESPONSE_HEADERS = ['content-type', 'location', 'retry-after', 'etag'];
const REMOVABLE = /^lock-[^/\\]+\.json$/i;
const SESSION_MANIFEST = 'session.json';

export interface GraphRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  /** The access level the page asks for: 0 (app folder), 1 (the OneDrive), 2 (also shared files). */
  level: number;
}

export interface GraphReply {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
  /** Set when there is no token for that level without a sign-in. */
  authNeeded?: boolean;
}

/** A Graph token for these scopes without a sign-in window, or null when one is needed. */
export type TokenSource = (scopes: string[]) => Promise<string | null>;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const encoder = new TextEncoder();
function refuse(status: number, message: string): GraphReply {
  return { status, statusText: 'Refused', headers: { 'content-type': 'application/json' }, body: encoder.encode(JSON.stringify({ error: { code: 'refusedByApp', message } })) };
}

/** The path after /v1.0, without the query. */
function graphPath(url: string): string | null {
  if (!url.startsWith(GRAPH_ROOT)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'graph.microsoft.com' || u.username || u.password || u.port) return null;
    return decodeURIComponent(u.pathname.slice('/v1.0'.length));
  } catch {
    return null;
  }
}

const isSharingPath = (path: string) => /\/(createLink|invite)$/.test(path) || /\/permissions(\/[^/]+)?$/.test(path);

export class GraphBroker {
  private own: Promise<{ driveId: string; rootId: string }> | null = null;
  private token: TokenSource;
  private fetchFn: Fetch;

  constructor(token: TokenSource, fetchFn: Fetch = (url, init) => fetch(url, init)) {
    this.token = token;
    this.fetchFn = fetchFn;
  }

  /** Forgets what it learned about the signed-in person (after signing out). */
  reset() {
    this.own = null;
  }

  async request(req: GraphRequest): Promise<GraphReply> {
    const path = typeof req.url === 'string' ? graphPath(req.url) : null;
    if (!path) return refuse(400, 'Only Microsoft Graph can be reached this way.');
    const method = String(req.method || 'GET').toUpperCase();
    if (!METHODS.has(method)) return refuse(400, 'That request is not allowed.');
    const level = Number.isInteger(req.level) && req.level >= 0 && req.level < ACCESS_LEVELS.length ? req.level : -1;
    if (level < 0) return refuse(400, 'That access level is not known.');
    const most = await this.mostFor(path);
    if (level > most) return refuse(403, 'That call does not need more than the app folder.');
    if (method === 'DELETE') {
      const why = await this.deleteRefusal(path, level);
      if (why) return refuse(403, why);
    }
    const token = await this.token([...ACCESS_LEVELS[level]!]);
    if (!token) return { ...refuse(401, 'Sign in to Microsoft.'), authNeeded: true };
    const headers = new Headers();
    for (const name of REQUEST_HEADERS) {
      const value = Object.entries(req.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];
      if (typeof value === 'string') headers.set(name, value);
    }
    headers.set('authorization', `Bearer ${token}`);
    const body = req.body instanceof Uint8Array && method !== 'GET' && method !== 'DELETE' ? req.body : undefined;
    let res = await this.fetchFn(req.url, { method, headers, body: body as BodyInit | undefined, cache: 'no-store', redirect: 'manual' });
    // File content redirects to a pre-authorised download address, which is fetched without the token.
    const location = res.headers.get('location');
    if (method === 'GET' && res.status >= 300 && res.status < 400 && location && /^https:\/\//i.test(location)) res = await this.fetchFn(location, { cache: 'no-store', redirect: 'follow' });
    const out: Record<string, string> = {};
    for (const name of RESPONSE_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) out[name] = value;
    }
    return { status: res.status, statusText: res.statusText, headers: out, body: new Uint8Array(await res.arrayBuffer()) };
  }

  /** The widest level a call to this path may use. */
  private async mostFor(path: string): Promise<number> {
    if (path.startsWith('/shares/')) return 2;
    if (isSharingPath(path)) return 1;
    const drive = /^\/drives\/([^/]+)\//.exec(path)?.[1];
    if (!drive) return 0;
    const own = await this.ownDrive().catch(() => null);
    return own && drive.toLowerCase() !== own.driveId.toLowerCase() ? 2 : 0;
  }

  /** Why a delete is refused, or null when it is one the app makes. */
  private async deleteRefusal(path: string, level: number): Promise<string | null> {
    if (/^\/drives\/[^/]+\/items\/[^/]+\/permissions\/[^/]+$/.test(path)) return null;
    const m = /^\/drives\/([^/]+)\/items\/([^/:]+)$/.exec(path);
    if (!m) return 'redcolumn only deletes its own files.';
    const [, driveId, itemId] = m as unknown as [string, string, string];
    const item = await this.get(`drives/${driveId}/items/${itemId}?$select=id,name,file,folder,parentReference`, level);
    if (!item) return null; // Already gone: the delete will say so.
    if (item.file) return REMOVABLE.test(String(item.name ?? '')) ? null : 'redcolumn only deletes its own lock files.';
    const own = await this.ownDrive().catch(() => null);
    const inAppFolder = !!own && driveId.toLowerCase() === own.driveId.toLowerCase() && item.parentReference?.id === own.rootId;
    if (!inAppFolder) return 'redcolumn only removes session folders it made in your OneDrive.';
    const manifest = await this.get(`drives/${driveId}/items/${itemId}:/${SESSION_MANIFEST}?$select=id`);
    return manifest ? null : 'redcolumn only removes session folders it made in your OneDrive.';
  }

  private ownDrive(): Promise<{ driveId: string; rootId: string }> {
    this.own ??= this.get('me/drive/special/approot?$select=id,parentReference').then((root) => {
      if (!root?.parentReference?.driveId) throw new Error('OneDrive did not say where the app folder is.');
      return { driveId: String(root.parentReference.driveId), rootId: String(root.id) };
    });
    this.own.catch(() => (this.own = null));
    return this.own;
  }

  /** A Graph read at an access level (null on 404). */
  private async get(relative: string, level = 0): Promise<{ id?: string; name?: string; file?: unknown; folder?: unknown; parentReference?: { driveId?: string; id?: string } } | null> {
    const token = await this.token([...ACCESS_LEVELS[level]!]);
    if (!token) throw new Error('Sign in to Microsoft.');
    const res = await this.fetchFn(`${GRAPH_ROOT}${relative}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OneDrive answered ${res.status}.`);
    return (await res.json()) as never;
  }
}
