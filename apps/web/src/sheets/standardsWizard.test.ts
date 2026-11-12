import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boxFromRegion, type PageText, type SheetInfo, type Word } from '@nb/sheets';
import { TITLE_QUESTIONS, boxFor, checkBox, checkVerdict, customNameProblem, disciplineCandidates, samplePages, startPage, templateFor, withAnswer } from './standardsWizard.ts';

const W = 2384;
const H = 1684;
const word = (text: string, x: number, y: number, size = 12): Word => ({ text, x0: x, y0: y - size, x1: x + text.length * size * 0.55, y1: y, size, angle: 0 });
const page = (words: Word[]): PageText => ({ width: W, height: H, words });
/** A sheet with its number and revision where a strip title block puts them. */
const sheet = (number: string, rev = 'C') => page([word('DRAWING', 1900, 740, 6), word('No.', 1940, 740, 6), word(number, 1900, 770, 14), word('REV', 1900, 790, 6), word(rev, 1900, 830, 30)]);
const size = { width: W, height: H };
const numberBox = boxFromRegion({ x: 1880, y: 720, w: 420, h: 60 }, size, 'number');
const info = (number: string | null, title: string | null): SheetInfo => ({ number, title, discipline: null, scaleText: null, revision: null, source: 'text', confidence: 1 });

test('the questions start with the drawing number, which cannot be skipped', () => {
  assert.equal(TITLE_QUESTIONS[0]!.field, 'number');
  assert.equal(TITLE_QUESTIONS[0]!.optional, false);
  assert.ok(TITLE_QUESTIONS.slice(1).every((q) => q.optional));
  assert.equal(new Set(TITLE_QUESTIONS.map((q) => q.key)).size, TITLE_QUESTIONS.length);
});

test('an answer replaces the box for its question only', () => {
  const status = TITLE_QUESTIONS.find((q) => q.name === 'Status')!;
  const project = TITLE_QUESTIONS.find((q) => q.name === 'Project')!;
  const a = boxFromRegion({ x: 0, y: 0, w: 10, h: 10 }, size, 'custom', 'Status');
  const b = boxFromRegion({ x: 20, y: 0, w: 10, h: 10 }, size, 'custom', 'Status');
  let boxes = withAnswer([numberBox], status, a);
  boxes = withAnswer(boxes, project, b);
  boxes = withAnswer(boxes, status, b);
  assert.equal(boxes.length, 3);
  assert.equal(boxFor(boxes, status)!.x, b.x);
  assert.equal(boxFor(boxes, project)!.name, 'Project');
  assert.deepEqual(withAnswer(boxes, status, null).map((x) => x.name ?? x.field), ['number', 'Project']);
});

test('sample pages spread through the set and leave out the page drawn on', () => {
  assert.deepEqual(samplePages(21, 5), [2, 7, 11, 15, 19]);
  assert.deepEqual(samplePages(4, 1), [0, 2, 3]);
  for (const p of samplePages(40, 7, 8)) assert.notEqual(p, 7);
});

test('the wizard starts on the first sheet with a number and title', () => {
  assert.equal(startPage([info(null, null), info('X-1', null), info('X-2', 'PLAN')]), 2);
  assert.equal(startPage([]), 0);
});

test('a box is checked across the set', () => {
  const texts = [page([word('COVER', 100, 100)]), sheet('KRU2-MCC-0412-RW-DRG-000021'), sheet('KRU2-MCC-0412-RW-DRG-000022'), sheet('KRU2-MCC-0412-RW-DRG-000031')];
  const c = checkBox(texts, numberBox, 1);
  assert.equal(c.here, 'KRU2-MCC-0412-RW-DRG-000021');
  assert.equal(c.read, 3);
  assert.equal(c.of, 4);
  assert.deepEqual(c.repeated, []);
  assert.deepEqual(
    c.samples.map((s) => s.value),
    [null, 'KRU2-MCC-0412-RW-DRG-000022', 'KRU2-MCC-0412-RW-DRG-000031'],
  );
  assert.equal(checkVerdict(c, 'number'), 'some');
  assert.deepEqual(c.empty, [0]);
  // The same number on every sheet: the box is on something else (a contract number).
  const same = checkBox([sheet('C-2041'), sheet('C-2041'), sheet('C-2041')], numberBox, 0);
  assert.deepEqual(same.repeated, ['C-2041']);
  assert.equal(checkVerdict(same, 'number'), 'poor');
});

test('the template leaves out numbers built another way', () => {
  const ours = ['KRU2-MCC-0412-RW-DRG-000021', 'KRU2-MCC-0412-RW-DRG-000031', 'KRU2-MCC-0412-DR-DRG-000301'];
  assert.equal(templateFor(ours), 'KRU2-MCC-0412-@@-DRG-######');
  assert.equal(templateFor([...ours, 'S-101']), 'KRU2-MCC-0412-@@-DRG-######');
});

test('discipline candidates: letter codes that change between sheets', () => {
  const numbers = ['KRU2-MCC-0412-RW-DRG-000021', 'KRU2-MCC-0412-DR-DRG-000031', 'KRU2-MCC-0412-RW-DRG-000301'];
  const found = disciplineCandidates(numbers);
  assert.deepEqual(found[0], { part: 3, codes: ['DR', 'RW'] });
  // Parts with digits are never offered (0412, KRU2, 000021); constant letter parts come after.
  assert.deepEqual(
    found.map((f) => f.part),
    [3, 1, 4],
  );
});

test("a field of the person's own cannot take a name already in use", () => {
  const pkg = boxFromRegion({ x: 0, y: 0, w: 10, h: 10 }, size, 'custom', 'Package');
  assert.match(customNameProblem('status', []) ?? '', /Status has its own question/);
  assert.match(customNameProblem(' PACKAGE ', [pkg]) ?? '', /already a field called Package/);
  assert.equal(customNameProblem('Drawn by', [pkg]), null);
  assert.equal(customNameProblem('', [pkg]), null);
});
