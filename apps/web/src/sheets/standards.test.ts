import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportStandard, newStandard, parseStandardFile, standardFileName, standardHash, standardOfProject, type DrawingStandard } from './standards.ts';

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
  assert.throws(() => parseStandardFile('x'.repeat(5 * 1024 * 1024)), /too large/);
  // Unknown fields are dropped; a code named __proto__ stays a code.
  const extra = structuredClone(good);
  extra.standard.script = 'alert(1)';
  extra.standard.sheets.disciplines = JSON.parse('{"__proto__": "Odd", "BR": "Bridges"}');
  const read = parseStandardFile(JSON.stringify(extra));
  assert.ok(!('script' in read));
  assert.equal(Object.getPrototypeOf(read.sheets.disciplines), Object.prototype);
  assert.deepEqual(Object.keys(read.sheets.disciplines).sort(), ['BR', '__proto__']);
});

test("a standard's link words and its own taught marks travel in the file and are checked", () => {
  const s = wsp();
  s.links = { ids: ['@@#', '#'], titles: { section: ['SECTION', 'SECT'], elevation: ['ELEVATION'], enlargedPlan: ['ENLARGED'] }, matchLine: ['CONTINUED ON'], calloutPart: 5 };
  s.marks = [{ id: 'm1', kind: 'sectionMark', name: 'WSP cut', createdAt: 1, w: 30, h: 30, lines: [0, 0, 10, 10], words: [{ role: 'detail', text: 'A', x: 5, y: 5, size: 6 }] }];
  assert.deepEqual(parseStandardFile(exportStandard(s)), s);
  const good = JSON.parse(exportStandard(s));
  const bad = (change: (f: typeof good) => void) => {
    const f = structuredClone(good);
    change(f);
    return () => parseStandardFile(JSON.stringify(f));
  };
  assert.throws(bad((f) => (f.standard.marks[0].kind = 'portal')), /no kind/);
  assert.throws(bad((f) => (f.standard.marks[0].lines = [0, 0, 1])), /line work/);
  assert.throws(bad((f) => (f.standard.marks[0].lines = [0, 0, 1, 'x'])), /not a number/);
  assert.throws(bad((f) => (f.standard.marks[0].words[0].role = 'script')), /label/);
  assert.throws(bad((f) => (f.standard.links.calloutPart = 99)), /part callouts cite/);
  assert.throws(bad((f) => (f.standard.links.titles.section = 'SECTION')), /section words/);
  // A file from before standards held links and marks reads with the defaults.
  const older = structuredClone(good);
  delete older.standard.links;
  delete older.standard.marks;
  const read = parseStandardFile(JSON.stringify(older));
  assert.deepEqual([read.links.ids, read.links.titles.section, read.marks], [null, ['SECTION'], []]);
  // Teaching or forgetting a mark changes the hash: sets read with the standard look again.
  assert.notEqual(standardHash({ ...s, marks: [] }), standardHash(s));
});

test("a standard's chainage settings travel in the file and are checked", () => {
  const s = wsp();
  s.chainage = { prefixes: ['CH'], alignments: ['MC01', 'RAMP A'], planTitles: ['PLAN AND LONGITUDINAL SECTION'], sectionTitles: ['CROSS SECTIONS'] };
  assert.deepEqual(parseStandardFile(exportStandard(s)).chainage, s.chainage);
  const f = JSON.parse(exportStandard(s));
  f.standard.chainage.alignments = 'MC01';
  assert.throws(() => parseStandardFile(JSON.stringify(f)), /alignment names/);
  delete f.standard.chainage;
  assert.deepEqual(parseStandardFile(JSON.stringify(f)).chainage.prefixes, ['STA', 'CH', 'CHAINAGE']);
  assert.notEqual(standardHash({ ...s, chainage: { ...s.chainage, alignments: [] } }), standardHash(s));
});

test("identifying words travel in the file; a Project's standard is read like any shared file", () => {
  const s = { ...wsp(), identify: ['WSP', 'HLD1BDD'] };
  assert.deepEqual(parseStandardFile(exportStandard(s)).identify, ['WSP', 'HLD1BDD']);
  // Not part of the hash: they only decide when to offer the standard, not how it reads.
  assert.equal(standardHash({ ...s, identify: [] }), standardHash(s));
  assert.equal(standardOfProject(JSON.parse(exportStandard(s)))?.name, s.name);
  assert.equal(standardOfProject(undefined), null);
  assert.equal(standardOfProject({ format: 'redcolumn.drawing-standard', version: 1, standard: { id: '../x' } }), null);
});

test('custom title-block fields travel in the file with their names, checked like the rest', () => {
  const s = wsp();
  s.sheets.boxes.push({ field: 'custom', name: 'Status', x: 0.1, y: 0.1, w: 0.1, h: 0.05 });
  const good = JSON.parse(exportStandard(s));
  assert.deepEqual(parseStandardFile(JSON.stringify(good)).sheets.boxes.at(-1), { field: 'custom', name: 'Status', x: 0.1, y: 0.1, w: 0.1, h: 0.05 });
  const f = structuredClone(good);
  f.standard.sheets.boxes.at(-1).name = 'x'.repeat(61);
  assert.throws(() => parseStandardFile(JSON.stringify(f)), /custom field's name is too long/);
  // A name only on a custom box; a blank one reads as Field.
  f.standard.sheets.boxes.at(-1).name = '  ';
  f.standard.sheets.boxes[0].name = 'Stray';
  const read = parseStandardFile(JSON.stringify(f));
  assert.equal(read.sheets.boxes.at(-1)!.name, 'Field');
  assert.equal(read.sheets.boxes[0]!.name, undefined);
  // The hash changes with a field's name, since sets are tagged with it.
  assert.notEqual(standardHash(read), standardHash(parseStandardFile(JSON.stringify(good))));
});
