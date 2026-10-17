import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeContent, parseStrokeForm, placements, Scanner, type OptimizeOptions } from './content.ts';

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (b: Uint8Array) => String.fromCharCode(...b);
const run = (s: string, options?: OptimizeOptions) => {
  const { bytes: out, stats } = optimizeContent(bytes(s), options);
  return { out: text(out), stats };
};
/** Operators in order, without operands. */
const ops = (s: string) => {
  const sc = new Scanner(bytes(s));
  const out: string[] = [];
  while (sc.next()) out.push(sc.op);
  return out;
};
const dash = (x: number, state = '0.5 0.5 0.5 RG 0.1 w') => `q ${state} ${x} 10 m ${x + 0.75} 10 l S 0 G 0 w Q\n`;

test('the scanner skips strings, arrays, dictionaries, comments and inline images', () => {
  const s = '(a (nested) \\) string) Tj [(x) -20 (y)] TJ /P <</MCID 3 /A <</B (>>)>> >> BDC % note q Q\n' + 'BI /W 2 /H 1 /BPC 8 /CS /G ID \x00Q EI\x01 EI\nEMC 1 0 0 1 0 0 cm';
  assert.deepEqual(ops(s), ['Tj', 'TJ', 'BDC', 'BI', 'EMC', 'cm']);
  const sc = new Scanner(bytes('-0.5 .25 +3. 12 re /Fm1 Do'));
  sc.next();
  assert.deepEqual([...sc.nums.subarray(0, sc.numCount)], [-0.5, 0.25, 3, 12]);
  sc.next();
  assert.equal(sc.op, 'Do');
  assert.equal(sc.name, 'Fm1');
});

test('a run of stroke objects with the same state becomes one path', () => {
  const src = `BT (title) Tj ET\n${Array.from({ length: 100 }, (_, i) => dash(i)).join('')}0 0 m 5 5 l f\n`;
  const { out, stats } = run(src);
  assert.equal(stats.merged, 100);
  assert.equal(stats.written, 2, '100 points wide in cells of 64: two areas');
  assert.equal(ops(out).filter((o) => o === 'S').length, 2);
  assert.equal(ops(out).filter((o) => o === 'm').length, 101, 'every dash kept, plus the fill');
  assert.ok(out.startsWith('BT (title) Tj ET\n'), 'what comes before is kept byte for byte');
  assert.ok(out.endsWith('0 0 m 5 5 l f\n'), 'and what comes after');
});

test('objects of different state, transparency, fills and marked content are not merged together', () => {
  // Different colours: two runs, painted in their original order.
  const { out } = run(dash(0) + dash(1) + dash(2, '1 0 0 RG 0.1 w') + dash(3));
  const s = ops(out).filter((o) => o === 'S' || o === 'RG');
  assert.deepEqual(s, ['RG', 'S', 'RG', 'S', 'RG', 'S']);
  // Transparency and fills are left exactly as they were.
  for (const src of [`q /GS1 gs 0 0 m 1 1 l S Q\nq /GS1 gs 2 2 m 3 3 l S Q\n`, `q 1 0 0 rg 0 0 5 5 re f Q\nq 1 0 0 rg 2 2 5 5 re f Q\n`]) {
    assert.equal(run(src).out, src);
  }
  // A layer change between two objects keeps them apart.
  const marked = `${dash(0)}/OC /oc1 BDC\n${dash(1)}EMC\n`;
  assert.equal(run(marked).stats.merged, 2);
  assert.equal(ops(run(marked).out).filter((o) => o === 'S').length, 2);
});

test('long runs are split so no merged path gets too big', () => {
  const src = Array.from({ length: 50 }, (_, i) => dash(i / 10)).join('');
  assert.equal(run(src, { maxPathOps: 20 }).stats.written, 5);
});

test('stroke-only forms placed by translation are drawn inline', () => {
  const tile = parseStrokeForm(bytes('0.7 0.7 0.7 RG\r1 J\r0.1 w\r0 0 m\r1.2 0 l\rS\r1.2 0.43 m\r1.2 0 l\rS\r'), [-0.05, -0.05, 1.25, 0.48]);
  assert.ok(tile);
  const place = (x: number, y: number) => `q 1 0 0 1 ${x} ${y} cm 0.5 0.5 0.5 RG 0.1 w /Fm2 Do Q\n`;
  const { out, stats } = run(place(5, 7) + place(6.2, 7) + 'q 2 0 0 2 0 0 cm /Fm2 Do Q\n', { form: (n) => (n === 'Fm2' ? tile : null) });
  assert.equal(stats.inlined, 2, 'a scaled placement stays as it is');
  assert.match(out, /^q\n0\.5 0\.5 0\.5 RG 0\.1 w\n0\.7 0\.7 0\.7 RG\n1 J\n0\.1 w\n5 7 m\n6\.2 7 l\n6\.2 7\.43 m\n6\.2 7 l\n6\.2 7 m\n/);
  assert.ok(out.endsWith('q 2 0 0 2 0 0 cm /Fm2 Do Q\n'));
});

test('only forms that just stroke, inside their box, can go inline', () => {
  const box: [number, number, number, number] = [0, 0, 10, 10];
  assert.equal(parseStrokeForm(bytes('0 0 m 5 5 l f'), box), null, 'fills');
  assert.equal(parseStrokeForm(bytes('0 0 m 50 5 l S'), box), null, 'reaches outside its box');
  assert.equal(parseStrokeForm(bytes('0 0 m 5 5 l S 1 0 0 RG 1 1 m 2 2 l S'), box), null, 'state changes between paths');
  assert.equal(parseStrokeForm(bytes('BT (a) Tj ET'), box), null, 'text');
  assert.ok(parseStrokeForm(bytes('0 0 m 5 5 l S 6 6 m 7 7 l s'), box));
});

test('a rectangle clip written as a polygon is written as a rectangle', () => {
  const { out, stats } = run('q 25 584 m 25 10 l 831 10 l 831 584 l 238 584 l 25 584 l W* n BT (x) Tj ET Q');
  assert.equal(stats.rects, 1);
  assert.equal(out, 'q 25 10 806 574 re\nW* n BT (x) Tj ET Q');
});

test('a rectangle clip around strokes already inside it is dropped', () => {
  const src = `q 0 0 m 100 0 l 100 100 l 50 100 l 0 100 l W* n\n${dash(10)}${dash(20)}Q\n`;
  const { out, stats } = run(src);
  assert.equal(stats.clips, 1);
  assert.ok(!/W/.test(out));
  assert.equal(ops(out).filter((o) => o === 'S').length, 1, 'and the strokes merge');
});

test('strokes under a polygon clip are cut to it and the clip dropped', () => {
  // A triangle; a horizontal line across it at y = 2.
  const src = `q 0 0 m 10 0 l 5 8 l h W n\nq 0 0 0 RG -5 2 m 15 2 l S Q\nQ\n`;
  const { out, stats } = run(src);
  assert.equal(stats.clips, 1);
  assert.ok(!/\bW\b/.test(out));
  // The triangle is 7.5 wide at y = 2: x from 1.25 to 8.75.
  assert.match(out, /1\.25 2 m\n8\.75 2 l\nS/);
});

test('dashed strokes keep their clip (a cut line would restart its dashes)', () => {
  const src = `q 0 0 m 10 0 l 5 8 l h W n\nq [2 1] 0 d -5 2 m 15 2 l S Q\nQ\n`;
  const { out, stats } = run(src);
  assert.equal(stats.clips, 0);
  assert.match(out, /\bW n/);
});

test('placements track the transformation in force', () => {
  const p = placements(bytes('q 2 0 0 2 0 0 cm q 100 0 0 50 10 10 cm /Im1 Do Q Q q 0 30 -30 0 0 0 cm /Im1 Do Q /Fm1 Do'));
  assert.deepEqual(p.get('Im1'), { w: 200, h: 100 });
  assert.deepEqual(p.get('Fm1'), { w: 1, h: 1 });
});
