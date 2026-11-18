/**
 * Links to a comment. A comment register can put one on each item number, so clicking it in Excel
 * opens the document at that comment.
 *
 * The desktop app's links use its own scheme (`redcolumn://markup/?…`, apps/desktop/src/links.ts);
 * the web app's are its own address with the same three values in the query. A link names the
 * document by its id in the library of the computer it was made on, with the file name to fall back
 * on: documents live on the device, so a link opens the comment where that document is.
 *
 * A link read back is outside data (anyone can write one): it is three plain strings, used only to
 * look a document up in the library and select a markup in it.
 */

export interface MarkupLink {
  /** The document's id in the library the link was made from. */
  doc: string;
  /** The markup's id. */
  markup: string;
  /** The document's file name. */
  name: string;
}

const MAX_FIELD = 300;
const plain = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD && !/[\u0000-\u001f\u007f]/.test(v);

/** The link as checked values, or null when it is not one. */
export function checkMarkupLink(v: { doc?: unknown; markup?: unknown; name?: unknown } | null | undefined): MarkupLink | null {
  if (!v || !plain(v.doc) || !plain(v.markup)) return null;
  return { doc: v.doc, markup: v.markup, name: plain(v.name) ? v.name : '' };
}

/** Where links made by this app point: the desktop app's scheme, or the web app's own address. */
export type LinkBase = { kind: 'desktop' } | { kind: 'web'; href: string };

/** The address that opens `link`. */
export function markupLinkUrl(base: LinkBase, link: MarkupLink): string {
  const q = new URLSearchParams({ doc: link.doc, markup: link.markup, ...(link.name ? { name: link.name.slice(0, MAX_FIELD) } : {}) });
  if (base.kind === 'desktop') return `redcolumn://markup/?${q}`;
  const url = new URL(base.href);
  return `${url.origin}${url.pathname}?${q}`;
}

/** The comment link in the web app's own address (`?doc=…&markup=…`), or null. */
export function parseMarkupQuery(search: string): MarkupLink | null {
  const q = new URLSearchParams(search);
  return q.has('markup') ? checkMarkupLink({ doc: q.get('doc'), markup: q.get('markup'), name: q.get('name') }) : null;
}

/** Removes a comment link from the address, so a reload does not follow it again. */
export function stripMarkupQuery() {
  const url = new URL(window.location.href);
  for (const k of ['doc', 'markup', 'name']) url.searchParams.delete(k);
  window.history.replaceState(window.history.state, '', url.href);
}

/** The library document a link is for: by id, else the only one with its file name. */
export function linkedFile<F extends { id: string; name: string }>(files: readonly F[], link: MarkupLink): F | undefined {
  const byId = files.find((f) => f.id === link.doc);
  if (byId || !link.name) return byId;
  const named = files.filter((f) => f.name === link.name);
  return named.length === 1 ? named[0] : undefined;
}
