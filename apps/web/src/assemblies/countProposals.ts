import { useSyncExternalStore } from 'react';
import { DEFAULT_STYLES, type CountMatch, type CountProposal, type Markup, type MarkupDocument, type AiReviewFacet } from '@nb/markup';
import { centreOf, countsFromHits } from '../search/countFromHits';

/**
 * Count proposals: an AI client (through the local MCP server) finds repeats of an example symbol
 * with `find_symbol_matches` and stages them with `propose_counts`. A person reviews each proposal
 * in Review AI Takeoff. Nothing is placed until they approve; approving places Count markups with the
 * proposal's subject as one undo step. Proposals are kept in the document until then.
 * redcolumn never calls a language model: the matching is the app's own symbol search.
 */

export type { CountMatch, CountProposal } from '@nb/markup';
export type MatchRect = CountMatch['rect'];

export type CountProposalState = 'pending' | 'approved' | 'rejected';

/** Count proposals by document (`MarkupStore.aiReview`). AI clients add them; a person's decisions are undoable edits. */
export const countProposals = {
  list(store: MarkupDocument & AiReviewFacet): CountProposal[] {
    return store.aiReview().counts;
  },

  add(store: MarkupDocument & AiReviewFacet, proposal: CountProposal) {
    store.changeAiReview({ counts: [proposal] }, true);
  },

  update(store: MarkupDocument & AiReviewFacet, id: string, patch: (p: CountProposal) => CountProposal) {
    const p = this.list(store).find((x) => x.id === id);
    if (p) store.changeAiReview({ counts: [patch(p)] });
  },

  reject(store: MarkupDocument & AiReviewFacet, id: string, by: string) {
    this.update(store, id, (p) => ({ ...p, rejected: { by, at: Date.now() } }));
  },

  reopen(store: MarkupDocument & AiReviewFacet, id: string) {
    this.update(store, id, ({ rejected: _r, ...p }) => p);
  },

  /** Forgets decided proposals. */
  clearDecided(store: MarkupDocument & AiReviewFacet) {
    store.changeAiReview({ remove: { counts: this.list(store).filter((p) => countStateOf(p, store) !== 'pending').map((p) => p.id) } });
  },
};

const NONE: CountProposal[] = [];
const noop = () => () => {};
export function useCountProposals(store: (MarkupDocument & AiReviewFacet) | null): CountProposal[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noop, () => (store ? store.aiReview().counts : NONE));
}

/** Approved while its Count markups are on the drawing (an undo makes it pending again). */
export function countStateOf(p: CountProposal, store: MarkupDocument & AiReviewFacet): CountProposalState {
  if (p.placed && p.placed.markupIds.length && p.placed.markupIds.every((id) => store.get(id))) return 'approved';
  return p.rejected ? 'rejected' : 'pending';
}

/**
 * Approves a proposal: one Count markup per page, holding a point per kept match, as one undo
 * step. `skip` are indexes into `p.matches` the person turned off. Returns the number placed, or
 * 0 when nothing could be (read-only drawing, or every match turned off).
 */
export function approveCountProposal(store: MarkupDocument & AiReviewFacet, p: CountProposal, by: string, skip: ReadonlySet<number> = new Set()): number {
  if (store.readOnly) return 0;
  const hits = p.matches.flatMap((m, i) => (skip.has(i) ? [] : [{ pageIndex: m.pageIndex, point: centreOf(m.rect) }]));
  if (!hits.length) return 0;
  const now = Date.now();
  // Each count says it came from the AI and who approved it, so a person's later changes show against it.
  const made: Markup[] = countsFromHits(hits, {
    base: { status: 'none', author: by, createdAt: now, modifiedAt: now },
    style: DEFAULT_STYLES.count,
    subject: p.subject,
  }).map((m) => ({
    ...m,
    ai: { source: p.source, at: p.createdAt, status: 'approved', reasoning: p.reasoning, ...(p.confidence !== undefined ? { confidence: p.confidence } : {}), ...(p.sources ? { sources: p.sources } : {}), original: { points: m.points.map((q) => [q[0], q[1]]), subject: p.subject }, review: { by, at: now } },
  }));
  store.checkpoint();
  // One undo step: the markups and the record of which proposal placed them.
  store.batch(() => {
    made.forEach((m) => store.add(m));
    countProposals.update(store, p.id, (x) => ({ ...x, placed: { by, at: now, markupIds: made.map((m) => m.id), count: hits.length } }));
  });
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
