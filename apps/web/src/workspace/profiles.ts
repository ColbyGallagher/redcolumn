import { msg } from '@nb/i18n';
import type { RegisterTemplate } from '../sheetsync/register';
import { useSyncExternalStore } from 'react';
import { DEFAULT_LINE_SETS, DEFAULT_STAMPS, type BookmarkTemplate, type ColumnSet, type CountSymbol, type HatchSet, type LineSet, type Markup, type MarkupStyle, type MarkupType, type RevuToolSource, type StampDef } from '@nb/markup';
import type { AdvancedFilter, ColumnLayout, SortState } from '../columns/listColumns';
import type { Tool } from '../markup/MarkupTools';
import type { TaughtMark } from '../sheets/marks';
import type { DrawingStandard } from '../sheets/standards';
import { cleanCustomColors } from './customColors';

/**
 * Profiles: a named arrangement of the workspace (which tools the toolbar shows, which
 * side panels are available and which side of the window each is docked on, the tool library, the markup list's columns and filters, and default
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
  /** The Label (category) its markups take; `label` above is the tool's own name. */
  markupLabel?: string;
  /** The comment its markups take (Revu's Comment column), for markups with no text of their own. */
  comment?: string;
  /** The markup layer its markups go on. */
  layer?: string;
  image?: string;
  /**
   * The exact markup it was saved from (its geometry moved to the origin): the tool places copies
   * of it. Tools without one (imported, recent) draw new markups in their style.
   */
  markups?: Markup[];
  /**
   * How clicking a tool with saved `markups` uses it: `copy` places the exact markup, `style` draws
   * new markups in its look. Set from the tool's right-click menu; unset follows Preferences.
   */
  mode?: 'copy' | 'style';
  /** The page scale (metres per point) it was saved at, for tool sets that scale to the page. */
  metersPerPoint?: number;
  /** Drawn with the Cloud+ tool (a cloud, then a callout): `type` is its cloud. */
  tool?: 'cloudPlus';
  /** Each placed copy's number goes on from the last one in the document (a numbered circle). */
  sequence?: { start: number; increment: number };
  /** The tool as a Revu tool set stored it: exported back to a .btx unchanged unless restyled. */
  revu?: RevuToolSource;
}

/** A markup script (see scripts/script.ts): its name and text. */
export interface SavedScript {
  id: string;
  name: string;
  source: string;
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
  /** The trade pack it was added from (its library id, or its name for a pack file): adding the pack again replaces it. */
  pack?: string;
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
  /** Comments wrap to show all their text (rows grow to fit); off, every row is one line high. */
  wrapComments: boolean;
  /** The Status column lists every status change ('all', as Bluebeam does) or only the latest. */
  statusHistory?: 'all' | 'latest';
  /** The Status column says who set each status and when. */
  statusDetails?: boolean;
  /** An icon for the markup's type (cloud, arrow...) beside its subject. */
  typeIcons?: boolean;
}

export interface WorkspaceState {
  toolChests: ToolSet[];
  /** Tools the toolbar shows; null shows all. */
  toolbarTools: Tool[] | null;
  /** Side panels hidden from the panel rail and Window menu. */
  hiddenPanels: string[];
  /** Order of the panel rail (panel ids); panels not listed follow in their default order. */
  panelOrder: string[];
  /** Panels docked on the right-hand side of the window; the rest sit on the left. */
  rightPanels: string[];
  /** Panels that start on the right (RIGHT_BY_DEFAULT) already placed there once, so moving one left sticks. */
  placedPanels: string[];
  /** The Markups list is docked in a side panel (the side is `rightPanels`') instead of the bottom dock. */
  markupsDocked: boolean;
  showToolbar: boolean;
  /** The top toolbar: a ribbon of tabs (Word, AutoCAD) or the one-row simplified toolbar. */
  toolbarStyle: ToolbarStyle;
  /** The ribbon shows only its tabs until one is clicked. */
  ribbonCollapsed: boolean;
  /** The Markups list spans the window's width, under the side panel too, rather than sitting beside it. */
  dockFullWidth: boolean;
  list: MarkupListSettings;
  /** Custom columns and statuses given to documents that have none of their own. */
  columnTemplate: ColumnSet | null;
  /** Keyboard shortcuts changed from the defaults, by command id (see commands/keys.ts). */
  shortcuts: Record<string, readonly string[]>;
  /** The user's own stamps (the built-in ones are always there too). */
  stamps: StampDef[];
  /** The stamp the Stamp tool places when none is chosen. */
  lastStampId: string | null;
  /** Imported Revu line style sets (.blx), offered in the Line style pickers. */
  lineSets: LineSet[];
  /** Markup scripts saved from Tools › Scripts (kept on this device, with the profile). */
  scripts?: SavedScript[];
  /** Imported Revu hatch sets (.bhx), offered in the Hatch pickers. */
  hatchSets: HatchSet[];
  /** Imported Revu bookmark templates, offered in the Bookmarks panel (the built-in one is always there). */
  bookmarkTemplates: BookmarkTemplate[];
  /** Section marks, titles and detail callouts the user taught, found in every set to suggest links (kept on this device). */
  taughtMarks: TaughtMark[];
  /** Clients' drawing standards (title block, drawing numbers), chosen per document (kept on this device; shared as files). */
  drawingStandards: DrawingStandard[];
  /** Comment register templates, one per client (kept on this device; shared as files). */
  registerTemplates?: RegisterTemplate[];
  /** Colors saved from the color pickers' "More colors…" (#rrggbb, newest first). */
  customColors?: string[];
  /** Custom Count tool symbols saved by the user (vector markups or pictures). */
  countSymbols?: CountSymbol[];
}

export type ToolbarStyle = 'simplified' | 'ribbon';

export interface Profile {
  id: string;
  name: string;
  state: WorkspaceState;
}

const RECENT_ID = 'recent';
export const RECENT_TOOLS_ID = RECENT_ID;
const RECENT_LIMIT = 12;

/** The toolbar a new profile starts with; the rest are added from the toolbar's right-click menu. */
export const DEFAULT_TOOLBAR_TOOLS: Tool[] = ['line', 'polyline', 'rect', 'ellipse', 'cloud', 'cloudPlus', 'pen', 'highlighter', 'text', 'callout', 'stamp'];

/** Panels that start docked on the right: the 3D model's properties and display controls sit opposite its tree. */
export const RIGHT_BY_DEFAULT: readonly string[] = ['model3dProps', 'model3dDisplay'];

export function defaultWorkspace(): WorkspaceState {
  return {
    toolChests: [
      { id: RECENT_ID, name: 'Recent Tools', collapsed: false, view: 'icon', items: [] },
      { id: crypto.randomUUID(), name: 'My Tools', collapsed: false, view: 'icon', items: [] },
    ],
    toolbarTools: [...DEFAULT_TOOLBAR_TOOLS],
    hiddenPanels: [],
    panelOrder: [],
    rightPanels: [...RIGHT_BY_DEFAULT],
    placedPanels: [...RIGHT_BY_DEFAULT],
    markupsDocked: false,
    showToolbar: true,
    toolbarStyle: 'ribbon',
    ribbonCollapsed: false,
    dockFullWidth: false,
    list: { columns: [], sort: null, filters: {}, showFilterRow: false, savedFilters: [], advanced: null, groupBy: null, wrapComments: true, statusHistory: 'all', statusDetails: true, typeIcons: true },
    columnTemplate: null,
    shortcuts: {},
    stamps: [],
    lastStampId: null,
    lineSets: [],
    hatchSets: [],
    bookmarkTemplates: [],
    taughtMarks: [],
    drawingStandards: [],
    countSymbols: [],
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
  const next: WorkspaceState = { ...d, ...state, list: { ...d.list, ...state.list } };
  // Panels added since the profile was saved that start on the right go there, once.
  const placed = state.placedPanels ?? [];
  const newRight = RIGHT_BY_DEFAULT.filter((id) => !placed.includes(id));
  if (newRight.length) {
    next.rightPanels = [...(state.rightPanels ?? []).filter((id) => !newRight.includes(id)), ...newRight];
    next.placedPanels = [...placed, ...newRight];
  }
  if ('customColors' in state) next.customColors = cleanCustomColors(state.customColors);
  return next;
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
let persisted = true;
const listeners = new Set<() => void>();

/** Saves the profiles. False when the browser would not keep them (storage full or blocked): they still apply for this visit. */
function commit(next: Saved): boolean {
  saved = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
    persisted = true;
  } catch {
    // Not persisted; the profile still applies for this visit.
    persisted = false;
  }
  listeners.forEach((l) => l());
  return persisted;
}

export const profiles = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => saved,
  active: (): Profile => saved.profiles.find((p) => p.id === saved.activeId)!,
  /** Changes the active profile's workspace. */
  update(fn: (s: WorkspaceState) => WorkspaceState): boolean {
    const active = profiles.active();
    return commit({ ...saved, profiles: saved.profiles.map((p) => (p === active ? { ...p, state: fn(p.state) } : p)) });
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
  /** Every profile, for the cloud backup. */
  exportAll(): string {
    return JSON.stringify({ format: 'nb-profiles', version: 1, savedAt: new Date().toISOString(), activeId: saved.activeId, profiles: saved.profiles }, null, 2);
  },
  /** Brings in a cloud backup: its profiles replace ones with the same ID and the rest are kept. Returns how many came in. */
  importAll(text: string): number {
    const data = JSON.parse(text) as { format?: string; activeId?: string; profiles?: Profile[] };
    if (data.format !== 'nb-profiles' || !Array.isArray(data.profiles) || !data.profiles.length) throw new Error(msg('This is not a profile backup.'));
    const incoming = data.profiles.map((p) => ({ id: p.id, name: p.name, state: upgrade(p.state) }));
    const ids = new Set(incoming.map((p) => p.id));
    const kept = saved.profiles.filter((p) => !ids.has(p.id));
    commit({ profiles: [...kept, ...incoming], activeId: incoming.some((p) => p.id === data.activeId) ? data.activeId! : incoming[0]!.id });
    return incoming.length;
  },
  /** A new profile with `state` laid over the defaults; `activate` makes it the active one. */
  add(name: string, state: Partial<WorkspaceState>, activate = true): Profile {
    const p: Profile = { id: crypto.randomUUID(), name, state: upgrade(state) };
    commit({ profiles: [...saved.profiles, p], activeId: activate ? p.id : saved.activeId });
    return p;
  },
  importJson(text: string): Profile {
    const data = JSON.parse(text) as { format?: string; name?: string; state?: Partial<WorkspaceState> };
    if (data.format !== 'nb-profile' || !data.state) throw new Error(msg('This is not a profile file.'));
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

// --- line styles ----------------------------------------------------------------------------

/** Every line style set this profile offers: the built-in ones, then the imported ones. */
export function lineSetLibrary(state: WorkspaceState): LineSet[] {
  return [...DEFAULT_LINE_SETS, ...state.lineSets];
}

// --- count symbols --------------------------------------------------------------------------

/** Saved custom count symbols in this profile. */
export function countSymbolLibrary(state: WorkspaceState): CountSymbol[] {
  return state.countSymbols ?? [];
}

/** Saves a custom count symbol into the active profile. Rolls back and returns false if storage is full. */
export function addCountSymbol(symbol: CountSymbol): boolean {
  let previous: CountSymbol[] | undefined;
  const kept = updateWorkspace((w) => {
    previous = w.countSymbols;
    const list = w.countSymbols ?? [];
    const taken = new Set(list.map((s) => s.name));
    let name = symbol.name.trim() || 'Custom Symbol';
    for (let n = 2; taken.has(name); n++) name = `${symbol.name.trim() || 'Custom Symbol'} (${n})`;
    const next = name === symbol.name ? symbol : { ...symbol, name };
    return { ...w, countSymbols: [...list, next] };
  });
  if (!kept && previous !== undefined) updateWorkspace((w) => ({ ...w, countSymbols: previous }));
  return kept;
}

/** Renames or updates a saved custom count symbol in the active profile. */
export function updateCountSymbol(id: string, patch: Partial<Pick<CountSymbol, 'name'>>) {
  updateWorkspace((w) => ({
    ...w,
    countSymbols: (w.countSymbols ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }));
}

/** Removes a saved custom count symbol from the active profile. */
export function removeCountSymbol(id: string) {
  updateWorkspace((w) => ({
    ...w,
    countSymbols: (w.countSymbols ?? []).filter((s) => s.id !== id),
  }));
}
