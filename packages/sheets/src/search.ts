import type { PageText, Word } from './types.ts';

export interface SearchHit {
  pageIndex: number;
  /** Boxes of the matched words, in page space. */
  rects: { x: number; y: number; w: number; h: number }[];
  /** The match with some surrounding text. */
  snippet: string;
  /** Where the match sits within `snippet`. */
  matchStart: number;
  matchEnd: number;
}

export interface SearchOptions {
  /** Match whole words only (default false). */
  wholeWord?: boolean;
  /** Match capitalisation exactly (default false). */
  caseSensitive?: boolean;
  /** Stop after this many hits (default 1000). */
  limit?: number;
}

const SNIPPET_CONTEXT = 40;

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Search of page text, case-insensitive unless asked. Words are joined in extraction (reading) order, so a
 * phrase matches across word boundaries ("noise wall" matches NOISE + WALL).
 */
export function searchText(pages: readonly PageText[], query: string, options: SearchOptions = {}): SearchHit[] {
  const cased = !!options.caseSensitive;
  const q = cased ? normalize(query) : normalize(query).toLowerCase();
  if (!q) return [];
  const limit = options.limit ?? 1000;
  const hits: SearchHit[] = [];
  pages.forEach((page, pageIndex) => {
    if (hits.length >= limit) return;
    // Page text as one string, remembering which word each character came from.
    let text = '';
    const owner: number[] = [];
    page.words.forEach((w: Word, i) => {
      if (text) {
        text += ' ';
        owner.push(-1);
      }
      const t = cased ? w.text : w.text.toLowerCase();
      text += t;
      for (let k = 0; k < t.length; k++) owner.push(i);
    });
    // Snippets show the original capitalisation (same length as the searched text).
    const original = page.words.map((w) => w.text).join(' ');
    let from = 0;
    while (hits.length < limit) {
      const at = text.indexOf(q, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + q.length;
      if (options.wholeWord && ((at > 0 && /\w/.test(text[at - 1]!)) || (end < text.length && /\w/.test(text[end]!)))) continue;
      const wordIdx = [...new Set(owner.slice(at, end).filter((o) => o >= 0))];
      const rects = wordIdx.map((i) => {
        const w = page.words[i]!;
        return { x: w.x0, y: w.y0, w: w.x1 - w.x0, h: w.y1 - w.y0 };
      });
      const s0 = Math.max(0, at - SNIPPET_CONTEXT);
      const s1 = Math.min(text.length, end + SNIPPET_CONTEXT);
      hits.push({ pageIndex, rects, snippet: original.slice(s0, s1), matchStart: at - s0, matchEnd: end - s0 });
    }
  });
  return hits;
}
