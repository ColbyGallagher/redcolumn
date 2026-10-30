import type { BpxProfile, ColumnType, CustomColumn } from '@nb/markup';
import { customKey, type ColumnLayout } from './listColumns';

/** Revu's markup list columns, by the name its profiles use, as ours. Several Revu columns may share one of ours. */
const COLUMN_KEYS: Record<string, string> = {
  Subject: 'subject',
  // Revu's Page is the page label and Page Index its number; ours shows the number.
  Page: 'page',
  'Page Index': 'page',
  Label: 'label',
  Comments: 'comment',
  Checkmark: 'checked',
  Author: 'author',
  Date: 'date',
  'Creation Date': 'created',
  Lock: 'locked',
  Status: 'status',
  Color: 'color',
  Capture: 'capture',
  Layer: 'layer',
  Space: 'space',
  Measurement: 'measurement',
  Length: 'length',
  Area: 'area',
  'Wall Area': 'wallArea',
  Volume: 'volume',
  Depth: 'depth',
  Slope: 'slope',
};

/** Revu's custom column types as ours; the ones not listed here are text. */
const CUSTOM_TYPES: Record<string, ColumnType> = {
  text: 'text',
  number: 'number',
  date: 'date',
  checkbox: 'checkmark',
  checkmark: 'checkmark',
  dropdown: 'choice',
  choice: 'choice',
};

export interface BpxImport {
  /** The list's columns in Revu's order, hidden where Revu hides them. */
  layout: ColumnLayout[];
  /** The custom columns the profile defines and the list shows. */
  custom: CustomColumn[];
  /** Columns the list shows in Revu that we have no equivalent for. */
  skipped: string[];
}

/** A Revu profile's markup list as a column layout for ours. */
export function layoutFromBpx(p: BpxProfile, newId: () => string): BpxImport {
  const layout: ColumnLayout[] = [];
  const custom: CustomColumn[] = [];
  const skipped: string[] = [];
  const seen = new Map<string, ColumnLayout>();
  for (const c of p.columns) {
    const hidden = !(c.visible && c.added);
    const width = Math.min(600, Math.max(30, Math.round(c.width)));
    const userDefined = /^UserDefined(\d+)$/.exec(c.key);
    let key = COLUMN_KEYS[c.key];
    if (userDefined) {
      const def = p.customColumns.find((d) => d.index === Number(userDefined[1]) && !d.deleted);
      if (def) {
        const type = CUSTOM_TYPES[def.subtype.toLowerCase()] ?? 'text';
        const col: CustomColumn = { id: newId(), name: def.name, type: type === 'text' && def.multiline ? 'multiline' : type, ...(type === 'choice' ? { options: [] } : {}) };
        custom.push(col);
        key = customKey(col.id);
      }
    }
    if (!key) {
      if (!hidden && c.key !== 'GoCanvasStatus') skipped.push(c.key);
      continue;
    }
    // Two Revu columns may be one of ours (Page and Page Index): shown if either is.
    const earlier = seen.get(key);
    if (earlier) {
      if (earlier.hidden && !hidden) Object.assign(earlier, { hidden: false, width });
      continue;
    }
    const entry = { key, width, hidden };
    seen.set(key, entry);
    layout.push(entry);
  }
  return { layout, custom, skipped };
}

/** Our columns as Revu's, for writing a profile: the first Revu column that reads back as each. */
const REVU_KEYS: Record<string, string> = { ...Object.fromEntries(Object.entries(COLUMN_KEYS).reverse().map(([revu, ours]) => [ours, revu])), page: 'Page Index' };

/** Our custom column types as Revu's (the reverse of CUSTOM_TYPES). */
const REVU_TYPES: Partial<Record<ColumnType, string>> = { number: 'Number', date: 'Date', checkmark: 'Checkbox', choice: 'Choice' };

/**
 * Our markup list as a Revu profile's (the reverse of `layoutFromBpx`). Custom columns become
 * UserDefined0, 1, …; columns Revu has no equivalent for are listed in `skipped`.
 */
export function bpxFromLayout(name: string, layout: readonly ColumnLayout[], customColumns: readonly CustomColumn[]): { profile: BpxProfile; skipped: string[] } {
  const columns: BpxProfile['columns'] = [];
  const custom: BpxProfile['customColumns'] = [];
  const skipped: string[] = [];
  for (const c of layout) {
    const def = customColumns.find((d) => customKey(d.id) === c.key);
    let key = REVU_KEYS[c.key];
    if (def) {
      const index = custom.length;
      custom.push({ index, name: def.name, subtype: REVU_TYPES[def.type] ?? 'Text', multiline: def.type === 'multiline', deleted: false });
      key = `UserDefined${index}`;
    }
    if (!key) {
      if (!c.hidden && c.key !== 'seq') skipped.push(c.key);
      continue;
    }
    columns.push({ key, width: c.width, visible: !c.hidden, added: true });
  }
  return { profile: { name, columns, customColumns: custom }, skipped };
}
