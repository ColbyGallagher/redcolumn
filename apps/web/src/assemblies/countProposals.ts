import { useSyncExternalStore } from 'react';
import { DEFAULT_STYLES, type Markup, type MarkupStore } from '@nb/markup';
import { centreOf, countsFromHits } from '../search/countFromHits';

/**
 * Count proposals: an AI client (through the local MCP server) finds repeats of an example symbol
 * with `find_symbol_matches` and stages them with `propose_counts`. A person reviews each proposal
 * in Takeoff Review. Nothing is placed until they approve; approving places Count markups with the
 * proposal's subject as one undo step. Proposals live on this device, apart from the document.
 * redcolumn never calls a language model: the matching is the app's own symbol search.
 */

export interface MatchRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One found symbol: where it is on the page (0-based page index, PDF points). */
export interface CountMatch {
  pageIndex: number;
  rect: MatchRect;
  /** How well it matched (0–1), when the engine said. */
  score?: number;
}

export interface CountProposal {
  id: string;
  subject: string;
  reasoning: string;
  source: string;
  createdAt: number;
  matches: CountMatch[];
  /** Set on approval: the Count markups it placed. */
  placed?: { by: string; at: number; markupIds: string[]; count: number };
  rejected?: { by: string; at: number };
}

export type CountProposalState = 'pending' | 'approved' | 'rejected';

const KEY = (fileHash: string) => `nb.countProposals.${fileHash}`;

function load(fileHash: string): CountProposal[] {
  try {
    const raw = localStorage.getItem(KEY(fileHash));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.matches)) as CountProposal[]) : [];
  } catch {
    return [];
  }
}

class CountProposalStore {
  private cache = new Map<string, CountProposal[]>();
  private listeners = new Set<() => void>();

  list(fileHash: string): CountProposal[] {
    let list = this.cache.get(fileHash);
    if (!list) this.cache.set(fileHash, (list = load(fileHash)));
    return list;
  }

  private save(fileHash: string, list: CountProposal[]) {
    this.cache.set(fileHash, list);
    try {
      localStorage.setItem(KEY(fileHash), JSON.stringify(list));
    } catch {
      // Kept for this visit only.
    }
    this.listeners.forEach((l) => l());
  }

  add(fileHash: string, proposal: CountProposal) {
    this.save(fileHash, [...this.list(fileHash), proposal]);
  }

  private update(fileHash: string, id: string, patch: Partial<CountProposal>) {
    this.save(fileHash, this.list(fileHash).map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  reject(fileHash: string, id: string, by: string) {
    this.update(fileHash, id, { rejected: { by, at: Date.now() } });
  }

  reopen(fileHash: string, id: string) {
    this.update(fileHash, id, { rejected: undefined });
  }

  markPlaced(fileHash: string, id: string, placed: NonNullable<CountProposal['placed']>) {
    this.update(fileHash, id, { placed });
  }

  /** Forgets decided proposals. */
  clearDecided(fileHash: string, store: MarkupStore) {
    this.save(fileHash, this.list(fileHash).filter((p) => countStateOf(p, store) === 'pending'));
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
}

export const countProposals = new CountProposalStore();

const NONE: CountProposal[] = [];
export function useCountProposals(fileHash: string | null): CountProposal[] {
  return useSyncExternalStore(countProposals.subscribe, () => (fileHash ? countProposals.list(fileHash) : NONE));
}

/** Approved while its Count markups are on the drawing (an undo makes it pending again). */
export function countStateOf(p: CountProposal, store: MarkupStore): CountProposalState {
  if (p.placed && p.placed.markupIds.length && p.placed.markupIds.every((id) => store.get(id))) return 'approved';
  return p.rejected ? 'rejected' : 'pending';
}

/**
 * Approves a proposal: one Count markup per page, holding a point per kept match, as one undo
 * step. `skip` are indexes into `p.matches` the person turned off. Returns the number placed, or
 * 0 when nothing could be (read-only drawing, or every match turned off).
 */
export function approveCountProposal(store: MarkupStore, p: CountProposal, by: string, skip: ReadonlySet<number> = new Set()): number {
  if (store.readOnly) return 0;
  const hits = p.matches.flatMap((m, i) => (skip.has(i) ? [] : [{ pageIndex: m.pageIndex, point: centreOf(m.rect) }]));
  if (!hits.length) return 0;
  const now = Date.now();
  const made: Markup[] = countsFromHits(hits, {
    base: { status: 'none', author: by, createdAt: now, modifiedAt: now },
    style: DEFAULT_STYLES.count,
    subject: p.subject,
  });
  store.checkpoint();
  store.batch(() => made.forEach((m) => store.add(m)));
  countProposals.markPlaced(store.fileHash, p.id, { by, at: now, markupIds: made.map((m) => m.id), count: hits.length });
  return hits.length;
}

// ---- Matches the engine found, waiting for propose_counts to name them ------------------------------

/** A match `find_symbol_matches` returned, by the `matchId` it gave. Kept in memory for this visit. */
const found = new Map<string, Map<string, CountMatch>>();
let nextMatch = 1;
const MAX_REMEMBERED = 5000;

/** Remembers matches and returns their ids, in order. */
export function rememberMatches(fileHash: string, matches: readonly CountMatch[]): string[] {
  let byId = found.get(fileHash);
  if (!byId) found.set(fileHash, (byId = new Map()));
  const ids = matches.map((m) => {
    const id = `m${nextMatch++}`;
    byId!.set(id, m);
    return id;
  });
  // The oldest go first, so a long session does not grow without end.
  while (byId.size > MAX_REMEMBERED) byId.delete(byId.keys().next().value as string);
  return ids;
}

export function recalledMatch(fileHash: string, id: string): CountMatch | undefined {
  return found.get(fileHash)?.get(id);
}
