/**
 * Custom markup columns and statuses: defined per document (so everyone
 * in a Live Session sees the same columns), each markup keeping its values in `Markup.fields`.
 */

export type ColumnType = 'text' | 'multiline' | 'choice' | 'number' | 'date' | 'checkmark' | 'formula';

export const COLUMN_TYPES: { value: ColumnType; label: string; hint: string }[] = [
  { value: 'text', label: 'Text', hint: 'A single line of free text' },
  { value: 'multiline', label: 'Multiline text', hint: 'Longer notes over several lines' },
  { value: 'choice', label: 'Dropdown', hint: 'Pick one value from a list you define' },
  { value: 'number', label: 'Number', hint: 'A number, with optional decimal places' },
  { value: 'date', label: 'Date', hint: 'A calendar date' },
  { value: 'checkmark', label: 'Checkmark', hint: 'A check box per markup (counts as 1 or 0 in calculations)' },
  { value: 'formula', label: 'Calculation', hint: 'Worked out from other columns, e.g. [Quantity] * [Unit Cost]' },
];

export interface CustomColumn {
  /** Stable id: values are stored under it, so renaming a column keeps them. */
  id: string;
  name: string;
  type: ColumnType;
  /** Every markup should have a value (highlighted in the list when missing). */
  required?: boolean;
  /** Choices for `choice` columns. */
  options?: string[];
  /** Value new markups start with. */
  defaultValue?: string;
  /** Expression for `formula` columns, referring to other columns as [Name]. */
  formula?: string;
  /** Decimal places for `number` and `formula` columns. */
  decimals?: number;
}

export interface MarkupStatusDef {
  /** Stored on the markup; `none` means no status. */
  id: string;
  name: string;
  color: string;
}

export const DEFAULT_STATUSES: MarkupStatusDef[] = [
  { id: 'none', name: 'None', color: '#9aa1a9' },
  { id: 'accepted', name: 'Accepted', color: '#16a34a' },
  { id: 'rejected', name: 'Rejected', color: '#dc2626' },
  { id: 'completed', name: 'Completed', color: '#2563eb' },
  { id: 'cancelled', name: 'Cancelled', color: '#6b7280' },
];

export interface ColumnSet {
  columns: CustomColumn[];
  statuses: MarkupStatusDef[];
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Custom columns and statuses as XML, to share them between documents and people:
 * export from one document, import into another.
 */
export function columnsToXml(set: ColumnSet): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<CustomColumns Version="1">'];
  for (const c of set.columns) {
    const attrs = [
      `Id="${escapeXml(c.id)}"`,
      `Name="${escapeXml(c.name)}"`,
      `Type="${c.type}"`,
      `Required="${c.required ? 'true' : 'false'}"`,
      c.defaultValue ? `Default="${escapeXml(c.defaultValue)}"` : '',
      c.decimals !== undefined ? `Decimals="${c.decimals}"` : '',
    ].filter(Boolean);
    const children = [
      ...(c.options ?? []).map((o) => `    <Option>${escapeXml(o)}</Option>`),
      ...(c.type === 'formula' && c.formula ? [`    <Formula>${escapeXml(c.formula)}</Formula>`] : []),
    ];
    if (children.length) lines.push(`  <Column ${attrs.join(' ')}>`, ...children, '  </Column>');
    else lines.push(`  <Column ${attrs.join(' ')} />`);
  }
  lines.push('  <Statuses>');
  for (const s of set.statuses) lines.push(`    <Status Id="${escapeXml(s.id)}" Name="${escapeXml(s.name)}" Color="${escapeXml(s.color)}" />`);
  lines.push('  </Statuses>', '</CustomColumns>');
  return lines.join('\n');
}

const TYPES = new Set(COLUMN_TYPES.map((t) => t.value));

/** Reads XML written by `columnsToXml`. Throws with a readable message on anything else. */
export function columnsFromXml(xml: string, parser: DOMParser = new DOMParser()): ColumnSet {
  const doc = parser.parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'CustomColumns' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('This is not a custom columns file (expected a <CustomColumns> XML document).');
  }
  const columns: CustomColumn[] = [];
  for (const el of Array.from(root.getElementsByTagName('Column'))) {
    const type = el.getAttribute('Type') as ColumnType;
    const name = el.getAttribute('Name')?.trim();
    if (!name || !TYPES.has(type)) continue;
    const decimals = el.getAttribute('Decimals');
    columns.push({
      id: el.getAttribute('Id') || crypto.randomUUID(),
      name,
      type,
      required: el.getAttribute('Required') === 'true',
      ...(el.getAttribute('Default') ? { defaultValue: el.getAttribute('Default')! } : {}),
      ...(decimals !== null && decimals !== '' ? { decimals: Number(decimals) } : {}),
      ...(type === 'choice' ? { options: Array.from(el.getElementsByTagName('Option')).map((o) => o.textContent ?? '') } : {}),
      ...(type === 'formula' ? { formula: el.getElementsByTagName('Formula')[0]?.textContent ?? '' } : {}),
    });
  }
  const statuses: MarkupStatusDef[] = Array.from(root.getElementsByTagName('Status'))
    .map((el) => ({ id: el.getAttribute('Id') || crypto.randomUUID(), name: el.getAttribute('Name') ?? '', color: el.getAttribute('Color') || '#9aa1a9' }))
    .filter((s) => s.name);
  if (!statuses.some((s) => s.id === 'none')) statuses.unshift(DEFAULT_STATUSES[0]!);
  return { columns, statuses };
}
