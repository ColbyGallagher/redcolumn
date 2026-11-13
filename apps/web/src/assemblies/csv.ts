import { parseNumber, type ProductList } from '@nb/markup';

/** Rows of a CSV file (RFC 4180: quoted fields, doubled quotes, CRLF or LF); blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** A column key from its header: lower case, letters and digits joined by underscores, unique. */
function keyFor(label: string, taken: Set<string>): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'column';
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  taken.add(key);
  return key;
}

/**
 * A product list from a CSV file: the header row becomes the columns, each other row a record. A
 * column whose every filled-in value is a number ("$12.50" and "1,200" count) is a number column.
 */
export function productListFromCsv(name: string, text: string): ProductList {
  const [head, ...body] = parseCsv(text);
  if (!head?.length) throw new Error('The CSV file is empty.');
  const taken = new Set<string>();
  const columns = head.map((label, i) => {
    const values = body.map((r) => (r[i] ?? '').trim()).filter((v) => v !== '');
    const numeric = values.length > 0 && values.every((v) => Number.isFinite(parseNumber(v)));
    return { key: keyFor(label || `Column ${i + 1}`, taken), label: label.trim() || `Column ${i + 1}`, type: numeric ? ('number' as const) : ('text' as const) };
  });
  const records = body.map((r) => ({
    id: crypto.randomUUID(),
    values: Object.fromEntries(columns.map((c, i) => {
      const raw = (r[i] ?? '').trim();
      return [c.key, c.type === 'number' && raw !== '' ? parseNumber(raw) : raw];
    })),
  }));
  return { id: crypto.randomUUID(), name, columns, records };
}
