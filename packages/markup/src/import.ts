import type { DetectedLink } from '@nb/sheets';
import { DEFAULT_STYLES, MARKUP_TYPES, type Markup, type MarkupStyle, type MarkupType, type Point } from './model';

/** What import needs from an existing PDF annotation (matches pdf-core's PdfAnnotation). */
export interface ImportableAnnotation {
  index: number;
  subtype: string;
  rect: { x: number; y: number; w: number; h: number };
  color: string | null;
  interior: string | null;
  opacity: number;
  borderWidth: number;
  contents: string;
  author: string;
  intent: string;
  cloudy: boolean;
  da: string;
  appData: string;
  flags: number;
  vertices: [number, number][];
  ink: [number, number][][];
  line: [[number, number], [number, number]] | null;
  /** Text markup annotations: four corners per marked line. */
  quads?: [number, number][][];
  /** FileAttachment annotations: the embedded file. */
  file?: { name: string; data: Uint8Array } | null;
  link: { targetPage: number | null; targetRect: { x: number; y: number; w: number; h: number } | null; uri: string | null; file: string | null } | null;
}

export interface ImportResult {
  markups: Markup[];
  links: DetectedLink[];
  /** /Annots indices now represented by markups or links; the originals are hidden and replaced on export. */
  imported: number[];
}

/** Annotation flags: Invisible, Hidden, NoView. Such annotations are never shown. */
const NOT_SHOWN = 1 | 2 | 32;

function isMarkup(value: unknown): value is Markup {
  const m = value as Markup;
  return !!m && typeof m.id === 'string' && MARKUP_TYPES.includes(m.type) && Array.isArray(m.points) && typeof m.style === 'object';
}

/**
 * Converts one page's PDF annotations into editable markups and hyperlinks. Annotations this app
 * exported carry their full markup data and come back exactly; other markups (from other PDF tools,
 * ...) map to the nearest markup type. Anything without an equivalent (stamps, form fields, text
 * highlights, AutoCAD's hidden SHX text) is left for PDFium to draw as before.
 */
export function importAnnotations(
  pageIndex: number,
  annotations: readonly ImportableAnnotation[],
  /**
   * Resolves a link to another file (e.g. `HLD1BDD-...-DRG-100051.pdf`) to a page of this
   * document, for sets published sheet-per-file and then combined.
   */
  resolveFile: (fileName: string) => number | null = () => null,
): ImportResult {
  const markups: Markup[] = [];
  const links: DetectedLink[] = [];
  const imported: number[] = [];
  const now = Date.now();

  for (const a of annotations) {
    if (a.appData) {
      try {
        const data: unknown = JSON.parse(a.appData);
        if (isMarkup(data)) {
          // Attachments keep their bytes in the embedded file only.
          const attachment = data.attachment && !data.attachment.data && a.file ? { ...data.attachment, data: toBase64(a.file.data) } : data.attachment;
          markups.push({ ...data, pageIndex, ...(attachment ? { attachment } : {}) });
          imported.push(a.index);
          continue;
        }
        // A reply we exported: its markup carries it already.
        if (data && typeof data === 'object' && 'replyTo' in data) {
          imported.push(a.index);
          continue;
        }
      } catch {
        // Not our data after all; fall through to a regular import.
      }
    }
    if (a.flags & NOT_SHOWN) continue;

    if (a.subtype === 'Link') {
      const fileName = a.link?.file?.split(/[\\/]/).pop()?.replace(/\.pdf$/i, '') ?? null;
      const targetPage = a.link?.targetPage ?? (fileName ? resolveFile(fileName) : null);
      if (a.link?.uri && targetPage === null) {
        // Web links become hyperlink markups, editable like ones drawn here.
        const r = a.rect;
        markups.push({
          id: `pdf-${pageIndex}-${a.index}`,
          type: 'hyperlink',
          pageIndex,
          points: [[r.x, r.y], [r.x + r.w, r.y + r.h]],
          style: { ...DEFAULT_STYLES.hyperlink, width: 0 },
          link: { kind: 'url', url: a.link.uri },
          status: 'none',
          author: a.author,
          createdAt: now,
          modifiedAt: now,
        });
        imported.push(a.index);
        continue;
      }
      if (!a.link || targetPage === null) continue;
      links.push({
        id: `pdf-${pageIndex}-${a.index}`,
        pageIndex,
        rect: a.rect,
        label: fileName ?? 'PDF link',
        kind: a.link.targetRect ? 'detail' : 'sheet',
        detail: null,
        targetPage,
        targetRect: a.link.targetRect,
        confidence: 1,
      });
      imported.push(a.index);
      continue;
    }

    const found = toMarkups(a);
    if (!found.length) continue;
    found.forEach((f, k) => {
      const style: MarkupStyle = {
        stroke: a.color ?? '#e11d48',
        fill: f.filled ? a.interior : null,
        width: a.borderWidth > 0 ? a.borderWidth : 1,
        opacity: a.opacity,
      };
      if (f.type === 'note') {
        // A Text annotation's /C is its icon colour: the note's paper.
        style.fill = a.color ?? '#fde047';
        style.stroke = '#a16207';
        style.width = 0.75;
      }
      if (f.type === 'typewriter') style.width = 0;
      if (f.type === 'text' || f.type === 'typewriter') {
        style.fontSize = Number(/([\d.]+)\s+Tf/.exec(a.da)?.[1]) || 12;
        // Font resource names in /DA hint at the family (Acrobat: Helv, TiRo, Cour).
        const font = /\/([^\s/]+)\s+[\d.]+\s+Tf/.exec(a.da)?.[1]?.toLowerCase() ?? '';
        if (/^(tiro|times)/.test(font)) style.fontFamily = 'serif';
        else if (/^cour/.test(font)) style.fontFamily = 'mono';
        if (/bold|,b/.test(font)) style.bold = true;
      }
      if (f.type === 'area') style.fillOpacity = 0.2;
      markups.push({
        id: `pdf-${pageIndex}-${a.index}${found.length > 1 ? `-${k}` : ''}`,
        type: f.type,
        pageIndex,
        points: f.points,
        style,
        ...(f.type === 'text' || f.type === 'typewriter' ? { text: a.contents } : a.contents ? { comment: a.contents } : {}),
        ...(f.type === 'attachment' && a.file ? { attachment: { name: a.file.name, mime: mimeOf(a.file.name), size: a.file.data.length, data: toBase64(a.file.data) } } : {}),
        status: 'none',
        author: a.author || 'Imported',
        createdAt: now,
        modifiedAt: now,
      });
    });
    imported.push(a.index);
  }
  return { markups, links, imported };
}

/** Markup shapes for a foreign annotation, or none when it has no editable equivalent. */
function toMarkups(a: ImportableAnnotation): { type: MarkupType; points: Point[]; filled: boolean }[] {
  const r = a.rect;
  // Box shapes: the rect includes half the border on each side.
  const inset = a.borderWidth / 2;
  const box: Point[] = [
    [r.x + inset, r.y + inset],
    [r.x + r.w - inset, r.y + r.h - inset],
  ];
  const bounds = (pts: [number, number][]): Point[] => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
    ];
  };
  switch (a.subtype) {
    case 'Line':
      return a.line ? [{ type: a.intent === 'LineDimension' ? 'length' : 'line', points: a.line.map((p) => [p[0], p[1]] as Point), filled: false }] : [];
    case 'Square':
      return [{ type: 'rect', points: box, filled: true }];
    case 'Circle':
      return [{ type: 'ellipse', points: box, filled: true }];
    case 'Polygon':
      if (a.vertices.length < 3) return [];
      if (a.cloudy || a.intent === 'PolygonCloud') return [{ type: 'cloud', points: bounds(a.vertices), filled: true }];
      return [{ type: a.intent === 'PolygonDimension' ? 'area' : 'polygon', points: a.vertices.map((p) => [p[0], p[1]] as Point), filled: true }];
    case 'PolyLine':
      if (a.vertices.length < 2) return [];
      return [{ type: a.intent === 'PolyLineDimension' ? 'polylength' : 'polyline', points: a.vertices.map((p) => [p[0], p[1]] as Point), filled: false }];
    case 'Text':
      return [{ type: 'note', points: [[r.x, r.y], [r.x + r.w, r.y + r.h]], filled: true }];
    case 'Ink': {
      // A translucent, wide ink stroke is a highlighter.
      const type: MarkupType = a.opacity < 0.8 && a.borderWidth >= 6 ? 'highlighter' : 'pen';
      return a.ink.filter((path) => path.length >= 2).map((path) => ({ type, points: path.map((p) => [p[0], p[1]] as Point), filled: false }));
    }
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
    case 'Squiggly': {
      // Each marked line as two opposite corners, as text markups drawn here keep them.
      const lines = (a.quads ?? []).map(bounds).flat();
      if (!lines.length) return [];
      const type = ({ Highlight: 'textHighlight', Underline: 'underline', StrikeOut: a.intent === 'StrikeOutTextEdit' ? 'replaceText' : 'strikeout', Squiggly: 'squiggly' } as const)[a.subtype];
      return [{ type, points: lines, filled: false }];
    }
    case 'FileAttachment':
      return [{ type: 'attachment', points: [[r.x, r.y], [r.x + r.w, r.y + r.h]], filled: true }];
    case 'FreeText':
      return [{ type: a.intent === 'FreeTextTypeWriter' ? 'typewriter' : 'text', points: box, filled: a.intent !== 'FreeTextTypeWriter' }];
    default:
      return [];
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A MIME type from a file name's extension, for attachments other tools embedded. */
export function mimeOf(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    txt: 'text/plain',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dwg: 'image/vnd.dwg',
    webm: 'audio/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
  };
  return types[ext] ?? 'application/octet-stream';
}
