import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, calculationScript, displayValue, formatScripts, parseCalculation, parseDate, parseFormat, parseNumber, recalculate } from './formScripts.ts';

test('calculation scripts read and write the Acrobat form', () => {
  assert.deepEqual(parseCalculation('AFSimple_Calculate("SUM", new Array ("Qty1", "Qty2"));'), { op: 'SUM', fields: ['Qty1', 'Qty2'] });
  assert.deepEqual(parseCalculation("AFSimple_Calculate('AVG', ['a','b'])"), { op: 'AVG', fields: ['a', 'b'] });
  assert.deepEqual(parseCalculation('AFSimple_Calculate("PRD", "a, b")'), { op: 'PRD', fields: ['a', 'b'] });
  assert.equal(parseCalculation('event.value = 3'), null);
  const c = { op: 'MAX' as const, fields: ['x "1"', 'y'] };
  assert.deepEqual(parseCalculation(calculationScript(c)), c);
});

test('numbers read the way people type them', () => {
  assert.equal(parseNumber('1,234.50'), 1234.5);
  assert.equal(parseNumber('$12'), 12);
  assert.equal(parseNumber('(3)'), -3);
  assert.equal(parseNumber('-4.5'), -4.5);
  assert.equal(parseNumber('45%'), 0.45);
  assert.equal(parseNumber('abc'), null);
});

test('calculate: blank counts as 0 for sums, is skipped for averages', () => {
  const v: Record<string, string> = { a: '2', b: '', c: '4' };
  const get = (n: string) => v[n] ?? '';
  assert.equal(calculate({ op: 'SUM', fields: ['a', 'b', 'c'] }, get), 6);
  assert.equal(calculate({ op: 'PRD', fields: ['a', 'c'] }, get), 8);
  assert.equal(calculate({ op: 'PRD', fields: ['a', 'b'] }, get), 0);
  assert.equal(calculate({ op: 'AVG', fields: ['a', 'b', 'c'] }, get), 3);
  assert.equal(calculate({ op: 'MIN', fields: ['a', 'c'] }, get), 2);
});

test('formats: number, currency, percent and date', () => {
  const money = parseFormat('AFNumber_Format(2, 0, 2, 0, "$", true);')!;
  assert.deepEqual(money, { kind: 'number', decimals: 2, separator: true, negativeParens: true, currency: '$', currencyFirst: true });
  assert.equal(displayValue('1234.5', money), '$1,234.50');
  assert.equal(displayValue('-3', money), '($3.00)');
  assert.deepEqual(parseFormat(formatScripts(money).format), money);
  assert.equal(displayValue('0.125', parseFormat('AFPercent_Format(1, 0)')), '12.5%');
  const date = parseFormat('AFDate_FormatEx("dd/mm/yyyy")')!;
  assert.equal(displayValue('2026-09-29', date), '29/09/2026');
  assert.equal(displayValue('3/4/2026', date), '03/04/2026');
  assert.equal(displayValue('not a date', date), 'not a date');
  assert.equal(parseDate('4/3/26', 'mm/dd/yy')?.getDate(), 3);
  assert.equal(displayValue('2026-01-05', { kind: 'date', pattern: 'mmm d, yyyy' }), 'Jan 5, 2026');
});

test('recalculate settles totals of totals', () => {
  const calcs = new Map([
    ['total', { op: 'SUM' as const, fields: ['sub1', 'sub2'] }],
    ['sub1', { op: 'PRD' as const, fields: ['q1', 'p1'] }],
    ['sub2', { op: 'PRD' as const, fields: ['q2', 'p2'] }],
  ]);
  const values = new Map([
    ['q1', '2'],
    ['p1', '1.5'],
    ['q2', '3'],
    ['p2', '10'],
  ]);
  // "total" first in the order: needs a second pass.
  const changed = recalculate(['total', 'sub1', 'sub2'], calcs, values);
  assert.equal(values.get('total'), '33');
  assert.equal(changed.get('sub1'), '3');
});
