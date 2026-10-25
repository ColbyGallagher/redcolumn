/**
 * Certificate services for digital signatures (time stamp servers, OCSP responders, revocation
 * lists, CA certificates), fetched by the main process: the page's Content Security Policy only
 * lets it reach its own origin, and most of these services do not allow browsers (CORS) anyway.
 *
 * The page names the address (from Preferences or from a certificate), so the request is kept to
 * what these services need: http(s), a GET or a POST of a time stamp or OCSP request, never this
 * computer itself (the local assistant listens there), a bounded answer, and no cookies.
 */

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const POST_TYPES = new Set(['application/timestamp-query', 'application/ocsp-request']);
/** Revocation lists can be large; time stamps and OCSP answers are a few kilobytes. */
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_BODY = 64 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;

/**
 * This computer: loopback names and addresses, and the unspecified address. URL has already
 * normalised the host (127.1 and 0x7f.0.0.1 become 127.0.0.1; IPv6 is compressed, and an
 * IPv4-mapped address is written in hex, as ::ffff:7f00:1).
 */
function isLocal(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^127\./.test(h) || h === '0.0.0.0') return true;
  return h === '::1' || h === '::' || /^::ffff:(7f[0-9a-f]{2}:|0:)/.test(h);
}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That certificate service address is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Certificate services are reached over http or https only.');
  if (url.username || url.password) throw new Error('That certificate service address is not allowed.');
  if (isLocal(url.hostname)) throw new Error('Certificate services on this computer are not allowed.');
  return url;
}

/** Fetches `url` (POSTing `body` as `type` when given) and returns the answer's bytes. */
export async function pkiRequest(rawUrl: unknown, body: unknown, type: unknown, fetchFn: Fetch = (u, init) => fetch(u, init)): Promise<Uint8Array> {
  if (typeof rawUrl !== 'string') throw new Error('That certificate service address is not valid.');
  let url = checkUrl(rawUrl);
  let init: RequestInit;
  if (body === undefined || body === null) {
    init = { method: 'GET' };
  } else {
    if (!(body instanceof Uint8Array) || body.byteLength > MAX_BODY) throw new Error('That request is not allowed.');
    if (typeof type !== 'string' || !POST_TYPES.has(type)) throw new Error('That request is not allowed.');
    init = { method: 'POST', body: body as BodyInit, headers: { 'content-type': type } };
  }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetchFn(url.href, { ...init, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal });
    } catch {
      throw new Error(`${url.host} cannot be reached`);
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error(`${url.host} redirected too many times`);
      url = checkUrl(new URL(location, url).href);
      continue;
    }
    if (!res.ok) throw new Error(`${url.host} answered ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error(`${url.host} sent too much`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new Error(`${url.host} sent too much`);
    return bytes;
  }
}
