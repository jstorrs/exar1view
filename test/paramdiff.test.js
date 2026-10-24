// Ported from protocols tests/test_params.py (the diff cases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffParams } from '../src/core/paramdiff.js';

/** Blocks from plain objects. */
const asc = (...blocks) => blocks.map((b) => new Map(Object.entries(b)));
const d = (block, key, tier, a, b) => ({ block, key, tier, a, b });

test('ordering and absent values', () => {
  const a = asc({ x: '1', 'alTR[0]': '2', same: '0' });
  const b = asc({ new1: '5', 'alTR[0]': '3', same: '0', new2: '6', x: '1' });
  assert.deepEqual(diffParams(a, b), [
    d(0, 'alTR[0]', 'key', '2', '3'),
    d(0, 'new1', 'other', null, '5'),
    d(0, 'new2', 'other', null, '6'),
  ]);
  assert.equal(diffParams(b, a)[0].key, 'new1');
  assert.deepEqual(diffParams(a, a), []);
});

test("A's keys come before B-only keys", () => {
  assert.deepEqual(diffParams(asc({ p: '1', q: '1' }), asc({ z: '1', q: '2' })).map((x) => x.key), ['p', 'q', 'z']);
});

test('ignored differences are included', () => {
  const [x, ...rest] = diffParams(asc({ tProtocolName: '"a"' }), asc({ tProtocolName: '"b"' }));
  assert.equal(x.tier, 'ignored');
  assert.deepEqual(rest, []);
});

test('a missing block counts as empty', () => {
  const a = asc({ x: '1' });
  const b = asc({ x: '1' }, { lAverages: '2' });
  assert.deepEqual(diffParams(a, b), [d(1, 'lAverages', 'key', null, '2')]);
  assert.deepEqual(diffParams(b, a), [d(1, 'lAverages', 'key', '2', null)]);
  assert.deepEqual(diffParams([], []), []);
});

test('values compare as raw text', () => {
  assert.deepEqual(diffParams(asc({ a: '1' }), asc({ a: '1.0' })), [d(0, 'a', 'other', '1', '1.0')]);
  assert.deepEqual(diffParams(asc({ a: '""' }), asc({})), [d(0, 'a', 'other', '""', null)]);
});
