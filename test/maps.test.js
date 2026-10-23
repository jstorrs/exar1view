// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMap, applyMaps } from '../src/core/maps.js';
import { FormatError } from '../src/core/errors.js';

const E1 = '33221100-5544-7766-8899-aabbccddeeff';
const E2 = '67452301-ab89-efcd-0123-456789abcdef';
const I1 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const HEX = {
  [E1]: '00112233445566778899aabbccddeeff',
  [E2]: '0123456789abcdef0123456789abcdef',
  [I1]: 'ffffffffffffffffffffffffffffffff',
  nil: '00000000000000000000000000000000',
};
const blob = (/** @type {string[]} */ ...hexes) => Uint8Array.from(Buffer.from(hexes.join(''), 'hex'));

test('decodeMap reads pairs and maps nil instance to null', () => {
  const pairs = decodeMap(blob(HEX[E1], HEX[I1], HEX[E2], HEX.nil));
  assert.deepEqual(pairs, [[E1, I1], [E2, null]]);
  assert.deepEqual(decodeMap(new Uint8Array(0)), []);
});

test('decodeMap rejects bad length, nil element, duplicate element', () => {
  assert.throws(() => decodeMap(new Uint8Array(33)), FormatError);
  assert.throws(() => decodeMap(blob(HEX.nil, HEX[I1])), /nil element/);
  assert.throws(() => decodeMap(blob(HEX[E1], HEX[I1], HEX[E1], HEX[I1])), /duplicate element/);
});

test('applyMaps applies updates and removals', () => {
  const m = applyMaps([[E1, I1], [E2, I1]], [[E1, null], [E2, E1]]);
  assert.deepEqual([...m], [[E2, E1]]);
  assert.deepEqual([...applyMaps([[E1, I1]], [[E2, E1]])], [[E1, I1], [E2, E1]]);
  assert.deepEqual([...applyMaps([], [[E1, null]])], []);
});

test('applyMaps rejects a nil instance in the base', () => {
  assert.throws(() => applyMaps([[E1, null]], []), /base element map/);
});
