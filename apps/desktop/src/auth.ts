import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage, shell } from 'electron';
import { writeAtomic } from './atomic';
import { listenForCode, SignInClosed, validTenant } from './loopback';
import { pkcePair } from './pkce';

export interface AuthResult {
  accessToken: string;
  expiresAt: number;
  email: string;
  name: string;
}

interface SavedAuth {
  clientId: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  email: string;
  name: string;
  scopes: string[];
}

/** What the renderer gets. The refresh token never leaves the main process. */
const publicResult = (saved: AuthResult): AuthResult => ({
  accessToken: saved.accessToken,
  expiresAt: saved.expiresAt,
  email: saved.email,
  name: saved.name,
});

async function postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json) throw new Error(typeof json?.error_description === 'string' ? json.error_description : 'Sign-in failed.');
  return json;
}

function tokenResult(json: Record<string, unknown>, email: string, name: string): AuthResult {
  const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  if (!accessToken) throw new Error('Sign-in did not return a token.');
  return { accessToken, expiresAt: Date.now() + expiresIn * 1000, email, name };
}

/**
 * Saved sign-ins are encrypted with the operating system's key store (DPAPI on Windows, Keychain
 * on macOS) when it is available. A file written before encryption was added is still read.
 */
async function readSaved(file: string, clientId: string): Promise<SavedAuth | null> {
  try {
    const raw = await fs.readFile(file);
    const text = raw.subarray(0, 4).toString() === 'enc:' ? safeStorage.decryptString(raw.subarray(4)) : raw.toString('utf8');
    const saved = JSON.parse(text) as Partial<SavedAuth>;
    if (saved.clientId !== clientId || typeof saved.refreshToken !== 'string' || !saved.refreshToken) return null;
    return { ...saved, scopes: Array.isArray(saved.scopes) ? saved.scopes : [] } as SavedAuth;
  } catch {
    return null;
  }
}

async function writeSaved(file: string, saved: SavedAuth) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const json = JSON.stringify(saved);
  const data = safeStorage.isEncryptionAvailable() ? Buffer.concat([Buffer.from('enc:'), safeStorage.encryptString(json)]) : json;
  await writeAtomic(file, data, { mode: 0o600 });
}

export class DesktopAuth {
  private flow: { close: (reason?: Error) => void } | null = null;
  /**
   * Microsoft access tokens by the scopes they were asked for, kept in memory only, so calls that
   * need the app folder alone and sharing calls each keep their own token without refreshing.
   */
  private msTokens = new Map<string, AuthResult>();

  constructor(private dir: string) {
    // Older builds could sign in to Google; that sign-in is no longer used, so its saved token goes.
    void fs.unlink(this.file('google-auth.json')).catch(() => undefined);
  }

  private file(name: string) {
    return path.join(this.dir, name);
  }

  async signOut(provider: 'microsoft') {
    this.msTokens.clear();
    await fs.unlink(this.file(`${provider}-auth.json`)).catch(() => undefined);
  }

  async microsoftAccount(clientId: string): Promise<{ email: string; name: string } | null> {
    const saved = await readSaved(this.file('microsoft-auth.json'), clientId);
    if (!saved?.email) return null;
    return { email: saved.email, name: saved.name };
  }

  async microsoft(clientId: string, tenant: string, scopes: string[], interactive: boolean): Promise<AuthResult | null> {
    if (!validTenant(tenant)) throw new Error('The Microsoft tenant setting is not valid.');
    const graphScopes = scopes.map((s) => (s.includes('/') ? s : `https://graph.microsoft.com/${s}`));
    const full = [...new Set([...graphScopes, 'openid', 'profile', 'email', 'offline_access'])];
    const saved = await readSaved(this.file('microsoft-auth.json'), clientId);
    const key = [...full].sort().join(' ');
    const cached = this.msTokens.get(key);
    if (saved && cached && cached.expiresAt > Date.now() + 60_000) return cached;
    // The scopes the person has allowed so far, from every sign-in kept (refreshing does not narrow it).
    const covers = saved && full.every((s) => saved.scopes.includes(s) || s === 'offline_access');
    if (saved && covers) {
      try {
        return await this.refreshMicrosoft(clientId, tenant, full, saved);
      } catch {
        if (!interactive) return null;
      }
    } else if (!interactive) return null;
    return this.interactive(async (redirectUri, state) => {
      const { verifier, challenge } = pkcePair();
      const auth = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`);
      auth.searchParams.set('client_id', clientId);
      auth.searchParams.set('redirect_uri', redirectUri);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', full.join(' '));
      auth.searchParams.set('state', state);
      auth.searchParams.set('code_challenge', challenge);
      auth.searchParams.set('code_challenge_method', 'S256');
      await shell.openExternal(auth.href);
      return verifier;
    }, async (code, redirectUri, verifier) => {
      const json = await postForm(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        scope: full.join(' '),
      }));
      const who = await microsoftUser(String(json.access_token));
      const result = tokenResult(json, who.email, who.name);
      const before = saved?.clientId === clientId ? saved.scopes : [];
      await writeSaved(this.file('microsoft-auth.json'), {
        ...result,
        clientId,
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : '',
        scopes: [...new Set([...before, ...full])],
      });
      this.msTokens.set(key, result);
      return result;
    });
  }

  private async refreshMicrosoft(clientId: string, tenant: string, scopes: string[], saved: SavedAuth): Promise<AuthResult> {
    const json = await postForm(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, new URLSearchParams({
      client_id: clientId,
      refresh_token: saved.refreshToken,
      grant_type: 'refresh_token',
      scope: scopes.join(' '),
    }));
    const result = tokenResult(json, saved.email, saved.name);
    await writeSaved(this.file('microsoft-auth.json'), {
      ...saved,
      ...result,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : saved.refreshToken,
      scopes: [...new Set([...saved.scopes, ...scopes])],
    });
    this.msTokens.set([...scopes].sort().join(' '), result);
    return result;
  }

  /**
   * One browser sign-in at a time. Starting another closes the one before it, so a tab the person
   * abandoned does not block signing in again.
   */
  private async interactive(
    start: (redirectUri: string, state: string) => Promise<string>,
    finish: (code: string, redirectUri: string, verifier: string) => Promise<AuthResult>,
  ): Promise<AuthResult> {
    this.flow?.close(new SignInClosed());
    const state = randomBytes(16).toString('base64url');
    const loop = await listenForCode(state);
    const flow = { close: loop.close };
    this.flow = flow;
    try {
      const verifier = await start(loop.redirectUri, state);
      const code = await loop.code;
      return publicResult(await finish(code, loop.redirectUri, verifier));
    } finally {
      loop.close();
      if (this.flow === flow) this.flow = null;
    }
  }
}

async function microsoftUser(token: string): Promise<{ email: string; name: string }> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { authorization: `Bearer ${token}` } });
  const info = (await res.json().catch(() => null)) as { mail?: string; userPrincipalName?: string; displayName?: string } | null;
  const email = info?.mail || info?.userPrincipalName;
  if (!res.ok || !email) throw new Error('Microsoft did not share this account\'s email address.');
  return { email: email.toLowerCase(), name: info?.displayName || email };
}
