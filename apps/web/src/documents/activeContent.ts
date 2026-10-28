import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';

/**
 * Active content: JavaScript (actions, the document-level name tree, scripts run on opening or on
 * page and field events) and Launch actions, which open files or programs. A script can change
 * what a signed PDF shows without touching its signed bytes, so what a viewer shows may not be
 * what was signed: signing and checking warn about it.
 */

export interface ActiveContent {
  /** JavaScript runs when the document opens (/OpenAction or the catalog's /AA). */
  onOpen: boolean;
  /** Document-level scripts (the /Names /JavaScript tree). */
  documentLevel: boolean;
  /** JavaScript actions anywhere (pages, fields, links, the ones above). */
  javascript: number;
  /** Launch actions. */
  launch: number;
}

const S = PDFName.of('S');
const JS = PDFName.of('JS');
const isJs = (d: PDFDict) => d.get(S) === PDFName.of('JavaScript') || d.has(JS);
const isLaunch = (d: PDFDict) => d.get(S) === PDFName.of('Launch');

/** The active content in a PDF, from every object in it (whether or not anything still reaches it). */
export function findActiveContent(doc: PDFDocument): ActiveContent {
  const found: ActiveContent = { onOpen: false, documentLevel: false, javascript: 0, launch: 0 };
  const seen = new Set<PDFObject>();
  const visit = (root: PDFObject) => {
    const stack: PDFObject[] = [root];
    while (stack.length) {
      const o = stack.pop()!;
      if (seen.has(o)) continue;
      seen.add(o);
      const dict = o instanceof PDFStream ? o.dict : o instanceof PDFDict ? o : null;
      if (dict) {
        if (isJs(dict)) found.javascript++;
        else if (isLaunch(dict)) found.launch++;
        // Direct children only: indirect ones are visited as objects of their own.
        for (const [, v] of dict.entries()) if (!(v instanceof PDFRef)) stack.push(v);
      } else if (o instanceof PDFArray) for (const v of o.asArray()) if (!(v instanceof PDFRef)) stack.push(v);
    }
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj);
  // A catalog stored inline in the trailer is not an indirect object.
  visit(doc.catalog);

  const ctx = doc.context;
  const deref = (v: PDFObject | undefined) => (v instanceof PDFRef ? ctx.lookup(v) : v);
  /** An action and the ones after it (/Next) include JavaScript or a Launch. */
  const runs = (action: PDFObject | undefined, depth = 0): boolean => {
    const a = deref(action);
    if (depth > 20) return false;
    if (a instanceof PDFArray) return a.asArray().some((x) => runs(x, depth + 1));
    if (!(a instanceof PDFDict)) return false;
    return isJs(a) || isLaunch(a) || runs(a.get(PDFName.of('Next')), depth + 1);
  };
  const aa = deref(doc.catalog.get(PDFName.of('AA')));
  found.onOpen = runs(doc.catalog.get(PDFName.of('OpenAction'))) || (aa instanceof PDFDict && [...aa.entries()].some(([, v]) => runs(v)));
  const names = deref(doc.catalog.get(PDFName.of('Names')));
  found.documentLevel = names instanceof PDFDict && !!names.get(PDFName.of('JavaScript'));
  return found;
}

/** The PDF's active content, described for a warning; null when it has none. */
export function describeActiveContent(a: ActiveContent): string | null {
  const parts = [
    a.onOpen ? 'runs a script or program when it opens' : '',
    a.documentLevel ? 'has document-level JavaScript' : '',
    a.javascript ? `has ${a.javascript} JavaScript action${a.javascript === 1 ? '' : 's'}` : '',
    a.launch ? `has ${a.launch} action${a.launch === 1 ? '' : 's'} that open${a.launch === 1 ? 's' : ''} a file or program` : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  return `This PDF ${parts.join(', ')}. Scripts can change what it shows without changing the signed bytes, so what you see may not be what was signed.`;
}

/** The warning for a PDF's bytes; null when it has no active content or cannot be read. */
export async function activeContentWarning(bytes: Uint8Array): Promise<string | null> {
  try {
    return describeActiveContent(findActiveContent(await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })));
  } catch {
    return null;
  }
}
