// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NIL, isGuid, guidFromBytesLe, optGuid } from '../src/core/guid.js';
import { FormatError } from '../src/core/errors.js';

const bytes = (/** @type {string} */ hex) => Uint8Array.from(Buffer.from(hex, 'hex'));

// Vectors from Python uuid.UUID(bytes_le=bytes.fromhex(h))
test('guidFromBytesLe matches Python bytes_le', () => {
  assert.equal(guidFromBytesLe(bytes('00112233445566778899aabbccddeeff')), '33221100-5544-7766-8899-aabbccddeeff');
  assert.equal(guidFromBytesLe(bytes('0123456789abcdef0123456789abcdef')), '67452301-ab89-efcd-0123-456789abcdef');
  assert.equal(guidFromBytesLe(bytes('ffffffffffffffffffffffffffffffff')), 'ffffffff-ffff-ffff-ffff-ffffffffffff');
  assert.equal(guidFromBytesLe(new Uint8Array(16)), NIL);
});

test('guidFromBytesLe honours offset and bounds', () => {
  const b = bytes('aaaa00112233445566778899aabbccddeeff');
  assert.equal(guidFromBytesLe(b, 2), '33221100-5544-7766-8899-aabbccddeeff');
  assert.throws(() => guidFromBytesLe(b, 3), FormatError);
});

test('isGuid is strict canonical lowercase', () => {
  assert.ok(isGuid(NIL));
  assert.ok(!isGuid('33221100-5544-7766-8899-AABBCCDDEEFF'));
  assert.ok(!isGuid('{33221100-5544-7766-8899-aabbccddeeff}'));
  assert.ok(!isGuid('33221100554477668899aabbccddeeff'));
  assert.ok(!isGuid(null));
});

test('optGuid', () => {
  assert.equal(optGuid(null), null);
  assert.equal(optGuid(undefined), null);
  assert.equal(optGuid(''), null);
  assert.equal(optGuid(NIL), null);
  assert.equal(optGuid('33221100-5544-7766-8899-aabbccddeeff'), '33221100-5544-7766-8899-aabbccddeeff');
  assert.throws(() => optGuid('nope', 'Head.Id'), (err) => err.message === 'Head.Id: not a canonical lowercase GUID');
});
