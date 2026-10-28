// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaStringTable } from '../src/core/xprotocol.js';

test('evaStringTable: reads code → text pairs of the first table', () => {
  const t = evaStringTable('<XProtocol> <EVAStringTable> \n  {\n    2 \n    400 "Alpha" \n    401 "Beta" \n  }\n<EVAStringTable> { 1 400 "Other" }');
  assert.deepEqual([...t], [[400, 'Alpha'], [401, 'Beta']]);
});

test('evaStringTable: "" inside a string is a quote; a string may hold braces and digits', () => {
  const t = evaStringTable('<EVAStringTable> { 2 7 "say ""hi"" {1} 8 ""x" 8 "" }');
  assert.deepEqual([...t], [[7, 'say "hi" {1} 8 "x'], [8, '']]);
});

test('evaStringTable: no table or a malformed one gives what was read', () => {
  assert.equal(evaStringTable('').size, 0);
  assert.equal(evaStringTable('<XProtocol> { }').size, 0);
  assert.equal(evaStringTable('<EVAStringTable> { x }').size, 0);
  assert.deepEqual([...evaStringTable('<EVAStringTable> { 3 1 "a" 2 oops 3 "c" }')], [[1, 'a']]);
  assert.equal(evaStringTable('<EVAStringTable> { 2 400 "ab""cd').size, 0);
  assert.deepEqual([...evaStringTable('<EVAStringTable> { 1 1 "a" 2 "b" }')], [[1, 'a']]);
});
