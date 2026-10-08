import type { DetectedLink } from '@nb/sheets';
import { bulgeThrough, type Scale } from '@nb/measure';
import { DEFAULT_STYLES, isTextType, MARKUP_TYPES, type CountShape, type Markup, type MarkupStyle, type MarkupType, type Point, type Reply } from './model';
import {
  arr,
  cleanText,
  colorHex,
  daTextColor,
  dict,
  importColumnData,
  importSpaces,
  importViewports,
  lineEndingOf,
  scaleFromMeasure,
  nameOf,
  num,
  nums,
  pagePoints,
  parseDefaultStyle,
  parsePdfDate,
  refNum,
  statusIdOf,
  str,
  userToPage,
  type PdfDictValue,
  type PdfExtras,
} from './bluebeam';
import { markupDigest } from './digest';
import type { LineDash } from './style';
import type { Viewport } from './viewports';

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
  /** Blend mode Multiply (a highlighter). */
  multiply?: boolean;
  /** Object number of the annotation dictionary (0 or absent when direct), to find its raw values. */
  objectNumber?: number;
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
  /** The page's drawing scale, when the PDF records one (Bluebeam's page viewport). */
  scale?: Scale | null;
  /** Regions of the page with their own scale (Bluebeam viewports). */
  viewports?: Viewport[];
  /** Status names seen (e.g. "Accepted"), with the state model each was set in, for the document's statuses. */
  statuses?: { name: string; model: string }[];
}

/** Annotation flags: Invisible, Hidden, NoView. Such annotations are never shown. */
const NOT_SHOWN = 1 | 2 | 32;
const LOCKED = 128;

function isMarkup(value: unknown): value is Markup {
  const m = value as Markup;
  return !!m && typeof m.id === 'string' && MARKUP_TYPES.includes(m.type) && Array.isArray(m.points) && typeof m.style === 'object';
}

/** What a reply or review-state annotation says about the markup it belongs to. */
interface Thread {
  owned: number[];
  replies: Reply[];
  states: { state: string; model: string; at: number; order: number }[];
}

/**
 * Converts one page's PDF annotations into editable markups and hyperlinks. Annotations this app
 * exported carry their full markup data and come back exactly; other markups (Bluebeam Revu,
 * Acrobat, ...) map to the matching markup type, reading the raw annotation values in `extras`
 * when given (measurements, callouts, custom columns, replies and review states). Anything without
 * an equivalent (stamps, form fields) is left for PDFium to draw as before. Each imported markup
 * is linked to its annotation (`pdfAnnot`), so saving replaces that annotation in place.
 */
export function importAnnotations(
  pageIndex: number,
  annotations: readonly ImportableAnnotation[],
  /**
   * Resolves a link to another file (e.g. `HLD1BDD-...-DRG-100051.pdf`) to a page of this
   * document, for sets published sheet-per-file and then combined.
   */
  resolveFile: (fileName: string) => number | null = () => null,
  extras: PdfExtras | null = null,
): ImportResult {
  const markups: Markup[] = [];
  const links: DetectedLink[] = [];
  const imported: number[] = [];
  const now = Date.now();
  /** Count markups by the group their items' annotations share. */
  const counts = new Map<string, Markup>();
  const page = extras?.pages[pageIndex] ?? null;
  const toPage = page ? userToPage(page.matrix) : null;

  /** The raw dictionary behind an annotation, checked by object number. */
  const rawOf = (a: Pick<ImportableAnnotation, 'index' | 'objectNumber'>): PdfDictValue | null => {
    if (!page) return null;
    if (a.objectNumber && page.objectNumbers[a.index] !== a.objectNumber) {
      const i = page.objectNumbers.indexOf(a.objectNumber);
      return i >= 0 ? page.annots[i] ?? null : null;
    }
    return page.annots[a.index] ?? null;
  };
  const indexOfRef = (n: number | null): number => (page && n ? page.objectNumbers.indexOf(n) : -1);
  const byIndex = new Map(annotations.map((a) => [a.index, a]));

  // Replies, review states and popups belong to the markup they point at; group members share a group.
  const threads = new Map<number, Thread>();
  const thread = (i: number) => {
    let t = threads.get(i);
    if (!t) threads.set(i, (t = { owned: [], replies: [], states: [] }));
    return t;
  };
  const groups = new Map<number, string>();
  const owner = new Map<number, number>();
  const statuses = new Map<string, string>();
  if (page) {
    const parentOf = (i: number): number | null => {
      const r = page.annots[i];
      if (!r) return null;
      const p = indexOfRef(refNum(r.IRT));
      return p >= 0 && p !== i ? p : null;
    };
    const isThreadItem = (i: number) => {
      const r = page.annots[i];
      return !!r && nameOf(r.Subtype) === 'Text' && parentOf(i) !== null && nameOf(r.RT) !== 'Group';
    };
    // The markup a reply (or a reply to a reply) ultimately belongs to.
    const rootOf = (i: number): number => {
      let at = i;
      for (let n = 0; n < 32 && isThreadItem(at); n++) at = parentOf(at)!;
      return at;
    };
    for (const a of annotations) {
      const r = rawOf(a);
      if (!r) continue;
      if (a.subtype === 'Popup') {
        const p = indexOfRef(refNum(r.Parent));
        if (p >= 0 && byIndex.has(p)) {
          thread(p).owned.push(a.index);
          owner.set(a.index, p);
        }
        continue;
      }
      const parent = parentOf(a.index);
      if (parent === null) continue;
      if (nameOf(r.RT) === 'Group') {
        let root = parent;
        for (let n = 0; n < 32; n++) {
          const up = page.annots[root];
          const next = up && nameOf(up.RT) === 'Group' ? parentOf(root) : null;
          if (next === null) break;
          root = next;
        }
        const id = `pdf-group-${pageIndex}-${root}`;
        groups.set(a.index, id);
        groups.set(root, id);
        continue;
      }
      if (!isThreadItem(a.index)) continue;
      const root = rootOf(a.index);
      if (!byIndex.has(root) || isThreadItem(root)) continue;
      const t = thread(root);
      t.owned.push(a.index);
      owner.set(a.index, root);
      const at = parsePdfDate(str(r.M)) ?? parsePdfDate(str(r.CreationDate)) ?? now;
      const model = str(r.StateModel);
      const state = str(r.State);
      if (model && state) {
        t.states.push({ state, model, at, order: a.index });
        if (model !== 'Marked' && !statuses.has(state)) statuses.set(state, model);
      } else {
        t.replies.push({ id: str(r.NM) || `pdf-${pageIndex}-${a.index}`, author: str(r.T) ?? a.author, text: cleanText(str(r.Contents) ?? a.contents), createdAt: parsePdfDate(str(r.CreationDate)) ?? at });
      }
    }
  }

  /** Links a new markup to its annotation and fills in what the annotation's thread and raw values say. */
  const finish = (m: Markup, a: ImportableAnnotation, r: PdfDictValue | null, part: number | null, ours: boolean): Markup => {
    const t = threads.get(a.index);
    if (t) {
      const have = new Set((m.replies ?? []).map((x) => x.id));
      const replies = [...(m.replies ?? []), ...t.replies.filter((x) => !have.has(x.id))].sort((x, y) => x.createdAt - y.createdAt);
      if (replies.length) m.replies = replies;
      // The latest state is the status, whether Review or a custom status set's (Bluebeam's
      // Marked model is a separate check).
      const latest = (match: (model: string) => boolean) => t.states.filter((s) => match(s.model)).sort((x, y) => x.at - y.at || x.order - y.order).at(-1);
      const review = latest((model) => model !== 'Marked');
      if (review) m.status = statusIdOf(review.state);
      // Bluebeam's checkmark: the Marked model, Marked or Unmarked.
      const marked = latest((model) => model === 'Marked');
      if (marked) m.checked = marked.state === 'Marked';
    }
    if (r) {
      const fields = extras ? importColumnData(r.BSIColumnData, extras.columns) : undefined;
      if (fields) m.fields = ours ? { ...m.fields, ...fields } : fields;
      if (!ours) {
        const subject = str(r.Subj);
        if (subject) m.subject = subject;
        const layer = extras?.ocgNames.get(refNum(r.OC) ?? -1);
        if (layer) m.layer = layer;
        const group = groups.get(a.index);
        if (group) m.groupId = group;
        if (a.flags & LOCKED) m.locked = true;
        const created = parsePdfDate(str(r.CreationDate));
        const modified = parsePdfDate(str(r.M));
        if (created) m.createdAt = created;
        if (modified ?? created) m.modifiedAt = (modified ?? created)!;
      }
    }
    m.pdfAnnot = {
      index: a.index,
      digest: '',
      id: m.id,
      ...(part !== null ? { part } : {}),
      ...(t?.owned.length ? { owned: [...t.owned].sort((x, y) => x - y) } : {}),
      status: m.status,
      ...(m.checked !== undefined ? { checked: m.checked } : {}),
      ...(m.image && !ours && a.subtype === 'Stamp' ? { image: markupDigest({ image: m.image } as Markup) } : {}),
    };
    return m;
  };

  for (const a of annotations) {
    if (owner.has(a.index)) {
      // A popup, reply or review state: saved with the markup it belongs to.
      imported.push(a.index);
      continue;
    }
    const r = rawOf(a);
    if (a.appData) {
      try {
        const data: unknown = JSON.parse(a.appData);
        if (isMarkup(data)) {
          // Attachments keep their bytes in the embedded file only.
          const attachment = data.attachment && !data.attachment.data && a.file ? { ...data.attachment, data: toBase64(a.file.data) } : data.attachment;
          const { pdfAnnot: _stale, ...rest } = data;
          markups.push(finish({ ...rest, pageIndex, ...(attachment ? { attachment } : {}) }, a, r, null, true));
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

    const found = r && toPage ? fromRaw(a, r, toPage, extras!, pageIndex) : toMarkups(a);
    if (!found.length) continue;
    found.forEach((f, k) => {
      const style: MarkupStyle = {
        stroke: a.color ?? '#e11d48',
        fill: f.filled ? a.interior : null,
        width: a.borderWidth > 0 ? a.borderWidth : f.type === 'area' || f.type === 'volume' || f.type === 'count' ? 0 : 1,
        opacity: a.opacity,
        ...f.style,
      };
      if (!r) {
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
      }
      if (style.width === 0 && f.type === 'text' && !style.fill) style.noBox = true;
      const contents = cleanText((r && str(r.Contents)) ?? a.contents);
      const textual = isTextType(f.type) || f.type === 'dimension';
      // A measurement's /Contents is its value as the other tool showed it, not a comment.
      const comment = !textual && !f.measure && contents ? contents : null;
      const m: Markup = {
        id: `pdf-${pageIndex}-${a.index}${found.length > 1 ? `-${k}` : ''}`,
        type: f.type,
        pageIndex,
        points: f.points,
        style,
        ...(textual ? { text: f.text ?? contents } : comment ? { comment } : {}),
        ...(f.extra ?? {}),
        ...(f.type === 'attachment' && a.file ? { attachment: { name: a.file.name, mime: mimeOf(a.file.name), size: a.file.data.length, data: toBase64(a.file.data) } } : {}),
        status: 'none',
        author: a.author || 'Imported',
        createdAt: now,
        modifiedAt: now,
      };
      const done = finish(m, a, r, found.length > 1 ? k : null, false);
      // Bluebeam writes a count as one annotation per item, grouped: they become one count markup.
      const group = done.type === 'count' && done.points.length === 1 ? done.groupId : undefined;
      const into = group ? counts.get(group) : undefined;
      if (into?.pdfAnnot) {
        into.points.push(done.points[0]!);
        into.pdfAnnot.members!.push(a.index);
        if (done.pdfAnnot?.owned) into.pdfAnnot.owned = [...(into.pdfAnnot.owned ?? []), ...done.pdfAnnot.owned];
        if (done.replies) into.replies = [...(into.replies ?? []), ...done.replies];
        return;
      }
      if (group && done.pdfAnnot) {
        done.pdfAnnot.members = [a.index];
        counts.set(group, done);
      }
      markups.push(done);
    });
    imported.push(a.index);
  }

  // Popups, replies and states of annotations left as they are (stamps, form fields) stay too.
  const represented = new Set(markups.flatMap((m) => (m.pdfAnnot ? [m.pdfAnnot.index, ...(m.pdfAnnot.members ?? [])] : [])));
  // A group left with one markup (a count's items, merged) is no group.
  const groupSizes = new Map<string, number>();
  for (const m of markups) if (m.groupId) groupSizes.set(m.groupId, (groupSizes.get(m.groupId) ?? 0) + 1);
  for (const m of markups) if (m.groupId && groupSizes.get(m.groupId) === 1) delete m.groupId;
  for (let k = imported.length - 1; k >= 0; k--) {
    const o = owner.get(imported[k]!);
    if (o !== undefined && !represented.has(o)) imported.splice(k, 1);
  }
  // Bluebeam Spaces live on the page, not in /Annots.
  if (page) markups.push(...importSpaces(pageIndex, page, now));
  for (const m of markups) if (m.pdfAnnot) m.pdfAnnot.digest = markupDigest(m);

  const vp = page ? importViewports(pageIndex, page) : null;
  if (vp?.scale && page) {
    // Bluebeam shows areas and volumes in the units its measurements' own /Measure says (e.g. m²
    // beside lengths in mm), which can differ from the page's: the most common at this scale wins.
    const common = (key: 'areaUnit' | 'volumeUnit') => {
      const votes = new Map<string, number>();
      for (const r of page.annots) {
        const s = scaleFromMeasure(dict(r?.Measure));
        if (!s || Math.abs(s.metersPerPoint / vp.scale!.metersPerPoint - 1) > 1e-6) continue;
        const u = s[key] ?? (key === 'volumeUnit' ? s.areaUnit : undefined) ?? s.unit;
        // Volume measurements say best how volumes are shown; areas likewise.
        const own = nameOf(r?.IT) === (key === 'volumeUnit' ? 'PolygonVolume' : 'PolygonDimension');
        votes.set(u, (votes.get(u) ?? 0) + (own ? 100 : 1));
      }
      return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] as Scale['unit'] | undefined;
    };
    const areaUnit = common('areaUnit');
    const volumeUnit = common('volumeUnit');
    const s: Scale = { ...vp.scale };
    delete s.areaUnit;
    delete s.volumeUnit;
    if (areaUnit && areaUnit !== s.unit) s.areaUnit = areaUnit;
    if (volumeUnit && volumeUnit !== (s.areaUnit ?? s.unit)) s.volumeUnit = volumeUnit;
    if (s.areaLabel && s.areaLabel.unit !== (s.areaUnit ?? s.unit)) delete s.areaLabel;
    if (s.volumeLabel && s.volumeLabel.unit !== (s.volumeUnit ?? s.areaUnit ?? s.unit)) delete s.volumeLabel;
    // The measurements' own wording for those units, and their angle precision.
    for (const r of page.annots) {
      const own = scaleFromMeasure(dict(r?.Measure));
      if (!own) continue;
      if (own.areaLabel?.unit === (s.areaUnit ?? s.unit)) s.areaLabel ??= own.areaLabel;
      if (own.volumeLabel?.unit === (s.volumeUnit ?? s.areaUnit ?? s.unit)) s.volumeLabel ??= own.volumeLabel;
      if (own.anglePrecision !== undefined) s.anglePrecision ??= own.anglePrecision;
    }
    vp.scale = s;
  }
  return {
    markups,
    links,
    imported,
    ...(vp?.scale ? { scale: vp.scale } : {}),
    ...(vp?.viewports.length ? { viewports: vp.viewports } : {}),
    ...(statuses.size ? { statuses: [...statuses].map(([name, model]) => ({ name, model })) } : {}),
  };
}

interface Found {
  type: MarkupType;
  points: Point[];
  filled: boolean;
  /** Style set from the annotation's own values, over the PDFium-derived defaults. */
  style?: Partial<MarkupStyle>;
  /** Other markup fields (holes, bulges, image, text). */
  extra?: Partial<Markup>;
  text?: string;
  /** A measurement: /Contents holds its value, not a comment. */
  measure?: boolean;
}

/** Markup shapes for a foreign annotation, or none when it has no editable equivalent. */
function toMarkups(a: ImportableAnnotation): Found[] {
  const r = a.rect;
  // Box shapes: the rect includes half the border on each side.
  const inset = a.borderWidth / 2;
  const box: Point[] = [
    [r.x + inset, r.y + inset],
    [r.x + r.w - inset, r.y + r.h - inset],
  ];
  switch (a.subtype) {
    case 'Line':
      return a.line ? [{ type: a.intent === 'LineDimension' ? 'length' : a.intent === 'LineArrow' ? 'arrow' : 'line', points: a.line.map((p) => [p[0], p[1]] as Point), filled: false }] : [];
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
      // A multiplied or translucent, wide ink stroke is a highlighter.
      const type: MarkupType = a.multiply || (a.opacity < 0.8 && a.borderWidth >= 6) ? 'highlighter' : 'pen';
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

function bounds(pts: readonly (readonly [number, number])[]): Point[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

const COUNT_SHAPES: Record<string, CountShape> = { Checkmark: 'check', Check: 'check', Circle: 'circle', Square: 'square', Diamond: 'diamond', Triangle: 'triangle', Cross: 'cross', X: 'cross' };

/** A dash pattern (in multiples of the line width) as the nearest of our line styles. */
function dashOf(d: number[], width: number): LineDash | undefined {
  if (!d.length) return undefined;
  const w = Math.max(width, 0.5);
  if (d.length >= 6) return 'dashDotDot';
  if (d.length >= 4) return 'dashDot';
  const on = d[0]! / w;
  if (on <= 1.5) return 'dotted';
  if (on >= 6) return 'longDash';
  return 'dashed';
}

/**
 * Markup shapes from an annotation's raw dictionary: every geometric and stylistic detail other
 * tools (Bluebeam Revu in particular) record, in page space.
 */
function fromRaw(a: ImportableAnnotation, r: PdfDictValue, toPage: (x: number, y: number) => Point, extras: PdfExtras, pageIndex: number): Found[] {
  const intent = nameOf(r.IT) ?? a.intent;
  const rect = nums(r.Rect);
  const rd = nums(r.RD);
  const bs = dict(r.BS);
  const width = num(bs?.W) ?? (nums(r.Border)[2] ?? a.borderWidth);
  const color = colorHex(r.C);
  const interior = colorHex(r.IC);
  const ds = str(r.DS);
  const textStyle = ds ? parseDefaultStyle(ds) : {};
  const daColor = daTextColor(str(r.DA) ?? a.da);
  const fillOpacity = num(r.FillOpacity);
  const dash = nameOf(bs?.S) === 'D' ? dashOf(nums(bs?.D).length ? nums(bs?.D) : [3], width) : undefined;
  const base: Partial<MarkupStyle> = {
    ...(color ? { stroke: color } : {}),
    width,
    ...(dash ? { dash } : {}),
  };
  const le = (() => {
    const v = r.LE;
    const names = Array.isArray(v) ? v.map(nameOf) : [nameOf(v)];
    return names.map((n) => lineEndingOf(n, !!interior));
  })();
  const caps = le.length >= 2 ? { startCap: le[0]!, endCap: le[1]! } : le[0] && le[0] !== 'none' ? { startCap: le[0] } : {};
  const verts = pagePoints(nums(r.Vertices), toPage);
  // The annotation's own box: Rect less its /RD insets (left, top, right, bottom).
  const innerBox = (): Point[] => {
    if (rect.length < 4) return [[a.rect.x, a.rect.y], [a.rect.x + a.rect.w, a.rect.y + a.rect.h]];
    const [l, t, rr, b] = rd.length === 4 ? rd : [width / 2, width / 2, width / 2, width / 2];
    const p = toPage(rect[0]! + l!, rect[1]! + b!);
    const q = toPage(rect[2]! - rr!, rect[3]! - t!);
    return [
      [Math.min(p[0], q[0]), Math.min(p[1], q[1])],
      [Math.max(p[0], q[0]), Math.max(p[1], q[1])],
    ];
  };
  const labelStyle: Partial<MarkupStyle> = {
    ...(textStyle.fontSize ? { fontSize: textStyle.fontSize } : {}),
    ...(textStyle.fontFamily ? { fontFamily: textStyle.fontFamily } : {}),
    ...(textStyle.textColor && textStyle.textColor !== color ? { textColor: textStyle.textColor } : {}),
  };
  const measured = !!dict(r.Measure);
  const fill = interior ? { fill: interior, ...(fillOpacity !== null && fillOpacity < 1 ? { fillOpacity } : {}) } : { fill: null };
  /**
   * Bluebeam /Curves: per curved vertex, its index and two Bézier handles (the one before it, the
   * one after). Segment i runs from vertex i (its after handle) to vertex i + 1 (its before handle);
   * a vertex without handles is a sharp corner.
   */
  const handles = (curves: number[], pts: Point[]) => {
    const h = pts.map((p) => ({ before: p, after: p }));
    for (let i = 0; i + 4 < curves.length; i += 5) {
      const k = curves[i]!;
      if (h[k]) h[k] = { before: toPage(curves[i + 1]!, curves[i + 2]!), after: toPage(curves[i + 3]!, curves[i + 4]!) };
    }
    return h;
  };
  const segmentCurve = (curves: number[], pts: Point[], closed: boolean) => {
    const h = handles(curves, pts);
    const n = closed ? pts.length : pts.length - 1;
    return Array.from({ length: Math.max(0, n) }, (_, i) => {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      const c1 = h[i]!.after;
      const c2 = h[(i + 1) % pts.length]!.before;
      const straight = c1 === p && c2 === q;
      return { p, q, c1, c2, straight };
    });
  };
  /** Bulges for a path's curved segments (each Bézier read as the circular arc through its middle). */
  const bulges = (curves: number[], pts: Point[], closed: boolean): number[] | undefined => {
    if (!curves.length) return undefined;
    const out = segmentCurve(curves, pts, closed).map(({ p, q, c1, c2, straight }) =>
      straight ? 0 : bulgeThrough(p, q, [(p[0] + 3 * c1[0] + 3 * c2[0] + q[0]) / 8, (p[1] + 3 * c1[1] + 3 * c2[1] + q[1]) / 8]),
    );
    return out.some(Boolean) ? out : undefined;
  };
  switch (a.subtype) {
    case 'FreeText': {
      const text = textStyle.textColor ?? daColor ?? color ?? '#000000';
      // FreeText /C is the box's background; the text colour also draws the border and leader.
      const style: Partial<MarkupStyle> = {
        ...textStyle,
        stroke: text,
        width,
        fill: color,
        ...(color && fillOpacity !== null && fillOpacity < 1 ? { fillOpacity } : {}),
        ...(dash ? { dash } : {}),
      };
      delete style.textColor;
      if (text !== style.stroke) style.textColor = text;
      if (!textStyle.fontSize) style.fontSize = Number(/([\d.]+)\s+Tf/.exec(str(r.DA) ?? a.da)?.[1]) || 12;
      const box = innerBox();
      if (intent === 'FreeTextCallout') {
        const cl = pagePoints(nums(r.CL), toPage);
        if (cl.length >= 2) {
          const ending = lineEndingOf(nameOf(r.LE), true);
          // A borderless callout still draws its leader (Bluebeam: at one point).
          const leader = width > 0 ? {} : { width: 1, ...(color ? {} : { noBox: true }) };
          return [{ type: 'callout', points: [cl[0]!, cl[1]!, box[0]!, box[1]!], filled: true, style: { ...style, ...leader, startCap: ending, endCap: 'none' } }];
        }
      }
      if (intent === 'FreeTextTypeWriter') return [{ type: 'typewriter', points: box, filled: false, style: { ...style, width: 0, fill: null } }];
      if (r.Flag !== undefined || str(r.Subj) === 'Flag') {
        // Bluebeam's flag: its point fills /RD's wide left inset; the box keeps the other margins.
        const margin = rd.length === 4 ? rd[1]! : 0;
        const full = rect.length === 4 ? [toPage(rect[0]! + margin, rect[1]! + margin), toPage(rect[2]! - margin, rect[3]! - margin)] : box;
        const flag: Point[] = [
          [Math.min(full[0]![0], full[1]![0]), Math.min(full[0]![1], full[1]![1])],
          [Math.max(full[0]![0], full[1]![0]), Math.max(full[0]![1], full[1]![1])],
        ];
        return [{ type: 'flagLabel', points: flag, filled: true, style }];
      }
      return [{ type: 'text', points: box, filled: !!color, style }];
    }
    case 'Ink': {
      const multiply = a.multiply || nameOf(r.BM) === 'Multiply';
      const type: MarkupType = multiply || (a.opacity < 0.8 && width >= 6) ? 'highlighter' : 'pen';
      const paths = arr(r.InkList).map((p) => pagePoints(nums(p), toPage)).filter((p) => p.length >= 2);
      return paths.map((points) => ({ type, points, filled: false, style: base }));
    }
    case 'Line': {
      const l = pagePoints(nums(r.L), toPage);
      if (l.length < 2) return [];
      const points = l.slice(0, 2);
      // /LL offsets the dimension line to the left of its direction in user space; ours is a signed
      // offset along the page-space normal, so map a point on the offset line across.
      const leader = (() => {
        const ll = num(r.LL);
        const u = nums(r.L);
        if (!ll || u.length < 4) return {};
        const [x0, y0, x1, y1] = u as [number, number, number, number];
        const d = Math.hypot(x1 - x0, y1 - y0) || 1;
        const off = toPage((x0 + x1) / 2 - ((y1 - y0) / d) * ll, (y0 + y1) / 2 + ((x1 - x0) / d) * ll);
        const [a, b] = points as [Point, Point];
        const pd = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n: Point = [-(b[1] - a[1]) / pd, (b[0] - a[0]) / pd];
        const side = Math.sign((off[0] - (a[0] + b[0]) / 2) * n[0] + (off[1] - (a[1] + b[1]) / 2) * n[1]);
        return { leader: side * Math.abs(ll) };
      })();
      if (intent === 'LineDimension' && measured) return [{ type: 'length', points, filled: false, measure: true, style: { ...base, ...caps, ...labelStyle, ...leader } }];
      if (intent === 'LineDimension') return [{ type: 'dimension', points, filled: false, style: { ...base, ...caps, ...labelStyle, ...leader } }];
      return [{ type: intent === 'LineArrow' ? 'arrow' : 'line', points, filled: false, style: { ...base, ...caps } }];
    }
    case 'Square': {
      const image = extras.images.get(refNum(r.Image) ?? -1);
      if (intent === 'SquareImage' || image) return [{ type: 'image', points: innerBox(), filled: false, style: { ...base, fill: null }, ...(image ? { extra: { image } } : {}) }];
      return [{ type: 'rect', points: innerBox(), filled: true, style: { ...base, ...fill } }];
    }
    case 'Circle': {
      const [p, q] = innerBox() as [Point, Point];
      const cx = (p[0] + q[0]) / 2;
      const cy = (p[1] + q[1]) / 2;
      if (intent === 'CircleArc') {
        // Bluebeam's arc: part of the ellipse in Rect less /RD, from /Angle1 to /Angle2 (in user
        // space). Each angle's point on the ellipse gives the same angle on the page's ellipse.
        const box = rect.length === 4 ? rect : null;
        const [l, t, rr, bt] = rd.length === 4 ? rd : [0, 0, 0, 0];
        const angles = ([num(r.Angle1) ?? 0, num(r.Angle2) ?? 360] as const).map((deg) => {
          if (!box) return deg;
          const ucx = (box[0]! + l! + box[2]! - rr!) / 2;
          const ucy = (box[1]! + bt! + box[3]! - t!) / 2;
          const urx = (box[2]! - rr! - box[0]! - l!) / 2;
          const ury = (box[3]! - t! - box[1]! - bt!) / 2;
          const u = toPage(ucx + urx * Math.cos((deg * Math.PI) / 180), ucy + ury * Math.sin((deg * Math.PI) / 180));
          const prx = (q[0] - p[0]) / 2 || 1;
          const pry = (q[1] - p[1]) / 2 || 1;
          return ((((Math.atan2(-(u[1] - cy) / pry, (u[0] - cx) / prx) * 180) / Math.PI) % 360) + 360) % 360;
        }) as [number, number];
        return [{ type: 'ellipticalArc', points: [p, q], filled: false, style: { ...base, ...caps }, extra: { arcAngles: angles } }];
      }
      if (intent === 'CircleDimension') {
        const radius = (q[0] - p[0] + q[1] - p[1]) / 4;
        return [{ type: 'diameter', points: [[cx - radius, cy], [cx + radius, cy]], filled: false, measure: true, style: { ...base, ...fill, ...labelStyle } }];
      }
      return [{ type: 'ellipse', points: [p, q], filled: true, style: { ...base, ...fill } }];
    }
    case 'Polygon': {
      if (verts.length < 2) return [];
      if (intent === 'PolygonCount') {
        const b = bounds(verts);
        const centre: Point = [(b[0]![0] + b[1]![0]) / 2, (b[0]![1] + b[1]![1]) / 2];
        const r0 = Math.max(b[1]![0] - b[0]![0], b[1]![1] - b[0]![1]) / 2;
        const shape = COUNT_SHAPES[nameOf(r.CountStyle) ?? ''] ?? 'circle';
        // Bluebeam shows each count item's marker without a label.
        return [{ type: 'count', points: [centre], filled: true, measure: true, style: { ...base, fill: interior ?? color, arcRadius: r0 || undefined, countShape: shape, showLabel: false, ...labelStyle } }];
      }
      if (intent === 'PolygonRadius' && verts.length >= 2) {
        // Bluebeam: [a point on the circle, the centre, the arc's other end].
        return [{ type: 'radius', points: [verts[1]!, verts[0]!, ...(verts[2] ? [verts[2]] : [])], filled: false, measure: true, style: { ...base, ...labelStyle } }];
      }
      if (verts.length < 3) return [];
      const b = bounds(verts);
      const boxed = verts.length === 4 && verts.every(([x, y]) => (Math.abs(x - b[0]![0]) < 0.5 || Math.abs(x - b[1]![0]) < 0.5) && (Math.abs(y - b[0]![1]) < 0.5 || Math.abs(y - b[1]![1]) < 0.5));
      // A rectangular cloud is our box cloud; any other outline is a polygon cloud.
      if (a.cloudy || dict(r.BE) || intent === 'PolygonCloud') {
        const intensity = num(dict(r.BE)?.I) ?? 1;
        const style = { ...base, ...fill, arcRadius: Math.max(3, intensity * 3) };
        return [boxed ? { type: 'cloud', points: b, filled: true, style } : { type: 'polygonCloud', points: verts, filled: true, style }];
      }
      const curves = nums(r.Curves);
      const cutouts = arr(r.Cutouts).map((h, i) => ({ points: pagePoints(nums(h), toPage), curves: nums(arr(r.CutoutsCurves)[i]) })).filter((h) => h.points.length > 2);
      const holes = cutouts.map((h) => h.points);
      const holeBulges = cutouts.map((h) => bulges(h.curves, h.points, true) ?? null);
      const geometry: Partial<Markup> = {
        ...(holes.length ? { holes } : {}),
        ...(holeBulges.some(Boolean) ? { holeBulges } : {}),
        ...(bulges(curves, verts, true) ? { bulges: bulges(curves, verts, true)! } : {}),
      };
      const areaLike = intent === 'PolygonDimension' || (measured && /SketchToScale$/.test(intent));
      if (intent === 'PolygonVolume') return [{ type: 'volume', points: verts, filled: true, measure: true, style: { ...base, ...fill, ...labelStyle }, extra: geometry }];
      if (areaLike) return [{ type: 'area', points: verts, filled: true, measure: true, style: { ...base, ...fill, ...labelStyle }, extra: geometry }];
      return [{ type: 'polygon', points: verts, filled: true, style: { ...base, ...fill }, ...(geometry.bulges ? { extra: { bulges: geometry.bulges } } : {}) }];
    }
    case 'PolyLine': {
      if (verts.length < 2) return [];
      if (intent === 'PolyLineAngle' && verts.length >= 3) return [{ type: 'angle', points: verts.slice(0, 3), filled: false, measure: true, style: { ...base, ...labelStyle } }];
      if (intent === 'PolyLineDimension' || (measured && /SketchToScale$/.test(intent))) {
        const b = bulges(nums(r.Curves), verts, false);
        return [{ type: 'polylength', points: verts, filled: false, measure: true, style: { ...base, ...caps, ...labelStyle }, ...(b ? { extra: { bulges: b } } : {}) }];
      }
      return [{ type: 'polyline', points: verts, filled: false, style: { ...base, ...caps } }];
    }
    case 'Stamp': {
      // Another tool's stamp (Bluebeam's Approved, a snapshot): its own appearance, as a picture.
      const image = extras.appearances?.get(`${pageIndex}:${a.index}`);
      if (!image) return [];
      const [p, q] = innerBox();
      return [{ type: 'image', points: [p!, q!], filled: false, style: { stroke: color ?? '#000000', fill: null, width: 0, opacity: a.opacity }, extra: { image } }];
    }
    case 'Text': {
      const [p, q] = innerBox();
      return [{ type: 'note', points: [p!, q!], filled: true, style: { fill: color ?? '#fde047', stroke: '#a16207', width: 0.75 } }];
    }
    default:
      return toMarkups(a).map((f) => ({ ...f, style: { ...base, ...(f.style ?? {}) } }));
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
