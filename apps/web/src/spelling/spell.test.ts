import { test } from 'node:test';
import assert from 'node:assert/strict';
import { misspellings, type Speller } from './spell.ts';

const known = new Set(['check', 'per', 'the', 'door', 'at', 'grid', 'line', 'contractor', "contractor's"]);
const fake: Speller = { correct: (w) => known.has(w.toLowerCase()), suggest: () => [], add: () => {} };

test('misspellings skips numbers, codes, abbreviations and ignored words', () => {
  const text = 'Chek the dor at grid line A3, 450mm clr. per Contractor’s RFI-12. Recieve';
  const found = misspellings(fake, text, new Set(['rfi']));
  assert.deepEqual(found.map((f) => f.word), ['Chek', 'dor', 'Recieve']);
  assert.equal(text.slice(found[1]!.index, found[1]!.index + 3), 'dor');
});
