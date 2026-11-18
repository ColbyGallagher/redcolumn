/**
 * Links to a comment: `redcolumn://markup/?doc=<id>&markup=<id>&name=<file name>`. A comment register
 * can put one on each item number, so clicking it in Excel opens the document at that comment.
 *
 * The link comes from a workbook, which is outside data: it is taken apart here into three plain
 * strings and nothing else. The page then looks the document up in its own library; a link never
 * names a path, and never makes the app fetch or run anything.
 */

export const LINK_SCHEME = 'redcolumn';

export interface MarkupLink {
  /** The document's id in the library of the computer the link was made on. */
  doc: string;
  /** The markup's id. */
  markup: string;
  /** The document's file name, to find it by when the id is not in this library. */
  name: string;
}

const MAX_URL = 2000;
const MAX_FIELD = 300;
/** No control characters, and not too long. */
const plain = (v: string | null): v is string => v !== null && v.length > 0 && v.length <= MAX_FIELD && !/[\u0000-\u001f\u007f]/.test(v);

/** The comment a link points at, or null when it is not one of this app's links. */
export function parseMarkupLink(value: string): MarkupLink | null {
  if (value.length > MAX_URL || !value.toLowerCase().startsWith(`${LINK_SCHEME}://markup`)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== `${LINK_SCHEME}:` || url.hostname !== 'markup' || url.username || url.password || url.port) return null;
  const doc = url.searchParams.get('doc');
  const markup = url.searchParams.get('markup');
  const name = url.searchParams.get('name') ?? '';
  if (!plain(doc) || !plain(markup) || (name !== '' && !plain(name))) return null;
  return { doc, markup, name };
}

/** The comment links on a command line: Windows starts the app with the clicked link as an argument. */
export function linkArguments(argv: readonly string[]): MarkupLink[] {
  return argv.flatMap((arg) => {
    const link = parseMarkupLink(arg);
    return link ? [link] : [];
  });
}
