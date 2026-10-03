import { useSyncExternalStore } from 'react';

/**
 * File Access groups: named lists of library documents for quick access (a project's
 * drawings, today's review set). A document can be in several groups; groups only hold ids, so
 * removing a document from a group never removes it from the device.
 */
export interface FileGroup {
  id: string;
  name: string;
  fileIds: string[];
  collapsed: boolean;
}

const KEY = 'nb.fileGroups';

function load(): FileGroup[] {
  try {
    const groups = JSON.parse(localStorage.getItem(KEY) ?? '[]') as FileGroup[];
    return Array.isArray(groups) ? groups.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.fileIds)) : [];
  } catch {
    return [];
  }
}

let groups = load();
const listeners = new Set<() => void>();

function commit(next: FileGroup[]) {
  groups = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(groups));
  } catch {
    // Not persisted; the groups last for this visit.
  }
  listeners.forEach((l) => l());
}

const edit = (id: string, fn: (g: FileGroup) => FileGroup) => commit(groups.map((g) => (g.id === id ? fn(g) : g)));

export const fileGroups = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => groups,
  create(name: string, fileIds: string[] = []): string {
    const id = crypto.randomUUID();
    commit([...groups, { id, name, fileIds: [...new Set(fileIds)], collapsed: false }]);
    return id;
  },
  rename: (id: string, name: string) => edit(id, (g) => ({ ...g, name })),
  remove: (id: string) => commit(groups.filter((g) => g.id !== id)),
  toggle: (id: string) => edit(id, (g) => ({ ...g, collapsed: !g.collapsed })),
  add: (id: string, fileId: string) => edit(id, (g) => (g.fileIds.includes(fileId) ? g : { ...g, fileIds: [...g.fileIds, fileId], collapsed: false })),
  removeFile: (id: string, fileId: string) => edit(id, (g) => ({ ...g, fileIds: g.fileIds.filter((f) => f !== fileId) })),
  /** Moves a group up or down the list. */
  move(id: string, by: -1 | 1) {
    const i = groups.findIndex((g) => g.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= groups.length) return;
    const next = [...groups];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next);
  },
  /** Forgets a document everywhere (it was removed from the device). */
  forget: (fileId: string) => commit(groups.map((g) => ({ ...g, fileIds: g.fileIds.filter((f) => f !== fileId) }))),
};

export function useFileGroups(): FileGroup[] {
  return useSyncExternalStore(fileGroups.subscribe, fileGroups.get);
}
