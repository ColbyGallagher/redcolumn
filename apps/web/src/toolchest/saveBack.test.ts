import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLES, type Markup } from '@nb/markup';
import { distinctIdentities, identityPatch, sharedIdentity, toolFieldsPatch, toolIdentity } from '../markup/selectionFormat.ts';

// profiles.ts reads localStorage when it loads.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const { savedToolItem } = await import('./saveBack.ts');

const mk = (over: Partial<Markup>): Markup => ({ id: 'x', type: 'rect', pageIndex: 0, points: [], style: DEFAULT_STYLES.rect, status: 'none', author: 'a', createdAt: 0, modifiedAt: 0, ...over }) as Markup;

test('a selection shares a subject, label and layer, or reads mixed', () => {
  const a = mk({ subject: 'Door', layer: 'Doors' });
  const b = mk({ id: 'y', type: 'area', subject: 'Door', layer: 'Walls', text: 'ignored', label: 'Tile 1' });
  assert.deepEqual(sharedIdentity([a, b], 'subject'), { value: 'Door', mixed: false });
  assert.deepEqual(sharedIdentity([a, b], 'layer'), { value: '', mixed: true });
  assert.deepEqual(sharedIdentity([a, b], 'label'), { value: '', mixed: true });
  assert.deepEqual(sharedIdentity([a, a], 'label'), { value: '', mixed: false });
});

test('a label goes in text for a measurement and label for any other markup', () => {
  assert.deepEqual(identityPatch({ type: 'rect' }, 'label', ' Tile '), { label: 'Tile' });
  assert.deepEqual(identityPatch({ type: 'area' }, 'label', 'Tile'), { text: 'Tile' });
  assert.deepEqual(identityPatch({ type: 'rect' }, 'subject', ''), { subject: undefined });
  assert.deepEqual(identityPatch({ type: 'rect' }, 'layer', 'Electrical'), { layer: 'Electrical' });
});

test('subjects and layers offered are the distinct ones in use', () => {
  const ms = [mk({ subject: 'B' }), mk({ subject: 'A' }), mk({ subject: 'B' }), mk({})];
  assert.deepEqual(distinctIdentities(ms, 'subject'), ['A', 'B']);
  assert.deepEqual(distinctIdentities(ms, 'layer', ['Z', 'M']), ['M', 'Z']);
});

test('tool edits beat what the Tool Chest tool carries, and only edited fields apply', () => {
  assert.equal(toolIdentity({ subject: 'Old' }, { subject: 'New' }, 'subject'), 'New');
  assert.equal(toolIdentity({ subject: 'Old' }, { layer: 'L' }, 'subject'), 'Old');
  assert.equal(toolIdentity({ subject: 'Old' }, { subject: '' }, 'subject'), '');
  assert.deepEqual(toolFieldsPatch({ type: 'rect' }, { layer: 'L' }), { layer: 'L' });
  assert.deepEqual(toolFieldsPatch({ type: 'rect' }, undefined), {});
});

test('saving back updates the Tool Chest item with the edited subject, label, layer and style', () => {
  const item = { id: 't', type: 'rect' as const, style: DEFAULT_STYLES.rect, label: 'Wall tool', subject: 'Old', layer: 'Base', markups: [mk({ subject: 'Old' })] };
  const style = { ...DEFAULT_STYLES.rect, stroke: '#123456' };
  const saved = savedToolItem(item, { fields: { subject: 'Downlight Type A', label: 'Lights', layer: '' }, style });
  assert.equal(saved.label, 'Wall tool', 'the tool keeps its own name');
  assert.equal(saved.subject, 'Downlight Type A');
  assert.equal(saved.markupLabel, 'Lights');
  assert.equal('layer' in saved, false, 'a cleared layer is dropped');
  assert.equal(saved.style.stroke, '#123456');
  assert.equal(saved.markups![0]!.subject, 'Downlight Type A');
  assert.equal(saved.markups![0]!.label, 'Lights');
  // Fields not edited are kept.
  assert.equal(savedToolItem(item, { fields: {} }).layer, 'Base');
});
