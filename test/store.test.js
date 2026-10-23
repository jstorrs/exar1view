// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionStore, shownSelection } from '../src/store.js';

test('shownSelection ignores the right pane while split view is off', () => {
  const store = createSelectionStore();
  store.setSteps(0, ['a', 'b']);
  store.setSteps(1, ['c']);
  assert.deepEqual(shownSelection(store.get()), ['a', 'b']);
  store.setSplit(true);
  assert.deepEqual(shownSelection(store.get()), ['a', 'b', 'c']);
});

test('a step selected in both panes is returned once', () => {
  const store = createSelectionStore();
  store.setSplit(true);
  store.setSteps(0, ['a', 'b']);
  store.setSteps(1, ['b', 'c']);
  assert.deepEqual(shownSelection(store.get()), ['a', 'b', 'c']);
});

test('subscribers hear changes only', () => {
  const store = createSelectionStore();
  let n = 0;
  const off = store.subscribe(() => { n++; });
  store.setSteps(0, ['a']);
  store.setSteps(0, ['a']);
  store.setSplit(false);
  assert.equal(n, 1);
  store.setSplit(true);
  store.setSteps(1, []);
  assert.equal(n, 2);
  off();
  store.setSteps(0, []);
  assert.equal(n, 2);
});
