import { PDFArray, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFDocument, type PDFPage } from 'pdf-lib';

/**
 * Content this app adds to pages (headers and footers, flattened markups) goes in its own content
 * streams, marked with a key in the stream dictionary, so it can be found and taken off again
 * without touching the page's own drawing.
 */

/** A page's /Contents as an array (it may be a stream, an array, or a reference to either). */
function contentList(page: PDFPage): { list: PDFArray | null; single: PDFRef | PDFStream | null } {
  const raw = page.node.get(PDFName.of('Contents'));
  const resolved = raw instanceof PDFRef ? page.doc.context.lookup(raw) : raw;
  if (resolved instanceof PDFArray) return { list: resolved, single: null };
  return { list: null, single: (raw as PDFRef | PDFStream | undefined) ?? null };
}

function isTagged(page: PDFPage, entry: unknown, tag: string): boolean {
  const obj = entry instanceof PDFRef ? page.doc.context.lookup(entry) : entry;
  return (obj instanceof PDFRawStream || obj instanceof PDFStream) && obj.dict.has(PDFName.of(tag));
}

export function pageHasTagged(page: PDFPage, tag: string): boolean {
  const { list, single } = contentList(page);
  return list ? list.asArray().some((e) => isTagged(page, e, tag)) : !!single && isTagged(page, single, tag);
}

/** Removes a tag's streams from pages (all by default). Returns how many pages had any. */
export function removeTagged(doc: PDFDocument, tag: string, pages?: readonly number[]): number {
  let n = 0;
  const all = doc.getPages();
  for (const i of pages ?? all.map((_, k) => k)) {
    const page = all[i];
    if (!page) continue;
    const { list, single } = contentList(page);
    if (list) {
      let removed = false;
      for (let k = list.size() - 1; k >= 0; k--) {
        if (isTagged(page, list.get(k), tag)) {
          list.remove(k);
          removed = true;
        }
      }
      if (removed) n++;
    } else if (single && isTagged(page, single, tag)) {
      page.node.delete(PDFName.of('Contents'));
      n++;
    }
  }
  return n;
}

/**
 * Stops pdf-lib wrapping a page's content in its own q … Q when the page is touched (resources
 * added, streams appended): those pile up on every edit. Our tagged wrappers do the job and come
 * off cleanly instead. Call before anything touches the page.
 */
export function keepContentAsIs(page: PDFPage) {
  (page.node as unknown as { autoNormalizeCTM: boolean }).autoNormalizeCTM = false;
}

/**
 * Draws `ops` on top of a page in a tagged stream. The page's own content is wrapped in q … Q
 * (tagged too) so graphics state it leaves behind does not leak into ours; removing the tag's
 * streams restores the page exactly.
 */
export function addTagged(doc: PDFDocument, page: PDFPage, tag: string, ops: string) {
  keepContentAsIs(page);
  const tagged = (content: string) => doc.context.register(doc.context.flateStream(content, { [tag]: true }));
  const contents = page.node.normalizedEntries().Contents;
  if (contents?.size()) {
    contents.insert(0, tagged('q'));
    page.node.addContentStream(tagged('Q'));
  }
  page.node.addContentStream(tagged(ops));
}
