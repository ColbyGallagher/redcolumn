import { StandardFonts, type PDFFont } from 'pdf-lib';
import { applyMatrix, pageMatrix } from '@nb/markup/export';
import { addTagged, keepContentAsIs, removeTagged } from './taggedContent';
import { openForEdit } from './incremental';

/** Marks the invisible text layer OCR adds, so running OCR again replaces it. */
const TAG = 'NBOcr';

/** A recognised word, in page space (points, top-left origin, y down). */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

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

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * Adds recognised words to pages as invisible text (render mode 3): nothing changes on screen or
 * in print, but the words can be searched, selected and copied. Each word is stretched to the
 * width it has on the page. Replaces a text layer added before.
 */
export async function addTextLayer(bytes: ArrayBuffer | Uint8Array, words: ReadonlyMap<number, readonly OcrWord[]>): Promise<Uint8Array> {
  const { doc, save } = await openForEdit(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  removeTagged(doc, TAG, [...words.keys()]);
  for (const [pageIndex, list] of words) {
    const page = pages[pageIndex];
    if (!page || !list.length) continue;
    keepContentAsIs(page);
    const m = pageMatrix(page);
    const name = page.node.newFontDictionary('NBOCR', font.ref).asString();
    const ops = ['BT 3 Tr'];
    for (const w of list) {
      const text = encodable(font, w.text);
      const h = w.y1 - w.y0;
      if (!text.trim() || h <= 0 || w.x1 <= w.x0) continue;
      const size = h;
      const natural = font.widthOfTextAtSize(text, size);
      const stretch = natural > 0 ? ((w.x1 - w.x0) / natural) * 100 : 100;
      // Baseline a little above the bottom of the word box (descenders go below it).
      const [ux, uy] = applyMatrix(m, [w.x0, w.y1 - h * 0.2]);
      const tm = [m[0], m[1], -m[2], -m[3], ux, uy].map(n).join(' ');
      ops.push(`${name} ${n(size)} Tf ${n(stretch)} Tz ${tm} Tm ${font.encodeText(text).toString()} Tj`);
    }
    ops.push('ET');
    addTagged(doc, page, TAG, ops.join('\n'));
  }
  return save();
}

/** Where the Tesseract files are served (see ocrAssets in vite.config.ts). */
const ocrUrl = (name: string) => new URL(`${import.meta.env.BASE_URL}ocr/${name}`, location.href).href;

/** Languages OCR can read (their data is served with the app), by Tesseract code. */
export const OCR_LANGUAGES: Record<string, string> = { eng: 'English', fra: 'French', deu: 'German', spa: 'Spanish', ita: 'Italian', por: 'Portuguese', nld: 'Dutch' };

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let worker: Promise<TesseractWorker> | null = null;
let workerLangs = '';
let languages = 'eng';

/** The languages the next recognition reads, e.g. ['eng', 'fra'] (English when none are given). */
export function setOcrLanguages(langs: readonly string[]) {
  const valid = langs.filter((l) => l in OCR_LANGUAGES);
  languages = valid.length ? valid.join('+') : 'eng';
}

async function getWorker(): Promise<TesseractWorker> {
  if (worker && workerLangs !== languages) {
    const old = worker;
    worker = null;
    void old.then((w) => w.terminate()).catch(() => {});
  }
  workerLangs = languages;
  worker ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker(languages, OEM.LSTM_ONLY, {
      workerPath: ocrUrl('worker.min.js'),
      // A folder: Tesseract picks the build for the browser's WebAssembly features itself.
      corePath: ocrUrl('').replace(/\/$/, ''),
      langPath: ocrUrl('').replace(/\/$/, ''),
      // The language data is served with the app, so there is nothing to cache in IndexedDB.
      cacheMethod: 'none',
    });
  })();
  try {
    return await worker;
  } catch (err) {
    worker = null;
    throw err;
  }
}

/**
 * Recognises the words in a page image. `scale` is image pixels per PDF point, to turn the word
 * boxes back into page space. Words recognised with low confidence are dropped.
 */
export async function recognise(image: Blob, scale: number, minConfidence = 40): Promise<OcrWord[]> {
  const w = await getWorker();
  const { data } = await w.recognize(image, {}, { blocks: true, text: false });
  const out: OcrWord[] = [];
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines)
        for (const word of line.words) {
          if (word.confidence < minConfidence || !word.text.trim()) continue;
          const b = word.bbox;
          out.push({ text: word.text, x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale });
        }
  return out;
}
