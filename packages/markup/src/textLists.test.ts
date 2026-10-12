import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoFormatList, backspaceList, continueList, layoutParagraphs, parseListItem, shiftList, toggleList, type TextEdit } from './textLists.ts';
import { textBoxLines } from './render.ts';
import { DEFAULT_STYLES, type Markup } from './model.ts';

/** Reads a text with `|` for the caret, or «» around the selection. */
function sel(s: string): { text: string; start: number; end: number } {
  const a = s.indexOf('«');
  if (a >= 0) {
    const b = s.indexOf('»');
    return { text: s.slice(0, a) + s.slice(a + 1, b) + s.slice(b + 1), start: a, end: b - 1 };
  }
  const i = s.indexOf('|');
  return { text: s.slice(0, i) + s.slice(i + 1), start: i, end: i };
}
/** The inverse of `sel`. */
function show(e: TextEdit): string {
  return e.start === e.end ? `${e.text.slice(0, e.start)}|${e.text.slice(e.start)}` : `${e.text.slice(0, e.start)}«${e.text.slice(e.start, e.end)}»${e.text.slice(e.end)}`;
}
const run = (s: string, op: (text: string, start: number, end: number) => TextEdit | null) => {
  const { text, start, end } = sel(s);
  const e = op(text, start, end);
  return e && show(e);
};
const toggle = (s: string, kind: Parameters<typeof toggleList>[3]) => run(s, (t, a, b) => toggleList(t, a, b, kind));
const enter = (s: string) => run(s, continueList);
const shift = (s: string, dir: 1 | -1) => run(s, (t, a, b) => shiftList(t, a, b, dir));

test('list items are recognised by their markers and indent', () => {
  assert.equal(parseListItem('• milk')?.kind, 'bullet');
  assert.equal(parseListItem('        – nested')?.level, 2);
  assert.equal(parseListItem('12. twelve')?.value, 12);
  assert.deepEqual(parseListItem('b) bee'), { level: 0, kind: 'letter', marker: 'b)', value: 2, upper: false, delim: ')', ambiguous: false, prefixLen: 3, content: 'bee' });
  assert.equal(parseListItem('iv. four')?.kind, 'roman');
  assert.equal(parseListItem('[x] done')?.kind, 'check');
  // Plain text that merely looks close is not a list.
  for (const line of ['no marker', '•no space', 'Dr. Smith', 'Mild. weather', '1.5 metres', '']) assert.equal(parseListItem(line), null, line);
});

test('toggling a bullet list marks every selected line and skips blanks', () => {
  assert.equal(toggle('«one\n\ntwo»', 'bullet'), '«• one\n\n• two»');
  assert.equal(toggle('one|', 'bullet'), '• one|');
  assert.equal(toggle('on|e', 'bullet'), '• on|e');
});

test('toggling again takes the lines out of the list; another kind converts', () => {
  assert.equal(toggle('«• one\n• two»', 'bullet'), '«one\ntwo»');
  assert.equal(toggle('«• one\n• two»', 'number'), '«1. one\n2. two»');
});

test('numbered lists count from 1, and join a list above them', () => {
  assert.equal(toggle('«a\nb\nc»', 'number'), '«1. a\n2. b\n3. c»');
  assert.equal(toggle('1. a\n2. b\n|c', 'number'), '1. a\n2. b\n3. |c');
  assert.equal(toggle('«a\nb»', 'letter'), '«a. a\nb. b»');
  assert.equal(toggle('«a\nb\nc»', 'roman'), '«i. a\nii. b\niii. c»');
});

test('a nested numbered list comes out in one toggle', () => {
  assert.equal(toggle('«1. a\n    a. b\n2. c»', 'number'), '«a\nb\nc»');
});

test('Enter continues a list and numbers what follows', () => {
  assert.equal(enter('• one|'), '• one\n• |');
  assert.equal(enter('1. one|\n2. two'), '1. one\n2. |\n3. two');
  assert.equal(enter('[ ] task|'), '[ ] task\n[ ] |');
  assert.equal(enter('[x] task|'), '[x] task\n[ ] |');
  assert.equal(enter('a. one|'), 'a. one\nb. |');
  assert.equal(enter('i. one|\nii. two'), 'i. one\nii. |\niii. two');
  // Splits the item at the caret.
  assert.equal(enter('• one| two'), '• one\n• |two');
});

test('a roman list started on one line goes i, ii, iii, but a lettered list still reaches i after h', () => {
  assert.equal(toggle('one|', 'roman'), 'i. one|');
  assert.equal(enter('i. one|'), 'i. one\nii. |');
  assert.equal(enter('i. one\nii. two|'), 'i. one\nii. two\niii. |');
  assert.equal(enter('I. one|'), 'I. one\nII. |');
  assert.equal(enter('g. g\nh. h|'), 'g. g\nh. h\ni. |');
  assert.equal(enter('h. h|\ni. i'), 'h. h\ni. |\nj. i');
  // Moving the lone numeral item keeps it numeral-style too.
  assert.equal(toggle('«a\nb»', 'roman'), '«i. a\nii. b»');
});

test('Enter on an empty item leaves the list, a level at a time', () => {
  assert.equal(enter('• one\n• |'), '• one\n|');
  assert.equal(enter('1. one\n    a. |'), '1. one\n2. |');
  assert.equal(enter('plain|'), null);
});

test('Enter before an item pushes it down behind an empty one', () => {
  assert.equal(enter('• one\n|• two'), '• one\n• \n• |two');
});

test('Tab moves items in and out, restyling numbers and bullets by level', () => {
  assert.equal(shift('1. a\n2. b|\n3. c', 1), '1. a\n    a. b|\n2. c');
  assert.equal(shift('1. a\n    a. b|\n2. c', -1), '1. a\n2. b|\n3. c');
  assert.equal(shift('• a\n• b|', 1), '• a\n    – b|');
  assert.equal(shift('• a\n    – b\n        › c|', 1), '• a\n    – b\n            • c|');
  assert.equal(shift('plain|', 1), null);
  // Outdenting past the top does nothing.
  assert.equal(shift('• a|', -1), '• a|');
});

test('Tab on a selection moves every item in it', () => {
  assert.equal(shift('• a\n«• b\n• c»', 1), '• a\n«    – b\n    – c»');
});

test('three levels of a numbered list read 1. a. i.', () => {
  assert.equal(shift('1. a\n    a. b\n    b. c|', 1), '1. a\n    a. b\n        i. c|');
});

test('Backspace at the start of an item takes it out of the list', () => {
  const back = (s: string) => run(s, backspaceList);
  assert.equal(back('• |one'), '|one');
  assert.equal(back('1. a\n2. |b\n3. c'), '1. a\n|b\n3. c');
  assert.equal(back('1. a\n    a. |b'), '1. a\n2. |b');
  assert.equal(back('• o|ne'), null);
  assert.equal(back('plain|'), null);
});

test('typing a space after -, * or [] starts a list', () => {
  const auto = (s: string) => run(s, (t, a) => autoFormatList(t, a));
  assert.equal(auto('- |'), '• |');
  assert.equal(auto('* |hello'), '• |hello');
  assert.equal(auto('[] |'), '[ ] |');
  assert.equal(auto('    - |'), '    – |');
  assert.equal(auto('a - |'), null);
  assert.equal(auto('-|'), null);
});

test('wrapped list lines hang under their text', () => {
  const measure = (s: string) => s.length * 10;
  assert.deepEqual(layoutParagraphs('• aaa bbb ccc ddd\nplain text', 120, measure), [
    { text: '• aaa bbb', indent: 0 },
    { text: 'ccc ddd', indent: 20 },
    { text: 'plain text', indent: 0 },
  ]);
});

test('a text box draws wrapped list lines indented, and right-aligned ones as a block', () => {
  const m = { id: 't', type: 'text', pageIndex: 0, points: [[0, 0], [108, 100]], style: { ...DEFAULT_STYLES.text, fontSize: 10 }, status: 'none', author: '', createdAt: 1, modifiedAt: 1, text: '1. aaa bbb ccc ddd' } as Markup;
  const measure = (s: string) => s.length * 10;
  assert.deepEqual(textBoxLines(m, measure).map((l) => [l.text, l.x]), [['1. aaa bbb', 4], ['ccc ddd', 34]]);
  const right = textBoxLines({ ...m, style: { ...m.style, textAlign: 'right' } }, measure);
  assert.equal(right[1]!.x + right[1]!.width, 104);
});
