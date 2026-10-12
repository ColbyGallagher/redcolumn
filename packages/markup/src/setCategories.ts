import { parseXml, type XmlElement } from './xml';

/** One Sets category as Revu lists it: the discipline's name and the sheet-number prefix that files into it. */
export interface RevuCategory {
  name: string;
  filter: string;
}

export interface RevuCategorySet {
  name: string;
  categories: RevuCategory[];
}

/** XML element names cannot hold a space: Revu writes `AIA Standards` as `AIA_x0020_Standards`. */
const decodeName = (n: string) => n.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const encodeName = (n: string) =>
  [...n]
    .map((c, i) => (/[A-Za-z_]/.test(c) || (i > 0 && /[0-9.-]/.test(c)) ? c : `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`))
    .join('');

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Reads a Revu categories file (`<?categories version="1"?><Name><Category><Discipline/><Abbrev/>…`). Throws when it is not one. */
export function parseCategoriesXml(xml: string, fallbackName = 'Imported categories'): RevuCategorySet {
  let root: XmlElement;
  try {
    root = parseXml(xml.replace(/^﻿/, ''));
  } catch {
    throw new Error('This is not a Revu categories file.');
  }
  const text = (e: XmlElement, tag: string) => e.children.find((c) => c.tagName === tag)?.textContent.trim() ?? '';
  const categories = root.children.flatMap((c) => (c.tagName === 'Category' && text(c, 'Discipline') ? [{ name: text(c, 'Discipline'), filter: text(c, 'Abbrev') }] : []));
  if (!categories.length) throw new Error('This is not a Revu categories file.');
  return { name: decodeName(root.tagName) || fallbackName, categories };
}

/** A set of categories as a Revu categories file, which Revu reads back. */
export function categoriesToXml(set: RevuCategorySet): string {
  const root = encodeName(set.name.trim() || 'Categories');
  const rows = set.categories
    .map((c) => `  <Category>\n    <Discipline>${escapeXml(c.name)}</Discipline>\n    <Abbrev>${escapeXml(c.filter)}</Abbrev>\n  </Category>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<?categories version="1"?>\n<${root}>\n${rows}\n</${root}>\n`;
}
