/**
 * Google sign-in for Live Sessions. The web app signs people in with Google Identity Services and
 * sends its access token; the server asks Google who the token belongs to and trusts only tokens
 * issued to this app's OAuth client (a token from another app is refused, so no other site can
 * pass one of its users' tokens off as ours).
 */

export interface GoogleIdentity {
  email: string;
}

/** Resolves a token to a verified identity, or null (bad, expired, wrong app, unverified email). */
export type TokenVerifier = (token: string) => Promise<GoogleIdentity | null>;

interface TokenInfo {
  aud?: string;
  azp?: string;
  email?: string;
  email_verified?: string | boolean;
  expires_in?: string | number;
}

const MAX_CACHE = 5000;

/**
 * Verifies access tokens with Google's tokeninfo endpoint, caching each answer until the token
 * expires (at most ten minutes, so a revoked token stops working soon).
 */
export function googleVerifier(clientIds: readonly string[], fetchImpl: typeof fetch = fetch): TokenVerifier {
  const cache = new Map<string, { identity: GoogleIdentity | null; until: number }>();
  return async (token) => {
    if (!token || token.length > 4096) return null;
    const now = Date.now();
    const hit = cache.get(token);
    if (hit && hit.until > now) return hit.identity;
    let identity: GoogleIdentity | null = null;
    let ttl = 60_000;
    try {
      const res = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
      if (res.ok) {
        const info = (await res.json()) as TokenInfo;
        const ours = clientIds.includes(info.aud ?? '') || clientIds.includes(info.azp ?? '');
        const verified = info.email_verified === true || info.email_verified === 'true';
        const left = Number(info.expires_in ?? 0) * 1000;
        if (ours && verified && info.email && left > 0) {
          identity = { email: info.email.toLowerCase() };
          ttl = Math.min(left, 10 * 60_000);
        }
      }
    } catch {
      // Google unreachable: treat as signed out, and ask again soon.
      ttl = 5_000;
    }
    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(token, { identity, until: now + ttl });
    return identity;
  };
}

/** The bearer token from an `Authorization` header. */
export function bearer(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m ? m[1]! : null;
}

/** WebSockets cannot send headers, so the app offers the token as a subprotocol: `nb-auth.<token>`. */
export function socketToken(protocolHeader: string | undefined): string | null {
  for (const p of (protocolHeader ?? '').split(',')) {
    const v = p.trim();
    if (v.startsWith('nb-auth.')) return v.slice('nb-auth.'.length);
  }
  return null;
}
