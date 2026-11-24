import { msg } from '@nb/i18n';
import { parseTradePack, type TradePack } from './pack';

/**
 * The community library: trade packs kept in the public `redcolumn-library` repository on GitHub,
 * listed by its `index.json`. The app asks for the index only when someone opens Browse Library,
 * and for a pack only when they add it. Nothing about them or their documents goes with either
 * request (see PRIVACY.md, "Community library").
 */

export const LIBRARY_REPO = 'ColbyGallagher/redcolumn-library';
export const LIBRARY_ORIGIN = 'https://raw.githubusercontent.com';
export const LIBRARY_BASE = `${LIBRARY_ORIGIN}/${LIBRARY_REPO}/main/`;
/** Where people read about the library and add their own packs. */
export const LIBRARY_PAGE = `https://github.com/${LIBRARY_REPO}`;

export const INDEX_FORMAT = 'redcolumn.library-index';
export const INDEX_VERSION = 1;

const MAX_INDEX = 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_PACK = 8 * 1024 * 1024;

export interface LibraryEntry {
  id: string;
  name: string;
  trade: string;
  description: string;
  author: string;
  units: 'metric' | 'imperial' | null;
  /** The pack's path in the repository, as `packs/civil-roads.rctrade`. */
  path: string;
  /** The pack file's SHA-256, hex: a pack that does not match is not added. */
  sha256: string;
  size: number;
  /** What it holds, for the list: `{ assemblies: 9, toolSets: 1, ... }`. */
  contents: Partial<Record<'assemblies' | 'items' | 'productLists' | 'templates' | 'toolSets' | 'tools' | 'standards', number>>;
  tags: string[];
}

export interface LibraryIndex {
  updated: string;
  entries: LibraryEntry[];
}

function fail(message: string): never {
  throw new Error(msg('The library\'s list could not be read: {message}.', { message }));
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');
const COUNT_KEYS = ['assemblies', 'items', 'productLists', 'templates', 'toolSets', 'tools', 'standards'] as const;

/** A path inside the repository: plain segments ending in `.rctrade`, never leaving it. */
export function isPackPath(path: string): boolean {
  return /^(?:[\w-]+\/)*[\w.-]+\.rctrade$/.test(path) && !path.split('/').some((s) => s === '..' || s === '.' || s.startsWith('.'));
}

/** Reads `index.json`. Entries it cannot use are left out rather than failing the whole list. */
export function parseIndex(content: string): LibraryIndex {
  if (content.length > MAX_INDEX) fail(msg('it is too large'));
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    fail(msg('it is not JSON'));
  }
  if (!isObject(data) || data.format !== INDEX_FORMAT) fail(msg('it is another kind of file'));
  if (typeof data.version !== 'number' || data.version > INDEX_VERSION) fail(msg('it needs a newer version of redcolumn'));
  if (!Array.isArray(data.entries)) fail(msg('it has no entries'));
  const seen = new Set<string>();
  const entries: LibraryEntry[] = [];
  for (const e of data.entries.slice(0, MAX_ENTRIES)) {
    if (!isObject(e)) continue;
    const id = str(e.id, 100);
    const name = str(e.name, 200);
    const path = str(e.path, 300);
    const sha256 = str(e.sha256, 64).toLowerCase();
    if (!/^[\w-]+$/.test(id) || seen.has(id) || !name || !isPackPath(path) || !/^[0-9a-f]{64}$/.test(sha256)) continue;
    const size = typeof e.size === 'number' && Number.isInteger(e.size) && e.size > 0 && e.size <= MAX_PACK ? e.size : 0;
    if (!size) continue;
    seen.add(id);
    const contents: LibraryEntry['contents'] = {};
    if (isObject(e.contents)) for (const k of COUNT_KEYS) if (typeof e.contents[k] === 'number' && Number.isInteger(e.contents[k]) && (e.contents[k] as number) > 0) contents[k] = e.contents[k] as number;
    entries.push({
      id,
      name,
      trade: str(e.trade, 100) || 'General',
      description: str(e.description, 2000),
      author: str(e.author, 200),
      units: e.units === 'metric' || e.units === 'imperial' ? e.units : null,
      path,
      sha256,
      size,
      contents,
      tags: Array.isArray(e.tags) ? e.tags.slice(0, 20).map((t) => str(t, 40)).filter(Boolean) : [],
    });
  }
  return { updated: str(data.updated, 40), entries };
}

/** The trades the index lists, alphabetically, for the filter. */
export function tradesOf(index: LibraryIndex): string[] {
  return [...new Set(index.entries.map((e) => e.trade))].sort((a, b) => a.localeCompare(b));
}

/** Entries matching a trade (or all, for null) and every word of `query`. */
export function filterEntries(entries: readonly LibraryEntry[], trade: string | null, query: string): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (trade && e.trade !== trade) return false;
    const hay = [e.name, e.trade, e.description, e.author, ...e.tags].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Asked without cookies, credentials or a referrer: GitHub sees only the request itself.
const REQUEST: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache', redirect: 'error' };

async function get(url: string, max: number, what: string, fetcher: typeof fetch): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetcher(url, REQUEST);
  } catch {
    throw new Error(msg('Could not reach the community library to get {what}. Check the connection and try again.', { what }));
  }
  if (!res.ok) throw new Error(msg('The community library did not send {what} ({status}).', { what, status: String(res.status) }));
  const body = await res.arrayBuffer();
  if (body.byteLength > max) throw new Error(msg('The community library sent {what} larger than redcolumn accepts.', { what }));
  return body;
}

/** Fetches and reads the library's index. */
export async function fetchIndex(fetcher: typeof fetch = fetch): Promise<LibraryIndex> {
  const body = await get(`${LIBRARY_BASE}index.json`, MAX_INDEX, 'its list', fetcher);
  return parseIndex(new TextDecoder().decode(body));
}

/** Fetches one pack, checks it against the index's hash and reads it. */
export async function fetchPack(entry: LibraryEntry, fetcher: typeof fetch = fetch): Promise<TradePack> {
  if (!isPackPath(entry.path)) throw new Error(msg('"{name}" is not in the library.', { name: entry.name }));
  const body = await get(LIBRARY_BASE + entry.path, MAX_PACK, `"${entry.name}"`, fetcher);
  if ((await sha256Hex(body)) !== entry.sha256) throw new Error(msg('"{name}" does not match the library\'s list, so it was not added. Try again later.', { name: entry.name }));
  return parseTradePack(new TextDecoder().decode(body));
}
