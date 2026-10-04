import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessFor, canAddMarkups, cleanPolicy } from './protocol';

const meta = (access: Parameters<typeof cleanPolicy>[0]) => ({ access: cleanPolicy(access)!, permissions: { markup: true, addDocuments: true }, hostEmail: 'host@example.com' });

test('editing anyone’s markups is a level above editing your own', () => {
  const m = meta({
    default: 'markup',
    people: [{ name: 'Ana', access: 'markupAny' }],
    groups: [
      { id: 'a', name: 'Leads', access: 'markupAny', members: ['Ben'] },
      { id: 'b', name: 'Reviewers', access: 'view', members: ['Ben', 'Cy'] },
    ],
  });
  assert.equal(accessFor(m, 'Ana', false), 'markupAny');
  assert.equal(accessFor(m, 'Ben', false), 'markupAny', 'the most generous of their groups');
  assert.equal(accessFor(m, 'Cy', false), 'view');
  assert.equal(accessFor(m, 'Dee', false), 'markup', 'everyone else: their own only');
  assert.equal(accessFor(m, 'Host', true), 'markupAny', 'the host may edit anything');
  assert.equal(accessFor(m, 'Someone', false, 'HOST@example.com'), 'markupAny', 'so may the host’s account on another device');
});

test('both markup levels can add markups; the policy keeps the new level', () => {
  assert.equal(canAddMarkups('markup'), true);
  assert.equal(canAddMarkups('markupAny'), true);
  assert.equal(canAddMarkups('view'), false);
  assert.equal(canAddMarkups('none'), false);
  assert.equal(cleanPolicy({ default: 'markupAny', people: [], groups: [] })?.default, 'markupAny');
});
