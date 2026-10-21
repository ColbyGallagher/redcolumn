/**
 * A small XML reader for LandXML: elements, attributes and text, without namespaces, DTDs or
 * entities beyond the predefined ones. Enough for survey and civil exchange files, and it runs
 * outside the browser (no DOMParser) for tests.
 */

export interface XmlElement {
  /** The local name (any namespace prefix dropped). */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

const localName = (n: string) => n.slice(n.indexOf(':') + 1);

export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1]!.text += decode(text.slice(i, lt));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      stack[stack.length - 1]!.text += text.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') {
      const end = text.indexOf('>', lt + 1);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const gt = findTagEnd(text, lt + 1);
    const body = text.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === '/') {
      const name = localName(body.slice(1).trim());
      // Close back to the matching element (tolerating stray tags).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const m = /^\s*([^\s/>]+)/.exec(inner);
    if (!m) continue;
    const el: XmlElement = { name: localName(m[1]!), attrs: {}, children: [], text: '' };
    for (const a of inner.slice(m[0].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      el.attrs[localName(a[1]!)] = decode(a[3] ?? a[4] ?? '');
    }
    stack[stack.length - 1]!.children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

/** The index of the `>` that closes a tag, skipping any inside quoted attribute values. */
function findTagEnd(text: string, from: number): number {
  let quote = '';
  for (let k = from; k < text.length; k++) {
    const c = text[k]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return k;
  }
  return text.length;
}

/** The element's children with a name. */
export const kids = (el: XmlElement | undefined, name: string): XmlElement[] => el?.children.filter((c) => c.name === name) ?? [];
export const kid = (el: XmlElement | undefined, name: string): XmlElement | undefined => el?.children.find((c) => c.name === name);

/** Every descendant (depth first) with a name. */
export function descendants(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

/** Whitespace-separated numbers in an element's text. */
export const numbersOf = (s: string): number[] =>
  s
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((v) => Number.isFinite(v));
