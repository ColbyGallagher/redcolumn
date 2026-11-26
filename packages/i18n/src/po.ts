/**
 * Gettext PO files: the catalog format translators and translation platforms work in. One entry
 * per English message; `msgctxt` separates identical English text with different meanings
 * ("Count" the noun and the verb). Plurals are ICU inside `msgstr`, so `msgid_plural` is unused.
 */

export interface PoEntry {
  context?: string;
  id: string;
  str: string;
  /** `#.` comments: notes for translators, from the code. */
  notes?: string[];
  /** `#:` comments: where the message is used. */
  refs?: string[];
  /** `#,` flags, e.g. `fuzzy`. */
  flags?: string[];
  /** `# ` comments: the translators' own notes, kept when the catalog is updated. */
  comments?: string[];
}

/** The catalog key of a message: its English text, with the context in front when it has one. */
export function messageKey(id: string, context?: string): string {
  return context ? `${context}\u0004${id}` : id;
}

function unquote(s: string): string {
  const m = /^"(.*)"$/.exec(s.trim());
  if (!m) throw new Error(`Expected a quoted string: ${s}`);
  return m[1]!.replace(/\\(.)/g, (_, c: string) => ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' })[c] ?? c);
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')}"`;
}

/** Parses a PO file. The header entry (empty msgid) is returned like any other. Obsolete `#~` entries are skipped. */
export function parsePo(text: string): PoEntry[] {
  const entries: PoEntry[] = [];
  let cur: PoEntry & { _field?: 'context' | 'id' | 'str' | 'plural'; _has?: boolean } = { id: '', str: '' };
  const finish = () => {
    if (cur._has) {
      const { _field, _has, ...e } = cur;
      void _field;
      void _has;
      entries.push(e);
    }
    cur = { id: '', str: '' };
  };
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      finish();
      continue;
    }
    if (line.startsWith('#~')) continue;
    if (line.startsWith('#')) {
      if (cur._has && cur._field) finish();
      if (line.startsWith('#.')) (cur.notes ??= []).push(line.slice(2).trim());
      else if (line === '#' || line.startsWith('# ')) (cur.comments ??= []).push(line.slice(2));
      else if (line.startsWith('#:')) (cur.refs ??= []).push(...line.slice(2).trim().split(/\s+/).filter(Boolean));
      else if (line.startsWith('#,')) (cur.flags ??= []).push(...line.slice(2).split(',').map((f) => f.trim()).filter(Boolean));
      continue;
    }
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(".*")$/.exec(line);
    if (m) {
      const key = m[1]!;
      if ((key === 'msgctxt' || key === 'msgid') && cur._has && cur._field !== 'context') finish();
      const value = unquote(m[2]!);
      cur._has = true;
      if (key === 'msgctxt') {
        cur.context = value;
        cur._field = 'context';
      } else if (key === 'msgid') {
        cur.id = value;
        cur._field = 'id';
      } else if (key === 'msgid_plural') cur._field = 'plural';
      else if (key === 'msgstr' || key === 'msgstr[0]') {
        cur.str = value;
        cur._field = 'str';
      } else cur._field = 'plural';
      continue;
    }
    if (line.startsWith('"')) {
      const value = unquote(line);
      if (cur._field === 'context') cur.context = (cur.context ?? '') + value;
      else if (cur._field === 'id') cur.id += value;
      else if (cur._field === 'str') cur.str += value;
      continue;
    }
    throw new Error(`Unrecognised PO line: ${raw}`);
  }
  finish();
  return entries;
}

/** Writes entries as a PO file, header first. Long strings are kept on one line (diff-friendly enough, and simple). */
export function writePo(entries: readonly PoEntry[]): string {
  const out: string[] = [];
  for (const e of entries) {
    for (const c of e.comments ?? []) out.push(c ? `# ${c}` : '#');
    for (const n of e.notes ?? []) out.push(`#. ${n}`);
    if (e.refs?.length) out.push(`#: ${e.refs.join(' ')}`);
    if (e.flags?.length) out.push(`#, ${e.flags.join(', ')}`);
    if (e.context !== undefined) out.push(`msgctxt ${quote(e.context)}`);
    out.push(`msgid ${quote(e.id)}`);
    out.push(`msgstr ${quote(e.str)}`);
    out.push('');
  }
  return out.join('\n');
}

/** The header entry for a language's catalog. */
export function poHeader(language: string): PoEntry {
  return { id: '', str: `Language: ${language}\nMIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n` };
}

export type Catalog = Readonly<Record<string, string>>;

/** The translations the app uses: key → translated text, leaving out the header, empty and fuzzy entries. */
export function compileCatalog(entries: readonly PoEntry[]): Catalog {
  const out: Record<string, string> = {};
  for (const e of entries) if (e.id && e.str && !e.flags?.includes('fuzzy')) out[messageKey(e.id, e.context)] = e.str;
  return out;
}
