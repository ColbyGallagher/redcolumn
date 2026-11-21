import { useSyncExternalStore } from 'react';
import { sanitizeAiReview, type Markup, type MarkupStore, type TakeoffApproval, type TakeoffProposal } from '@nb/markup';

/**
 * Takeoff proposals: an AI client (through the local MCP server) suggests the assembly for a
 * measurement, with its reasoning, and a person approves or rejects each one in Review AI Takeoff.
 * Proposals are kept in the document (`MarkupStore.aiReview`), so they save with the file and
 * everyone in a Live Session reviews the same list; nothing reaches the takeoff until a person
 * approves it. An approval is written onto the measurement (its assembly, and a record of who
 * approved which proposal, when), so it undoes like any edit. Rejections stay in the list.
 */

export type { ProposedQuantity, TakeoffProposal } from '@nb/markup';

export type ProposalState = 'pending' | 'approved' | 'rejected';

/** Proposals by document. AI clients add them; a person's decisions are undoable edits. */
export const takeoffProposals = {
  list(store: MarkupStore): TakeoffProposal[] {
    return store.aiReview().takeoff;
  },

  /** Adds proposals. A new one for a measurement replaces its older pending one. */
  add(store: MarkupStore, proposals: TakeoffProposal[]) {
    const fresh = new Set(proposals.map((p) => p.markupId));
    const stale = this.list(store).filter((p) => !p.rejected && fresh.has(p.markupId) && stateOf(p, store.get(p.markupId)) === 'pending');
    store.changeAiReview({ takeoff: proposals, remove: { takeoff: stale.map((p) => p.id) } }, true);
  },

  reject(store: MarkupStore, ids: readonly string[], by: string) {
    const at = Date.now();
    store.changeAiReview({ takeoff: this.list(store).filter((p) => ids.includes(p.id)).map((p) => ({ ...p, rejected: { by, at } })) });
  },

  /** Takes a rejection back (it is pending again). */
  reopen(store: MarkupStore, ids: readonly string[]) {
    store.changeAiReview({ takeoff: this.list(store).filter((p) => ids.includes(p.id)).map(({ rejected: _r, ...p }) => p) });
  },

  /** Forgets decided proposals. */
  clearDecided(store: MarkupStore) {
    store.changeAiReview({ remove: { takeoff: this.list(store).filter((p) => stateOf(p, store.get(p.markupId)) !== 'pending').map((p) => p.id) } });
  },
};

const NONE: TakeoffProposal[] = [];
const noop = () => () => {};

export function useTakeoffProposals(store: MarkupStore | null): TakeoffProposal[] {
  return useSyncExternalStore(store ? (l) => store.subscribe(l) : noop, () => (store ? store.aiReview().takeoff : NONE));
}

/** Approved when the measurement carries this proposal's approval (so an undo makes it pending again). */
export function stateOf(p: TakeoffProposal, m: Markup | undefined): ProposalState {
  if (m?.takeoffApproval?.proposalId === p.id) return 'approved';
  return p.rejected ? 'rejected' : 'pending';
}

/** What the person changed before approving. */
export interface ApprovalEdit {
  /** Another assembly than the AI proposed. */
  assemblyId?: string;
  /** Per assembly item id, the quantity (before waste) set by hand. */
  overrides?: Record<string, number>;
}

/**
 * Approves proposals as one undo step: each measurement gets its assembly (and any quantities set
 * by hand) and a record of the approval. Proposals whose measurement is gone or locked are skipped
 * and returned.
 */
export function approveProposals(store: MarkupStore, proposals: readonly TakeoffProposal[], by: string, edits: Readonly<Record<string, ApprovalEdit>> = {}): { approved: string[]; skipped: string[] } {
  const approved: string[] = [];
  const skipped: string[] = [];
  const at = Date.now();
  const exists = new Set(store.assemblies().map((a) => a.id));
  store.checkpoint();
  store.batch(() => {
    for (const p of proposals) {
      const m = store.get(p.markupId);
      const edit = edits[p.id] ?? {};
      const assemblyId = edit.assemblyId ?? p.assemblyId;
      // An assembly deleted since it was proposed cannot be approved: choose another first.
      if (!m || m.locked || store.readOnly || !exists.has(assemblyId)) {
        skipped.push(p.id);
        continue;
      }
      const overrides = edit.overrides && Object.keys(edit.overrides).length ? edit.overrides : undefined;
      const approval: TakeoffApproval = {
        by,
        at,
        proposalId: p.id,
        source: p.source,
        ...(p.reasoning ? { reasoning: p.reasoning } : {}),
        ...(assemblyId !== p.assemblyId || overrides ? { edited: true } : {}),
        ...(assemblyId !== p.assemblyId ? { proposedAssemblyId: p.assemblyId } : {}),
        ...(p.confidence !== undefined ? { confidence: p.confidence } : {}),
      };
      store.update(m.id, { assemblyId, assemblyOverrides: overrides, takeoffApproval: approval });
      if (store.get(m.id)?.takeoffApproval?.proposalId === p.id) approved.push(p.id);
      else skipped.push(p.id);
    }
  });
  return { approved, skipped };
}

/**
 * Proposals from before they were kept in the document lived in this browser's storage: they move
 * into the document once, the first time it is opened here and can be edited.
 */
export function migrateLocalProposals(store: MarkupStore) {
  if (store.readOnly) return;
  const take = (key: string): unknown[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      localStorage.removeItem(key);
      const list = JSON.parse(raw) as unknown;
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const takeoff = take(`nb.takeoffProposals.${store.fileHash}`);
  const counts = take(`nb.countProposals.${store.fileHash}`);
  if (!takeoff.length && !counts.length) return;
  const known = store.aiReview();
  const have = new Set([...known.takeoff, ...known.counts].map((p) => p.id));
  // Checked like a file's or a peer's: anything malformed is dropped.
  const keep = <T extends { id: string }>(list: T[]) => list.filter((p) => !have.has(p.id));
  const checked = sanitizeAiReview({ takeoff, counts });
  store.changeAiReview({ takeoff: keep(checked.takeoff), counts: keep(checked.counts) }, true);
}
