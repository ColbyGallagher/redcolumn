export interface ServerUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  isAdmin: boolean;
}

export interface InvitePreview {
  email: string;
  name: string | null;
  projectName: string | null;
  scopeName: string | null;
  hasAccount: boolean;
  expiresAt: string;
}

export interface ServerProjectSummary {
  id: string;
  name: string;
  number: string | null;
  createdAt: string;
}

export interface ServerSessionSummary {
  id: string;
  projectId: string;
  projectName: string;
  kind: 'review' | 'session';
  name: string;
  state: 'open' | 'locked' | 'closed' | null;
  createdAt: string;
}

export interface ServerSessionsResponse {
  projects: ServerProjectSummary[];
  sessions: ServerSessionSummary[];
}

export class ServerClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = 'ServerClientError';
    this.status = status;
    this.code = code;
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ServerClient {
  me(): Promise<ServerUser | null>;
  login(email: string, password: string): Promise<ServerUser>;
  logout(): Promise<void>;
  previewInvite(token: string): Promise<InvitePreview>;
  acceptInvite(token: string, input?: { name?: string; password?: string }): Promise<ServerUser>;
  listSessions(): Promise<ServerSessionsResponse>;
}

async function readErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string' && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // Non-JSON error body.
  }
  if (res.status === 429) return 'rate_limited';
  if (res.status === 401) return 'unauthenticated';
  if (res.status === 403) return 'forbidden';
  if (res.status === 404) return 'not_found';
  return `http_${res.status}`;
}

/**
 * Typed same-origin HTTP client for the redcolumn server.
 * Always sends `credentials: 'same-origin'` so session cookies stay HttpOnly and
 * never touches `localStorage` or `sessionStorage`.
 */
export function createServerClient(fetchImpl: FetchLike = fetch): ServerClient {
  async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const res = await fetchImpl(path, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
    if (!res.ok) {
      throw new ServerClientError(res.status, await readErrorCode(res));
    }
    return (await res.json()) as T;
  }

  return {
    async me(): Promise<ServerUser | null> {
      const res = await fetchImpl('/auth/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (res.status === 401) return null;
      if (!res.ok) {
        throw new ServerClientError(res.status, await readErrorCode(res));
      }
      const data = (await res.json()) as { user: ServerUser };
      return data.user;
    },

    async login(email: string, password: string): Promise<ServerUser> {
      const data = await requestJson<{ user: ServerUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      return data.user;
    },

    async logout(): Promise<void> {
      await requestJson<{ ok: boolean }>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    async previewInvite(token: string): Promise<InvitePreview> {
      const data = await requestJson<{ invite: InvitePreview }>(`/api/invites/${encodeURIComponent(token)}`, {
        method: 'GET',
        cache: 'no-store',
      });
      return data.invite;
    },

    async acceptInvite(token: string, input: { name?: string; password?: string } = {}): Promise<ServerUser> {
      const data = await requestJson<{ ok: boolean; user: ServerUser }>(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      );
      return data.user;
    },

    async listSessions(): Promise<ServerSessionsResponse> {
      return requestJson<ServerSessionsResponse>('/api/sessions', {
        method: 'GET',
        cache: 'no-store',
      });
    },
  };
}
