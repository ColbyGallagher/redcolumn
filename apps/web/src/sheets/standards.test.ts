import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportStandard, newStandard, parseStandardFile, standardFileName, standardHash, type DrawingStandard } from './standards.ts';

function wsp(): DrawingStandard {
  const s = newStandard('WSP / HLD1BDD');
  s.sheets = {
    boxes: [
      { field: 'number', x: 0.79, y: 0.95, w: 0.1, h: 0.03 },
      { field: 'ignore', x: 0.9, y: 0.95, w: 0.06, h: 0.03 },
    ],
    template: 'HLD1BDD-WSPAU-####-@@-DRG-######',
    disciplinePart: 3,
    disciplines: { BR: 'Bridges' },
  };
  return s;
}

test('a standard round-trips through its file', () => {
  const s = wsp();
  assert.deepEqual(parseStandardFile(exportStandard(s)), s);
  assert.equal(standardFileName({ ...s, name: 'WSP / HLD1BDD: roads?' }), 'WSP _ HLD1BDD_ roads_.rcstandard');
});

test('the hash follows what the standard does to detection, not its name', () => {
  const s = wsp();
  assert.equal(standardHash({ ...s, name: 'Renamed', notes: 'x' }), standardHash(s));
  assert.notEqual(standardHash({ ...s, sheets: { ...s.sheets, template: '@-###' } }), standardHash(s));
});

test('shared files are checked field by field', () => {
  const good = JSON.parse(exportStandard(wsp()));
  const bad = (change: (f: typeof good) => void) => {
    const f = structuredClone(good);
    change(f);
    return () => parseStandardFile(JSON.stringify(f));
  };
  assert.throws(() => parseStandardFile('not json'), /not JSON/);
  assert.throws(() => parseStandardFile(JSON.stringify({ format: 'something-else' })), /another kind of file/);
  assert.throws(bad((f) => (f.version = 99)), /newer version/);
  assert.throws(bad((f) => (f.standard.sheets.boxes[0].x = 2)), /off the page/);
  assert.throws(bad((f) => (f.standard.sheets.boxes[0].x = 0.95)), /off the page/);
  assert.throws(bad((f) => (f.standard.sheets.boxes[0].field = 'script')), /no field/);
  assert.throws(bad((f) => (f.standard.sheets.disciplinePart = -1)), /discipline part/);
  assert.throws(bad((f) => (f.standard.id = '../../x')), /id/);
  assert.throws(() => parseStandardFile('x'.repeat(600 * 1024)), /too large/);
  // Unknown fields are dropped; a code named __proto__ stays a code.
  const extra = structuredClone(good);
  extra.standard.script = 'alert(1)';
  extra.standard.sheets.disciplines = JSON.parse('{"__proto__": "Odd", "BR": "Bridges"}');
  const read = parseStandardFile(JSON.stringify(extra));
  assert.ok(!('script' in read));
  assert.equal(Object.getPrototypeOf(read.sheets.disciplines), Object.prototype);
  assert.deepEqual(Object.keys(read.sheets.disciplines).sort(), ['BR', '__proto__']);
});
