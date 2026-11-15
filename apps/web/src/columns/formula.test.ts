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

test('function names are not case-sensitive', () => {
  assert.deepEqual(run('if([Quantity] > 3, 1, 0)'), { value: 1 });
  assert.deepEqual(run('If([Quantity] > 3, 1, 0)'), { value: 1 });
  assert.deepEqual(run('Round(10 / 3, 1) + ceiling(0.2)'), { value: 4.3 });
});

test('Yes/No values count as 1 and 0', () => {
  const yes = (name: string) => (name === 'Insulated' ? true : name === 'Done' ? false : undefined);
  assert.deepEqual(evalFormula('[Insulated] * 10 + [Done]', yes), { value: 10 });
  assert.deepEqual(evalFormula('IF([Insulated], 2, 3)', yes), { value: 2 });
});

test('CONVERT turns lengths, areas and volumes into other units', () => {
  const near = (src: string, want: number) => {
    const r = run(src);
    assert.ok('value' in r && Math.abs((r.value as number) - want) < 1e-9, `${src}: ${JSON.stringify(r)}`);
  };
  near('CONVERT(10, "ft", "m")', 3.048);
  near('CONVERT(1, "m2", "sf")', 10.763910416709722);
  near('CONVERT(100, "sq ft", "m²")', 9.290304);
  near('CONVERT(1, "cy", "cf")', 27);
  near('convert(1, "m3", "l")', 1000);
  near('CONVERT(1, "ac", "sf")', 43560);
  assert.match((run('CONVERT(1, "m", "m2")') as { error: string }).error, /length .* into area/);
  assert.match((run('CONVERT(1, "furlong", "m")') as { error: string }).error, /does not know the unit "furlong"/);
  assert.ok('error' in run('CONVERT(1, "m")'));
});
