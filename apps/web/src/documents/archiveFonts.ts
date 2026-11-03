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

/** Embeds the font file where it can be loaded, else names the standard font (offline, before the file is cached). */
export async function embedFontOrStandard(doc: PDFDocument, name: StandardFonts): Promise<PDFFont> {
  try {
    return await embedFontFile(doc, name);
  } catch {
    return doc.embedFont(name);
  }
}

// ---- Installed fonts, for text the Liberation fonts lack (CJK) --------------------------------------

/** The Local Font Access API (Chromium), not yet in TypeScript's DOM library. */
interface LocalFont {
  family: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFont[]>;
  }
}

/** CJK families to try, in order: Windows, macOS, Linux/Noto, then Adobe's. A font is only used if it has every character. */
const CJK_FAMILIES = [
  'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'SimSun', 'SimHei', 'Heiti SC',
  'Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC', 'Noto Sans TC', 'Yu Gothic', 'Meiryo', 'Hiragino Sans', 'Noto Sans CJK JP', 'Noto Sans JP',
  'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', 'Noto Sans KR', 'WenQuanYi Micro Hei', 'Droid Sans Fallback', 'Arial Unicode MS',
];

/** The characters of the text that need a font (spaces and controls never do). */
function codePoints(text: string): number[] {
  return [...new Set([...text].map((c) => c.codePointAt(0)!))].filter((cp) => cp > 0x20 && cp !== 0x7f && !(cp >= 0x80 && cp < 0xa0));
}

/** Whether a font file (one face of a collection, if `face` names it) has a glyph for each code point. */
function covers(bytes: Uint8Array, face: string | undefined, cps: number[]): boolean {
  try {
    const f = fontkit.create(bytes, face) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
    return cps.every((cp) => f.hasGlyphForCodePoint(cp));
  } catch {
    return false;
  }
}

let installed: Promise<LocalFont[]> | undefined;

/** The installed fonts, or none where the browser lacks the API or the user declines. */
function installedFonts(): Promise<LocalFont[]> {
  if (!installed) {
    const query = (window.queryLocalFonts?.() ?? Promise.resolve([])).catch((): LocalFont[] => []);
    installed = query;
    // An empty answer (permission declined, no API) is not kept, so a later export asks again.
    void query.then((fonts) => {
      if (!fonts.length && installed === query) installed = undefined;
    });
  }
  return installed;
}

/** Fonts already embedded per document, so each file is embedded once however many standard fonts ask for it. */
const embedded = new WeakMap<PDFDocument, Map<string, PDFFont>>();

/**
 * An installed font with a glyph for every character of the text, embedded as a subset (a CJK font
 * is megabytes) or null if there is none. Regular weight only: bold and italic are not synthesised.
 */
async function embedInstalledFont(doc: PDFDocument, text: string): Promise<PDFFont | null> {
  const cps = codePoints(text);
  const key = cps.join(',');
  const cached = embedded.get(doc)?.get(key);
  if (cached) return cached;
  const fonts = (await installedFonts()).filter((f) => /^(regular|normal|book|roman)$/i.test(f.style));
  const ordered = [...CJK_FAMILIES.flatMap((family) => fonts.filter((f) => f.family === family)), ...fonts.filter((f) => !CJK_FAMILIES.includes(f.family))];
  for (const f of ordered) {
    const bytes = new Uint8Array(await (await f.blob()).arrayBuffer());
    if (!covers(bytes, f.postscriptName, cps)) continue;
    // pdf-lib calls `create(bytes)` with no face name, which fails for a collection (.ttc): name the face here.
    doc.registerFontkit({ create: (b: Uint8Array) => fontkit.create(b, f.postscriptName) } as unknown as typeof fontkit);
    const font = await doc.embedFont(bytes, { subset: true });
    if (!embedded.has(doc)) embedded.set(doc, new Map());
    embedded.get(doc)!.set(key, font);
    return font;
  }
  return null;
}

/**
 * For text the standard fonts cannot show: the Liberation font if it has every character (Greek,
 * Cyrillic), else an installed font that does (CJK), else the Liberation font anyway, which draws
 * what it lacks as question marks.
 */
export async function embedFontForText(doc: PDFDocument, name: StandardFonts, text: string): Promise<PDFFont> {
  const file = FILES[name];
  if (file) {
    try {
      const bytes = new Uint8Array(await fontFile(file));
      if (covers(bytes, undefined, codePoints(text))) return embedFontOrStandard(doc, name);
    } catch {
      // Not loadable: an installed font may still have the characters.
    }
  }
  return (await embedInstalledFont(doc, text).catch(() => null)) ?? embedFontOrStandard(doc, name);
}
