import { PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef, PDFStream, PDFString, type PDFContext, type PDFObject } from 'pdf-lib';
import { dict, PdfName, PdfRefNum, type PdfDictValue, type PdfValue } from './bluebeam';

/** Keys whose referenced objects are kept as references: other annotations, pages, streams. */
const KEEP_REF = new Set(['P', 'Parent', 'IRT', 'Popup', 'OC', 'Flag', 'Image', 'AP', 'FS', 'Dest', 'A', 'StructParent']);

/** A pdf-lib object as plain values, following references except to annotations, pages and streams. */
export function toPdfValue(ctx: PDFContext, obj: PDFObject | undefined, key: string | null = null, depth = 0): PdfValue {
  if (obj === undefined || obj === PDFNull) return null;
  if (obj instanceof PDFRef) {
    if ((key && KEEP_REF.has(key)) || depth > 8) return new PdfRefNum(obj.objectNumber);
    const target = ctx.lookup(obj);
    if (!target || target instanceof PDFStream) return new PdfRefNum(obj.objectNumber);
    return toPdfValue(ctx, target, key, depth + 1);
  }
  if (obj instanceof PDFNumber) return obj.asNumber();
  if (obj instanceof PDFBool) return obj.asBoolean();
  if (obj instanceof PDFName) return new PdfName(obj.decodeText());
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFArray) return obj.asArray().map((x) => toPdfValue(ctx, x, key, depth + 1));
  if (obj instanceof PDFDict) {
    const out: Record<string, PdfValue> = {};
    for (const [k, v] of obj.entries()) out[k.decodeText()] = toPdfValue(ctx, v, k.decodeText(), depth + 1);
    return out;
  }
  return null;
}

export function toPdfDict(ctx: PDFContext, obj: PDFObject | undefined): PdfDictValue | null {
  return dict(toPdfValue(ctx, obj));
}
