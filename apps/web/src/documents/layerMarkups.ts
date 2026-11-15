// Kept apart from layers.ts so the app can use it without loading pdf-lib.
import type { PdfLayer } from './layers';

/**
 * The markup layers hidden along with the PDF's own layers. A markup put on a PDF layer (an annotation
 * with /OC, as Revu saves them) is imported with that layer's name, so switching the layer off hides
 * markup layers of the same name: a name whose PDF layers are all off. (Files can repeat a name; while
 * one layer of that name is on, its markups stay.)
 */
export function markupLayersOfHiddenPdf(pdfLayers: readonly PdfLayer[], hiddenPdf: readonly string[]): string[] {
  const hidden = new Set(hiddenPdf);
  const allOff = new Map<string, boolean>();
  for (const l of pdfLayers) allOff.set(l.name, (allOff.get(l.name) ?? true) && hidden.has(l.id));
  return [...allOff].filter(([, off]) => off).map(([name]) => name);
}
