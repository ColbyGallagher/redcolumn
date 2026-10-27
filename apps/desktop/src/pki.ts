import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Certificate services for digital signatures (time stamp servers, OCSP responders, revocation
 * lists, CA certificates), fetched by the main process: the page's Content Security Policy only
 * lets it reach its own origin, and most of these services do not allow browsers (CORS) anyway.
 *
 * The address comes from Preferences or from a certificate inside a PDF from anyone, so the request
 * is kept to what these services need: http(s), a GET or a POST of a time stamp or OCSP request,
 * no cookies, and a bounded answer. It never reaches this computer or the local network (the local
 * assistant listens on loopback; routers and cloud metadata services on private addresses): the
 * name is resolved here, every address it resolves to is checked, and the connection is made to
 * the checked address, so a name cannot resolve one way for the check and another for the request.
 */

const POST_TYPES = new Set(['application/timestamp-query', 'application/ocsp-request']);
/** Revocation lists can be large; time stamps and OCSP answers are a few kilobytes. */
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_BODY = 64 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;

/** Loopback, private, link-local, shared (CGNAT), multicast and reserved addresses. */
const BLOCKED = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  BLOCKED.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  BLOCKED.addSubnet(net6, prefix, 'ipv6');

/** An address on this computer or the local network. IPv4-mapped IPv6 is checked as IPv4. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED.check(ip, 'ipv4');
  if (family !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return BLOCKED.check(mapped[1]!, 'ipv4');
  // URL writes a mapped address in hex (::ffff:7f00:1); turn it back into dotted form.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const [a, b] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)];
    return BLOCKED.check(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`, 'ipv4');
  }
  return BLOCKED.check(ip, 'ipv6');
}

export type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolve: Resolve = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** A `lookup` for http(s).request that refuses a name if any address it resolves to is blocked. */
export function safeLookup(resolve: Resolve = systemResolve): net.LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const err = (message: string) => Object.assign(new Error(message), { code: 'EBLOCKED' });
        if (!addresses.length) return callback(err(`${hostname} has no address`), '', 4);
        if (addresses.some((a) => isBlockedAddress(a.address))) return callback(err(`${hostname} is on this computer or the local network`), '', 4);
        if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: Error) => callback(Object.assign(error, { code: (error as { code?: string }).code ?? 'ENOTFOUND' }), '', 4),
    );
  };
}

/** One HTTP exchange: the status, the redirect target, the stated length and the body as it arrives. */
export interface Answer {
  status: number;
  location: string | null;
  length: number | null;
  body: AsyncIterable<Uint8Array>;
  /** Stops reading and closes the connection. */
  cancel(): void;
}

export type Transport = (url: URL, init: { method: 'GET' | 'POST'; body?: Uint8Array; type?: string }, signal: AbortSignal) => Promise<Answer>;

/** The default transport: node's http(s) with the checked lookup, no proxy, no cookies, no pooling. */
export function nodeTransport(lookup: net.LookupFunction = safeLookup()): Transport {
  return (url, init, signal) =>
    new Promise<Answer>((resolve, reject) => {
      const send = url.protocol === 'https:' ? https.request : http.request;
      const req = send(url, { method: init.method, lookup, agent: false, signal, headers: init.body ? { 'content-type': init.type!, 'content-length': String(init.body.byteLength) } : {} }, (res) =>
        resolve({
          status: res.statusCode ?? 0,
          location: typeof res.headers.location === 'string' ? res.headers.location : null,
          length: res.headers['content-length'] ? Number(res.headers['content-length']) : null,
          body: res,
          cancel: () => res.destroy(),
        }),
      );
      req.on('error', reject);
      req.end(init.body ? Buffer.from(init.body) : undefined);
    });
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
  // A literal address is never looked up, so it is checked here; names are checked as they resolve.
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedAddress(url.hostname)) throw new Error('Certificate services on this computer or the local network are not allowed.');
  return url;
}

/** Fetches `url` (POSTing `body` as `type` when given) and returns the answer's bytes. */
export async function pkiRequest(rawUrl: unknown, body: unknown, type: unknown, transport: Transport = nodeTransport()): Promise<Uint8Array> {
  if (typeof rawUrl !== 'string') throw new Error('That certificate service address is not valid.');
  let url = checkUrl(rawUrl);
  let init: Parameters<Transport>[1];
  if (body === undefined || body === null) {
    init = { method: 'GET' };
  } else {
    if (!(body instanceof Uint8Array) || body.byteLength > MAX_BODY) throw new Error('That request is not allowed.');
    if (typeof type !== 'string' || !POST_TYPES.has(type)) throw new Error('That request is not allowed.');
    init = { method: 'POST', body, type };
  }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const failed = (host: string, err: unknown) => {
    if (signal.aborted) return new Error(`${host} did not answer in time`);
    if ((err as { code?: string }).code === 'EBLOCKED') return new Error((err as Error).message);
    return new Error(`${host} cannot be reached`);
  };
  for (let hop = 0; ; hop++) {
    let answer: Answer;
    try {
      answer = await transport(url, init, signal);
    } catch (err) {
      throw failed(url.host, err);
    }
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      answer.cancel();
      if (hop >= MAX_REDIRECTS) throw new Error(`${url.host} redirected too many times`);
      const next = checkUrl(new URL(answer.location, url).href);
      if (url.protocol === 'https:' && next.protocol === 'http:') throw new Error(`${url.host} redirected from https to http`);
      // As fetch does: 301, 302 and 303 continue as a GET without the body; 307 and 308 repeat the POST.
      if (answer.status === 301 || answer.status === 302 || answer.status === 303) init = { method: 'GET' };
      url = next;
      continue;
    }
    if (answer.status < 200 || answer.status >= 300) {
      answer.cancel();
      throw new Error(`${url.host} answered ${answer.status}`);
    }
    if (answer.length !== null && answer.length > MAX_BYTES) {
      answer.cancel();
      throw new Error(`${url.host} sent too much`);
    }
    // Counted as it arrives: an answer without a length (chunked) is stopped once it passes the cap.
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of answer.body) {
        total += chunk.byteLength;
        if (total > MAX_BYTES) {
          answer.cancel();
          throw Object.assign(new Error(`${url.host} sent too much`), { code: 'ETOOBIG' });
        }
        chunks.push(chunk);
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'ETOOBIG') throw new Error((err as Error).message);
      throw failed(url.host, err);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }
}
