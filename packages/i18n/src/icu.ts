/**
 * ICU MessageFormat, the subset translations need: `{name}`, `{n, number}`, `{n, plural, …}`,
 * `{n, selectordinal, …}`, `{x, select, …}`, `#` inside plurals, and apostrophe quoting.
 *
 * Plural categories come from `Intl.PluralRules`, so a language with six plural forms (Arabic) or
 * three (Russian) needs no code here: its translation simply lists more cases.
 */

export type IcuNode =
  | string
  | { kind: 'arg'; name: string }
  | { kind: 'number'; name: string; style?: string }
  | { kind: 'plural'; name: string; ordinal: boolean; options: Record<string, IcuNode[]> }
  | { kind: 'select'; name: string; options: Record<string, IcuNode[]> }
  | { kind: 'pound' };

export class IcuSyntaxError extends Error {
  readonly source: string;
  readonly offset: number;
  constructor(message: string, source: string, offset: number) {
    super(`${message} at ${offset} in "${source}"`);
    this.name = 'IcuSyntaxError';
    this.source = source;
    this.offset = offset;
  }
}

const NAME = /[\p{L}\p{N}_]/u;
const SPACE = /\s/;

/** Parses an ICU message. Throws IcuSyntaxError on malformed input. */
export function parseIcu(source: string): IcuNode[] {
  let i = 0;
  const fail = (what: string): never => {
    throw new IcuSyntaxError(what, source, i);
  };
  const skipSpace = () => {
    while (i < source.length && SPACE.test(source[i]!)) i++;
  };
  const word = (): string => {
    const start = i;
    while (i < source.length && NAME.test(source[i]!)) i++;
    if (i === start) fail('Expected a name');
    return source.slice(start, i);
  };
  const expect = (ch: string) => {
    if (source[i] !== ch) fail(`Expected "${ch}"`);
    i++;
  };

  /** Reads a message until `}` (when nested) or the end. `inPlural` makes `#` special. */
  const message = (nested: boolean, inPlural: boolean): IcuNode[] => {
    const out: IcuNode[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push(text);
      text = '';
    };
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === "'") {
        const next = source[i + 1];
        if (next === "'") {
          text += "'";
          i += 2;
        } else if (next === '{' || next === '}' || (inPlural && next === '#')) {
          // Quoted literal: up to the next lone apostrophe ('' inside is one apostrophe).
          i++;
          while (i < source.length) {
            if (source[i] === "'") {
              if (source[i + 1] === "'") {
                text += "'";
                i += 2;
                continue;
              }
              i++;
              break;
            }
            text += source[i++];
          }
        } else {
          text += "'";
          i++;
        }
      } else if (ch === '{') {
        flush();
        out.push(argument());
      } else if (ch === '}') {
        if (!nested) fail('Unmatched "}"');
        break;
      } else if (ch === '#' && inPlural) {
        flush();
        out.push({ kind: 'pound' });
        i++;
      } else {
        text += ch;
        i++;
      }
    }
    flush();
    return out;
  };

  const options = (inPlural: boolean): Record<string, IcuNode[]> => {
    const opts: Record<string, IcuNode[]> = {};
    skipSpace();
    while (i < source.length && source[i] !== '}') {
      let key: string;
      if (source[i] === '=') {
        i++;
        const start = i;
        while (i < source.length && /[0-9.]/.test(source[i]!)) i++;
        if (i === start) fail('Expected a number after "="');
        key = `=${source.slice(start, i)}`;
      } else key = word();
      if (key in opts) fail(`Duplicate case "${key}"`);
      skipSpace();
      expect('{');
      opts[key] = message(true, inPlural);
      expect('}');
      skipSpace();
    }
    if (!('other' in opts)) fail('Missing "other" case');
    return opts;
  };

  const argument = (): IcuNode => {
    expect('{');
    skipSpace();
    const name = word();
    skipSpace();
    if (source[i] === '}') {
      i++;
      return { kind: 'arg', name };
    }
    expect(',');
    skipSpace();
    const type = word();
    skipSpace();
    let node: IcuNode;
    if (type === 'number') {
      let style: string | undefined;
      if (source[i] === ',') {
        i++;
        skipSpace();
        style = word();
        skipSpace();
      }
      node = { kind: 'number', name, ...(style ? { style } : {}) };
    } else if (type === 'plural' || type === 'selectordinal') {
      expect(',');
      node = { kind: 'plural', name, ordinal: type === 'selectordinal', options: options(true) };
    } else if (type === 'select') {
      expect(',');
      node = { kind: 'select', name, options: options(false) };
    } else return fail(`Unknown argument type "${type}"`);
    expect('}');
    return node;
  };

  const nodes = message(false, false);
  if (i < source.length) fail('Unexpected text');
  return nodes;
}

/** Every argument name a message uses, nested ones included. */
export function argNames(nodes: readonly IcuNode[], into = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (typeof n === 'string' || n.kind === 'pound') continue;
    into.add(n.name);
    if (n.kind === 'plural' || n.kind === 'select') for (const opt of Object.values(n.options)) argNames(opt, into);
  }
  return into;
}

export type IcuValues = Readonly<Record<string, unknown>>;

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function numberFormat(locale: string, style?: string): Intl.NumberFormat {
  const key = `${locale}|${style ?? ''}`;
  let f = numberFormats.get(key);
  if (!f) {
    const opts: Intl.NumberFormatOptions = style === 'integer' ? { maximumFractionDigits: 0 } : style === 'percent' ? { style: 'percent' } : { maximumFractionDigits: 20 };
    f = new Intl.NumberFormat(locale, opts);
    numberFormats.set(key, f);
  }
  return f;
}

function pluralCategory(locale: string, ordinal: boolean, n: number): string {
  const key = `${locale}|${ordinal}`;
  let r = pluralRules.get(key);
  if (!r) {
    r = new Intl.PluralRules(locale, { type: ordinal ? 'ordinal' : 'cardinal' });
    pluralRules.set(key, r);
  }
  return r.select(n);
}

/**
 * Formats parsed nodes. Strings are joined; any other value (a React element, say) is passed
 * through as its own part, so callers can render rich text. A missing value leaves `{name}`.
 */
export function formatIcuParts(nodes: readonly IcuNode[], values: IcuValues, locale: string): unknown[] {
  const out: unknown[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] += v;
    else out.push(v);
  };
  const walk = (list: readonly IcuNode[], pound: number | undefined) => {
    for (const n of list) {
      if (typeof n === 'string') push(n);
      else if (n.kind === 'pound') push(pound === undefined ? '#' : numberFormat(locale).format(pound));
      else if (!(n.name in values)) push(`{${n.name}}`);
      else {
        const v = values[n.name];
        if (n.kind === 'arg') push(typeof v === 'number' ? numberFormat(locale).format(v) : typeof v === 'string' ? v : v == null || v === false ? '' : typeof v === 'object' ? v : String(v));
        else if (n.kind === 'number') push(numberFormat(locale, n.style).format(Number(v)));
        else if (n.kind === 'select') walk(n.options[String(v)] ?? n.options.other!, pound);
        else {
          const num = Number(v);
          const exact = n.options[`=${num}`];
          walk(exact ?? n.options[pluralCategory(locale, n.ordinal, num)] ?? n.options.other!, num);
        }
      }
    }
  };
  walk(nodes, undefined);
  return out;
}

/** Formats parsed nodes to a string. */
export function formatIcu(nodes: readonly IcuNode[], values: IcuValues, locale: string): string {
  return formatIcuParts(nodes, values, locale).map((p) => (typeof p === 'string' ? p : String(p))).join('');
}

/** Maps every text run of a message (not names, keys or `#`), for pseudo-localization. */
export function mapIcuText(nodes: readonly IcuNode[], fn: (text: string) => string): IcuNode[] {
  return nodes.map((n) => {
    if (typeof n === 'string') return fn(n);
    if (n.kind === 'plural' || n.kind === 'select') return { ...n, options: Object.fromEntries(Object.entries(n.options).map(([k, v]) => [k, mapIcuText(v, fn)])) };
    return n;
  });
}
