/** An XML element: enough of XML for Bluebeam's files (elements, attributes and text; no mixed content). */
export interface XmlElement {
  tagName: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  textContent: string;
}

export const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!,
  );

const isNameChar = (c: string | undefined) => !!c && /[\w.:-]/.test(c);
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * Parses XML into elements (here and in Node, where there is no DOMParser). Throws on bad nesting.
 * A single scan with no backtracking, so a hostile file cannot make it slow.
 */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { tagName: '#root', attrs: {}, children: [], textContent: '' };
  const stack = [root];
  const n = xml.length;
  /** The index after `end`, searching from `from`; throws when the file stops first. */
  const skipTo = (end: string, from: number) => {
    const at = xml.indexOf(end, from);
    if (at < 0) throw new Error(`Missing ${end}`);
    return at;
  };
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1]!;
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i);
      const stop = next < 0 ? n : next;
      top.textContent += unescapeXml(xml.slice(i, stop));
      i = stop;
    } else if (xml.startsWith('<?', i)) {
      i = skipTo('?>', i + 2) + 2;
    } else if (xml.startsWith('<!--', i)) {
      i = skipTo('-->', i + 4) + 3;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const at = skipTo(']]>', i + 9);
      top.textContent += xml.slice(i + 9, at);
      i = at + 3;
    } else if (xml.startsWith('<!', i)) {
      // A <!DOCTYPE …> and the like: nothing we read.
      i = skipTo('>', i + 2) + 1;
    } else if (xml.startsWith('</', i)) {
      const at = skipTo('>', i + 2);
      const name = xml.slice(i + 2, at).trim();
      if (top.tagName !== name) throw new Error(`Unexpected </${name}>`);
      stack.pop();
      i = at + 1;
    } else {
      let j = i + 1;
      while (isNameChar(xml[j])) j++;
      const el: XmlElement = { tagName: xml.slice(i + 1, j), attrs: {}, children: [], textContent: '' };
      if (!el.tagName) throw new Error('Unexpected <');
      let selfClosing = false;
      for (;;) {
        while (isSpace(xml[j])) j++;
        if (xml[j] === '>') {
          j++;
          break;
        }
        if (xml[j] === '/' && xml[j + 1] === '>') {
          selfClosing = true;
          j += 2;
          break;
        }
        const nameStart = j;
        while (isNameChar(xml[j])) j++;
        if (j === nameStart) throw new Error(`Bad attribute in <${el.tagName}>`);
        const name = xml.slice(nameStart, j);
        while (isSpace(xml[j])) j++;
        if (xml[j] !== '=') throw new Error(`Bad attribute in <${el.tagName}>`);
        j++;
        while (isSpace(xml[j])) j++;
        const quote = xml[j];
        if (quote !== '"' && quote !== "'") throw new Error(`Bad attribute in <${el.tagName}>`);
        const close = skipTo(quote, j + 1);
        el.attrs[name] = unescapeXml(xml.slice(j + 1, close));
        j = close + 1;
      }
      top.children.push(el);
      if (!selfClosing) stack.push(el);
      i = j;
    }
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1]!.tagName}> is not closed`);
  const doc = root.children[0];
  if (!doc) throw new Error('Empty file');
  return doc;
}
