import { useSyncExternalStore } from 'react';
import { runTool, sanitizeTool, toolRuns, type GroupingProposal, type GroupingTool, type MarkupStore } from '@nb/markup';
import { ruleContext } from './groupingColumns';

/**
 * The grouping tool library: declarative rules an AI client proposed ("doors by fire rating",
 * "by level from the sheet title", "inside a zone"), kept on this machine for every takeoff. A
 * person accepts, edits, turns off or deletes each one. Only accepted, enabled tools run, and a run
 * only proposes a grouping column for review: it never changes the drawing or a quantity by itself.
 * Deleting a tool leaves the groupings it already made as they are.
 */

const KEY = 'nb.groupingTools';

function load(): GroupingTool[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.flatMap((t) => sanitizeTool(t) ?? []) : [];
  } catch {
    return [];
  }
}

class ToolLibrary {
  private cache: GroupingTool[] | null = null;
  private listeners = new Set<() => void>();

  list(): GroupingTool[] {
    return (this.cache ??= load());
  }

  get(idOrName: string): GroupingTool | undefined {
    const wanted = idOrName.trim().toLowerCase();
    return this.list().find((t) => t.id === idOrName) ?? this.list().find((t) => t.name.trim().toLowerCase() === wanted);
  }

  private save(list: GroupingTool[]) {
    this.cache = list;
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      // Kept for this visit only.
    }
    this.listeners.forEach((l) => l());
  }

  /** Adds an AI client's tool, waiting for a person. One with the same name that is still proposed is replaced. */
  propose(tool: GroupingTool) {
    const same = (t: GroupingTool) => t.status === 'proposed' && t.name.trim().toLowerCase() === tool.name.trim().toLowerCase();
    this.save([...this.list().filter((t) => !same(t)), tool]);
  }

  private change(id: string, patch: (t: GroupingTool) => GroupingTool) {
    this.save(this.list().map((t) => (t.id === id ? patch(t) : t)));
  }

  accept(id: string, by: string) {
    this.change(id, (t) => ({ ...t, status: 'accepted', decided: { by, at: Date.now() } }));
  }

  reject(id: string, by: string) {
    this.change(id, (t) => ({ ...t, status: 'rejected', decided: { by, at: Date.now() } }));
  }

  setDisabled(id: string, disabled: boolean) {
    this.change(id, ({ disabled: _d, ...t }) => (disabled ? { ...t, disabled: true } : t));
  }

  /** A person's edit. The rule is checked again; an edited proposal still needs accepting. */
  edit(id: string, patch: Partial<Pick<GroupingTool, 'name' | 'description' | 'column' | 'filter' | 'action'>>) {
    this.change(id, (t) => sanitizeTool({ ...t, ...patch }) ?? t);
  }

  delete(id: string) {
    this.save(this.list().filter((t) => t.id !== id));
  }

  recordUse(id: string, use: NonNullable<GroupingTool['uses']>[number]) {
    this.change(id, (t) => ({ ...t, uses: [...(t.uses ?? []), use].slice(-200) }));
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  /** Forgets the cache (tests, and another window changing storage). */
  reload() {
    this.cache = null;
    this.listeners.forEach((l) => l());
  }
}

export const toolLibrary = new ToolLibrary();

export function useToolLibrary(): GroupingTool[] {
  return useSyncExternalStore(toolLibrary.subscribe, () => toolLibrary.list());
}

/**
 * Runs an accepted tool on a document: the grouping it makes waits in Review AI Takeoff as a
 * grouping column, recorded against the tool (and the tool's use against it). Throws when the
 * tool may not run or groups nothing.
 */
/** `ai`: the AI client that ran it (over MCP), when not the person. */
export function runToolOn(store: MarkupStore, tool: GroupingTool, by: string, documentName: string, ai?: string): GroupingProposal {
  if (!toolRuns(tool)) throw new Error(tool.status !== 'accepted' ? `“${tool.name}” is not accepted yet: a person accepts it in Review AI Takeoff › Tools first.` : `“${tool.name}” is turned off.`);
  if (store.readOnly) throw new Error(`${documentName} is read-only.`);
  const assignments = runTool(tool, store.all(), ruleContext(store));
  if (!assignments.length) throw new Error(`“${tool.name}” matched nothing on ${documentName}.`);
  const at = Date.now();
  const proposal: GroupingProposal = {
    id: crypto.randomUUID(),
    name: tool.column,
    type: 'choice',
    reasoning: `Made by the tool “${tool.name}”: ${tool.description || 'no description'}`,
    source: ai ?? by,
    createdAt: at,
    status: 'proposed',
    assignments,
    toolUse: { toolId: tool.id, toolName: tool.name, at, by },
  };
  store.changeAiReview({ columns: [proposal] }, !!ai);
  toolLibrary.recordUse(tool.id, { documentName, proposalId: proposal.id, at, markups: assignments.length });
  return proposal;
}
