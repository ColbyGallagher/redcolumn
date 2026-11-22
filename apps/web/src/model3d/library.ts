import { useSyncExternalStore } from 'react';
import type { ColourProfile, SavedView, SearchSet } from '@nb/model3d';

/**
 * What the 3D panel keeps between sessions: search sets and colour profiles (shared by every model,
 * so a set made on one model works on the next), and each model's saved views, by file hash.
 * Plain data only; the viewer is not loaded to read or change it.
 */
export interface ModelLibrary {
  sets: SearchSet[];
  profiles: ColourProfile[];
  views: Record<string, SavedView[]>;
}

const KEY = 'nb.model3d';
const EMPTY: ModelLibrary = { sets: [], profiles: [], views: {} };
const listeners = new Set<() => void>();
let current: ModelLibrary | null = null;

function read(): ModelLibrary {
  if (current) return current;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ModelLibrary> | null;
    current = {
      sets: Array.isArray(v?.sets) ? v.sets : [],
      profiles: Array.isArray(v?.profiles) ? v.profiles : [],
      views: v?.views && typeof v.views === 'object' ? v.views : {},
    };
  } catch {
    current = EMPTY;
  }
  return current;
}

export function modelLibrary(): ModelLibrary {
  return read();
}

export function updateModelLibrary(change: (lib: ModelLibrary) => ModelLibrary): void {
  current = change(read());
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage full or unavailable: the change lasts until the app closes.
  }
  for (const l of listeners) l();
}

export function useModelLibrary(): ModelLibrary {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, read);
}

/** The search sets as a file to share (what Import reads back). */
export function exportSearchSets(sets: readonly SearchSet[]): string {
  return JSON.stringify({ type: 'redcolumn-search-sets', version: 1, sets }, null, 2);
}

/** Forgets what was read, so the next read comes from storage (tests). */
export function resetModelLibraryCache(): void {
  current = null;
}
