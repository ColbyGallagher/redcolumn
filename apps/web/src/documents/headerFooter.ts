import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { addTagged, keepContentAsIs, pageHasTagged, removeTagged } from './taggedContent';
import { applyMatrix, pageMatrix } from '@nb/markup/export';

/** Marks the content streams this app adds, so they can be found and removed again. */
const TAG = 'NBHeaderFooter';

export type Slot = 'headerLeft' | 'headerCenter' | 'headerRight' | 'footerLeft' | 'footerCenter' | 'footerRight';
export const SLOTS: readonly Slot[] = ['headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight'];

export interface HeaderFooterSpec {
  /** Text per position; may contain tokens (see TOKENS). Empty positions are skipped. */
  text: Partial<Record<Slot, string>>;
  fontSize: number;
  /** CSS hex colour. */
  color: string;
  font: 'Helvetica' | 'Times' | 'Courier';
  /** Distance from the page edges, in points. */
  margin: { top: number; bottom: number; left: number; right: number };
  /** Bates numbering: `<<bates>>` becomes prefix + zero-padded number + suffix. */
  bates: { start: number; digits: number; prefix: string; suffix: string };
  /** `<<page>>` counts from this number on the first chosen page. */
  startPage: number;
}

export const TOKENS: { token: string; label: string }[] = [
  { token: '<<page>>', label: 'Page number' },
  { token: '<<pages>>', label: 'Page count' },
  { token: '<<label>>', label: 'Page label' },
  { token: '<<bates>>', label: 'Bates number' },
  { token: '<<file>>', label: 'File name' },
  { token: '<<date>>', label: 'Date' },
];

export interface TokenValues {
  /** 0-based position among the chosen pages. */
  index: number;
  count: number;
  label: string;
  file: string;
  date: string;
}

/** A position's text for one page, tokens filled in. */
export function fillTokens(text: string, spec: Pick<HeaderFooterSpec, 'bates' | 'startPage'>, v: TokenValues): string {
  const bates = `${spec.bates.prefix}${String(spec.bates.start + v.index).padStart(spec.bates.digits, '0')}${spec.bates.suffix}`;
  return text
    .replace(/<<page>>/gi, String(spec.startPage + v.index))
    .replace(/<<pages>>/gi, String(v.count))
    .replace(/<<label>>/gi, v.label)
    .replace(/<<bates>>/gi, bates)
    .replace(/<<file>>/gi, v.file)
    .replace(/<<date>>/gi, v.date);
}

const FONTS = { Helvetica: StandardFonts.Helvetica, Times: StandardFonts.TimesRoman, Courier: StandardFonts.Courier } as const;

/** Text the standard font can encode; anything else becomes "?". */
function encodable(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function hex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : [0, 0, 0];
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Removes headers and footers this app added. Returns how many pages had some. */
export function removeFromDoc(doc: PDFDocument, pages?: readonly number[]): number {
  return removeTagged(doc, TAG, pages);
}

/** Whether any page carries headers or footers this app added. */
export async function hasHeaderFooter(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().some((p) => pageHasTagged(p, TAG));
}

/**
 * Adds headers and footers to `pages` (replacing ones this app added before), drawn into their own
 * tagged content stream on each page so they can be edited or removed later. Positions are on the
 * displayed page, so rotated pages get them upright at the top and bottom as seen.
 */
export async function addHeaderFooter(bytes: ArrayBuffer | Uint8Array, pages: readonly number[], spec: HeaderFooterSpec, values: (pageIndex: number) => Omit<TokenValues, 'index' | 'count'>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  removeFromDoc(doc, pages);
  const font = await doc.embedFont(FONTS[spec.font]);
  const [r, g, b] = hex(spec.color);
  const all = doc.getPages();
  const size = spec.fontSize;
  const ascent = font.heightAtSize(size, { descender: false });
  pages.forEach((pageIndex, index) => {
    const page = all[pageIndex];
    if (!page) return;
    keepContentAsIs(page);
    const box = page.getCropBox();
    const turned = page.getRotation().angle % 180 !== 0;
    const W = turned ? box.height : box.width;
    const H = turned ? box.width : box.height;
    const m = pageMatrix(page);
    const v = { ...values(pageIndex), index, count: pages.length };
    const fontName = page.node.newFontDictionary('NBHF', font.ref);
    const ops: string[] = [`/Artifact <</Type /Pagination>> BDC q ${n(r)} ${n(g)} ${n(b)} rg BT ${fontName.asString()} ${n(size)} Tf`];
    for (const slot of SLOTS) {
      const raw = spec.text[slot]?.trim();
      if (!raw) continue;
      const text = encodable(font, fillTokens(raw, spec, v));
      const w = font.widthOfTextAtSize(text, size);
      const x = slot.endsWith('Left') ? spec.margin.left : slot.endsWith('Right') ? W - spec.margin.right - w : (W - w) / 2;
      // Baselines in page space (y down): below the top margin, or above the bottom margin.
      const y = slot.startsWith('header') ? spec.margin.top + ascent : H - spec.margin.bottom;
      const [ux, uy] = applyMatrix(m, [x, y]);
      // Text runs along the displayed page's x axis and stands up along its -y axis.
      const tm = [m[0], m[1], -m[2], -m[3], ux, uy].map(n).join(' ');
      ops.push(`${tm} Tm ${font.encodeText(text).toString()} Tj`);
    }
    ops.push('ET Q EMC');
    addTagged(doc, page, TAG, ops.join('\n'));
  });
  return doc.save();
}

/** Removes this app's headers and footers from every page. */
export async function removeHeaderFooter(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  removeFromDoc(doc);
  return doc.save();
}
