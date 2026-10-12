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

/** Parses XML into elements (here and in Node, where there is no DOMParser). Throws on bad nesting. */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { tagName: '#root', attrs: {}, children: [], textContent: '' };
  const stack = [root];
  const token = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w.:-]+)\s*>|<([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(token)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.textContent += m[1];
    else if (m[2]) {
      if (top.tagName !== m[2]) throw new Error(`Unexpected </${m[2]}>`);
      stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = unescapeXml(a[2] ?? a[3] ?? '');
      const el: XmlElement = { tagName: m[3], attrs, children: [], textContent: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.textContent += unescapeXml(m[6]);
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1]!.tagName}> is not closed`);
  const doc = root.children[0];
  if (!doc) throw new Error('Empty file');
  return doc;
}
