import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDiscard } from './discardUnsaved.ts';

test('undoes only the steps made since the last save', () => {
  assert.deepEqual(planDiscard({ edits: 5, undo: 2 }, 5), { kind: 'undo', steps: 3 });
  assert.deepEqual(planDiscard({ edits: 0, undo: 0 }, 1), { kind: 'undo', steps: 1 });
  assert.deepEqual(planDiscard({ edits: 3, undo: 3 }, 3), { kind: 'undo', steps: 0 });
});

test('changes recovered from an earlier session are read back from the file', () => {
  assert.deepEqual(planDiscard({ edits: -1 }, 0), { kind: 'reread' });
  assert.deepEqual(planDiscard({ edits: -1, undo: 0 }, 4), { kind: 'reread' });
});

test('a document with no remembered save point, or whose history was cleared since, is read back', () => {
  assert.deepEqual(planDiscard(undefined, 2), { kind: 'reread' });
  assert.deepEqual(planDiscard({ edits: 4 }, 2), { kind: 'reread' });
  assert.deepEqual(planDiscard({ edits: 4, undo: 6 }, 2), { kind: 'reread' });
});
