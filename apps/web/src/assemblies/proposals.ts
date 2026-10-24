import { useSyncExternalStore } from 'react';
import type { Markup, MarkupStore, TakeoffApproval } from '@nb/markup';

/**
 * Takeoff proposals: an AI client (through the local MCP server) suggests the assembly for a
 * measurement, with its reasoning, and a person approves or rejects each one in Takeoff Review.
 * Proposals are kept apart from the document, on this device, until approved: nothing reaches the
 * takeoff until a person approves it. An approval is written onto the measurement (its assembly,
 * and a record of who approved which proposal, when), so it saves with the document and undoes
 * like any edit. Rejections stay here.
 */

export interface ProposedQuantity {
  item: string;
  quantity: number;
  unit?: string;
}

export interface TakeoffProposal {
  id: string;
  markupId: string;
  assemblyId: string;
  /** Why the AI chose this assembly for this measurement. */
  reasoning: string;
  /** The quantities the AI expects, to check against what the assembly works out. */
  expected?: ProposedQuantity[];
  /** Who proposed it: the AI client's name. */
  source: string;
  createdAt: number;
  /** Set when a person rejects it (approvals are on the measurement). */
  rejected?: { by: string; at: number };
}

export type ProposalState = 'pending' | 'approved' | 'rejected';

const KEY = (fileHash: string) => `nb.takeoffProposals.${fileHash}`;

function load(fileHash: string): TakeoffProposal[] {
  try {
    const raw = localStorage.getItem(KEY(fileHash));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list.filter((p) => p && typeof p.id === 'string' && typeof p.markupId === 'string' && typeof p.assemblyId === 'string') as TakeoffProposal[]) : [];
  } catch {
    return [];
  }
}

/** Proposals by document (its file hash), kept in this browser's storage. */
class ProposalStore {
  private cache = new Map<string, TakeoffProposal[]>();
  private listeners = new Set<() => void>();

  list(fileHash: string): TakeoffProposal[] {
    let list = this.cache.get(fileHash);
    if (!list) this.cache.set(fileHash, (list = load(fileHash)));
    return list;
  }

  private save(fileHash: string, list: TakeoffProposal[]) {
    this.cache.set(fileHash, list);
    try {
      localStorage.setItem(KEY(fileHash), JSON.stringify(list));
    } catch {
      // Kept for this visit only.
    }
    this.listeners.forEach((l) => l());
  }

  /** Adds proposals. A new one for a measurement replaces its older pending one. */
  add(fileHash: string, proposals: TakeoffProposal[]) {
    const fresh = new Set(proposals.map((p) => p.markupId));
    this.save(fileHash, [...this.list(fileHash).filter((p) => p.rejected || !fresh.has(p.markupId)), ...proposals]);
  }

  reject(fileHash: string, ids: readonly string[], by: string) {
    const at = Date.now();
    this.save(
      fileHash,
      this.list(fileHash).map((p) => (ids.includes(p.id) ? { ...p, rejected: { by, at } } : p)),
    );
  }

  /** Takes a rejection back (it is pending again). */
  reopen(fileHash: string, ids: readonly string[]) {
    this.save(
      fileHash,
      this.list(fileHash).map((p) => (ids.includes(p.id) ? { ...p, rejected: undefined } : p)),
    );
  }

  /** Forgets decided proposals. */
  clearDecided(fileHash: string, store: MarkupStore) {
    this.save(fileHash, this.list(fileHash).filter((p) => stateOf(p, store.get(p.markupId)) === 'pending'));
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
}

export const takeoffProposals = new ProposalStore();

export function useTakeoffProposals(fileHash: string | null): TakeoffProposal[] {
  return useSyncExternalStore(takeoffProposals.subscribe, () => (fileHash ? takeoffProposals.list(fileHash) : NONE));
}
const NONE: TakeoffProposal[] = [];

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
  store.checkpoint();
  store.batch(() => {
    for (const p of proposals) {
      const m = store.get(p.markupId);
      if (!m || m.locked || store.readOnly) {
        skipped.push(p.id);
        continue;
      }
      const edit = edits[p.id] ?? {};
      const assemblyId = edit.assemblyId ?? p.assemblyId;
      const overrides = edit.overrides && Object.keys(edit.overrides).length ? edit.overrides : undefined;
      const approval: TakeoffApproval = { by, at, proposalId: p.id, source: p.source, ...(p.reasoning ? { reasoning: p.reasoning } : {}), ...(assemblyId !== p.assemblyId || overrides ? { edited: true } : {}) };
      store.update(m.id, { assemblyId, assemblyOverrides: overrides, takeoffApproval: approval });
      if (store.get(m.id)?.takeoffApproval?.proposalId === p.id) approved.push(p.id);
      else skipped.push(p.id);
    }
  });
  return { approved, skipped };
}
