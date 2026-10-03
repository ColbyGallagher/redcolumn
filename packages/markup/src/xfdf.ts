import { arcPoints } from './arc';
import { applyMatrix, type Matrix } from './export';
import { importAnnotations, type ImportableAnnotation } from './import';
import { boundsOf, isTextType, markupBounds, type Markup, type Point } from './model';
import { markupLines } from './textSelect';
import { lineEnds, type LineEnding } from './style';

/**
 * Markups as XFDF, the XML form of PDF annotations that Acrobat, Revu and other PDF tools import
 * and export. Each annotation carries the standard attributes (so other tools read it) and, in
 * `nb-data`, the markup's full data, so this app gets it back exactly.
 */

const XFDF_ENDINGS: Record<LineEnding, string> = {
  none: 'None',
  openArrow: 'OpenArrow',
  closedArrow: 'ClosedArrow',
  filledArrow: 'ClosedArrow',
  circle: 'Circle',
  filledCircle: 'Circle',
  square: 'Square',
  filledSquare: 'Square',
  diamond: 'Diamond',
  filledDiamond: 'Diamond',
  tick: 'Butt',
  slash: 'Slash',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();
const isoDate = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unbase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** The XFDF element and its type-specific attributes and children for a markup. */
function element(m: Markup, user: (p: Point) => Point): { tag: string; attrs: Record<string, string>; children: string[] } {
  const pts = (list: readonly Point[]) => list.map((p) => user(p).map(fmt).join(',')).join(';');
  const [start, end] = lineEnds(m);
  const ends = { head: XFDF_ENDINGS[start], tail: XFDF_ENDINGS[end] };
  switch (m.type) {
    case 'line':
    case 'arrow':
    case 'length':
    case 'dimension':
      return {
        tag: 'line',
        attrs: { start: pts([m.points[0]!]), end: pts([m.points[m.points.length - 1]!]), ...ends, ...(m.type === 'length' ? { IT: 'LineDimension' } : {}) },
        children: [],
      };
    case 'polyline':
    case 'polylength':
    case 'angle':
    case 'arc':
    case 'arcLength':
      return {
        tag: 'polyline',
        attrs: { ...ends, ...(m.type === 'polylength' || m.type === 'arcLength' ? { IT: 'PolyLineDimension' } : {}) },
        children: [`<vertices>${pts(m.type === 'arc' || m.type === 'arcLength' ? arcPoints(m.points, 24) : m.points)}</vertices>`],
      };
    case 'polygon':
    case 'area':
    case 'perimeter':
    case 'volume':
    case 'space':
      return { tag: 'polygon', attrs: m.type === 'area' || m.type === 'volume' ? { IT: 'PolygonDimension' } : {}, children: [`<vertices>${pts(m.points)}</vertices>`] };
    case 'cloud': {
      const b = boundsOf(m.points);
      return { tag: 'polygon', attrs: { style: 'cloudy', intensity: '1', IT: 'PolygonCloud' }, children: [`<vertices>${pts([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]])}</vertices>`] };
    }
    case 'rect':
    case 'redaction':
      return { tag: m.type === 'redaction' ? 'redact' : 'square', attrs: {}, children: [] };
    case 'ellipse':
    case 'diameter':
    case 'radius':
      return { tag: 'circle', attrs: {}, children: [] };
    case 'pen':
    case 'highlighter':
    case 'count':
      return { tag: 'ink', attrs: {}, children: [`<inklist><gesture>${pts(m.points)}</gesture></inklist>`] };
    case 'textHighlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly':
    case 'replaceText': {
      const coords = markupLines(m.points).flatMap((r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map((p) => user(p as Point).map(fmt).join(','))).join(',');
      const tag = { textHighlight: 'highlight', underline: 'underline', strikeout: 'strikeout', squiggly: 'squiggly', replaceText: 'strikeout' }[m.type];
      return { tag, attrs: { coords, ...(m.type === 'replaceText' ? { IT: 'StrikeOutTextEdit' } : {}) }, children: [] };
    }
    case 'text':
    case 'typewriter':
    case 'callout':
    case 'legend':
      return {
        tag: 'freetext',
        attrs: m.type === 'typewriter' ? { IT: 'FreeTextTypeWriter' } : m.type === 'callout' ? { IT: 'FreeTextCallout' } : {},
        children: [`<defaultappearance>/Helv ${m.style.fontSize ?? 12} Tf</defaultappearance>`],
      };
    case 'note':
    case 'flag':
      return { tag: 'text', attrs: { icon: m.type === 'flag' ? 'Flag' : 'Comment' }, children: [] };
    case 'attachment':
      return { tag: 'fileattachment', attrs: { icon: 'Paperclip', ...(m.attachment ? { file: m.attachment.name } : {}) }, children: [] };
    case 'hyperlink':
      return { tag: 'link', attrs: {}, children: [] };
    default:
      // Stamps, images and signatures: a stamp annotation (their picture stays with this app's data).
      return { tag: 'stamp', attrs: { icon: m.type === 'signature' ? 'Signature' : 'Draft' }, children: [] };
  }
}

/**
 * The markups as an XFDF document. `matrixFor` maps each page's space to PDF user space (as
 * `pageMatrix` does); `fileName` names the PDF they belong to.
 */
export function markupsToXfdf(markups: readonly Markup[], matrixFor: (pageIndex: number) => Matrix, fileName = ''): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">', '<annots>'];
  for (const m of [...markups].sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt)) {
    const matrix = matrixFor(m.pageIndex);
    const user = (p: Point) => applyMatrix(matrix, p);
    const b = markupBounds(m);
    const corners = [user([b.x, b.y]), user([b.x + b.w, b.y + b.h])];
    const rect = [Math.min(corners[0]![0], corners[1]![0]), Math.min(corners[0]![1], corners[1]![1]), Math.max(corners[0]![0], corners[1]![0]), Math.max(corners[0]![1], corners[1]![1])];
    const { tag, attrs, children } = element(m, user);
    const text = isTextType(m.type) || m.type === 'dimension' || m.type === 'replaceText' ? m.text : m.comment;
    const all: Record<string, string> = {
      page: String(m.pageIndex),
      rect: rect.map(fmt).join(','),
      color: m.style.stroke,
      ...(m.style.fill ? { 'interior-color': m.style.fill } : {}),
      width: fmt(m.style.width),
      opacity: fmt(m.style.opacity),
      name: m.id,
      title: m.author,
      ...(m.subject ? { subject: m.subject } : {}),
      creationdate: isoDate(m.createdAt),
      date: isoDate(m.modifiedAt),
      flags: [m.hidden ? 'hidden' : 'print', ...(m.locked ? ['locked'] : [])].join(','),
      ...attrs,
      // The full markup (without an attachment's bytes, which XFDF does not carry here).
      'nb-data': base64(JSON.stringify(m.attachment ? { ...m, attachment: { ...m.attachment, data: '' } } : m)),
    };
    const attrText = Object.entries(all)
      .map(([k, v]) => `${k}="${esc(v)}"`)
      .join(' ');
    const body = [...children, ...(text ? [`<contents>${esc(text)}</contents>`] : [])];
    out.push(`<${tag} ${attrText}>${body.join('')}</${tag}>`);
    for (const r of m.replies ?? []) {
      out.push(`<text page="${m.pageIndex}" rect="${rect.map(fmt).join(',')}" name="${esc(r.id)}" title="${esc(r.author)}" date="${isoDate(r.createdAt)}" inreplyto="${esc(m.id)}" replyType="reply" flags="print,nozoom,norotate"><contents>${esc(r.text)}</contents></text>`);
    }
  }
  out.push('</annots>', fileName ? `<f href="${esc(fileName)}"/>` : '', '</xfdf>');
  return out.filter(Boolean).join('\n');
}

/** A parsed XML element: its name, attributes, text and children. */
interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}

const unesc = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!,
  );

/** A small XML reader: elements, attributes and text (enough for XFDF). */
function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, text: '', children: [] };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += unesc(m[6]);
    else if (m[3]) {
      if (m[2]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!.toLowerCase()] = unesc(a[2] ?? a[3] ?? '');
      const node: XmlNode = { name: m[3].replace(/^.*:/, '').toLowerCase(), attrs, text: '', children: [] };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  return root;
}

function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const c of node.children) {
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

const SUBTYPES: Record<string, string> = {
  line: 'Line',
  polyline: 'PolyLine',
  polygon: 'Polygon',
  square: 'Square',
  circle: 'Circle',
  ink: 'Ink',
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  squiggly: 'Squiggly',
  freetext: 'FreeText',
  text: 'Text',
  fileattachment: 'FileAttachment',
  stamp: 'Stamp',
  link: 'Link',
  redact: 'Redact',
};

/**
 * Markups from an XFDF document: annotations this app wrote come back exactly; others (from Acrobat,
 * Revu, ...) become the nearest markup type. `invertFor` maps PDF user space back to each page's
 * space (the inverse of `pageMatrix`). Replies attach to their markups.
 */
export function markupsFromXfdf(xml: string, invertFor: (pageIndex: number) => Matrix | null): Markup[] {
  const root = parseXml(xml);
  const annots = find(root, 'annots');
  if (!find(root, 'xfdf') && !annots) throw new Error('This is not an XFDF file (no <xfdf> or <annots>).');
  const out: Markup[] = [];
  const replies: { to: string; id: string; author: string; text: string; at: number }[] = [];
  const date = (s: string | undefined) => {
    const m = /D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(s ?? '');
    return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : Date.now();
  };
  (annots?.children ?? []).forEach((a, index) => {
    const pageIndex = Number(a.attrs.page ?? 0);
    const contents = find(a, 'contents')?.text ?? a.text.trim();
    if (a.attrs.inreplyto) {
      replies.push({ to: a.attrs.inreplyto, id: a.attrs.name || crypto.randomUUID(), author: a.attrs.title ?? '', text: contents, at: date(a.attrs.date) });
      return;
    }
    if (a.attrs['nb-data']) {
      try {
        const m = JSON.parse(unbase64(a.attrs['nb-data'])) as Markup;
        out.push({ ...m, pageIndex, replies: [] });
        return;
      } catch {
        // Fall through to a standard import.
      }
    }
    const inv = invertFor(pageIndex);
    const subtype = SUBTYPES[a.name];
    if (!inv || !subtype) return;
    const toPage = (x: number, y: number): [number, number] => applyMatrix(inv, [x, y]);
    const pairs = (s: string | undefined) =>
      (s ?? '')
        .split(/[;,\s]+/)
        .filter(Boolean)
        .map(Number)
        .reduce<[number, number][]>((acc, n, i, arr) => (i % 2 === 0 && i + 1 < arr.length ? [...acc, toPage(n, arr[i + 1]!)] : acc), []);
    const r = pairs(a.attrs.rect);
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    const rect = r.length === 2 ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[1]! - xs[0]!), h: Math.abs(ys[1]! - ys[0]!) } : { x: 0, y: 0, w: 0, h: 0 };
    const coords = pairs(a.attrs.coords);
    const quads: [number, number][][] = [];
    // XFDF quads run upper-left, upper-right, lower-left, lower-right, as QuadPoints do.
    for (let i = 0; i + 3 < coords.length; i += 4) quads.push(coords.slice(i, i + 4));
    const flags = (a.attrs.flags ?? '').split(',');
    const annotation: ImportableAnnotation = {
      index,
      subtype,
      rect,
      color: a.attrs.color ?? null,
      interior: a.attrs['interior-color'] ?? null,
      opacity: a.attrs.opacity ? Number(a.attrs.opacity) : 1,
      borderWidth: a.attrs.width ? Number(a.attrs.width) : 1,
      contents,
      author: a.attrs.title ?? '',
      intent: a.attrs.it ?? (a.attrs.style === 'cloudy' ? 'PolygonCloud' : ''),
      cloudy: a.attrs.style === 'cloudy',
      da: find(a, 'defaultappearance')?.text ?? '',
      appData: '',
      flags: flags.includes('hidden') ? 2 : 4,
      vertices: pairs(find(a, 'vertices')?.text),
      ink: (find(a, 'inklist')?.children ?? []).map((g) => pairs(g.text)),
      line: a.attrs.start && a.attrs.end ? [toPage(...(a.attrs.start.split(',').map(Number) as [number, number])), toPage(...(a.attrs.end.split(',').map(Number) as [number, number]))] : null,
      ...(quads.length ? { quads } : {}),
      link: null,
    };
    for (const m of importAnnotations(pageIndex, [annotation]).markups) {
      out.push({ ...m, id: a.attrs.name || m.id, createdAt: date(a.attrs.creationdate ?? a.attrs.date), modifiedAt: date(a.attrs.date), ...(a.attrs.subject ? { subject: a.attrs.subject } : {}) });
    }
  });
  for (const r of replies) {
    const m = out.find((x) => x.id === r.to);
    if (m) m.replies = [...(m.replies ?? []), { id: r.id, author: r.author, text: r.text, createdAt: r.at }];
  }
  return out.map((m) => (m.replies?.length ? m : (({ replies: _r, ...rest }) => rest)(m) as Markup));
}

/** The inverse of an affine matrix (page space ← user space), or null if it is singular. */
export function invertMatrix(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
