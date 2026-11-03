import { useSyncExternalStore } from 'react';
import { compareParagraphs, type AiDecision, type ComparisonResult, type Paragraph } from './semantic';

/**
 * The semantic compare a person has asked an AI client to judge. The panel starts it (Document ›
 * AI Compare Documents), the client reads it with `get_comparison` and answers with
 * `report_document_changes`. Until it answers the panel shows the built-in text comparison, so the
 * person is never left waiting on a client that is not there. Kept in memory: a request lasts
 * as long as the panel does.
 */

/** How long the panel waits for an AI client before it says none answered. */
export const AI_WAIT_MS = 3 * 60 * 1000;

export interface SemanticRequest {
  id: string;
  oldId: string;
  newId: string;
  oldName: string;
  newName: string;
  old: Paragraph[];
  new: Paragraph[];
  startedAt: number;
}

/**
 * `waiting`: asked, no answer yet (the text comparison is showing). `ai`: a client answered.
 * `fallback`: it did not answer in time, or said it could not; the text comparison stands.
 */
export type SemanticPhase = 'waiting' | 'ai' | 'fallback';

export interface SemanticState {
  request: SemanticRequest;
  phase: SemanticPhase;
  /** The AI client's name, once it has answered. */
  source?: string;
  /** What the client gave up on, when it reported a failure. */
  failure?: string;
  /** The client's own summary of what changed, shown above the list. */
  summary?: string;
  decisions: AiDecision[];
  result: ComparisonResult;
}

class SemanticStore {
  private state: SemanticState | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  get = () => this.state;

  private set(next: SemanticState | null) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  /** Starts a request. The text comparison is ready at once; the AI wait starts the clock. */
  begin(request: Omit<SemanticRequest, 'id' | 'startedAt'>, waitMs = AI_WAIT_MS): SemanticState {
    clearTimeout(this.timer);
    const full: SemanticRequest = { ...request, id: crypto.randomUUID(), startedAt: Date.now() };
    const next: SemanticState = { request: full, phase: 'waiting', decisions: [], result: compareParagraphs(full.old, full.new) };
    this.set(next);
    this.timer = setTimeout(() => {
      if (this.state?.request.id === full.id && this.state.phase === 'waiting') this.set({ ...this.state, phase: 'fallback' });
    }, waitMs);
    return next;
  }

  /** An AI client's verdicts. A later verdict on the same paragraph replaces an earlier one. */
  decide(requestId: string, decisions: readonly AiDecision[], source: string, summary?: string) {
    const cur = this.state;
    if (!cur || cur.request.id !== requestId) throw new Error('That comparison is no longer open.');
    clearTimeout(this.timer);
    const touched = new Set(decisions.flatMap((d) => [d.old, d.new].filter((x): x is string => !!x)));
    const kept = cur.decisions.filter((d) => !(d.old && touched.has(d.old)) && !(d.new && touched.has(d.new)));
    const all = [...kept, ...decisions];
    this.set({ ...cur, phase: 'ai', source, failure: undefined, ...(summary ? { summary } : {}), decisions: all, result: compareParagraphs(cur.request.old, cur.request.new, all) });
  }

  /** The client could not judge it: the text comparison stands, with the reason. */
  fail(requestId: string, reason: string, source: string) {
    const cur = this.state;
    if (!cur || cur.request.id !== requestId) throw new Error('That comparison is no longer open.');
    clearTimeout(this.timer);
    this.set({ ...cur, phase: cur.decisions.length ? 'ai' : 'fallback', source, failure: reason });
  }

  clear() {
    clearTimeout(this.timer);
    if (this.state) this.set(null);
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
}

export const semanticCompare = new SemanticStore();

export function useSemanticCompare(): SemanticState | null {
  return useSyncExternalStore(semanticCompare.subscribe, semanticCompare.get);
}

/** The words a person pastes into an AI client that is not already watching for the request. */
export function aiPrompt(req: Pick<SemanticRequest, 'oldName' | 'newName'>): string {
  return [
    `In redcolumn, compare "${req.oldName}" (old) with "${req.newName}" (new) by meaning.`,
    'Call get_comparison to read the paragraphs that did not match word for word, then call report_document_changes with your verdict on each:',
    'added, removed, modified (reworded or edited), moved (same content in a new place), or unchanged (same meaning, only reformatted).',
    'Match paragraphs by meaning, not position. A paragraph that only moved, or was lightly reworded, is not an addition and a removal.',
  ].join(' ');
}
