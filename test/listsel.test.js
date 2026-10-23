// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SELECTION, selectKeys, clickSelect, moveSelect, toggleFocus, selectAll, reconcileSelection, selectedInOrder,
} from '../src/core/listsel.js';

/** @typedef {import('../src/core/listsel.js').ListSelection} ListSelection */

const items = ['a', 'b', 'c', 'd', 'e'];
/** @param {ListSelection} s */
const view = (s) => ({ sel: selectedInOrder(items, s), anchor: s.anchor, focus: s.focus });

test('click, toggle, range', () => {
  let s = clickSelect(items, EMPTY_SELECTION, 'b');
  assert.deepEqual(view(s), { sel: ['b'], anchor: 'b', focus: 'b' });
  s = clickSelect(items, s, 'd', { extend: true });
  assert.deepEqual(view(s), { sel: ['b', 'c', 'd'], anchor: 'b', focus: 'd' });
  s = clickSelect(items, s, 'c', { toggle: true });
  assert.deepEqual(view(s), { sel: ['b', 'd'], anchor: 'c', focus: 'c' });
  s = clickSelect(items, s, 'e', { toggle: true, extend: true });
  assert.deepEqual(view(s), { sel: ['b', 'c', 'd', 'e'], anchor: 'c', focus: 'e' });
  assert.equal(clickSelect(items, s, 'zz'), s);
});

test('keyboard moves and ranges', () => {
  let s = moveSelect(items, EMPTY_SELECTION, 'next');
  assert.deepEqual(view(s), { sel: ['a'], anchor: 'a', focus: 'a' });
  assert.equal(moveSelect(items, s, 'prev'), s);
  s = moveSelect(items, s, 'next', { extend: true });
  s = moveSelect(items, s, 'next', { extend: true });
  assert.deepEqual(view(s), { sel: ['a', 'b', 'c'], anchor: 'a', focus: 'c' });
  s = moveSelect(items, s, 'last');
  assert.deepEqual(view(s), { sel: ['e'], anchor: 'e', focus: 'e' });
  s = moveSelect(items, s, 'first', { extend: true });
  assert.deepEqual(view(s).sel, items);
  assert.equal(moveSelect([], s, 'next'), s);
});

test('toggleFocus, selectAll, selectKeys', () => {
  let s = selectKeys(items, ['c', 'x', 'a']);
  assert.deepEqual(view(s), { sel: ['a', 'c'], anchor: 'c', focus: 'a' });
  s = toggleFocus(items, s);
  assert.deepEqual(view(s).sel, ['c']);
  assert.deepEqual(view(selectAll(items, s)).sel, items);
  assert.equal(selectKeys(items, ['x']), EMPTY_SELECTION);
});

test('reconcileSelection keeps the place after items vanish', () => {
  const s = selectKeys(items, ['b', 'c']);
  // Nothing changed: same object.
  assert.equal(reconcileSelection(items, items, s), s);
  // Both selected deleted: focus moves to the item that followed.
  const after = ['a', 'd', 'e'];
  assert.deepEqual(reconcileSelection(items, after, s), { selected: new Set(['d']), anchor: 'd', focus: 'd' });
  // At the end: the item that preceded.
  const s2 = selectKeys(items, ['e']);
  assert.deepEqual(reconcileSelection(items, ['a', 'b'], s2), { selected: new Set(['b']), anchor: 'b', focus: 'b' });
  // Some survive: just drop the vanished ones.
  const r = reconcileSelection(items, ['a', 'b', 'd', 'e'], s);
  assert.deepEqual([...r.selected], ['b']);
  // Everything gone.
  assert.deepEqual(reconcileSelection(items, [], s), { selected: new Set(), anchor: null, focus: null });
});

test('selectAll keeps anchor and focus', () => {
  const s = clickSelect(items, EMPTY_SELECTION, 'c');
  const all = selectAll(items, s);
  assert.deepEqual([all.anchor, all.focus, all.selected.size], ['c', 'c', 5]);
  const fresh = selectAll(items, EMPTY_SELECTION);
  assert.deepEqual([fresh.anchor, fresh.focus], ['a', 'a']);
});

test('reconcileSelection keeps a surviving anchor when the focus vanished', () => {
  // Anchor b, focus d (range b..d); d is deleted.
  const s = clickSelect(items, clickSelect(items, EMPTY_SELECTION, 'b'), 'd', { extend: true });
  const r = reconcileSelection(items, ['a', 'b', 'c', 'e'], s);
  assert.deepEqual([r.anchor, r.focus, [...r.selected]], ['b', 'e', ['b', 'c']]);
});
