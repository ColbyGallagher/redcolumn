import type { PageText } from '@nb/sheets';
import { commonPageSize, findRepeatedRegions, regionOnPage } from '../../sheets/repeatedRegions';

/** A page's text split for the index: what the page is about, and the text repeated on most pages. */
export interface IndexedText {
  body: string;
  /**
   * Words in a box at the same place on most pages near an edge (headers, footers, title block
   * strips). A word found only there ranks lower, so a search for "PLAN" puts the plans first,
   * not every sheet whose title block says "PLAN" in the project name.
   */
  chrome: string;
}

/** Each page's text split into body and chrome (see `IndexedText`). */
export function splitChrome(pages: readonly PageText[]): IndexedText[] {
  const all = pages.map((_, i) => i);
  const regions = pages.length >= 2 ? findRepeatedRegions(pages, all) : [];
  const ref = regions.length ? commonPageSize(pages, all) : null;
  return pages.map((page) => {
    const boxes = ref ? regions.map((r) => regionOnPage(r.rect, ref, page)) : [];
    const body: string[] = [];
    const chrome: string[] = [];
    for (const w of page.words) {
      const cx = (w.x0 + w.x1) / 2;
      const cy = (w.y0 + w.y1) / 2;
      const repeated = boxes.some((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
      (repeated ? chrome : body).push(w.text);
    }
    return { body: body.join(' '), chrome: chrome.join(' ') };
  });
}
