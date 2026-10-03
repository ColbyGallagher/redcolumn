/**
 * Batch Compare and Batch Overlay: the sheets of two sets of files (an old issue and a new one),
 * paired across the files by sheet number (or in order), then grouped by the two files each pair
 * comes from so every pair of files is compared once.
 */

import { pairPages, type PagePair } from './pairing';

export interface SheetRef {
  fileId: string;
  page: number;
  label: string | null;
}

export interface FilePairing {
  oldId: string;
  newId: string;
  pairs: PagePair[];
}

export function pairAcross(old: readonly SheetRef[], cur: readonly SheetRef[], bySheet: boolean): FilePairing[] {
  const groups = new Map<string, FilePairing>();
  for (const { oldPage, newPage } of pairPages(
    old.map((s) => s.label),
    cur.map((s) => s.label),
    bySheet,
  )) {
    const o = old[oldPage]!;
    const n = cur[newPage]!;
    // The same file on both sides is the same revision: nothing to compare.
    if (o.fileId === n.fileId) continue;
    const key = `${o.fileId}\n${n.fileId}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { oldId: o.fileId, newId: n.fileId, pairs: [] }));
    g.pairs.push({ oldPage: o.page, newPage: n.page });
  }
  return [...groups.values()];
}
