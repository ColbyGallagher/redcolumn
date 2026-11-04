import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TextWord } from '@nb/pdf-core';
import { compareParagraphs, countKinds, documentParagraphs, exactMatches, normalise, pageParagraphs, similarity, SIMILAR, wordDiff, type AiDecision, type Paragraph } from './semantic.ts';

/** Words of one text line starting at (x, y), 10pt type, 5pt per letter. */
function line(text: string, x: number, y: number): TextWord[] {
  let cursor = x;
  return text.split(' ').map((w) => {
    const word = { text: w, x0: cursor, y0: y, x1: cursor + w.length * 5, y1: y + 10, size: 10, angle: 0 };
    cursor = word.x1 + 3;
    return word;
  });
}

/** Paragraphs from plain strings, ids numbered like a document's. */
function paras(prefix: 'o' | 'n', texts: string[]): Paragraph[] {
  return texts.map((text, i) => ({ id: `${prefix}${i + 1}`, page: 1, text, box: { x: 0, y: i * 40, w: 400, h: 30 } }));
}

const A = 'The foundation is poured concrete on a compacted gravel bed.';
const B = 'The contractor shall submit shop drawings before fabrication. Approval takes ten working days.';
const B2 = 'The contractor shall submit shop drawings before fabrication. Approval takes fourteen working days.';
const C = 'All timber is treated to hazard class H3 unless noted otherwise.';

test('lines close together are one paragraph, a bigger gap starts the next', () => {
  const words = [...line('First line of one', 50, 100), ...line('paragraph continues here', 50, 112), ...line('Second paragraph', 50, 150)];
  const out = pageParagraphs(words, 3);
  assert.deepEqual(
    out.map((p) => p.text),
    ['First line of one paragraph continues here', 'Second paragraph'],
  );
  assert.equal(out[0]!.page, 3);
  assert.equal(out[0]!.box.y, 100);
});

test('two columns read down one, then down the other', () => {
  const words = [...line('left one', 50, 100), ...line('right one', 300, 100), ...line('left two', 50, 112), ...line('right two', 300, 112)];
  assert.deepEqual(
    pageParagraphs(words, 1).map((p) => p.text).sort(),
    ['left one left two', 'right one right two'],
  );
});

test('a word hyphenated across a line break is closed up', () => {
  const words = [...line('the founda-', 50, 100), ...line('tion is poured', 50, 112)];
  assert.equal(pageParagraphs(words, 1)[0]!.text, 'the foundation is poured');
});

test('documentParagraphs numbers paragraphs through every page', async () => {
  const pages = [line('Alpha', 50, 50), line('Beta', 50, 50)];
  const out = await documentParagraphs('n', 2, async (i) => pages[i]!);
  assert.deepEqual(
    out.map((p) => [p.id, p.page, p.text]),
    [['n1', 1, 'Alpha'], ['n2', 2, 'Beta']],
  );
});

test('normalise ignores case, punctuation and spacing', () => {
  assert.equal(normalise('  Shop-Drawings,\n  APPROVED. '), 'shop drawings approved');
});

test('wordDiff marks the changed words', () => {
  const parts = wordDiff('Approval takes ten working days', 'Approval takes fourteen working days');
  assert.deepEqual(parts, [
    { op: 'same', text: 'Approval takes' },
    { op: 'del', text: 'ten' },
    { op: 'ins', text: 'fourteen' },
    { op: 'same', text: 'working days' },
  ]);
});

test('similarity is high for a reworded paragraph and low for another', () => {
  assert.ok(similarity(B, B2) > 0.8);
  assert.ok(similarity(A, C) < 0.3);
});

test('exactMatches pairs equal text once each, and reports the rest', () => {
  const m = exactMatches(paras('o', [A, A, B]), paras('n', [A, C]));
  assert.deepEqual(m.pairs.map((p) => [p.old.id, p.new.id]), [['o1', 'n1']]);
  assert.deepEqual(m.unmatchedOld.map((p) => p.id), ['o2', 'o3']);
  assert.deepEqual(m.unmatchedNew.map((p) => p.id), ['n2']);
});

test("the issue's example: A B C becomes C A B with one sentence in B reworded", () => {
  const { changes } = compareParagraphs(paras('o', [A, B, C]), paras('n', [C, A, B2]));
  const byNew = Object.fromEntries(changes.map((c) => [c.new!.id, c]));
  // C moved to the front, A and B2 kept their order: only C counts as moved.
  assert.equal(byNew.n1!.kind, 'moved');
  assert.equal(byNew.n1!.basis, 'exact');
  assert.equal(byNew.n2!.kind, 'unchanged');
  assert.equal(byNew.n3!.kind, 'modified');
  assert.equal(byNew.n3!.basis, 'text');
  assert.deepEqual(
    byNew.n3!.wording!.filter((p) => p.op !== 'same'),
    [{ op: 'del', text: 'ten' }, { op: 'ins', text: 'fourteen' }],
  );
  assert.equal(changes.some((c) => c.kind === 'added' || c.kind === 'removed'), false);
});

test('new and deleted paragraphs are added and removed', () => {
  const D = 'Scaffolding shall be erected by a licensed contractor only.';
  const { changes } = compareParagraphs(paras('o', [A, C]), paras('n', [A, D]));
  assert.deepEqual(countKinds(changes), { added: 1, removed: 1, modified: 0, moved: 0, unchanged: 1 });
});

test('an AI verdict settles a pair the text pass would have split', () => {
  // Same meaning, different words: similarity alone calls these an add and a remove.
  const oldP = paras('o', ['Payment is due within thirty days of the invoice date.']);
  const newP = paras('n', ['Invoices must be settled one month after they are issued.']);
  const plain = compareParagraphs(oldP, newP);
  assert.deepEqual(countKinds(plain.changes), { added: 1, removed: 1, modified: 0, moved: 0, unchanged: 0 });
  assert.equal(plain.unreported, 2);

  const ai: AiDecision[] = [{ kind: 'unchanged', old: 'o1', new: 'n1', note: 'Same payment term.' }];
  const judged = compareParagraphs(oldP, newP, ai);
  assert.equal(judged.unreported, 0);
  assert.equal(judged.changes.length, 1);
  assert.equal(judged.changes[0]!.kind, 'unchanged');
  assert.equal(judged.changes[0]!.basis, 'ai');
  assert.equal(judged.changes[0]!.note, 'Same payment term.');
});

test('an AI move of a reworded paragraph is kept, and the reworded text is shown', () => {
  const ai: AiDecision[] = [{ kind: 'moved', old: 'o1', new: 'n3' }];
  const { changes } = compareParagraphs(paras('o', [B, A, C]), paras('n', [A, C, B2]), ai);
  const moved = changes.find((c) => c.new!.id === 'n3')!;
  assert.equal(moved.kind, 'moved');
  assert.equal(moved.basis, 'ai');
  assert.ok(moved.wording!.some((p) => p.op === 'ins' && p.text === 'fourteen'));
});

test('an AI decision for a paragraph that already matched exactly is ignored', () => {
  const ai: AiDecision[] = [{ kind: 'removed', old: 'o1' }];
  const { changes } = compareParagraphs(paras('o', [A]), paras('n', [A]), ai);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.kind, 'unchanged');
  assert.equal(changes[0]!.basis, 'exact');
});

test('a removed paragraph is listed where it used to be', () => {
  const { changes } = compareParagraphs(paras('o', [A, B, C]), paras('n', [A, C]));
  assert.deepEqual(changes.map((c) => c.kind), ['unchanged', 'removed', 'unchanged']);
});

test('a long reordered document is cheap to compare', () => {
  const texts = Array.from({ length: 600 }, (_, i) => `Clause ${i} states requirement number ${i * 7} for the works.`);
  const shuffled = [...texts.slice(300), ...texts.slice(0, 300)];
  const { changes } = compareParagraphs(paras('o', texts), paras('n', shuffled));
  const counts = countKinds(changes);
  assert.equal(counts.added + counts.removed + counts.modified, 0);
  assert.equal(counts.moved, 300);
  assert.equal(counts.unchanged, 300);
});

test('thousands of leftover paragraphs pair as an all-pairs search would, and quickly', () => {
  // Pseudo-random wording from a small vocabulary, so many pairs share words and some read alike.
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  const vocab = ['the', 'pipe', 'valve', 'to', 'be', 'replaced', 'new', 'existing', 'see', 'detail', 'A', 'B', 'C', 'mm', 'dia'];
  const text = () => Array.from({ length: 2 + rand(8) }, () => vocab[rand(vocab.length)]).join(' ');
  const old = paras('o', Array.from({ length: 300 }, text));
  const cur = paras('n', Array.from({ length: 300 }, text));
  const { pairs, unmatchedOld, unmatchedNew } = exactMatches(old, cur);
  // The pairs the text pass makes of what is left: as an all-pairs search makes them, best score
  // first, ties in old then new order.
  const left = compareParagraphs(unmatchedOld, unmatchedNew).changes.filter((c) => c.basis === 'text' && c.old && c.new).map((c) => c.id);
  const expected = (() => {
    const s: { o: (typeof unmatchedOld)[number]; n: (typeof unmatchedNew)[number]; s: number }[] = [];
    for (const o of unmatchedOld) for (const n of unmatchedNew) {
      const v = similarity(o.text, n.text);
      if (v >= SIMILAR) s.push({ o, n, s: v });
    }
    s.sort((x, y) => y.s - x.s);
    const uo = new Set<string>();
    const un = new Set<string>();
    const out: string[] = [];
    for (const { o, n } of s) if (!uo.has(o.id) && !un.has(n.id)) uo.add(o.id), un.add(n.id), out.push(`${o.id}-${n.id}`);
    return out;
  })();
  assert.ok(pairs.length > 0 && expected.length > 0);
  assert.deepEqual([...left].sort(), [...expected].sort());

  const many = 8000;
  const big = (p: 'o' | 'n') => paras(p, Array.from({ length: many }, (_, i) => `TAG ${p === 'o' ? 'A' : 'B'}${i} TYPE ${i % 7} SEE DETAIL ${i % 13}`));
  const t = performance.now();
  compareParagraphs(big('o'), big('n'));
  assert.ok(performance.now() - t < 5000, `took ${Math.round(performance.now() - t)} ms`);
});

test('past the pair budget, paragraphs made only of common words still pair up', () => {
  // 1,500 × 1,500 is over the budget, and every word but the last is in every paragraph.
  const notes = (p: 'o' | 'n') => paras(p, Array.from({ length: 1500 }, () => `SEE DETAIL 3 TYPE ${p === 'o' ? 'A' : 'B'}`));
  const { changes } = compareParagraphs(notes('o'), notes('n'));
  const kinds = countKinds(changes);
  assert.equal(kinds.modified, 1500);
  assert.equal(kinds.added + kinds.removed, 0);
});

test('wordDiff of two very long paragraphs stays within memory and keeps their ends', () => {
  const words = (k: number, tag: string) => Array.from({ length: k }, (_, i) => `${tag}${i}`).join(' ');
  const a = `START ${words(6000, 'a')} END`;
  const b = `START ${words(6000, 'b')} END`;
  const parts = wordDiff(a, b);
  assert.deepEqual(parts.map((p) => p.op), ['same', 'del', 'ins', 'same']);
  assert.equal(parts[0]!.text, 'START');
  assert.equal(parts[3]!.text, 'END');
});
