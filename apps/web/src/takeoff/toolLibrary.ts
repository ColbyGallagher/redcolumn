import { msg } from '@nb/i18n';
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

/** What storage holds, or null when it cannot be read (no storage: the copy here is all there is). */
function read(): GroupingTool[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.flatMap((t) => sanitizeTool(t) ?? []) : [];
  } catch {
    return null;
  }
}

const load = (): GroupingTool[] => read() ?? [];

class ToolLibrary {
  private cache: GroupingTool[] | null = null;
  private listeners = new Set<() => void>();

  list(): GroupingTool[] {
    return (this.cache ??= load());
  }

  /** By id, or by name: a tool that may run before a proposed one, before a rejected one. */
  get(idOrName: string): GroupingTool | undefined {
    const wanted = idOrName.trim().toLowerCase();
    const byId = this.list().find((t) => t.id === idOrName);
    if (byId) return byId;
    const named = this.list().filter((t) => t.name.trim().toLowerCase() === wanted);
    const rank = (t: GroupingTool) => (toolRuns(t) ? 0 : t.status === 'accepted' ? 1 : t.status === 'proposed' ? 2 : 3);
    return named.sort((x, y) => rank(x) - rank(y) || y.createdAt - x.createdAt)[0];
  }

  /** Read again before each change: another window may have saved since (it shares the storage). */
  private fresh(): GroupingTool[] {
    const stored = read();
    if (stored) this.cache = stored;
    return this.list();
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
    this.save([...this.fresh().filter((t) => !same(t)), tool]);
  }

  private change(id: string, patch: (t: GroupingTool) => GroupingTool) {
    this.save(this.fresh().map((t) => (t.id === id ? patch(t) : t)));
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
    this.save(this.fresh().filter((t) => t.id !== id));
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

// Another window (desktop windows share this storage) changed the library: show its version.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) toolLibrary.reload();
  });
}

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
  if (!toolRuns(tool)) throw new Error(tool.status !== 'accepted' ? msg('“{name}” is not accepted yet: a person accepts it in Review AI Takeoff › Tools first.', { name: tool.name }) : msg('“{name}” is turned off.', { name: tool.name }));
  if (store.readOnly) throw new Error(`${documentName} is read-only.`);
  const a = tool.action;
  if (a.kind === 'zone' && a.document && a.document !== documentName) throw new Error(`“${tool.name}” groups by zones drawn on ${a.document}: they are that document's page positions, so it runs on that document only.`);
  const assignments = runTool(tool, store.all(), ruleContext(store));
  if (!assignments.length) throw new Error(`“${tool.name}” matched nothing on ${documentName}.`);
  const at = Date.now();
  const proposal: GroupingProposal = {
    id: crypto.randomUUID(),
    name: tool.column,
    type: 'choice',
    reasoning: msg('Made by the tool “{name}”: {value}', { name: tool.name, value: tool.description || msg('no description') }),
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
