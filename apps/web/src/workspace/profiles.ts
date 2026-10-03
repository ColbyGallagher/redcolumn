import { useSyncExternalStore } from 'react';
import { DEFAULT_STAMPS, type ColumnSet, type Markup, type MarkupStyle, type MarkupType, type StampDef } from '@nb/markup';
import type { AdvancedFilter, ColumnLayout, SortState } from '../columns/listColumns';
import type { Tool } from '../markup/MarkupTools';

/**
 * Profiles: a named arrangement of the workspace (which tools the toolbar shows, which
 * side panels are available, the tool library, the markup list's columns and filters, and default
 * custom columns and statuses). Changes are saved to the active profile as they happen; switching
 * profile swaps the whole arrangement.
 */

/** A saved tool: a markup type with its look, subject and (signatures) image. */
export interface ToolChestItem {
  id: string;
  type: MarkupType;
  style: MarkupStyle;
  label: string;
  subject?: string;
  image?: string;
  /**
   * The exact markup it was saved from (its geometry moved to the origin): the tool places copies
   * of it. Tools without one (imported, recent) draw new markups in their style.
   */
  markups?: Markup[];
  /** The page scale (metres per point) it was saved at, for tool sets that scale to the page. */
  metersPerPoint?: number;
}

export interface ToolSet {
  id: string;
  name: string;
  collapsed: boolean;
  /** Hidden from the Tool Library panel in this profile. */
  hidden?: boolean;
  /** Icon view shows tools as a grid of previews; detail view as a list with names. */
  view?: 'icon' | 'detail';
  /** Tools keep their real-world size: placed copies grow or shrink with the page's scale. */
  scaleToPage?: boolean;
  items: ToolChestItem[];
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: Record<string, string>;
}

export interface MarkupListSettings {
  columns: ColumnLayout[];
  sort: SortState | null;
  /** Filter text per column key. */
  filters: Record<string, string>;
  showFilterRow: boolean;
  savedFilters: SavedFilter[];
  /** Filter builder rules, applied together with the column filters. */
  advanced: AdvancedFilter | null;
  /** Column the list is grouped by, or null. */
  groupBy: string | null;
}

export interface WorkspaceState {
  toolChests: ToolSet[];
  /** Tools the toolbar shows; null shows all. */
  toolbarTools: Tool[] | null;
  /** Side panels hidden from the panel rail and Window menu. */
  hiddenPanels: string[];
  showToolbar: boolean;
  list: MarkupListSettings;
  /** Custom columns and statuses given to documents that have none of their own. */
  columnTemplate: ColumnSet | null;
  /** Keyboard shortcuts changed from the defaults, by command id (see commands/keys.ts). */
  shortcuts: Record<string, readonly string[]>;
  /** The user's own stamps (the built-in ones are always there too). */
  stamps: StampDef[];
  /** The stamp the Stamp tool places when none is chosen. */
  lastStampId: string | null;
}

export interface Profile {
  id: string;
  name: string;
  state: WorkspaceState;
}

const RECENT_ID = 'recent';
export const RECENT_TOOLS_ID = RECENT_ID;
const RECENT_LIMIT = 12;

export function defaultWorkspace(): WorkspaceState {
  return {
    toolChests: [
      { id: RECENT_ID, name: 'Recent Tools', collapsed: false, view: 'icon', items: [] },
      { id: crypto.randomUUID(), name: 'My Tools', collapsed: false, view: 'icon', items: [] },
    ],
    toolbarTools: null,
    hiddenPanels: [],
    showToolbar: true,
    list: { columns: [], sort: null, filters: {}, showFilterRow: false, savedFilters: [], advanced: null, groupBy: null },
    columnTemplate: null,
    shortcuts: {},
    stamps: [],
    lastStampId: null,
  };
}

const KEY = 'nb.profiles';

interface Saved {
  profiles: Profile[];
  activeId: string;
}

/** Fills fields added since a profile was saved. */
function upgrade(state: Partial<WorkspaceState>): WorkspaceState {
  const d = defaultWorkspace();
  return { ...d, ...state, list: { ...d.list, ...state.list } };
}

function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (saved?.profiles?.length) {
      // The first profile used to be called 'Revu'.
      const profiles = saved.profiles.map((p) => ({ ...p, name: p.name === 'Revu' ? 'Default' : p.name, state: upgrade(p.state) }));
      return { profiles, activeId: profiles.some((p) => p.id === saved.activeId) ? saved.activeId : profiles[0]!.id };
    }
  } catch {
    // Corrupt or unavailable storage: start from the default profile.
  }
  const id = crypto.randomUUID();
  return { profiles: [{ id, name: 'Default', state: defaultWorkspace() }], activeId: id };
}

let saved = load();
const listeners = new Set<() => void>();

function commit(next: Saved) {
  saved = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Not persisted; the profile still applies for this visit.
  }
  listeners.forEach((l) => l());
}

export const profiles = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => saved,
  active: (): Profile => saved.profiles.find((p) => p.id === saved.activeId)!,
  /** Changes the active profile's workspace. */
  update(fn: (s: WorkspaceState) => WorkspaceState) {
    const active = profiles.active();
    commit({ ...saved, profiles: saved.profiles.map((p) => (p === active ? { ...p, state: fn(p.state) } : p)) });
  },
  switchTo(id: string) {
    if (saved.profiles.some((p) => p.id === id)) commit({ ...saved, activeId: id });
  },
  /** A new profile starting from a copy of the current workspace (or the defaults), made active. */
  create(name: string, from: 'current' | 'default' = 'current'): Profile {
    const state = from === 'current' ? structuredClone(profiles.active().state) : defaultWorkspace();
    const p: Profile = { id: crypto.randomUUID(), name, state };
    commit({ profiles: [...saved.profiles, p], activeId: p.id });
    return p;
  },
  rename(id: string, name: string) {
    commit({ ...saved, profiles: saved.profiles.map((p) => (p.id === id ? { ...p, name } : p)) });
  },
  remove(id: string) {
    if (saved.profiles.length < 2) return;
    const rest = saved.profiles.filter((p) => p.id !== id);
    commit({ profiles: rest, activeId: saved.activeId === id ? rest[0]!.id : saved.activeId });
  },
  /** A profile as a JSON file to share. */
  exportJson(id: string): string {
    const p = saved.profiles.find((x) => x.id === id)!;
    return JSON.stringify({ format: 'nb-profile', version: 1, name: p.name, state: p.state }, null, 2);
  },
  importJson(text: string): Profile {
    const data = JSON.parse(text) as { format?: string; name?: string; state?: Partial<WorkspaceState> };
    if (data.format !== 'nb-profile' || !data.state) throw new Error('This is not a profile file.');
    const p: Profile = { id: crypto.randomUUID(), name: data.name || 'Imported profile', state: upgrade(data.state) };
    commit({ profiles: [...saved.profiles, p], activeId: p.id });
    return p;
  },
};

export function useProfiles(): Saved {
  return useSyncExternalStore(profiles.subscribe, profiles.get);
}

export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore(profiles.subscribe, () => profiles.active().state);
}

export const updateWorkspace = profiles.update;

// --- tool library helpers ---------------------------------------------------------------------

export function addToToolSet(setId: string, item: Omit<ToolChestItem, 'id'>) {
  updateWorkspace((s) => ({
    ...s,
    toolChests: s.toolChests.map((t) => (t.id === setId ? { ...t, collapsed: false, items: [...t.items, { ...item, id: crypto.randomUUID() }] } : t)),
  }));
}

export function createToolSet(name: string): string {
  const id = crypto.randomUUID();
  updateWorkspace((s) => ({ ...s, toolChests: [...s.toolChests, { id, name, collapsed: false, view: 'icon', items: [] }] }));
  return id;
}

/** Remembers a just-used tool look in Recent Tools (most recent first, no duplicates). */
export function rememberRecentTool(item: Omit<ToolChestItem, 'id'>) {
  const same = (a: Omit<ToolChestItem, 'id'>) => a.type === item.type && a.subject === item.subject && JSON.stringify(a.style) === JSON.stringify(item.style);
  updateWorkspace((s) => {
    const recent = s.toolChests.find((t) => t.id === RECENT_ID);
    if (!recent) return s;
    if (recent.items[0] && same(recent.items[0])) return s;
    const items = [{ ...item, id: crypto.randomUUID() }, ...recent.items.filter((i) => !same(i))].slice(0, RECENT_LIMIT);
    return { ...s, toolChests: s.toolChests.map((t) => (t === recent ? { ...t, items } : t)) };
  });
}

// --- stamps ---------------------------------------------------------------------------------

/** Every stamp this profile can place: the built-in ones, then the user's own. */
export function stampLibrary(state: WorkspaceState): StampDef[] {
  return [...DEFAULT_STAMPS, ...state.stamps];
}
