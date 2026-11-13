import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MarkupStyle } from '@nb/markup';
import { centreOf, countsFromHits, type CountTool } from './countFromHits';

const style = { stroke: '#f00' } as MarkupStyle;
const toolStyle = { stroke: '#00f', symbol: 'door' } as unknown as MarkupStyle;
const base = { status: 'none' as const, author: 'me', createdAt: 1, modifiedAt: 1 };
let n = 0;
const newId = () => `id${++n}`;
const hits = [
  { pageIndex: 0, point: [1, 2] as [number, number] },
  { pageIndex: 2, point: [3, 4] as [number, number] },
  { pageIndex: 0, point: [5, 6] as [number, number] },
];

describe('countsFromHits', () => {
  it('makes one count per page with the default style', () => {
    const made = countsFromHits(hits, { base, style, subject: 'Search', newId });
    assert.deepEqual(made.map((m) => [m.pageIndex, m.points]), [[0, [[1, 2], [5, 6]]], [2, [[3, 4]]]]);
    assert.equal(made[0]!.type, 'count');
    assert.deepEqual(made[0]!.style, style);
    assert.equal(made[0]!.subject, 'Search');
    assert.equal(made[0]!.author, 'me');
  });

  it('carries the tool style, subject, label and layer', () => {
    const tool: CountTool = {
      id: 't',
      name: 'Door Type D1',
      style: toolStyle,
      subject: 'Doors',
      label: 'D1',
      markups: [{ id: 'x', seq: 9, type: 'count', pageIndex: 7, points: [[0, 0]], style: toolStyle, layer: 'Doors', label: 'D1', subject: 'Doors', ...base }],
    };
    const made = countsFromHits(hits, { base, style, subject: 'Search', tool, newId });
    assert.equal(made.length, 2);
    assert.deepEqual(made[0]!.style, toolStyle);
    assert.deepEqual([made[0]!.subject, made[0]!.label, made[0]!.layer, made[0]!.pageIndex], ['Doors', 'D1', 'Doors', 0]);
    assert.equal(made[0]!.seq, undefined);
    assert.notEqual(made[0]!.id, 'x');
  });

  it('falls back to the tool name when it has no subject', () => {
    const made = countsFromHits(hits, { base, style, subject: 'Search', tool: { id: 't', name: 'Fire door', style: toolStyle }, newId });
    assert.equal(made[0]!.subject, 'Fire door');
  });
});

describe('countsFromHits from a saved markup', () => {
  it('leaves behind what belongs to the saved markup', () => {
    const saved = { id: 'x', type: 'count' as const, pageIndex: 7, points: [[0, 0]] as [number, number][], style: toolStyle, layer: 'Doors', label: 'D1', subject: 'Doors', groupId: 'g', locked: true, capture: 'data:image/jpeg;base64,AA', checked: true, flagged: true, comment: 'hi', ...base };
    const tool: CountTool = { id: 't', name: 'D1', style: toolStyle, subject: 'Doors', label: 'D1', markups: [saved] };
    const [m] = countsFromHits(hits, { base, style, subject: 'Search', tool, newId });
    assert.equal(m!.groupId, undefined);
    assert.equal(m!.locked, undefined);
    assert.equal(m!.capture, undefined);
    assert.equal(m!.checked, undefined);
    assert.equal(m!.comment, undefined);
    assert.deepEqual([m!.layer, m!.label, m!.subject], ['Doors', 'D1', 'Doors']);
  });
});

describe('centreOf', () => {
  it('is the middle of the box', () => assert.deepEqual(centreOf({ x: 10, y: 20, w: 4, h: 6 }), [12, 23]));
});
