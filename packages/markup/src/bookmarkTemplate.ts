import type { Bookmark } from './bookmarks';
import { parseXml, type XmlElement } from './xml';

/**
 * A Revu bookmark template: the outline a set of drawings is filed under (folders for disciplines,
 * slots for series of sheets). Revu keeps them as XML in its settings folder.
 */
export interface BookmarkTemplateNode {
  name: string;
  /** Revu's `manual` flag, kept as it is written (what it means to Revu is not documented). */
  manual: boolean;
  children: BookmarkTemplateNode[];
}

export interface BookmarkTemplate {
  name: string;
  nodes: BookmarkTemplateNode[];
}

/** Reads a template (Revu's Construction.xml): `<root><bookmark dname manual>…`. Throws when it is not one. */
export function parseBookmarkTemplate(xml: string, name = 'Imported template'): BookmarkTemplate {
  let root: XmlElement;
  try {
    root = parseXml(xml.replace(/^﻿/, ''));
  } catch {
    throw new Error('This is not a bookmark template.');
  }
  const read = (e: XmlElement): BookmarkTemplateNode[] =>
    e.children.flatMap((b) => (b.tagName === 'bookmark' && b.attrs.dname ? [{ name: b.attrs.dname, manual: b.attrs.manual !== '0', children: read(b) }] : []));
  const nodes = root.tagName === 'root' ? read(root) : [];
  if (!nodes.length) throw new Error('This is not a bookmark template.');
  return { name, nodes };
}

/** `Sheet` series leaf names such as `C-100` or `AD-000`: the discipline prefix and the series number. */
const SERIES = /^([A-Z]{1,3})[-\s]?(\d{1,4})$/;

/** A sheet label as its discipline prefix and the hundreds series it belongs to: `A-101` is A, 100; `A1.01` too. */
export function sheetSeries(label: string): { prefix: string; series: number } | null {
  const m = /^\s*([A-Za-z]{1,3})[\s._-]*(\d[\d.]*)/.exec(label);
  if (!m) return null;
  const n = Number(m[2]!.replace(/\./g, ''));
  if (!Number.isFinite(n)) return null;
  return { prefix: m[1]!.toUpperCase(), series: Math.floor(n / 100) * 100 };
}

/** The discipline prefix a folder files: the one most of its series slots (`C-000`, `C-100`…) are named with. */
function folderPrefix(node: BookmarkTemplateNode): string | null {
  const counts = new Map<string, number>();
  for (const c of node.children) {
    const m = SERIES.exec(c.name.trim().toUpperCase());
    if (m) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface TemplatePage {
  pageIndex: number;
  /** The page's sheet number, or its page label. */
  label: string;
}

/** Where a page goes in the template: the path of node names from the top, or null when nothing fits. */
function place(template: BookmarkTemplate, page: TemplatePage): string[] | null {
  const label = page.label.trim();
  // A slot named for the sheet itself (Cover Sheet, Sheet Index) wins.
  const walk = (nodes: BookmarkTemplateNode[], path: string[]): string[] | null => {
    for (const n of nodes) {
      if (!n.children.length && label && (same(n.name, label) || (!SERIES.test(n.name.trim().toUpperCase()) && !same(n.name, 'Other') && label.toLowerCase().startsWith(n.name.trim().toLowerCase())))) return [...path, n.name];
      const hit = walk(n.children, [...path, n.name]);
      if (hit) return hit;
    }
    return null;
  };
  const named = walk(template.nodes, []);
  if (named) return named;
  const s = sheetSeries(label);
  if (!s) return null;
  const find = (nodes: BookmarkTemplateNode[], path: string[]): string[] | null => {
    for (const n of nodes) {
      if (n.children.length && folderPrefix(n) === s.prefix) {
        const slot = n.children.find((c) => {
          const m = SERIES.exec(c.name.trim().toUpperCase());
          return m && m[1] === s.prefix && Number(m[2]) === s.series;
        });
        const other = n.children.find((c) => same(c.name, 'Other'));
        const hit = slot ?? other;
        return hit ? [...path, n.name, hit.name] : null;
      }
      const deeper = find(n.children, [...path, n.name]);
      if (deeper) return deeper;
    }
    return null;
  };
  const filed = find(template.nodes, []);
  if (filed) return filed;
  // A sheet of a discipline the template has no folder for goes in its Other folder, when it has one.
  const catchAll = template.nodes.find((n) => same(n.name, 'Other') && n.children.length);
  const last = catchAll?.children.find((c) => same(c.name, 'Other'));
  return catchAll && last ? [catchAll.name, last.name] : null;
}

/**
 * The outline for `pages` filed under `template`: each page a bookmark in the slot its sheet number
 * belongs to (by discipline prefix and hundreds series; the folder's Other slot when the series has
 * none). Folders and slots with no pages are left out. `unmatched` are the pages that fit nowhere.
 */
export function applyBookmarkTemplate(template: BookmarkTemplate, pages: readonly TemplatePage[], newId: () => string): { tree: Bookmark[]; unmatched: number[] } {
  const filed = new Map<string, TemplatePage[]>();
  const unmatched: number[] = [];
  for (const p of pages) {
    const path = place(template, p);
    if (!path) unmatched.push(p.pageIndex);
    else filed.set(JSON.stringify(path), [...(filed.get(JSON.stringify(path)) ?? []), p]);
  }
  const build = (nodes: BookmarkTemplateNode[], path: string[]): Bookmark[] =>
    nodes.flatMap((n): Bookmark[] => {
      const here = [...path, n.name];
      const own = filed.get(JSON.stringify(here)) ?? [];
      const children = [...own.map((p) => ({ id: newId(), title: p.label || `Page ${p.pageIndex + 1}`, pageIndex: p.pageIndex, rect: null, children: [] as Bookmark[] })), ...build(n.children, here)];
      if (!children.length) return [];
      const first = Math.min(...[...own.map((p) => p.pageIndex), ...children.map((c) => c.pageIndex)]);
      return [{ id: newId(), title: n.name, pageIndex: first, rect: null, children }];
    });
  return { tree: build(template.nodes, []), unmatched };
}

/** [folder name, discipline prefix, series] for the template built in: the usual drawing set. */
const DISCIPLINES: [string, string, number][] = [
  ['General Information', 'G', 3],
  ['Civil', 'C', 5],
  ['Landscape', 'L', 5],
  ['Architectural Demolition', 'AD', 5],
  ['Architectural', 'A', 5],
  ['Structural', 'S', 5],
  ['Mechanical', 'M', 5],
  ['Electrical', 'E', 5],
  ['Plumbing', 'P', 5],
  ['Fire Protection', 'FP', 5],
  ['Telecom', 'T', 5],
  ['Security', 'SE', 5],
  ['Interiors', 'I', 5],
];

const slot = (name: string): BookmarkTemplateNode => ({ name, manual: true, children: [] });
const series = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => slot(`${prefix}-${String(i * 100).padStart(3, '0')}`));

/**
 * Built in: a cover sheet, a folder per discipline with a slot for each hundred of its sheet numbers
 * (and an Other for the rest), and an Other folder for sheets of any other discipline.
 */
export const DEFAULT_BOOKMARK_TEMPLATE: BookmarkTemplate = {
  name: 'Construction Documents',
  nodes: [
    slot('Cover Sheet'),
    ...DISCIPLINES.map(([name, prefix, count]): BookmarkTemplateNode => ({
      name,
      manual: false,
      children: [...(prefix === 'G' ? [slot('Sheet Index')] : []), ...series(prefix, count), slot('Other')],
    })),
    { name: 'Other', manual: true, children: [...series('O', 5), slot('Other')] },
  ],
};
