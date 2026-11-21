/**
 * Small pure helpers for the search index: quoting terms for an FTS5 MATCH expression, the
 * expression that narrows a query to candidate pages, and the edit distance used to suggest a
 * spelling. Terms are always ones SQLite's own tokenizer produced (folded to lower case without
 * accents), so these never fold text themselves.
 */

/** A term as an FTS5 string, so `-`, `:` or `"` in it are not read as query syntax. */
export const quote = (term: string) => `"${term.replace(/"/g, '""')}"`;

/** A query term with its alternatives: any of them on a page makes the page a candidate. */
type TermGroup = string[];

/**
 * Whether a term is a word character run as SQLite's unicode61 tokenizer sees it. Used only to
 * tell whether the query starts or ends in the middle of a word.
 */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * The FTS5 expression for a query whose tokens are `tokens` (from SQLite's tokenizer, in order).
 * The exact matcher in the Search panel finds the query anywhere in a page's text, so the pages
 * this expression matches must include every page the matcher can match:
 *
 * - a token between two others is a whole word on the page (the separators around it are there too);
 * - the last token can be the start of a longer word, so it is a prefix (`"m1"*`);
 * - the first token can be the end of a longer word ("orque" in "torque"), so it also matches the
 *   index's words that contain it (`midWord`), unless the query starts with a separator;
 * - with Whole Words Only every token is a whole word.
 *
 * `midWord` lists the indexed words containing a term but not starting with it, or returns null
 * when there are too many to list; that token then does not narrow the search.
 */
export function matchExpression(query: string, tokens: readonly string[], wholeWord: boolean, midWord: (term: string) => string[] | null): string | null {
  if (!tokens.length) return null;
  const trimmed = query.trim();
  const opensMidWord = WORD_CHAR.test(trimmed[0] ?? '');
  const closesMidWord = WORD_CHAR.test(trimmed[trimmed.length - 1] ?? '');
  const groups: TermGroup[] = [];
  tokens.forEach((t, i) => {
    const first = i === 0;
    const last = i === tokens.length - 1;
    if (wholeWord) {
      groups.push([quote(t)]);
      return;
    }
    const head = last && closesMidWord ? `${quote(t)}*` : quote(t);
    if (first && opensMidWord) {
      const inside = midWord(t);
      if (inside === null) return;
      // `inside` already lists every indexed word containing the term, wherever it ends.
      groups.push([head, ...inside.map(quote)]);
      return;
    }
    groups.push([head]);
  });
  if (!groups.length) return null;
  return groups.map((g) => (g.length === 1 ? g[0]! : `(${g.join(' OR ')})`)).join(' AND ');
}

/**
 * Edit distance between two words (insertions, deletions, substitutions and swaps of neighbouring
 * letters), or `max + 1` as soon as it is known to be more than `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
      row.push(d);
      if (d < best) best = d;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return Math.min(prev[b.length]!, max + 1);
}

/** How far a misspelling may be from the word meant: one edit for short words, two for longer ones. */
export const allowedEdits = (term: string) => (term.length <= 4 ? 1 : 2);

/**
 * Indexed words a misspelt term may have meant, closest first and then the most common, at most
 * `limit`. Words of one or two letters, and anything with a digit (sheet numbers, bolt sizes,
 * levels), are never corrected: M13 is not a misspelling of M12.
 */
export function corrections(term: string, vocabulary: ReadonlyMap<string, number>, limit = 3): string[] {
  if (term.length < 3 || /\p{N}/u.test(term) || !/\p{L}/u.test(term)) return [];
  const max = allowedEdits(term);
  const found: { word: string; d: number; n: number }[] = [];
  for (const [word, n] of vocabulary) {
    if (word === term || Math.abs(word.length - term.length) > max || !/\p{L}/u.test(word)) continue;
    const d = editDistance(term, word, max);
    if (d <= max) found.push({ word, d, n });
  }
  return found
    .sort((x, y) => x.d - y.d || y.n - x.n || (x.word < y.word ? -1 : 1))
    .slice(0, limit)
    .map((f) => f.word);
}
