/**
 * Finds every translatable message in the app and updates the catalogs.
 *
 *   pnpm i18n:extract          writes packages/i18n/catalogs/messages.pot (the template) and adds
 *                              new messages to each language's <code>.po, keeping translations
 *   pnpm i18n:extract --check  writes nothing; fails on a non-literal message, ICU syntax errors,
 *                              or a translation whose {placeholders} differ from the English
 *
 * A message is the literal text of `msg('…')`, `msgParts('…')` or `msgc('context', '…')`. A
 * `// translators: …` comment on the line above becomes a note for translators.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { argNames, parseIcu } from '../src/icu.ts';
import { translatedLocales } from '../src/locales.ts';
import { messageKey, parsePo, poHeader, writePo, type PoEntry } from '../src/po.ts';

export interface Extracted {
  id: string;
  context?: string;
  note?: string;
  ref: string;
}

const CALLS: Record<string, number> = { msg: 0, msgParts: 0, msgc: 1 };

function literal(node: ts.Expression | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text;
  return undefined;
}

/** The messages in one source file, and problems with them. */
export function extractFromSource(ref: string, text: string): { messages: Extracted[]; errors: string[] } {
  const source = ts.createSourceFile(ref, text, ts.ScriptTarget.Latest, true, ref.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split(/\r?\n/);
  const messages: Extracted[] = [];
  const errors: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && Object.hasOwn(CALLS, node.expression.text)) {
      const name = node.expression.text;
      const at = `${ref}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      const id = literal(node.arguments[CALLS[name]!]);
      const context = name === 'msgc' ? literal(node.arguments[0]) : undefined;
      if (id === undefined || (name === 'msgc' && context === undefined)) errors.push(`${at}: ${name}() needs literal text, so it can be translated`);
      else {
        try {
          parseIcu(id);
        } catch (e) {
          errors.push(`${at}: ${(e as Error).message}`);
        }
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line;
        const above = /\/\/\s*translators?:\s*(.*)$/i.exec(lines[line - 1] ?? '')?.[1]?.trim();
        messages.push({ id, ...(context !== undefined ? { context } : {}), ...(above ? { note: above } : {}), ref });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { messages, errors };
}

/** The template: every message once, with its notes and the files using it, in a stable order. */
export function buildTemplate(found: readonly Extracted[]): PoEntry[] {
  const byKey = new Map<string, PoEntry>();
  for (const m of found) {
    const key = messageKey(m.id, m.context);
    const e = byKey.get(key) ?? { id: m.id, str: '', ...(m.context !== undefined ? { context: m.context } : {}) };
    if (m.note && !e.notes?.includes(m.note)) (e.notes ??= []).push(m.note);
    if (!e.refs?.includes(m.ref)) (e.refs ??= []).push(m.ref);
    byKey.set(key, e);
  }
  return [...byKey.values()]
    .map((e) => ({ ...e, refs: e.refs?.sort() }))
    .sort((a, b) => (a.refs![0]! < b.refs![0]! ? -1 : a.refs![0]! > b.refs![0]! ? 1 : messageKey(a.id, a.context) < messageKey(b.id, b.context) ? -1 : 1));
}

/** A language's catalog brought up to date with the template: translations, flags and translators' comments kept, messages no longer used dropped. */
export function mergeCatalog(existing: readonly PoEntry[], template: readonly PoEntry[], language: string): PoEntry[] {
  const old = new Map(existing.filter((e) => e.id).map((e) => [messageKey(e.id, e.context), e]));
  const header = existing.find((e) => !e.id && e.context === undefined) ?? poHeader(language);
  return [header, ...template.map((t) => {
    const prev = old.get(messageKey(t.id, t.context));
    return { ...(prev?.comments?.length ? { comments: prev.comments } : {}), ...t, str: prev?.str ?? '', ...(prev?.flags?.length ? { flags: prev.flags } : {}) };
  })];
}

/** Problems in a language's translations: ICU syntax, and placeholders that differ from the English. */
export function checkCatalog(file: string, entries: readonly PoEntry[]): string[] {
  const errors: string[] = [];
  for (const e of entries) {
    if (!e.id || !e.str) continue;
    const where = `${file}: "${e.id}"`;
    try {
      const want = [...argNames(parseIcu(e.id))].sort().join(', ');
      const got = [...argNames(parseIcu(e.str))].sort().join(', ');
      if (want !== got) errors.push(`${where}: placeholders {${got}} should be {${want}}`);
      // A closing "…" marks a command that opens a dialog; code relies on it (commandNeedsYou).
      if (e.id.endsWith('…') && !e.str.endsWith('…')) errors.push(`${where}: should end with "…" as the English does`);
    } catch (err) {
      errors.push(`${where}: ${(err as Error).message}`);
    }
  }
  return errors;
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const catalogs = join(here, '..', 'catalogs');
/** Where messages are looked for. */
const ROOTS = ['apps/web/src', 'apps/desktop/src'];

/** A file's text, or undefined when there is none (read directly: checking first could race a change). */
function readIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules') sourceFiles(path, out);
    } else if (/\.tsx?$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name) && !ent.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

function main(check: boolean) {
  const found: Extracted[] = [];
  const errors: string[] = [];
  for (const root of ROOTS) {
    const dir = join(repo, root);
    if (!existsSync(dir)) continue;
    for (const file of sourceFiles(dir)) {
      const r = extractFromSource(relative(repo, file).replace(/\\/g, '/'), readFileSync(file, 'utf8'));
      found.push(...r.messages);
      errors.push(...r.errors);
    }
  }
  const template = buildTemplate(found);
  const summary: string[] = [`${template.length} messages`];
  for (const l of translatedLocales()) {
    const path = join(catalogs, `${l.code}.po`);
    const existing = parsePo(readIfExists(path) ?? '');
    errors.push(...checkCatalog(`${l.code}.po`, existing));
    const merged = mergeCatalog(existing, template, l.code);
    const done = merged.filter((e) => e.id && e.str && !e.flags?.includes('fuzzy')).length;
    summary.push(`${l.code} ${template.length ? Math.floor((done / template.length) * 100) : 100}%`);
    if (!check) writeFileSync(path, writePo(merged));
  }
  if (!check) writeFileSync(join(catalogs, 'messages.pot'), writePo([poHeader(''), ...template]));
  for (const e of errors) console.error(e);
  console.log(`i18n: ${summary.join(', ')}${errors.length ? `; ${errors.length} problem(s)` : ''}`);
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main(process.argv.includes('--check'));
