import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPatch, ownMarkupsOnly } from './ownership';

test('people may edit only markups they authored', () => {
  const mine = ownMarkupsOnly('Hana Ito');
  assert.equal(mine({ author: 'Hana Ito' }), true);
  assert.equal(mine({ author: ' hana ito ' }), true, 'case and edge spaces do not matter');
  assert.equal(mine({ author: 'Sam' }), false);
  assert.equal(mine({ author: '' }), false, 'a markup with no author is not anyone’s own');
  assert.equal(ownMarkupsOnly('')({ author: '' }), false, 'nor is it the own markup of someone with no name');
});

test('on someone else’s markup only its status and replies may change', () => {
  assert.deepEqual(openPatch({ status: 'accepted' }), { status: 'accepted' });
  assert.deepEqual(openPatch({ status: 'rejected', points: [[0, 0]], style: undefined }), { status: 'rejected' });
  const replies = [{ id: 'r1', author: 'Sam', text: 'Agreed', createdAt: 1 }];
  assert.deepEqual(openPatch({ replies }), { replies });
  assert.equal(openPatch({ points: [[1, 1]], comment: 'moved' }), null);
  assert.equal(openPatch({ locked: true }), null, 'nor may it be locked or unlocked');
});
