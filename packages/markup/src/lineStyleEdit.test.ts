import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LINE_SETS } from './defaultLines.ts';
import { lineArt } from './lineStyle.ts';
import { draftProblem, fromDraft, newComponent, toDraft, uniqueName, type LineStyleDraft } from './lineStyleEdit.ts';

test('every built-in line style survives a trip through the editor unchanged', () => {
  for (const set of DEFAULT_LINE_SETS) {
    for (const style of set.styles) assert.deepEqual(fromDraft(toDraft(style)), style, style.name);
  }
});

test('reads dashes, gaps, text and symbols into fields', () => {
  const d = toDraft({ name: 'Gas', spec: [false, [1.5, 18, -4, ['G', 'Arial', 7, true, false, false], [1, 2, 0.5, true, 0, 0, 0, 2, 1, 1, 2, 2, 0, 1, 3, 0]]] });
  assert.equal(d.scaleWithWidth, false);
  assert.equal(d.lines[0]!.offset, 1.5);
  assert.deepEqual(d.lines[0]!.components, [
    { kind: 'dash', width: 18 },
    { kind: 'space', width: 4 },
    { kind: 'text', text: 'G', font: 'Arial', size: 7, bold: true, italic: false, upright: false },
    {
      kind: 'vector',
      left: 1,
      right: 2,
      scale: 0.5,
      fill: true,
      points: [
        { type: 'start', x: 0, y: 0 },
        { type: 'curve', x: 1, y: 1 },
        { type: 'curve', x: 2, y: 0 },
        { type: 'line', x: 3, y: 0 },
      ],
    },
  ]);
});

test('a written draft leaves out components with nothing to draw, and starts every symbol with a start point', () => {
  const d: LineStyleDraft = {
    name: '  Fence  ',
    scaleWithWidth: true,
    lines: [
      {
        offset: 0,
        components: [
          { kind: 'dash', width: 0 },
          { kind: 'text', text: '', font: 'Helvetica', size: 6, bold: false, italic: false, upright: true },
          { kind: 'vector', left: 1, right: 1, scale: 1, fill: false, points: [{ type: 'line', x: 0, y: 1 }, { type: 'line', x: 0, y: -1 }] },
          { kind: 'space', width: 3 },
        ],
      },
    ],
  };
  assert.deepEqual(fromDraft(d), { name: 'Fence', spec: [true, [0, [1, 1, 1, false, 0, 0, 1, 1, 0, -1], -3]] });
});

test('a style made in the editor draws', () => {
  const d: LineStyleDraft = { name: 'E line', scaleWithWidth: true, lines: [{ offset: 0, components: [newComponent('dash'), newComponent('space'), newComponent('text'), newComponent('space')] }] };
  assert.equal(draftProblem(d), null);
  const art = lineArt(
    [
      ['M', 0, 0],
      ['L', 200, 0],
    ],
    fromDraft(d),
    1,
    (t, _f, _b, _i, size) => t.length * size * 0.6,
  )!;
  assert.ok(art.stroke.length > 0);
  assert.ok(art.texts.length > 5);
  assert.equal(art.texts[0]!.text, 'A');
});

test('draftProblem says what would stop a style drawing', () => {
  const base = (components: LineStyleDraft['lines'][number]['components']): LineStyleDraft => ({ name: 'X', scaleWithWidth: true, lines: [{ offset: 0, components }] });
  assert.match(draftProblem({ ...base([]), name: ' ' })!, /name/);
  assert.match(draftProblem({ name: 'X', scaleWithWidth: true, lines: [] })!, /at least one line/);
  assert.equal(draftProblem(base([])), null, 'no components is a solid line');
  assert.match(draftProblem(base([{ kind: 'space', width: 4 }]))!, /Nothing would be drawn/);
  const sym = { ...(newComponent('vector') as Extract<ReturnType<typeof newComponent>, { kind: 'vector' }>), left: 0, right: 0 };
  assert.match(draftProblem(base([sym]))!, /no length/);
  assert.equal(draftProblem(base([sym, { kind: 'space', width: 2 }])), null);
  const curve = { ...sym, left: 1, points: [{ type: 'start' as const, x: 0, y: 0 }, { type: 'curve' as const, x: 1, y: 1 }, { type: 'curve' as const, x: 2, y: 1 }] };
  assert.match(draftProblem(base([curve]))!, /curve/);
});

test('uniqueName numbers a name that is taken', () => {
  assert.equal(uniqueName('Gas', []), 'Gas');
  assert.equal(uniqueName('Gas', ['Gas']), 'Gas (2)');
  assert.equal(uniqueName('Gas (2)', ['Gas', 'Gas (2)']), 'Gas (3)');
  assert.equal(uniqueName('  ', []), 'Line Style');
});
