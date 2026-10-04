import fontkit from '@pdf-lib/fontkit';
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';

/**
 * The Liberation fonts (SIL Open Font License, see public/fonts/LICENSE.txt) have the same widths
 * as Helvetica, Times and Courier, so markup text lays out exactly as with the standard fonts.
 */
const FILES: Partial<Record<StandardFonts, string>> = {
  [StandardFonts.Helvetica]: 'LiberationSans-Regular.ttf',
  [StandardFonts.HelveticaBold]: 'LiberationSans-Bold.ttf',
  [StandardFonts.HelveticaOblique]: 'LiberationSans-Italic.ttf',
  [StandardFonts.HelveticaBoldOblique]: 'LiberationSans-BoldItalic.ttf',
  [StandardFonts.TimesRoman]: 'LiberationSerif-Regular.ttf',
  [StandardFonts.TimesRomanBold]: 'LiberationSerif-Bold.ttf',
  [StandardFonts.TimesRomanItalic]: 'LiberationSerif-Italic.ttf',
  [StandardFonts.TimesRomanBoldItalic]: 'LiberationSerif-BoldItalic.ttf',
  [StandardFonts.Courier]: 'LiberationMono-Regular.ttf',
  [StandardFonts.CourierBold]: 'LiberationMono-Bold.ttf',
  [StandardFonts.CourierOblique]: 'LiberationMono-Italic.ttf',
  [StandardFonts.CourierBoldOblique]: 'LiberationMono-BoldItalic.ttf',
};

const loaded = new Map<string, Promise<ArrayBuffer>>();

/** Fetches a font file (served from public/fonts, cached by the service worker once used). */
function fontFile(file: string): Promise<ArrayBuffer> {
  let p = loaded.get(file);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}fonts/${file}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load the font ${file} (${r.status}).`);
      return r.arrayBuffer();
    });
    p.catch(() => loaded.delete(file));
    loaded.set(file, p);
  }
  return p;
}

/**
 * Embeds the font file for a standard font, for exports that must carry their fonts (PDF/A). The
 * whole font is embedded rather than a subset: subsetting is where pdf-lib's font handling is weakest.
 */
export async function embedFontFile(doc: PDFDocument, name: StandardFonts): Promise<PDFFont> {
  const file = FILES[name];
  if (!file) return doc.embedFont(name);
  doc.registerFontkit(fontkit);
  return doc.embedFont(await fontFile(file));
}
