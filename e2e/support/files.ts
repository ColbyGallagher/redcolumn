// Reads back the files the app saves (app.saved()): PDFs through pdf-lib, and the zips Split and
// Extract write (stored, uncompressed: apps/web/src/documents/zip.ts).
import { PDFDocument } from 'pdf-lib';

/** Each page's size in points and its /Rotate, in page order. */
export async function pdfPages(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width: Math.round(width), height: Math.round(height), rotation: p.getRotation().angle };
  });
}

export async function pdfInfo(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return { title: doc.getTitle(), author: doc.getAuthor(), subject: doc.getSubject(), keywords: doc.getKeywords(), pageCount: doc.getPageCount() };
}

/** The entries of a zip whose files are stored without compression. */
export function unzip(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { name: string; data: Uint8Array }[] = [];
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    if (view.getUint16(at + 8, true) !== 0) throw new Error('Compressed zip entries are not supported');
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extraLen;
    out.push({ name, data: bytes.subarray(start, start + size) });
    at = start + size;
  }
  return out;
}
