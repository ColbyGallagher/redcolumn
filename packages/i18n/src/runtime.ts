import { formatIcu, formatIcuParts, parseIcu, type IcuNode, type IcuValues } from './icu.ts';
import { localeInfo, SOURCE_LOCALE, type LocaleInfo } from './locales.ts';
import { messageKey, type Catalog } from './po.ts';
import { pseudoLocalize } from './pseudo.ts';

/**
 * Translating interface text. Wrap every English string the user reads:
 *
 *   msg('Save all')
 *   msg('{count, plural, one {# markup} other {# markups}} selected', { count })
 *   msgc('noun', 'Count')            // same English, different meaning
 *
 * The English text is the key, so the code stays readable. `pnpm i18n:extract` finds these calls
 * (the text must be a literal) and writes the catalogs. A message with no translation shows English.
 *
 * The language is chosen once, at start-up, before the first render. Modules load before that, so
 * never call `msg` at a module's top level: the text would be fixed in English. Build it in a
 * function or component instead (`messagesBeforeActivation` lists any that slip through).
 */

interface Active {
  info: LocaleInfo;
  catalog: Catalog;
  rules: string;
}

const ENGLISH: Active = { info: localeInfo(SOURCE_LOCALE)!, catalog: {}, rules: SOURCE_LOCALE };

let active: Active = ENGLISH;
let activated = false;
const compiled = new Map<string, IcuNode[]>();
const early = new Set<string>();
const broken = new Set<string>();

/** Makes `code` the interface language, with its translations (already loaded and merged along the fallback chain). */
export function activate(code: string, catalog: Catalog = {}): void {
  const info = localeInfo(code) ?? ENGLISH.info;
  active = { info, catalog, rules: info.rules ?? info.code };
  compiled.clear();
  activated = true;
}

/** The interface language. */
export function currentLocale(): LocaleInfo {
  return active.info;
}

/** The locale whose number and plural rules apply (pseudo-locales use a real one's). */
export function formattingLocale(): string {
  return active.rules;
}

/** Messages asked for before `activate`, so shown in English whatever the language. For a development warning. */
export function messagesBeforeActivation(): string[] {
  return [...early];
}

function nodesFor(text: string, context: string | undefined): IcuNode[] {
  const key = messageKey(text, context);
  let nodes = compiled.get(key);
  if (nodes) return nodes;
  if (!activated && early.size < 50) early.add(text);
  const translated = active.catalog[key];
  try {
    nodes = parseIcu(translated ?? text);
  } catch (e) {
    // A broken translation falls back to English rather than showing ICU syntax.
    if (!broken.has(key)) {
      broken.add(key);
      console.warn(`i18n: ${(e as Error).message}`);
    }
    try {
      nodes = parseIcu(text);
    } catch {
      nodes = [text];
    }
  }
  if (active.info.pseudo) nodes = pseudoLocalize(nodes, active.info.pseudo);
  compiled.set(key, nodes);
  return nodes;
}

/**
 * Values a plain-text message takes. Elements and other objects go through `msgParts`, which keeps
 * them as parts: in a string they would show as "[object Object]".
 */
export type TextValues = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Translated text. */
export function msg(text: string, values: TextValues = {}): string {
  return formatIcu(nodesFor(text, undefined), values, active.rules);
}

/** Translated text for English that has more than one meaning; `context` tells them apart ("noun", "verb"). */
export function msgc(context: string, text: string, values: TextValues = {}): string {
  return formatIcu(nodesFor(text, context), values, active.rules);
}

/** Translated text as parts, with non-string values (React elements, say) left in place for rich text. */
export function msgParts(text: string, values: IcuValues = {}): unknown[] {
  return formatIcuParts(nodesFor(text, undefined), values, active.rules);
}
