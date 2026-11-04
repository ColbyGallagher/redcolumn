import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveScale, matchPaper, paperFromText, PAPER_SIZES, parseScaleStatements } from './paper.ts';

const mm = (w: number, h: number): [number, number] => [(w * 72) / 25.4, (h * 72) / 25.4];

test('ISO sizes halve correctly', () => {
  const size = (n: string) => PAPER_SIZES.find((p) => p.name === n)!;
  assert.deepEqual([size('A1').widthMm, size('A1').heightMm], [594, 841]);
  assert.deepEqual([size('A3').widthMm, size('A3').heightMm], [297, 420]);
  assert.deepEqual([size('B1').widthMm, size('B1').heightMm], [707, 1000]);
});

test('matchPaper finds sheets in either orientation within plot tolerance', () => {
  assert.equal(matchPaper(...mm(841, 594))?.paper.name, 'A1');
  assert.equal(matchPaper(...mm(841, 594))?.landscape, true);
  assert.equal(matchPaper(...mm(297, 420))?.paper.name, 'A3');
  assert.equal(matchPaper(...mm(845, 597))?.paper.name, 'A1');
  assert.equal(matchPaper(36 * 72, 24 * 72)?.paper.name, 'ARCH D');
  assert.equal(matchPaper(34 * 72, 22 * 72)?.paper.name, 'ANSI D');
  assert.equal(matchPaper(...mm(650, 450)), null);
});

test('paperFromText reads sheet names and inch dimensions', () => {
  assert.equal(paperFromText('A1')?.name, 'A1');
  assert.equal(paperFromText('@ a3')?.name, 'A3');
  assert.equal(paperFromText('ANSI-D')?.name, 'ANSI D');
  assert.equal(paperFromText('ARCH E1')?.name, 'ARCH E1');
  assert.equal(paperFromText('24"x36"')?.name, 'ARCH D');
  assert.equal(paperFromText('SITE PLAN'), null);
});

test('parseScaleStatements keeps the sheet each scale is written for', () => {
  const [a] = parseScaleStatements('SCALE 1:100 @ A1');
  assert.equal(a!.scale.label, '1:100');
  assert.equal(a!.paper?.name, 'A1');
  assert.equal(parseScaleStatements('1:500 (A1)')[0]!.paper?.name, 'A1');
  const dual = parseScaleStatements('1:100 AT A1 / 1:200 AT A3');
  assert.deepEqual(dual.map((s) => [s.scale.label, s.paper?.name]), [['1:100', 'A1'], ['1:200', 'A3']]);
  const tight = parseScaleStatements('1:250@A1/1:500@A3');
  assert.deepEqual(tight.map((s) => [s.scale.label, s.paper?.name]), [['1:250', 'A1'], ['1:500', 'A3']]);
  const arch = parseScaleStatements(`1/4" = 1'-0" ON 24x36`);
  assert.equal(arch.length, 1);
  assert.equal(arch[0]!.scale.label, `1/4" = 1'-0"`);
  assert.equal(arch[0]!.paper?.name, 'ARCH D');
  assert.equal(parseScaleStatements('1:100')[0]!.paper, null);
  assert.deepEqual(parseScaleStatements('NTS'), []);
});

test('effectiveScale corrects a sheet saved smaller than it was drawn for', () => {
  const full = effectiveScale('1:100 @ A1', ...mm(841, 594))!;
  assert.equal(full.printRatio, 1);
  assert.equal(full.scale.label, '1:100');
  const half = effectiveScale('1:100 @ A1', ...mm(420, 297))!;
  assert.ok(Math.abs(half.printRatio - 0.5) < 0.01);
  assert.ok(Math.abs(half.scale.metersPerPoint / full.scale.metersPerPoint - 2) < 0.02);
  assert.equal(half.scale.label, '1:100 @ A1 (on A3)');
  assert.equal(half.aspectMismatch, false);
  // 10 m at 1:200 on A3 is 50 mm of paper.
  const metersFor50mm = ((50 * 72) / 25.4) * half.scale.metersPerPoint;
  assert.ok(Math.abs(metersFor50mm - 10) < 0.1);
});

test('effectiveScale picks the dual statement for the page sheet and flags cropping', () => {
  const a3 = effectiveScale('1:100 AT A1 / 1:200 AT A3', ...mm(420, 297))!;
  assert.equal(a3.statement.scale.label, '1:200');
  assert.equal(a3.printRatio, 1);
  const cropped = effectiveScale('1:100 @ A1', ...mm(841, 400))!;
  assert.equal(cropped.aspectMismatch, true);
  assert.equal(effectiveScale('1:100', ...mm(420, 297))!.printRatio, 1);
  assert.equal(effectiveScale('NTS', 100, 100), null);
});

test('effectiveScale takes the sheet size from its own box when the scale names none', () => {
  const half = effectiveScale('1:100', ...mm(420, 297), 'A1')!;
  assert.ok(Math.abs(half.printRatio - 0.5) < 0.01);
  assert.equal(half.scale.label, '1:100 @ A1 (on A3)');
  assert.equal(effectiveScale('1:200 @ A3', ...mm(420, 297), 'A1')!.printRatio, 1, 'the scale text wins');
});

test('long runs of white space read quickly and as one space', () => {
  const spaces = '\t'.repeat(50_000);
  const start = performance.now();
  assert.equal(paperFromText(`ANSI${spaces}`), null);
  assert.deepEqual(parseScaleStatements(`@ANSI${spaces}1:100`).length, 1);
  assert.deepEqual(parseScaleStatements(`@0${spaces}`), []);
  assert.ok(performance.now() - start < 500);
  assert.equal(parseScaleStatements('1:100\t\t@\n A1')[0]!.paper?.name, 'A1');
  assert.equal(parseScaleStatements('1:100, A1').length, 1);
});

test('digit groups in a ratio are one number', () => {
  assert.equal(parseScaleStatements('1:1,000 @ A1')[0]!.scale.label, '1:1000');
  assert.equal(parseScaleStatements('SCALE 1:2 500')[0]!.scale.label, '1:2500');
  const dual = parseScaleStatements('1:1,000@A1/1:2,000@A3');
  assert.deepEqual(dual.map((s) => [s.scale.label, s.paper?.name]), [['1:1000', 'A1'], ['1:2000', 'A3']]);
});

test('a page padded to a size that is not a standard sheet is flagged, not only corrected', () => {
  const padded = effectiveScale('1:500 @ A1', ...mm(901, 654))!;
  assert.equal(padded.aspectMismatch, false);
  assert.equal(padded.unknownSize, true);
  assert.equal(effectiveScale('1:500 @ A1', ...mm(420, 297))!.unknownSize, false);
  assert.equal(effectiveScale('1:500 @ A1', 17 * 72, 11 * 72)!.unknownSize, true, 'A1 on ANSI B');
});
