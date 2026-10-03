import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Context } from 'hono';

/**
 * A relay for the certificate services signatures need, which browsers cannot reach directly (no
 * CORS): RFC 3161 time stamp authorities and OCSP responders (POST), and certificate revocation
 * lists (GET). Only those request types are passed on, only to public http(s) hosts, and only
 * small answers come back.
 */

const REQUEST_TYPES = new Set(['application/timestamp-query', 'application/ocsp-request']);
const MAX_REQUEST = 16 * 1024;
const MAX_RESPONSE = 20 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** Loopback, private, link-local and other addresses a relay must never reach. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe[89ab]|ff)/.test(s);
  }
  return true;
}

/** Whether `raw` is a public http(s) URL; the host's addresses are looked up and all must be public. */
export async function publicUrl(raw: string, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
  // STUDIO_PKI_ALLOW_PRIVATE=1 lets a test or an intranet CA be reached; off by default.
  const allowPrivate = process.env.STUDIO_PKI_ALLOW_PRIVATE === '1';
  if (!addresses.length || (!allowPrivate && addresses.some(isPrivateAddress))) return null;
  return url;
}

export async function pkiRelay(c: Context, fetcher: typeof fetch = fetch, resolve?: (host: string) => Promise<string[]>) {
  const url = await publicUrl(c.req.query('url') ?? '', resolve);
  if (!url) return c.json({ error: 'That is not a public http(s) address.' }, 400);
  let init: RequestInit = { method: 'GET' };
  if (c.req.method === 'POST') {
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!REQUEST_TYPES.has(type)) return c.json({ error: 'Only time stamp and OCSP requests are relayed.' }, 415);
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.length > MAX_REQUEST) return c.json({ error: 'That request is too large.' }, 413);
    init = { method: 'POST', body, headers: { 'content-type': type } };
  }
  let res: Response;
  try {
    res = await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return c.json({ error: `Could not reach ${url.host}: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
  if (res.status >= 300 && res.status < 400) return c.json({ error: `${url.host} redirected the request.` }, 502);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_RESPONSE) return c.json({ error: 'The answer is too large.' }, 502);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length > MAX_RESPONSE) return c.json({ error: 'The answer is too large.' }, 502);
  return new Response(body, { status: res.ok ? 200 : 502, headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' } });
}
