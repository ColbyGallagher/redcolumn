import { useSyncExternalStore } from 'react';
import { CONSTRUCTION_TEMPLATE, type SetTemplate } from '../settings/settings';

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
  /** Sheets as Preferences › Sets › Sorting says ('auto'), in file order, or by sheet number. */
  sort: 'auto' | 'files' | 'sheet';
  collapsed: boolean;
  /** The category template (Preferences › Sets › Categories) its categories come from. */
  template?: string;
  /** Tag values typed for sheets, by `fileId:page`, then by tag name. */
  tags?: Record<string, Record<string, string>>;
  /** Revisions already followed up (markups copied, earlier one stamped), as `earlier>later` sheet keys. */
  revised?: string[];
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
  /** '' when categories are off. */
  category: string;
  number: string | null;
  title: string | null;
  fileName: string;
  /** Its tags: typed ones, plus Sheet Number and Sheet Name and any tagged automatically. */
  tags: Record<string, string>;
  /** Its place among the revisions of the same sheet (0 the first), or null. */
  revision: number | null;
  /** What identifies it across revisions (its sheet number, or its file name by the wildcard), or null. */
  revisionOf: string | null;
  /** A later revision of the same sheet is in the set. */
  superseded: boolean;
  /** Earlier revisions stacked under this one (Current Revisions: Stack), earliest first. */
  previous: SetSheet[];
}

/** How a set's sheets are listed: Preferences › Sets, and the files' names. */
export interface SetListOptions {
  fileName: (fileId: string) => string;
  /** When a file was added to the device, to order revisions that do not say their number. */
  addedAt?: (fileId: string) => number;
  categories: 'auto' | 'manual' | 'none';
  template: SetTemplate | null;
  /** Sheet numbers and names read off the pages (AutoMark), or only typed. */
  autoMark: { number: boolean; title: boolean };
  autoTagRevision: boolean;
  autoTagDiscipline: boolean;
  autoTagSheetType: boolean;
  sortBy: 'fileAndLabel' | 'fileName' | 'pageLabel' | 'sheetNumber';
  sortTagged: boolean;
  sortOrder: 'asc' | 'desc';
  revisionFilter: 'auto' | 'wildcard' | 'none';
  wildcard: string;
  previousRevisions: 'crossOut' | 'hide' | 'none';
  currentRevisions: 'stack' | 'none';
}

const LIST_DEFAULTS: SetListOptions = {
  fileName: (id) => id,
  categories: 'manual',
  template: null,
  autoMark: { number: true, title: true },
  autoTagRevision: false,
  autoTagDiscipline: false,
  autoTagSheetType: false,
  sortBy: 'sheetNumber',
  sortTagged: true,
  sortOrder: 'asc',
  revisionFilter: 'none',
  wildcard: '',
  previousRevisions: 'none',
  currentRevisions: 'none',
};

/** A sheet's key in a set's tags and revisions. */
export const sheetKey = (s: { fileId: string; page: number }) => `${s.fileId}:${s.page}`;

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
  create(name: string, fileIds: string[], template?: string): string {
    const id = crypto.randomUUID();
    commit([...sets, { id, name, entries: [...new Set(fileIds)].map((fileId) => ({ fileId })), sort: 'auto', collapsed: false, ...(template ? { template } : {}) }]);
    return id;
  },
  setTemplate: (id: string, template: string) => edit(id, (s) => ({ ...s, template })),
  /** Sets a sheet's tag ('' clears it). */
  setTag: (id: string, sheet: string, tag: string, value: string) =>
    edit(id, (s) => {
      const tags = { ...s.tags };
      const one = { ...tags[sheet] };
      if (value.trim()) one[tag] = value.trim();
      else delete one[tag];
      if (Object.keys(one).length) tags[sheet] = one;
      else delete tags[sheet];
      return { ...s, tags };
    }),
  /** Notes that revisions have been followed up, so they are not done again. */
  markRevised: (id: string, pairs: string[]) => edit(id, (s) => ({ ...s, revised: [...new Set([...(s.revised ?? []), ...pairs])] })),
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

/** Sheet types by the first digit of a sheet number (the US National CAD Standard). */
const SHEET_TYPES = ['General', 'Plans', 'Elevations', 'Sections', 'Large-Scale Views', 'Details', 'Schedules and Diagrams', 'User Defined', 'User Defined', '3D Representations'];

/** A sheet number's type, e.g. A-201 → Elevations; null when it does not follow the pattern. */
export function sheetType(number: string): string | null {
  const m = /^[A-Z]{1,3}[-.\s]?(\d)/i.exec(number.trim());
  return m ? SHEET_TYPES[Number(m[1])]! : null;
}

/** The template category `value` (a sheet number, name…) starts with; the longest filter wins. */
export function matchCategory(template: SetTemplate, value: string | null): string | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  let best: { name: string; filter: string } | null = null;
  for (const c of template.categories) if (c.filter && v.startsWith(c.filter.toUpperCase()) && (!best || c.filter.length > best.filter.length)) best = c;
  return best?.name ?? null;
}

/**
 * Preferences › Sets › Wildcard Syntax over file names: `*` matches what stays the same between
 * revisions and `#` the revision itself, e.g. `*_Rev#` for "A-101_Rev3.pdf".
 */
export function wildcardMatch(pattern: string, fileName: string): { key: string; revision: string | null } | null {
  if (!pattern.trim()) return null;
  const parts = pattern.trim().split(/([*#])/);
  let source = '^';
  for (const p of parts) source += p === '*' ? '(.+?)' : p === '#' ? '([0-9A-Za-z]+)' : p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${source}$`, 'i').exec(fileName.replace(/\.pdf$/i, ''));
  if (!m) return null;
  const caps = parts.filter((p) => p === '*' || p === '#');
  return {
    key: caps.map((c, i) => (c === '*' ? m[i + 1]!.toUpperCase() : '')).join('|'),
    revision: caps.includes('#') ? m[caps.indexOf('#') + 1]! : null,
  };
}

interface Listed extends SetSheet {
  order: number;
  manual: string | undefined;
}

/**
 * The set's sheets in list order, as Preferences › Sets says: tagged; put in categories (from the
 * set's template, by hand, or none); revisions found, the earlier ones marked, hidden or stacked
 * under the latest; and sorted. Files not indexed yet are left out (see `unindexed`).
 */
export function setSheets(set: DrawingSet, idx: Readonly<Record<string, SheetIndex>>, options: Partial<SetListOptions> = {}): SetSheet[] {
  const o: SetListOptions = { ...LIST_DEFAULTS, ...options };
  const template = o.template;
  const sheets: Listed[] = [];
  set.entries.forEach((e, order) => {
    const i = idx[e.fileId];
    if (!i) return;
    const fileName = o.fileName(e.fileId);
    for (let page = 0; page < i.pageCount; page++) {
      const typed = set.tags?.[sheetKey({ fileId: e.fileId, page })] ?? {};
      const read = i.sheets[page];
      const number = typed['Sheet Number'] || (o.autoMark.number ? read?.number : undefined) || null;
      const title = typed['Sheet Name'] || (o.autoMark.title ? read?.title : undefined) || null;
      const tags: Record<string, string> = { ...typed };
      if (number) tags['Sheet Number'] = number;
      if (title) tags['Sheet Name'] = title;
      if (o.autoTagDiscipline && number && !tags['Discipline']) {
        const d = matchCategory(template ?? CONSTRUCTION_TEMPLATE, number);
        if (d) tags['Discipline'] = d;
      }
      if (o.autoTagSheetType && number && !tags['Sheet Type']) {
        const t = sheetType(number);
        if (t) tags['Sheet Type'] = t;
      }
      sheets.push({ fileId: e.fileId, page, category: '', number, title, fileName, tags, revision: null, revisionOf: null, superseded: false, previous: [], order, manual: e.category });
    }
  });

  // Categories: from the template by the tag it assigns by, else as set by hand.
  const assignValue = (s: Listed): string | null => {
    if (!template) return null;
    switch (template.assignBy) {
      case 'Drawing Number':
      case 'Sheet Number':
        return s.number;
      case 'Sheet Name':
        return s.title;
      case 'File Name':
        return s.fileName;
      default:
        return s.tags[template.assignBy] ?? null;
    }
  };
  for (const s of sheets) {
    const auto = o.categories === 'auto' && template ? matchCategory(template, assignValue(s)) : null;
    s.category = o.categories === 'none' ? '' : (auto ?? s.manual ?? 'Other');
  }

  // Revisions: sheets that are the same sheet, earliest first.
  if (o.revisionFilter !== 'none') {
    const groups = new Map<string, Listed[]>();
    const revisionOf = new Map<Listed, string>();
    for (const s of sheets) {
      let key: string | null = null;
      if (o.revisionFilter === 'wildcard') {
        const m = wildcardMatch(o.wildcard, s.fileName);
        if (m) {
          key = `${m.key}#${s.page}`;
          if (m.revision) revisionOf.set(s, m.revision);
        }
      } else if (s.number) key = s.number.toUpperCase().replace(/\s+/g, ' ').trim();
      if (s.tags['Revision Number']) revisionOf.set(s, s.tags['Revision Number']);
      if (key === null) continue;
      s.revisionOf = key;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const ra = revisionOf.get(a);
        const rb = revisionOf.get(b);
        if (ra !== undefined && rb !== undefined && ra !== rb) return compareSheetNumbers(ra, rb);
        return (o.addedAt?.(a.fileId) ?? 0) - (o.addedAt?.(b.fileId) ?? 0) || a.order - b.order || a.page - b.page;
      });
      group.forEach((s, i) => {
        s.revision = i;
        s.superseded = i < group.length - 1;
        if (o.autoTagRevision && !s.tags['Revision Number']) s.tags['Revision Number'] = String(i);
      });
    }
  }
  let listed = sheets.filter((s) => !(s.superseded && o.previousRevisions === 'hide'));
  if (o.currentRevisions === 'stack') {
    const latest = new Map<string, Listed>();
    for (const s of listed) if (s.revisionOf !== null && !s.superseded) latest.set(s.revisionOf, s);
    for (const s of listed) if (s.superseded) latest.get(s.revisionOf!)?.previous.push(s);
    for (const s of latest.values()) s.previous.sort((a, b) => a.revision! - b.revision!);
    listed = listed.filter((s) => !s.superseded || !latest.has(s.revisionOf!));
  }

  // Categories in template order (auto) or as they first appear; "Other" last.
  const categories: string[] = [];
  if (o.categories === 'auto' && template) for (const c of template.categories) categories.push(c.name);
  for (const s of listed) if (!categories.includes(s.category)) categories.push(s.category);
  categories.sort((a, b) => Number(a === 'Other') - Number(b === 'Other'));

  const sortBy = set.sort === 'files' ? 'files' : set.sort === 'sheet' ? 'sheetNumber' : o.sortBy;
  const dir = o.sortOrder === 'desc' ? -1 : 1;
  const label = (s: Listed) => s.number ?? `p. ${s.page + 1}`;
  const fileOrder = (a: Listed, b: Listed) => a.order - b.order || a.page - b.page;
  const by = (a: Listed, b: Listed): number => {
    switch (sortBy) {
      case 'fileName':
        return dir * compareSheetNumbers(a.fileName, b.fileName) || fileOrder(a, b);
      case 'pageLabel':
        return dir * compareSheetNumbers(label(a), label(b)) || fileOrder(a, b);
      case 'fileAndLabel':
        return dir * (compareSheetNumbers(a.fileName, b.fileName) || compareSheetNumbers(label(a), label(b))) || fileOrder(a, b);
      default:
        return fileOrder(a, b);
    }
  };
  const out: Listed[] = [];
  for (const category of categories) {
    const inCategory = listed.filter((s) => s.category === category);
    // By sheet number (or, with Sort Tagged Pages By Sheet Number, numbered pages first by
    // number), pages without a number after them; or entirely by the Sort By key.
    if (sortBy === 'sheetNumber' || (o.sortTagged && sortBy !== 'files')) {
      const numbered = inCategory.filter((s) => s.number).sort((a, b) => dir * compareSheetNumbers(a.number!, b.number!) || fileOrder(a, b));
      out.push(...numbered, ...inCategory.filter((s) => !s.number).sort(sortBy === 'sheetNumber' ? fileOrder : by));
    } else out.push(...inCategory.sort(by));
  }
  return out.map(strip);
}

/** A listed sheet without its working fields. */
function strip(s: Listed): SetSheet {
  const { order: _order, manual: _manual, ...sheet } = s;
  return { ...sheet, previous: s.previous.map((p) => strip(p as Listed)) };
}

/** Each revision with the one just before it (stacked ones included), as `earlier>later` keys with the sheets. */
export function revisionPairs(list: readonly SetSheet[]): { key: string; earlier: SetSheet; later: SetSheet }[] {
  const all = [...list, ...list.flatMap((s) => s.previous)];
  const groups = new Map<string, SetSheet[]>();
  for (const s of all) if (s.revisionOf !== null && s.revision !== null) groups.set(s.revisionOf, [...(groups.get(s.revisionOf) ?? []), s]);
  const out: { key: string; earlier: SetSheet; later: SetSheet }[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.revision! - b.revision!);
    for (let i = 1; i < group.length; i++) out.push({ key: `${sheetKey(group[i - 1]!)}>${sheetKey(group[i]!)}`, earlier: group[i - 1]!, later: group[i]! });
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
