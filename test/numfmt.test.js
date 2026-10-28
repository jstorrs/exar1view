// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixed, formatNumber } from '../src/core/numfmt.js';

test('fixed: ties round away from zero on the exact binary value', () => {
  assert.equal(fixed(1.25, 1), '1.3');
  assert.equal(fixed(360 / 160, 1), '2.3');
  assert.equal(fixed(-1.25, 1), '-1.3');
  assert.equal(fixed(2.675, 2), '2.67'); // stored just below 2.675
  assert.equal(fixed(0.5, 0), '1');
  assert.equal(fixed(3, 2), '3.00');
});

test('fixed: a zero result has no minus sign', () => {
  assert.equal(fixed(-0.04, 1), '0.0');
  assert.equal(fixed(-0, 1), '0.0');
  assert.equal(fixed(-0.4, 0), '0');
  assert.equal(fixed(-0.05, 1), '-0.1');
});

test('formatNumber: fixedN keeps zeros, trimN drops trailing zeros and a bare dot', () => {
  assert.equal(formatNumber(2.5, 'fixed2'), '2.50');
  assert.equal(formatNumber(2.5, 'trim2'), '2.5');
  assert.equal(formatNumber(3, 'trim2'), '3');
  assert.equal(formatNumber(10, 'trim1'), '10');
  assert.equal(formatNumber(100, 'trim0'), '100');
  assert.equal(formatNumber(0.004, 'trim2'), '0');
  assert.equal(formatNumber(-0.004, 'trim2'), '0');
  assert.equal(formatNumber(1234.5678, 'fixed3'), '1234.568');
});

test('formatNumber: an unknown format gives null', () => {
  assert.equal(formatNumber(1, 'fixed'), null);
  assert.equal(formatNumber(1, 'round2'), null);
  assert.equal(formatNumber(1, 'fixed101'), null);
});
