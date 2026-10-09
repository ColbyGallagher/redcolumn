/**
 * Bluebeam's markup exchange file (.bax): Revu's Markups › Export / Import Markups. An XML document
 * with, per page, each markup's details as Revu lists them (subject, author, dates, custom column
 * values) and the markup itself: its PDF annotation dictionary, zlib-compressed and hex-encoded
 * (`Raw`). Replies, status changes, pop-ups and the members of a group sit inside their markup. A
 * dictionary refers to another annotation by its /NM (`/IRT/ABCDEF`), and to any other object
 * (appearance streams, measure dictionaries, embedded files) as `/BBObjPtr_<id>`, stored once under
 * GlobalResources.
 */
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFObject, PDFObjectParser, PDFRef, PDFStream, PDFString } from 'pdf-lib';
import { parsePdfDate } from './bluebeam';

// ---- Bytes --------------------------------------------------------------------------------------

async function pipe(bytes: Uint8Array, through: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(through);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const deflate = (bytes: Uint8Array) => pipe(bytes, new CompressionStream('deflate'));
const inflate = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream('deflate'));

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const latin1Text = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};

/** Revu's object ids: 16 capital letters. */
function newId(): string {
  const letters = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(letters, (n) => String.fromCharCode(65 + (n % 26))).join('');
}

// ---- Revu's names for things ---------------------------------------------------------------------

const nameOf = (d: PDFDict, key: string) => d.lookupMaybe(PDFName.of(key), PDFName)?.decodeText();
const textOf = (d: PDFDict, key: string) => d.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText();
const numberOf = (d: PDFDict, key: string) => d.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber();

/** Revu's class for an annotation, as `TypeInternal` names it (its subtype's otherwise). */
export function baxTypeInternal(d: PDFDict): string {
  const subtype = nameOf(d, 'Subtype') ?? 'Unknown';
  const it = nameOf(d, 'IT') ?? '';
  const measure = numberOf(d, 'MeasurementTypes');
  const cls = (() => {
    switch (subtype) {
      case 'Polygon':
        if (it === 'PolygonCount') return 'MeasureCount';
        if (it === 'PolygonRadius') return 'MeasureRadius';
        if (/Dimension|Volume|SketchToScale/.test(it) || measure === 129 || measure === 132) return 'MeasureArea';
        return 'Polygon';
      case 'PolyLine':
        if (it === 'PolyLineAngle') return 'MeasureAngle';
        // Revu's polylengths carry a rise and drop; its perimeters are polylines without one.
        if (/Dimension|SketchToScale/.test(it)) return d.has(PDFName.of('RiseDrop')) ? 'MeasurePolylength' : 'MeasurePerimeter';
        return 'Polyline';
      case 'Circle':
        return it === 'CircleDimension' ? 'MeasureDiameter' : 'Circle';
      case 'Square':
        return d.has(PDFName.of('Image')) || it === 'SquareImage' ? 'BBImage' : 'Square';
      case 'Stamp':
        return 'BRXStamp';
      case 'StrikeOut':
        return 'StrikeOut';
      default:
        return subtype;
    }
  })();
  return `Bluebeam.PDF.Annotations.Annotation${cls}`;
}

/**
 * Revu's newer classes, which BAX names in `TypeInternalNew` beside the older one (an elliptical arc
 * is still a Circle to older readers), with the /IT that says the same in the dictionary.
 */
const NEWER_TYPES: Record<string, string> = { CircleArc: 'Bluebeam.PDF.Annotations.AnnotationArc' };
const INTENT_OF_NEWER: Record<string, string> = Object.fromEntries(Object.entries(NEWER_TYPES).map(([it, cls]) => [cls, it]));

/** A PDF colour array as Revu writes it: #RRGGBB, or Transparent. */
function colourOf(d: PDFDict): string {
  const c = d.lookupMaybe(PDFName.of('C'), PDFArray)?.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0));
  if (!c?.length) return 'Transparent';
  const rgb = c.length === 1 ? [c[0]!, c[0]!, c[0]!] : c.length === 4 ? [0, 1, 2].map((i) => (1 - c[i]!) * (1 - c[3]!)) : c.slice(0, 3);
  return '#' + rgb.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** A PDF date as Revu writes it in BAX: 2026-10-08T21:42:30.0000000Z. */
function isoDate(pdfDate: string | undefined): string | null {
  const t = parsePdfDate(pdfDate);
  return t === null ? null : new Date(t).toISOString().replace(/\.(\d{3})Z$/, '.$10000Z');
}

/** A custom column's name as a BAX element name (spaces and the like become underscores). */
export const baxColumnTag = (name: string) => {
  const tag = name.trim().replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(tag) ? tag : `_${tag}`;
};

// ---- Writing --------------------------------------------------------------------------------------

/** Keys Revu leaves out of a dictionary in BAX: its page and pop-up links (nesting says those). */
const DROPPED_KEYS = new Set(['P', 'Popup', 'Parent']);

class RawWriter {
  /** Objects written as GlobalResources, by object number: their id and bytes. */
  readonly resources = new Map<string, { id: string; raw: Uint8Array | null }>();
  private readonly doc: PDFDocument;
  private readonly nmOf: (ref: PDFRef) => string | undefined;

  constructor(doc: PDFDocument, nmOf: (ref: PDFRef) => string | undefined) {
    this.doc = doc;
    this.nmOf = nmOf;
  }

  /** An annotation dictionary as Revu stores it in BAX. */
  annotation(d: PDFDict): Uint8Array {
    const parts: (string | Uint8Array)[] = [];
    this.write(d, parts, true);
    return join(parts);
  }

  private pointer(ref: PDFRef): string {
    const key = ref.toString();
    let r = this.resources.get(key);
    if (!r) {
      r = { id: newId(), raw: null };
      this.resources.set(key, r);
      const parts: (string | Uint8Array)[] = [];
      this.write(this.doc.context.lookup(ref) ?? PDFNull, parts, false);
      r.raw = join(parts);
    }
    return `/BBObjPtr_${r.id}`;
  }

  private write(o: PDFObject, out: (string | Uint8Array)[], annotation: boolean, key?: string) {
    if (o instanceof PDFRef) {
      // Annotations refer to annotations by /NM; to everything else through GlobalResources.
      const nm = this.nmOf(o);
      if (nm !== undefined) out.push(`/${nm}`);
      else out.push(this.pointer(o));
      return;
    }
    if (o instanceof PDFStream) {
      const contents: Uint8Array = (o as unknown as { getContents(): Uint8Array }).getContents();
      o.dict.set(PDFName.of('Length'), PDFNumber.of(contents.length));
      this.write(o.dict, out, false);
      out.push('\nstream\r\n', contents, '\r\nendstream');
      return;
    }
    if (o instanceof PDFDict) {
      out.push('<<');
      for (const [k, v] of o.entries()) {
        const name = k.decodeText();
        if (annotation && DROPPED_KEYS.has(name)) continue;
        out.push(k.toString());
        if (!(v instanceof PDFName || v instanceof PDFDict || v instanceof PDFArray || v instanceof PDFString || v instanceof PDFHexString || v instanceof PDFRef)) out.push(' ');
        this.write(v, out, false, name);
      }
      out.push('>>');
      return;
    }
    if (o instanceof PDFArray) {
      out.push('[');
      o.asArray().forEach((v, i) => {
        if (i && !(v instanceof PDFName || v instanceof PDFDict || v instanceof PDFArray || v instanceof PDFString || v instanceof PDFHexString)) out.push(' ');
        this.write(v, out, false, key);
      });
      out.push(']');
      return;
    }
    if (o instanceof PDFBool || o === PDFNull) {
      out.push(o.toString());
      return;
    }
    out.push(o.toString());
  }
}

function join(parts: readonly (string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map((p) => (typeof p === 'string' ? latin1(p) : p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One element of the XML, written with Revu's two-space indent and CRLF line ends. */
interface Node {
  tag: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: Node[];
}

function render(n: Node, depth: number, out: string[]) {
  const pad = '  '.repeat(depth);
  const attrs = Object.entries(n.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
  if (n.children?.length) {
    out.push(`${pad}<${n.tag}${attrs}>`);
    for (const c of n.children) render(c, depth + 1, out);
    out.push(`${pad}</${n.tag}>`);
  } else if (n.text) out.push(`${pad}<${n.tag}${attrs}>${escapeXml(n.text)}</${n.tag}>`);
  else out.push(`${pad}<${n.tag}${attrs} />`);
}

export interface BaxExportOptions {
  /** Each page's label (sheet number); the page number where null. */
  pageLabels?: readonly (string | null)[];
}

/**
 * The markups of a PDF as a .bax file. `bytes` is the PDF with its markups written in as
 * annotations (as saving does); every markup annotation on every page goes in, with its replies,
 * status history, pop-up and group members nested inside it. Links and form fields are left out.
 */
export async function exportBax(bytes: Uint8Array | ArrayBuffer, options: BaxExportOptions = {}): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  // The document's custom columns, in the order /BSIColumnData stores their values.
  const columns = (doc.catalog.lookupMaybe(PDFName.of('BSIAnnotColumns'), PDFArray)?.asArray() ?? []).map((c) => {
    const d = ctx.lookup(c);
    return d instanceof PDFDict ? { name: textOf(d, 'Name')?.trim() ?? '', deleted: d.lookupMaybe(PDFName.of('Deleted'), PDFBool)?.asBoolean() === true } : { name: '', deleted: true };
  });

  // Every annotation's /NM (given one where it has none), so dictionaries can refer to each other by it.
  const nms = new Map<string, string>();
  const pages = doc.getPages();
  for (const page of pages) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      if (!(ref instanceof PDFRef)) continue;
      const d = ctx.lookup(ref);
      if (!(d instanceof PDFDict)) continue;
      let nm = textOf(d, 'NM');
      if (!nm) d.set(PDFName.of('NM'), PDFString.of((nm = newId())));
      nms.set(ref.toString(), nm);
    }
  }
  const writer = new RawWriter(doc, (ref) => nms.get(ref.toString()));
  const raw = async (d: PDFDict) => toHex(await deflate(writer.annotation(d)));

  const pageNodes: Node[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const label = options.pageLabels?.[pageIndex] || String(pageIndex + 1);
    const entries = (page.node.Annots()?.asArray() ?? []).flatMap((ref, index) => {
      const d = ctx.lookup(ref);
      return d instanceof PDFDict ? [{ ref, d, index }] : [];
    });
    const byRef = new Map(entries.filter((e) => e.ref instanceof PDFRef).map((e) => [e.ref.toString(), e]));
    const parentOf = (d: PDFDict, key: string) => {
      const r = d.get(PDFName.of(key));
      return r instanceof PDFRef ? byRef.get(r.toString()) : undefined;
    };
    // Where each annotation goes: top level, or inside another as a reply, status, group member or pop-up.
    type Entry = (typeof entries)[number];
    const kids = new Map<Entry, { replies: Entry[]; statuses: Entry[]; children: Entry[]; popup: Entry | null }>();
    const slot = (e: Entry) => {
      let k = kids.get(e);
      if (!k) kids.set(e, (k = { replies: [], statuses: [], children: [], popup: null }));
      return k;
    };
    const top: Entry[] = [];
    for (const e of entries) {
      const subtype = nameOf(e.d, 'Subtype');
      if (subtype === 'Link' || subtype === 'Widget') continue;
      if (subtype === 'Popup') {
        const owner = parentOf(e.d, 'Parent');
        if (owner) slot(owner).popup = e;
        else top.push(e);
        continue;
      }
      const parent = parentOf(e.d, 'IRT');
      if (!parent) {
        top.push(e);
        continue;
      }
      // Replies and statuses belong to the markup at the top of their thread.
      let root = parent;
      for (let n = 0; n < 32; n++) {
        const up = parentOf(root.d, 'IRT');
        if (!up || nameOf(root.d, 'RT') === 'Group') break;
        root = up;
      }
      if (nameOf(e.d, 'RT') === 'Group') slot(parent).children.push(e);
      else if (e.d.has(PDFName.of('StateModel'))) slot(root).statuses.push(e);
      else slot(root).replies.push(e);
    }

    const element = async (tag: string, e: Entry, parentNm?: string): Promise<Node> => {
      const d = e.d;
      const children: Node[] = [];
      const add = (t: string, text?: string | null) => children.push({ tag: t, ...(text ? { text } : {}) });
      add('Page', label);
      add('Contents', textOf(d, 'Contents')?.replace(/\r\n?/g, '\n'));
      add('ModDate', isoDate(textOf(d, 'M')) ?? isoDate(textOf(d, 'CreationDate')));
      add('Color', colourOf(d));
      add('Type', nameOf(d, 'Subtype'));
      add('ID', nms.get(e.ref.toString()));
      const newer = NEWER_TYPES[nameOf(d, 'IT') ?? ''];
      if (newer) add('TypeInternalNew', newer);
      add('TypeInternal', baxTypeInternal(d));
      add('Raw', await raw(d));
      add('Index', String(e.index));
      const data = d.lookupMaybe(PDFName.of('BSIColumnData'), PDFArray)?.asArray() ?? [];
      children.push({
        tag: 'Custom',
        children:
          tag === 'Popup'
            ? []
            : columns.flatMap((c, i) => {
                if (c.deleted || !c.name) return [];
                const v = data[i];
                const text = v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '';
                return [{ tag: baxColumnTag(c.name), ...(text ? { text } : {}) }];
              }),
      });
      if (tag !== 'Popup') {
        add('Subject', textOf(d, 'Subj'));
        add('CreationDate', isoDate(textOf(d, 'CreationDate')) ?? isoDate(textOf(d, 'M')));
        add('Author', textOf(d, 'T'));
      }
      if (parentNm) add('Parent', parentNm);
      if (tag === 'Status') add('State', textOf(d, 'State'));
      const k = kids.get(e);
      const nm = nms.get(e.ref.toString());
      if (k?.popup) children.push(await element('Popup', k.popup));
      if (k?.children.length) children.push({ tag: 'GroupChildren', children: await Promise.all(k.children.map((c) => element('Child', c, nm))) });
      if (k?.replies.length) children.push({ tag: 'Replies', children: await Promise.all(k.replies.map((c) => element('Reply', c, nm))) });
      if (k?.statuses.length) children.push({ tag: 'StatusHistory', children: await Promise.all(k.statuses.map((c) => element('Status', c, nm))) });
      return { tag, children };
    };

    const annotations: Node[] = [];
    for (const e of top) annotations.push(await element('Annotation', e));
    if (!annotations.length) continue;
    const { width, height } = page.getSize();
    pageNodes.push({
      tag: 'Page',
      attrs: { Index: String(pageIndex) },
      children: [{ tag: 'Label', text: label }, { tag: 'Width', text: fmt(width) }, { tag: 'Height', text: fmt(height) }, ...annotations],
    });
  }

  const resources: Node[] = [];
  for (const r of writer.resources.values()) {
    resources.push({ tag: 'Resource', children: [{ tag: 'ID', text: toHex(await deflate(latin1(r.id))) }, { tag: 'Raw', text: toHex(await deflate(r.raw ?? new Uint8Array())) }] });
  }
  const out = ['<?xml version="1.0" encoding="utf-8"?>'];
  render({ tag: 'Document', attrs: { Version: '1' }, children: [...pageNodes, ...(resources.length ? [{ tag: 'GlobalResources', children: resources }] : [])] }, 0, out);
  return '﻿' + out.join('\r\n');
}

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

// ---- Reading -------------------------------------------------------------------------------------

/** One markup from a .bax file, with what is nested inside it. */
export interface BaxMarkup {
  pageIndex: number;
  /** Revu's page label for it, to find the page when the index does not match. */
  pageLabel: string;
  /** The annotation dictionary, as PDF syntax (still with /BBObjPtr_ and /IRT/<NM> names). */
  raw: Uint8Array;
  id: string;
  /** Revu's newer class name for it, where it has one (`TypeInternalNew`). */
  typeNew: string;
  /** Custom column values by element name (see `baxColumnTag`). */
  custom: Record<string, string>;
  replies: BaxMarkup[];
  statuses: BaxMarkup[];
  children: BaxMarkup[];
  popup: BaxMarkup | null;
}

export interface BaxFile {
  pages: { index: number; label: string; markups: BaxMarkup[] }[];
  /** GlobalResources: object bytes by Revu id. */
  resources: Map<string, Uint8Array>;
}

/** An XML element: enough of XML for BAX (elements, attributes and text; no mixed content). */
interface XmlElement {
  tagName: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  textContent: string;
}

const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!,
  );

/** Parses XML into elements (here and in Node, where there is no DOMParser). Throws on bad nesting. */
function parseXml(xml: string): XmlElement {
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

/** Reads a .bax file. Throws when it is not one. */
export async function parseBax(xml: string): Promise<BaxFile> {
  let root: XmlElement;
  try {
    root = parseXml(xml.replace(/^﻿/, ''));
  } catch {
    throw new Error('This is not a Bluebeam markup file (.bax).');
  }
  if (root.tagName !== 'Document') throw new Error('This is not a Bluebeam markup file (.bax).');
  const child = (e: XmlElement, tag: string) => e.children.find((c) => c.tagName === tag) ?? null;
  const text = (e: XmlElement, tag: string) => child(e, tag)?.textContent.trim() ?? '';
  const markup = async (e: XmlElement, pageIndex: number, pageLabel: string): Promise<BaxMarkup> => {
    const list = async (tag: string, item: string) => Promise.all([...(child(e, tag)?.children ?? [])].filter((c) => c.tagName === item).map((c) => markup(c, pageIndex, pageLabel)));
    const custom: Record<string, string> = {};
    for (const c of child(e, 'Custom')?.children ?? []) if (c.textContent.trim()) custom[c.tagName] = c.textContent.trim();
    const popup = child(e, 'Popup');
    return {
      pageIndex,
      pageLabel,
      raw: await inflate(fromHex(text(e, 'Raw'))),
      id: text(e, 'ID'),
      typeNew: text(e, 'TypeInternalNew'),
      custom,
      replies: await list('Replies', 'Reply'),
      statuses: await list('StatusHistory', 'Status'),
      children: await list('GroupChildren', 'Child'),
      popup: popup ? await markup(popup, pageIndex, pageLabel) : null,
    };
  };
  const pages: BaxFile['pages'] = [];
  for (const p of [...root.children].filter((c) => c.tagName === 'Page')) {
    const index = Number(p.attrs.Index ?? '0');
    const label = text(p, 'Label');
    const markups = await Promise.all([...p.children].filter((c) => c.tagName === 'Annotation').map((a) => markup(a, index, label)));
    pages.push({ index, label, markups });
  }
  const resources = new Map<string, Uint8Array>();
  for (const r of child(root, 'GlobalResources')?.children ?? []) {
    if (r.tagName !== 'Resource') continue;
    resources.set(latin1Text(await inflate(fromHex(text(r, 'ID')))), await inflate(fromHex(text(r, 'Raw'))));
  }
  return { pages, resources };
}

export interface BaxInjected {
  /** The PDF with the file's markups added to its pages as annotations. */
  bytes: Uint8Array;
  /** The added annotations' /Annots positions, by page: the markups to import (their replies and states included). */
  added: Record<number, number[]>;
  /** Custom column values of each added markup, by /Annots position per page. */
  custom: Record<number, Record<number, Record<string, string>>>;
  /** Each added markup's /NM (Revu's id), by /Annots position per page. */
  nms: Record<number, Record<number, string>>;
  /**
   * Added markups that are one of the PDF's own annotations (same /NM): the position of that
   * annotation, by the added one's position per page. Importing updates that markup.
   */
  same: Record<number, Record<number, number>>;
  /** Markups for pages the document does not have, left out. */
  offPage: number;
}

/**
 * Adds a .bax file's markups to a copy of `pdf` as annotations, so the PDF import reads them like
 * any of the file's own. Pages are matched by index, or by label when the index's label differs.
 * Markups that are one of the PDF's own annotations (same /NM) are added too, and reported in
 * `same`, so the import can update those markups (their status, replies...). Column values are left
 * off the dictionaries (the file's columns may be in another order) and returned by name instead.
 */
export async function injectBax(pdf: Uint8Array | ArrayBuffer, bax: BaxFile, labels: readonly (string | null)[] = []): Promise<BaxInjected> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  const pages = doc.getPages();
  const parse = (bytes: Uint8Array) => PDFObjectParser.forBytes(bytes, ctx).parseObject();
  // GlobalResources, registered once each when first pointed at.
  const pointers = new Map<string, PDFRef>();
  const pointer = (id: string): PDFObject => {
    let ref = pointers.get(id);
    if (ref) return ref;
    const bytes = bax.resources.get(id);
    if (!bytes) return PDFNull;
    ref = ctx.nextRef();
    pointers.set(id, ref);
    ctx.assign(ref, resolve(parse(bytes), null));
    return ref;
  };
  // A parsed object with /BBObjPtr_ names made references; /IRT names point at annotations by /NM.
  const resolve = (o: PDFObject, byNm: ((nm: string) => PDFRef | undefined) | null, key?: string): PDFObject => {
    if (o instanceof PDFName) {
      const n = o.decodeText();
      if (n.startsWith('BBObjPtr_')) return pointer(n.slice('BBObjPtr_'.length));
      if (key === 'IRT' && byNm) return byNm(n) ?? o;
      return o;
    }
    if (o instanceof PDFStream) {
      resolve(o.dict, byNm);
      return o;
    }
    if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) o.set(k, resolve(v, byNm, k.decodeText()));
      return o;
    }
    if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) o.set(i, resolve(o.get(i), byNm, key));
      return o;
    }
    return o;
  };

  const out: BaxInjected = { bytes: new Uint8Array(), added: {}, custom: {}, nms: {}, same: {}, offPage: 0 };
  for (const p of bax.pages) {
    const at = p.index < pages.length && (!p.label || !labels[p.index] || labels[p.index] === p.label) ? p.index : labels.findIndex((l) => !!l && l === p.label);
    const pageIndex = at >= 0 ? at : p.index < pages.length ? p.index : -1;
    if (pageIndex < 0) {
      out.offPage += p.markups.length;
      continue;
    }
    const page = pages[pageIndex]!;
    // The page's own annotations by /NM (and position); added ones are looked up first.
    const existing = new Map<string, number>();
    (page.node.Annots()?.asArray() ?? []).forEach((r, i) => {
      const d = r instanceof PDFRef ? ctx.lookup(r) : null;
      const nm = d instanceof PDFDict ? textOf(d, 'NM') : undefined;
      if (nm) existing.set(nm, i);
    });
    const refs = new Map<string, PDFRef>();
    const byNm = (nm: string) => refs.get(nm);
    // `listed`: a markup of its own (a top-level one or a group member), not a reply, state or pop-up.
    const add = (m: BaxMarkup, listed: boolean): { ref: PDFRef; dict: PDFDict } | null => {
      const d = parse(m.raw);
      if (!(d instanceof PDFDict)) return null;
      // BAX names some kinds only by their newer class; the dictionary says it with /IT.
      const it = INTENT_OF_NEWER[m.typeNew];
      if (it && !d.has(PDFName.of('IT'))) d.set(PDFName.of('IT'), PDFName.of(it));
      const ref = ctx.nextRef();
      if (m.id) refs.set(m.id, ref);
      d.delete(PDFName.of('BSIColumnData'));
      d.set(PDFName.of('P'), page.ref);
      ctx.assign(ref, d);
      page.node.addAnnot(ref);
      if (listed) {
        const index = page.node.Annots()!.size() - 1;
        (out.added[pageIndex] ??= []).push(index);
        if (m.id) (out.nms[pageIndex] ??= {})[index] = m.id;
        if (Object.keys(m.custom).length) ((out.custom[pageIndex] ??= {})[index] = m.custom);
        const own = existing.get(m.id);
        if (own !== undefined) (out.same[pageIndex] ??= {})[index] = own;
      }
      return { ref, dict: d };
    };
    const added: { m: BaxMarkup; ref: PDFRef; dict: PDFDict }[] = [];
    const walk = (m: BaxMarkup) => {
      const a = add(m, true);
      if (!a) return;
      added.push({ m, ...a });
      for (const c of m.children) walk(c);
      for (const r of [...m.replies, ...m.statuses]) {
        const x = add(r, false);
        if (x) added.push({ m: r, ...x });
      }
      if (m.popup) {
        const pop = add(m.popup, false);
        if (pop) {
          pop.dict.set(PDFName.of('Parent'), a.ref);
          a.dict.set(PDFName.of('Popup'), pop.ref);
        }
      }
    };
    for (const m of p.markups) walk(m);
    // References resolved once every annotation of the page has its object (replies point back up).
    for (const a of added) resolve(a.dict, byNm);
  }
  out.bytes = await doc.save({ useObjectStreams: false });
  return out;
}
