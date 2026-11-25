import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareNames, dropPositionFromPoint, nextSortDirection, reorderAt, reorderById, sortAlphabetically } from './ordering';

describe('ordering', () => {
  describe('reorderAt', () => {
    const items = ['a', 'b', 'c', 'd'];

    it('moves an item before an earlier item', () => {
      assert.deepEqual(reorderAt(items, 2, 0, 'before'), ['c', 'a', 'b', 'd']);
    });

    it('moves an item after a later item', () => {
      assert.deepEqual(reorderAt(items, 0, 2, 'after'), ['b', 'c', 'a', 'd']);
    });

    it('moves an item before a later item', () => {
      assert.deepEqual(reorderAt(items, 0, 2, 'before'), ['b', 'a', 'c', 'd']);
    });

    it('moves an item after an earlier item', () => {
      assert.deepEqual(reorderAt(items, 3, 0, 'after'), ['a', 'd', 'b', 'c']);
    });

    it('moves the first item to the very end', () => {
      assert.deepEqual(reorderAt(items, 0, 3, 'after'), ['b', 'c', 'd', 'a']);
    });

    it('returns the same array reference when order would not change', () => {
      assert.equal(reorderAt(items, 1, 1, 'before'), items);
      assert.equal(reorderAt(items, 1, 2, 'before'), items);
      assert.equal(reorderAt(items, 1, 0, 'after'), items);
      assert.equal(reorderAt(items, -1, 2, 'before'), items);
      assert.equal(reorderAt(items, 0, 99, 'before'), items);
    });
  });

  describe('reorderById', () => {
    const rows = [
      { id: '1', name: 'One', cat: 'material' },
      { id: '2', name: 'Two', cat: 'labor' },
      { id: '3', name: 'Three', cat: 'material' },
      { id: '4', name: 'Four', cat: 'labor' },
    ];

    it('reorders by id while preserving hidden items in a filtered view', () => {
      // Filtered to material: ['1', '3']. Drag '3' before '1'.
      const next = reorderById(rows, '3', '1', 'before');
      assert.deepEqual(
        next.map((r) => r.id),
        ['3', '1', '2', '4'],
      );
    });

    it('returns original array when id is missing or identical', () => {
      assert.equal(reorderById(rows, '1', '1', 'before'), rows);
      assert.equal(reorderById(rows, 'missing', '1', 'before'), rows);
      assert.equal(reorderById(rows, '1', 'missing', 'after'), rows);
    });
  });

  describe('sortAlphabetically & nextSortDirection', () => {
    it('sorts naturally and case-insensitively', () => {
      const list = [{ name: 'Item 10' }, { name: 'apple' }, { name: 'Item 2' }, { name: 'Banana' }];
      assert.deepEqual(
        sortAlphabetically(list, (x) => x.name, 'asc').map((x) => x.name),
        ['apple', 'Banana', 'Item 2', 'Item 10'],
      );
      assert.deepEqual(
        sortAlphabetically(list, (x) => x.name, 'desc').map((x) => x.name),
        ['Item 10', 'Item 2', 'Banana', 'apple'],
      );
    });

    it('ignores leading/trailing whitespace', () => {
      assert.ok(compareNames('  Alpha', 'Beta') < 0);
    });

    it('toggles nextSortDirection to desc only when already ascending with distinct names', () => {
      assert.equal(nextSortDirection([], (x: string) => x), 'asc');
      assert.equal(nextSortDirection(['A'], (x) => x), 'asc');
      assert.equal(nextSortDirection(['A', 'A'], (x) => x), 'asc');
      assert.equal(nextSortDirection(['B', 'A'], (x) => x), 'asc');
      assert.equal(nextSortDirection(['A', 'B', 'C'], (x) => x), 'desc');
      assert.equal(nextSortDirection(['A', 'B', 'B'], (x) => x), 'desc');
    });
  });

  describe('dropPositionFromPoint', () => {
    const rect = { top: 100, height: 40 };

    it('returns before for top half and after for bottom half', () => {
      assert.equal(dropPositionFromPoint(110, rect, false), 'before');
      assert.equal(dropPositionFromPoint(130, rect, false), 'after');
    });

    it('breaks ties at exact midpoint by drag direction', () => {
      assert.equal(dropPositionFromPoint(120, rect, false), 'before');
      assert.equal(dropPositionFromPoint(120, rect, true), 'after');
    });
  });
});
