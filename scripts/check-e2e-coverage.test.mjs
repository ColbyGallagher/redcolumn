import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTodo } from './check-e2e-coverage.mjs';

test('a new todo command is reported', () => {
  const r = compareTodo({ a: 'todo', b: { spec: 'x' }, c: 'todo' }, ['a']);
  assert.deepEqual(r, { added: ['c'], resolved: [] });
});

test('a listed command that got a test must leave the list', () => {
  const r = compareTodo({ a: { spec: 'x' }, b: { skip: 'camera' } }, ['a']);
  assert.deepEqual(r, { added: [], resolved: ['a'] });
});

test('an unchanged list passes', () => {
  assert.deepEqual(compareTodo({ a: 'todo', b: { spec: 'x' } }, ['a']), { added: [], resolved: [] });
});
