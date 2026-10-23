// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleControls, visibleText, visibleSpaces, nameText } from '../src/core/visible.js';

test('visibleControls: pictures for C0 and DEL, escapes for C1, bidi controls and separators', () => {
  assert.equal(visibleControls('a\x1bb\x7f'), 'a\u241bb\u2421');
  assert.equal(visibleControls('\x9b\u202e\u2028\u2066'), '\\x9b\\u202e\\u2028\\u2066');
  assert.equal(visibleControls('plain  text'), 'plain  text', 'spaces are left alone');
});

test('visibleSpaces and nameText: edge and repeated spaces too', () => {
  assert.equal(visibleSpaces(' a  b '), '\u2423a\u2423\u2423b\u2423');
  assert.equal(nameText('x\u202ey'), '"x\\u202ey"');
});

test('visibleText: controls shown, newline and tab kept', () => {
  assert.equal(visibleText('a\u202eb'), 'a\\u202eb');
  assert.equal(visibleText('a\x1bb'), 'a\u241bb');
  assert.equal(visibleText('l1\nl2\tx'), 'l1\nl2\tx');
  assert.equal(visibleText('l1\r\nl2\x00'), 'l1\u240d\nl2\u2400', 'CR is not a line break here');
  assert.equal(visibleText('a\ud800b'), 'a\\ud800b');
  assert.equal(visibleText('a\u{1f600}b'), 'a\u{1f600}b', 'a paired surrogate is one character');
});
