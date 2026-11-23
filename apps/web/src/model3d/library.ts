import { useSyncExternalStore } from 'react';
import type { ColourProfile, SavedView, SearchSet } from '@nb/model3d';
import type { BcfTopic } from './bcf';

/**
 * What the 3D panel keeps between sessions: search sets and colour profiles (shared by every model,
 * so a set made on one model works on the next), and each model's saved views, by file hash.
 * Plain data only; the viewer is not loaded to read or change it.
 */
export interface ModelLibrary {
  sets: SearchSet[];
  profiles: ColourProfile[];
  views: Record<string, SavedView[]>;
  /** Each model's issues (BCF topics), by file hash. */
  issues: Record<string, BcfTopic[]>;
}

const KEY = 'nb.model3d';
const EMPTY: ModelLibrary = { sets: [], profiles: [], views: {}, issues: {} };
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
      issues: v?.issues && typeof v.issues === 'object' ? v.issues : {},
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
  const was = read();
  const next = change(was);
  // Nothing changed: nothing to save or tell.
  if (next === was) return;
  current = next;
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

export function subscribeModelLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes one model's issues. */
export function updateIssues(fileHash: string, change: (topics: BcfTopic[]) => BcfTopic[]): void {
  updateModelLibrary((lib) => {
    const was = lib.issues[fileHash] ?? [];
    const next = change(was);
    return next === was ? lib : { ...lib, issues: { ...lib.issues, [fileHash]: next } };
  });
}

/** The search sets as a file to share (what Import reads back). */
export function exportSearchSets(sets: readonly SearchSet[]): string {
  return JSON.stringify({ type: 'redcolumn-search-sets', version: 1, sets }, null, 2);
}

/** Forgets what was read, so the next read comes from storage (tests). */
export function resetModelLibraryCache(): void {
  current = null;
}
