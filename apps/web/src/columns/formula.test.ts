import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evalFormula, formulaRefs } from './formula';
import { matchesFilter } from './listColumns';

const values: Record<string, number | string> = { quantity: 4, 'unit cost': '12.50', status: 'Accepted', name: 'Door' };
const lookup = (n: string) => values[n.toLowerCase()];
const run = (src: string) => evalFormula(src, lookup);

test('arithmetic follows precedence and reads numeric text', () => {
  assert.deepEqual(run('[Quantity] * [Unit Cost]'), { value: 50 });
  assert.deepEqual(run('1 + 2 * 3 ^ 2'), { value: 19 });
  assert.deepEqual(run('-(2 + 3) * 2'), { value: -10 });
  assert.deepEqual(run('2 ^ 3 ^ 2'), { value: 512 });
});

test('functions, comparisons and text joining', () => {
  assert.deepEqual(run('ROUND(10 / 3, 2)'), { value: 3.33 });
  assert.deepEqual(run('IF([Status] = "accepted", [Quantity], 0)'), { value: 4 });
  assert.deepEqual(run('IF([Quantity] > 5, "big", "small")'), { value: 'small' });
  assert.deepEqual(run('[Name] & " x" & [Quantity]'), { value: 'Door x4' });
  assert.deepEqual(run('CONCAT(UPPER([Name]), "-", MAX(1, 7, 3))'), { value: 'DOOR-7' });
});

test('errors are reported, not thrown', () => {
  assert.ok('error' in run('[Missing] + 1'));
  assert.ok('error' in run('1 +'));
  assert.ok('error' in run('FOO(1)'));
  assert.deepEqual(run('1 / 0'), { error: '#DIV/0' });
});

test('formulaRefs lists referenced columns', () => {
  assert.deepEqual(formulaRefs('[A] * ROUND([B], 2) + [A]'), ['A', 'B']);
});

test('filters: contains, not, exact, numeric and blank', () => {
  const c = { text: 'Plan review', num: null };
  const n = { text: '12.5', num: 12.5 };
  assert.ok(matchesFilter(c, 'plan'));
  assert.ok(!matchesFilter(c, '!plan'));
  assert.ok(matchesFilter(c, '=plan review'));
  assert.ok(!matchesFilter(c, '=plan'));
  assert.ok(matchesFilter(n, '>10'));
  assert.ok(!matchesFilter(n, '<=10'));
  assert.ok(matchesFilter({ text: '', num: null }, '(blank)'));
  assert.ok(matchesFilter(c, '(not blank)'));
});
