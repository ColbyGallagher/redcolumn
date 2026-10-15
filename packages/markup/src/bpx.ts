import type { Dropped } from './diagnostics';
import { parseXml, type XmlElement } from './xml';

/** One column of a Revu markup list, as a profile (.bpx) stores it. */
export interface BpxColumn {
  /** Revu's name for it: `Subject`, `Page Index`, `UserDefined0`. */
  key: string;
  width: number;
  visible: boolean;
  /** Whether the column is in the list at all (a column that is not added is not offered). */
  added: boolean;
}

/** A custom column a profile defines (`UserDefinedN` in the list). */
export interface BpxCustomColumn {
  index: number;
  name: string;
  /** Revu's type: `Text`, `Number`, `Date`, … */
  subtype: string;
  multiline: boolean;
  deleted: boolean;
}

/** The markup list part of a Revu profile: what shows, in what order and how wide. */
export interface BpxProfile {
  name: string;
  /** In the order the list shows them. */
  columns: BpxColumn[];
  customColumns: BpxCustomColumn[];
}

const child = (e: XmlElement, tag: string) => e.children.find((c) => c.tagName === tag);
const text = (e: XmlElement, tag: string) => child(e, tag)?.textContent.trim() ?? '';

/**
 * Reads the markup list of a Revu profile (.bpx). Throws when it is not one, or has no markup list.
 * Columns and custom columns it cannot keep are listed in `dropped`.
 */
export function parseBpx(xml: string, fallbackName = 'Imported profile', dropped: Dropped[] = []): BpxProfile {
  let root: XmlElement;
  try {
    root = parseXml(xml.replace(/^﻿/, ''));
  } catch {
    throw new Error('This is not a Bluebeam profile (.bpx).');
  }
  if (root.tagName !== 'RevuProfile') throw new Error('This is not a Bluebeam profile (.bpx).');
  const list = root.children.find((r) => r.tagName === 'Record' && r.attrs.Key === 'MarkupList');
  const stored = child(list ?? root, 'Columns');
  if (!list || !stored) throw new Error('This profile has no markup list layout.');

  const byKey = new Map<string, BpxColumn>();
  for (const [i, c] of stored.children.entries()) {
    if (c.tagName !== 'Column') continue;
    if (!c.attrs.Key) {
      dropped.push({ item: `Column ${i + 1}`, reason: 'the column has no key' });
      continue;
    }
    const width = Number(text(c, 'Width'));
    byKey.set(c.attrs.Key, { key: c.attrs.Key, width: Number.isFinite(width) && width > 0 ? width : 100, visible: !/^false$/i.test(text(c, 'Visible')), added: !/^false$/i.test(text(c, 'Added')) });
  }
  // <Columns> is how Revu stores them; <DisplayOrder> is the order the list shows.
  const order = (child(list, 'DisplayOrder')?.children ?? []).flatMap((c) => (c.tagName === 'Column' && c.attrs.Key ? [c.attrs.Key] : []));
  for (const k of order) if (!byKey.has(k)) dropped.push({ item: `Column ${k}`, reason: 'listed in the display order but not stored' });
  const columns = [...new Set([...order, ...byKey.keys()])].flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));

  const customColumns = (child(list, 'CustomColumns')?.children ?? []).flatMap((c, i): BpxCustomColumn[] => {
    if (c.tagName !== 'BSIColumnItem') return [];
    if (!text(c, 'Name')) {
      dropped.push({ item: `Custom column ${i + 1}`, reason: 'the custom column has no name' });
      return [];
    }
    return [{ index: Number(c.attrs.Index ?? '0') || 0, name: text(c, 'Name'), subtype: c.attrs.Subtype ?? 'Text', multiline: /^true$/i.test(text(c, 'Multiline')), deleted: /^true$/i.test(text(c, 'Deleted')) }];
  });
  return { name: root.attrs.Name?.trim() || fallbackName, columns, customColumns };
}
