// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOrder } from '../src/core/mergeorder.js';

test('mergeOrder keeps every sequence as a subsequence', () => {
  assert.deepEqual(mergeOrder([['a', 'c', 'd'], ['a', 'b', 'c'], ['b', 'e', 'd']]), { order: ['a', 'b', 'c', 'e', 'd'], broken: 0 });
  assert.deepEqual(mergeOrder([['x'], ['y', 'x']]), { order: ['y', 'x'], broken: 0 });
});

test('mergeOrder breaks a cycle at the earliest position and counts it', () => {
  const { order, broken } = mergeOrder([['a', 'b', 'c'], ['a', 'c', 'b']]);
  assert.equal(broken, 1);
  assert.deepEqual(order, ['a', 'b', 'c']);
});
