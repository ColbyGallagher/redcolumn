import { useSyncExternalStore } from 'react';

/**
 * Sets: many drawing files viewed as one sheet list, grouped by category (discipline)
 * and sorted by sheet number. Each file keeps its own markups; a set only holds library ids, each
 * with an optional category, plus a cached index of every file's sheets so the list shows without
 * opening the files.
 */
export interface SetEntry {
  fileId: string;
  /** e.g. "Architectural"; files without one are listed under "Other". */
  category?: string;
}

export interface DrawingSet {
  id: string;
  name: string;
  entries: SetEntry[];
  /** Sheets in file order, or sorted by sheet number within each category. */
  sort: 'files' | 'sheet';
  collapsed: boolean;
}

/** A file's sheets as last read: page count and each page's sheet number and title. */
export interface SheetIndex {
  pageCount: number;
  sheets: ({ number?: string; title?: string } | null)[];
}

/** One sheet of a set, in list order. */
export interface SetSheet {
  fileId: string;
  page: number;
  category: string;
  number: string | null;
  title: string | null;
}

const KEY = 'nb.sets';
const INDEX_KEY = 'nb.sheetIndex';

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not persisted; lasts for this visit.
  }
}

let sets: DrawingSet[] = read<DrawingSet[]>(KEY, []).filter((s) => s && typeof s.id === 'string' && Array.isArray(s.entries));
let index: Record<string, SheetIndex> = read(INDEX_KEY, {});
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function commit(next: DrawingSet[]) {
  sets = next;
  write(KEY, sets);
  emit();
}

const edit = (id: string, fn: (s: DrawingSet) => DrawingSet) => commit(sets.map((s) => (s.id === id ? fn(s) : s)));

export const drawingSets = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => sets,
  index: () => index,
  create(name: string, fileIds: string[]): string {
    const id = crypto.randomUUID();
    commit([...sets, { id, name, entries: [...new Set(fileIds)].map((fileId) => ({ fileId })), sort: 'sheet', collapsed: false }]);
    return id;
  },
  rename: (id: string, name: string) => edit(id, (s) => ({ ...s, name })),
  remove: (id: string) => commit(sets.filter((s) => s.id !== id)),
  toggle: (id: string) => edit(id, (s) => ({ ...s, collapsed: !s.collapsed })),
  setSort: (id: string, sort: DrawingSet['sort']) => edit(id, (s) => ({ ...s, sort })),
  addFiles: (id: string, fileIds: string[]) => edit(id, (s) => ({ ...s, entries: [...s.entries, ...fileIds.filter((f) => !s.entries.some((e) => e.fileId === f)).map((fileId) => ({ fileId }))] })),
  removeFile: (id: string, fileId: string) => edit(id, (s) => ({ ...s, entries: s.entries.filter((e) => e.fileId !== fileId) })),
  setCategory: (id: string, fileId: string, category: string) =>
    edit(id, (s) => ({ ...s, entries: s.entries.map((e) => (e.fileId === fileId ? { fileId, ...(category.trim() ? { category: category.trim() } : {}) } : e)) })),
  /** Moves a file up or down within its set. */
  moveFile(id: string, fileId: string, by: -1 | 1) {
    edit(id, (s) => {
      const i = s.entries.findIndex((e) => e.fileId === fileId);
      const j = i + by;
      if (i < 0 || j < 0 || j >= s.entries.length) return s;
      const entries = [...s.entries];
      [entries[i], entries[j]] = [entries[j]!, entries[i]!];
      return { ...s, entries };
    });
  },
  /** Forgets a file everywhere (removed from the device). */
  forget(fileId: string) {
    commit(sets.map((s) => ({ ...s, entries: s.entries.filter((e) => e.fileId !== fileId) })));
    const { [fileId]: _, ...rest } = index;
    index = rest;
    write(INDEX_KEY, index);
  },
  /** Records a file's sheets (after it was opened or indexed). No change, no update. */
  setIndex(fileId: string, value: SheetIndex) {
    if (JSON.stringify(index[fileId]) === JSON.stringify(value)) return;
    index = { ...index, [fileId]: value };
    write(INDEX_KEY, index);
    emit();
  },
};

export function useDrawingSets(): { sets: DrawingSet[]; index: Record<string, SheetIndex> } {
  const s = useSyncExternalStore(drawingSets.subscribe, drawingSets.get);
  const i = useSyncExternalStore(drawingSets.subscribe, drawingSets.index);
  return { sets: s, index: i };
}

/** Natural order for sheet numbers: A-2 before A-10, and "A" disciplines together. */
export function compareSheetNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * The set's sheets in list order: by category (in the order categories first appear), then by
 * file order or sheet number. Files not indexed yet are left out (see `unindexed`).
 */
export function setSheets(set: DrawingSet, idx: Readonly<Record<string, SheetIndex>>): SetSheet[] {
  const categories: string[] = [];
  for (const e of set.entries) {
    const c = e.category ?? 'Other';
    if (!categories.includes(c)) categories.push(c);
  }
  // "Other" last.
  categories.sort((a, b) => Number(a === 'Other') - Number(b === 'Other'));
  const out: SetSheet[] = [];
  for (const category of categories) {
    const sheets: SetSheet[] = [];
    for (const e of set.entries) {
      if ((e.category ?? 'Other') !== category) continue;
      const i = idx[e.fileId];
      if (!i) continue;
      for (let page = 0; page < i.pageCount; page++) sheets.push({ fileId: e.fileId, page, category, number: i.sheets[page]?.number ?? null, title: i.sheets[page]?.title ?? null });
    }
    if (set.sort === 'sheet') {
      // Numbered sheets in number order; pages without a number keep their place after them.
      const numbered = sheets.filter((s) => s.number).sort((a, b) => compareSheetNumbers(a.number!, b.number!));
      out.push(...numbered, ...sheets.filter((s) => !s.number));
    } else out.push(...sheets);
  }
  return out;
}

/** Files of a set whose sheets have not been read yet. */
export const unindexed = (set: DrawingSet, idx: Readonly<Record<string, SheetIndex>>) => set.entries.filter((e) => !idx[e.fileId]).map((e) => e.fileId);

/** The sheet after (or before) the given one in the set's order, or null at the ends. */
export function neighbourSheet(list: readonly SetSheet[], fileId: string, page: number, by: -1 | 1): SetSheet | null {
  const i = list.findIndex((s) => s.fileId === fileId && s.page === page);
  if (i < 0) return null;
  return list[i + by] ?? null;
}
