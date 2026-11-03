/**
 * Semantic compare: what changed in a document's text, with moved paragraphs left alone.
 *
 * Both revisions are cut into paragraphs. Paragraphs with the same text are matched first, by this
 * code, so a paragraph that only moved is never an add plus a remove. Whatever is left over is
 * judged by meaning: by an AI client through the local assistant when one answers, otherwise by a
 * plain text-similarity pass. Every change says which of these decided it (`basis`), so a person
 * can tell a fact from an AI's opinion.
 *
 * Plain data only, so it runs (and is tested) outside the browser.
 */
import type { TextWord } from '@nb/pdf-core';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Paragraph {
  /** `o12` for the 12th paragraph of the old revision, `n7` for the 7th of the new. */
  id: string;
  /** 1-based page. */
  page: number;
  text: string;
  /** In PDF points on its page, origin top-left. */
  box: Box;
}

export type ChangeKind = 'added' | 'removed' | 'modified' | 'moved' | 'unchanged';

/**
 * Who decided a match. `exact` is the same text (this code checked), `ai` is an AI client's
 * judgement, `text` is the built-in similarity fallback.
 */
export type MatchBasis = 'exact' | 'ai' | 'text';

export interface WordPart {
  op: 'same' | 'del' | 'ins';
  text: string;
}

export interface SemanticChange {
  /** Stable within one result: the ids of the paragraphs it joins. */
  id: string;
  kind: ChangeKind;
  basis: MatchBasis;
  old?: Paragraph;
  new?: Paragraph;
  /** For a modified paragraph, its wording old to new. */
  wording?: WordPart[];
  /** The AI's reason, when it gave one. */
  note?: string;
  /** A modified paragraph that also changed place. */
  reordered?: boolean;
}

/** What an AI client decided about one pair, or one paragraph. */
export interface AiDecision {
  kind: ChangeKind;
  old?: string;
  new?: string;
  note?: string;
}

// ---- Paragraphs from words ------------------------------------------------------------------------

interface Segment {
  words: TextWord[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  size: number;
}

const wordsInOrder = (words: readonly TextWord[]) => [...words].filter((w) => w.text.trim()).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

/** Words on one line, left to right, split where a gap is wide enough to be a column break. */
function segmentsOf(words: readonly TextWord[]): Segment[] {
  const lines: TextWord[][] = [];
  for (const w of wordsInOrder(words)) {
    const mid = (w.y0 + w.y1) / 2;
    const line = lines.find((l) => {
      const first = l[0]!;
      return Math.abs((first.y0 + first.y1) / 2 - mid) <= Math.min(first.y1 - first.y0, w.y1 - w.y0) / 2;
    });
    if (line) line.push(w);
    else lines.push([w]);
  }
  const out: Segment[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x0 - b.x0);
    let current: TextWord[] = [];
    const flush = () => {
      if (!current.length) return;
      out.push({
        words: current,
        x0: Math.min(...current.map((w) => w.x0)),
        x1: Math.max(...current.map((w) => w.x1)),
        y0: Math.min(...current.map((w) => w.y0)),
        y1: Math.max(...current.map((w) => w.y1)),
        size: Math.max(...current.map((w) => w.size || w.y1 - w.y0)),
      });
      current = [];
    };
    for (const w of line) {
      const last = current[current.length - 1];
      if (last && w.x0 - last.x1 > Math.max(last.size, w.size) * 2.5) flush();
      current.push(w);
    }
    flush();
  }
  return out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

const overlapsHorizontally = (a: Segment, b: Segment) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.4;

const textOf = (words: readonly TextWord[]) => words.map((w) => w.text.trim()).join(' ');

/** Joins lines into a paragraph, closing up a word hyphenated across a line break. */
function joinLines(lines: readonly string[]): string {
  let text = '';
  for (const line of lines) {
    if (!text) text = line;
    else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(line)) text = text.slice(0, -1) + line;
    else text += ' ' + line;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The paragraphs on one page, in reading order. A line joins the paragraph above it when it sits
 * close underneath and over the same columns; a bigger gap, or another column, starts a new one.
 */
export function pageParagraphs(words: readonly TextWord[], page: number): Omit<Paragraph, 'id'>[] {
  const blocks: { lines: Segment[] }[] = [];
  for (const seg of segmentsOf(words)) {
    let join: { lines: Segment[] } | undefined;
    for (const block of blocks) {
      const last = block.lines[block.lines.length - 1]!;
      const gap = seg.y0 - last.y1;
      if (gap > Math.max(seg.size, last.size) * 0.6 || gap < -Math.max(seg.size, last.size) * 0.5) continue;
      if (Math.abs(seg.size - last.size) > Math.max(seg.size, last.size) * 0.25) continue;
      if (!overlapsHorizontally(seg, last)) continue;
      if (!join || block.lines[block.lines.length - 1]!.y1 > join.lines[join.lines.length - 1]!.y1) join = block;
    }
    if (join) join.lines.push(seg);
    else blocks.push({ lines: [seg] });
  }
  return blocks
    .map((block) => {
      const x0 = Math.min(...block.lines.map((l) => l.x0));
      const y0 = Math.min(...block.lines.map((l) => l.y0));
      const x1 = Math.max(...block.lines.map((l) => l.x1));
      const y1 = Math.max(...block.lines.map((l) => l.y1));
      return { page, text: joinLines(block.lines.map((l) => textOf(l.words))), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
    })
    .filter((p) => p.text);
}

/** Every page's paragraphs, numbered through the document with `prefix` (`o` old, `n` new). */
export async function documentParagraphs(prefix: 'o' | 'n', pageCount: number, text: (pageIndex: number) => Promise<readonly TextWord[]>): Promise<Paragraph[]> {
  const out: Paragraph[] = [];
  for (let i = 0; i < pageCount; i++) {
    for (const p of pageParagraphs(await text(i), i + 1)) out.push({ ...p, id: `${prefix}${out.length + 1}` });
  }
  return out;
}

// ---- Words ----------------------------------------------------------------------------------------

/** The text with case, punctuation and spacing ignored: what "the same text" means. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** Word-level diff old to new (longest common subsequence). Words compare ignoring case and punctuation. */
export function wordDiff(oldText: string, newText: string): WordPart[] {
  const a = wordsOf(oldText);
  const b = wordsOf(newText);
  const key = (w: string) => normalise(w) || w;
  const ka = a.map(key);
  const kb = b.map(key);
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i]![j] = ka[i] === kb[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const parts: WordPart[] = [];
  const push = (op: WordPart['op'], word: string) => {
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += ' ' + word;
    else parts.push({ op, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) {
      push('same', b[j]!);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) push('del', a[i++]!);
    else push('ins', b[j++]!);
  }
  while (i < n) push('del', a[i++]!);
  while (j < m) push('ins', b[j++]!);
  return parts;
}

/** 0 to 1: how much of two paragraphs' words they share (Dice on word counts). */
export function similarity(a: string, b: string): number {
  const wa = wordsOf(normalise(a));
  const wb = wordsOf(normalise(b));
  if (!wa.length || !wb.length) return 0;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const c = counts.get(w) ?? 0;
    if (c > 0) {
      shared++;
      counts.set(w, c - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

// ---- Matching -------------------------------------------------------------------------------------

/** Paragraphs this similar are taken to be the same paragraph reworded, when no AI has said otherwise. */
export const SIMILAR = 0.55;

/** Pairs of paragraphs with the same text, and the paragraphs left without a partner. */
export function exactMatches(oldList: readonly Paragraph[], newList: readonly Paragraph[]) {
  const free = new Map<string, Paragraph[]>();
  for (const p of oldList) {
    const key = normalise(p.text);
    free.set(key, [...(free.get(key) ?? []), p]);
  }
  const pairs: { old: Paragraph; new: Paragraph }[] = [];
  const unmatchedNew: Paragraph[] = [];
  const taken = new Set<string>();
  for (const p of newList) {
    const key = normalise(p.text);
    const candidates = key ? free.get(key) : undefined;
    const old = candidates?.shift();
    if (old) {
      pairs.push({ old, new: p });
      taken.add(old.id);
    } else unmatchedNew.push(p);
  }
  return { pairs, unmatchedOld: oldList.filter((p) => !taken.has(p.id)), unmatchedNew };
}

/** Indexes (into `values`) of one longest strictly increasing run. */
function longestIncreasing(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = [];
  values.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let at = tails.length ? tails[tails.length - 1]! : -1; at >= 0; at = prev[at]!) keep.add(at);
  return keep;
}

/** Greedy best-first pairing of leftover paragraphs that read alike. */
function similarPairs(oldList: readonly Paragraph[], newList: readonly Paragraph[]): { old: Paragraph; new: Paragraph }[] {
  const scored: { o: Paragraph; n: Paragraph; score: number }[] = [];
  for (const o of oldList) for (const n of newList) {
    const score = similarity(o.text, n.text);
    if (score >= SIMILAR) scored.push({ o, n, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const usedOld = new Set<string>();
  const usedNew = new Set<string>();
  const out: { old: Paragraph; new: Paragraph }[] = [];
  for (const { o, n } of scored) {
    if (usedOld.has(o.id) || usedNew.has(n.id)) continue;
    usedOld.add(o.id);
    usedNew.add(n.id);
    out.push({ old: o, new: n });
  }
  return out;
}

export interface ComparisonResult {
  changes: SemanticChange[];
  /** Leftover paragraphs the AI gave no verdict on, which the similarity pass judged instead. */
  unreported: number;
}

/**
 * The full comparison. Same-text paragraphs are matched first. AI decisions then settle some of
 * the rest; the similarity pass settles what is still open. Decisions that name a paragraph that
 * is not left over (it already matched exactly, or does not exist) are ignored here: the caller
 * checks them first and tells the AI.
 */
export function compareParagraphs(oldList: readonly Paragraph[], newList: readonly Paragraph[], ai: readonly AiDecision[] = []): ComparisonResult {
  const exact = exactMatches(oldList, newList);
  const oldById = new Map(oldList.map((p) => [p.id, p]));
  const newById = new Map(newList.map((p) => [p.id, p]));
  const openOld = new Set(exact.unmatchedOld.map((p) => p.id));
  const openNew = new Set(exact.unmatchedNew.map((p) => p.id));

  const pairs: { old?: Paragraph; new?: Paragraph; kind?: ChangeKind; basis: MatchBasis; note?: string }[] = exact.pairs.map((p) => ({ ...p, basis: 'exact' as const }));
  for (const d of ai) {
    const old = d.old ? oldById.get(d.old) : undefined;
    const now = d.new ? newById.get(d.new) : undefined;
    if ((d.old && !old) || (d.new && !now)) continue;
    if ((old && !openOld.has(old.id)) || (now && !openNew.has(now.id))) continue;
    if (old) openOld.delete(old.id);
    if (now) openNew.delete(now.id);
    pairs.push({ ...(old ? { old } : {}), ...(now ? { new: now } : {}), kind: d.kind, basis: 'ai', ...(d.note ? { note: d.note } : {}) });
  }

  const leftOld = exact.unmatchedOld.filter((p) => openOld.has(p.id));
  const leftNew = exact.unmatchedNew.filter((p) => openNew.has(p.id));
  const near = similarPairs(leftOld, leftNew);
  const nearOld = new Set(near.map((p) => p.old.id));
  const nearNew = new Set(near.map((p) => p.new.id));
  for (const p of near) pairs.push({ ...p, kind: 'modified', basis: 'text' });
  for (const p of leftOld) if (!nearOld.has(p.id)) pairs.push({ old: p, kind: 'removed', basis: 'text' });
  for (const p of leftNew) if (!nearNew.has(p.id)) pairs.push({ new: p, kind: 'added', basis: 'text' });
  const unreported = leftOld.length + leftNew.length;

  // Which matched pairs changed place: those outside the longest run that keeps old order.
  const oldIndex = new Map(oldList.map((p, i) => [p.id, i]));
  const newIndex = new Map(newList.map((p, i) => [p.id, i]));
  const matched = pairs.filter((p) => p.old && p.new && p.kind !== 'added' && p.kind !== 'removed').sort((a, b) => newIndex.get(a.new!.id)! - newIndex.get(b.new!.id)!);
  const inOrder = longestIncreasing(matched.map((p) => oldIndex.get(p.old!.id)!));
  const reordered = new Set(matched.filter((_, i) => !inOrder.has(i)).map((p) => p.new!.id));

  const changes: SemanticChange[] = pairs.map((p) => {
    const id = `${p.old?.id ?? ''}${p.old && p.new ? '-' : ''}${p.new?.id ?? ''}`;
    if (!p.old) return { id, kind: 'added', basis: p.basis, new: p.new!, ...(p.note ? { note: p.note } : {}) };
    if (!p.new) return { id, kind: 'removed', basis: p.basis, old: p.old, ...(p.note ? { note: p.note } : {}) };
    const moved = reordered.has(p.new.id);
    const same = p.basis === 'exact';
    // What the AI called a plain match is trusted either way; the app's own pairs are judged by text.
    let kind: ChangeKind = p.kind ?? 'unchanged';
    if (same) kind = moved ? 'moved' : 'unchanged';
    else if (kind === 'unchanged' && moved) kind = 'moved';
    else if (kind === 'added' || kind === 'removed') kind = 'modified';
    const base = { id, kind, basis: p.basis, old: p.old, new: p.new, ...(p.note ? { note: p.note } : {}) };
    if (kind === 'modified') return { ...base, wording: wordDiff(p.old.text, p.new.text), ...(moved ? { reordered: true } : {}) };
    if (!same && normalise(p.old.text) !== normalise(p.new.text)) return { ...base, wording: wordDiff(p.old.text, p.new.text) };
    return base;
  });

  // New document order; a removed paragraph sits after the old paragraph that preceded it.
  const keyOf = new Map<string, number>();
  for (const c of changes) if (c.new) keyOf.set(c.id, newIndex.get(c.new.id)!);
  let carry = -1;
  const lastOld = new Map<string, number>();
  const byOld = new Map(changes.filter((c) => c.old).map((c) => [c.old!.id, c]));
  for (const p of oldList) {
    const own = byOld.get(p.id);
    if (own && keyOf.has(own.id)) carry = keyOf.get(own.id)!;
    else if (own) lastOld.set(own.id, carry + 0.5 + oldIndex.get(p.id)! / (oldList.length + 1) / 1000);
  }
  for (const [id, key] of lastOld) keyOf.set(id, key);
  changes.sort((a, b) => keyOf.get(a.id)! - keyOf.get(b.id)!);
  return { changes, unreported };
}

export function countKinds(changes: readonly SemanticChange[]): Record<ChangeKind, number> {
  const counts: Record<ChangeKind, number> = { added: 0, removed: 0, modified: 0, moved: 0, unchanged: 0 };
  for (const c of changes) counts[c.kind]++;
  return counts;
}
