export interface LocalModeConfig {
  mode: 'local';
}

export interface ServerModeConfig {
  mode: 'server';
  origin: string;
  version: string;
  auth: {
    local: boolean;
  };
}

export type AppConfig = LocalModeConfig | ServerModeConfig;

export const LOCAL_MODE_CONFIG: LocalModeConfig = Object.freeze({ mode: 'local' });

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function isServerModeConfig(value: unknown): value is ServerModeConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.mode !== 'server') return false;
  if (typeof record.origin !== 'string' || record.origin.trim() === '') return false;
  if (typeof record.version !== 'string') return false;
  if (!record.auth || typeof record.auth !== 'object') return false;
  const auth = record.auth as Record<string, unknown>;
  if (typeof auth.local !== 'boolean') return false;
  return true;
}

/**
 * Loads `/config.json` from the same origin to detect whether the web app is served
 * by a redcolumn server. Any 404, network error, non-JSON payload, or unexpected shape
 * falls back silently to `{ mode: 'local' }` so static hosts and local dev stay unchanged.
 */
export async function loadAppConfig(fetchImpl: FetchLike = fetch): Promise<AppConfig> {
  try {
    const res = await fetchImpl('/config.json', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return LOCAL_MODE_CONFIG;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !contentType.toLowerCase().includes('json')) {
      return LOCAL_MODE_CONFIG;
    }
    const data: unknown = await res.json();
    if (!isServerModeConfig(data)) return LOCAL_MODE_CONFIG;
    return {
      mode: 'server',
      origin: data.origin,
      version: data.version,
      auth: { local: data.auth.local },
    };
  } catch {
    return LOCAL_MODE_CONFIG;
  }
}

const SAFE_INVITE_TOKEN_RE = /^[A-Za-z0-9_.-]{8,256}$/;

/**
 * Extracts an invitation token from `#/invite/<token>`, `#invite/<token>`, `/invite/<token>`,
 * or `?invite=<token>`. Returns `null` when absent or malformed.
 */
export function parseInviteToken(locationLike: { hash: string; search: string; pathname?: string }): string | null {
  const hash = locationLike.hash ?? '';
  const hashMatch = /^#\/?invite\/([^/?#]+)/i.exec(hash);
  if (hashMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(hashMatch[1]).trim();
      if (SAFE_INVITE_TOKEN_RE.test(decoded)) return decoded;
    } catch {
      return null;
    }
  }

  const pathname = locationLike.pathname ?? '';
  const pathMatch = /^\/invite\/([^/?#]+)/i.exec(pathname);
  if (pathMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(pathMatch[1]).trim();
      if (SAFE_INVITE_TOKEN_RE.test(decoded)) return decoded;
    } catch {
      return null;
    }
  }

  const search = locationLike.search ?? '';
  if (search) {
    try {
      const params = new URLSearchParams(search);
      const raw = params.get('invite')?.trim();
      if (raw && SAFE_INVITE_TOKEN_RE.test(raw)) return raw;
    } catch {
      return null;
    }
  }

  return null;
}

/** Removes any `#/invite/...` hash, `/invite/...` path, or `?invite=...` query parameter from the browser URL without reloading. */
export function clearInviteFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    if (/^#\/?invite\//i.test(url.hash)) {
      url.hash = '';
    }
    if (/^\/invite\//i.test(url.pathname)) {
      url.pathname = '/';
    }
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // Ignore history restrictions in sandboxed environments.
  }
}
