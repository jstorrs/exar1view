// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormatError } from '../src/core/errors.js';
import { normalize, UNRESOLVED_REF, asObj, str, optStr, bool, optBool, int, obj, arr } from '../src/core/json.js';

test('normalize drops $ keys and unwraps $values at any depth', () => {
  const doc = {
    $id: '1',
    $type: 'Foo, Bar',
    Name: 'x',
    Items: {
      $id: '2',
      $type: 'System.Collections.Generic.List`1[[Foo]], mscorlib',
      $values: [{ $id: '3', A: 1 }, { $id: '4', A: { $id: '5', $values: [] } }],
    },
    Dict: { $id: '6', en: 'Hello', de: 'Hallo' },
  };
  assert.deepEqual(normalize(doc), {
    Name: 'x',
    Items: [{ A: 1 }, { A: [] }],
    Dict: { en: 'Hello', de: 'Hallo' },
  });
});

test('normalize recurses into plain arrays', () => {
  assert.deepEqual(normalize([{ $id: '1', a: { $values: [1] } }]), [{ a: [1] }]);
});

test('normalize turns $ref into the sentinel; every accessor refuses it', () => {
  const o = asObj(normalize({ a: { $ref: '3' }, list: { $values: [{ $ref: '4' }] } }), 'doc');
  assert.equal(o.a, UNRESOLVED_REF);
  assert.deepEqual(arr(o, 'list', 'doc'), [UNRESOLVED_REF]);
  for (const read of [str, optStr, bool, optBool, int, obj, arr]) {
    assert.throws(() => read(o, 'a', 'doc'), /doc.*unresolved Json.NET \$ref/, read.name);
  }
  assert.throws(() => asObj(UNRESOLVED_REF, 'c'), /unresolved Json.NET \$ref/);
});

test('normalize rejects bad $values', () => {
  assert.throws(() => normalize({ $values: {} }), /must be an array/);
  assert.throws(() => normalize({ $values: [], extra: 1 }), /sibling keys/);
});

test('normalize keeps a __proto__ key as data', () => {
  const out = /** @type {any} */ (normalize(JSON.parse('{"__proto__": {"x": 1}}')));
  assert.deepEqual(Object.keys(out), ['__proto__']);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test('accessors', () => {
  const o = asObj(normalize({ s: 'a', b: true, n: 3, f: 1.5, nul: null, o: { k: 1 }, a: [1], d: { x: 'y' } }), 'doc');
  assert.deepEqual(obj(o, 'd', 'doc'), { x: 'y' });
  assert.equal(str(o, 's', 'doc'), 'a');
  assert.equal(optStr(o, 'nul', 'doc'), null);
  assert.equal(optStr(o, 'missing', 'doc'), null);
  assert.equal(bool(o, 'b', 'doc'), true);
  assert.equal(optBool(o, 'missing', 'doc'), null);
  assert.equal(int(o, 'n', 'doc'), 3);
  assert.deepEqual(obj(o, 'o', 'doc'), { k: 1 });
  assert.deepEqual(arr(o, 'a', 'doc'), [1]);
  assert.equal(optBool(o, 'nul', 'doc'), null);
});

test('accessors throw FormatError with context', () => {
  const o = asObj({ s: 1, f: 1.5, b: 'x', a: {}, nul: null }, 'doc');
  assert.throws(() => str(o, 's', 'step 1'), /^FormatError: step 1: "s" must be a string, got number/);
  assert.throws(() => str(o, 'nope', 'step 1'), /missing key "nope"/);
  assert.throws(() => int(o, 'f', 'c'), /must be a safe integer, got number 1.5/);
  assert.throws(() => int({ n: 2 ** 60 }, 'n', 'c'), /safe integer/);
  assert.throws(() => bool(o, 'b', 'c'), FormatError);
  assert.throws(() => optBool(o, 'b', 'c'), FormatError);
  assert.throws(() => arr(o, 'a', 'c'), FormatError);
  assert.throws(() => obj(o, 'nul', 'c'), /c\.nul: expected a JSON object, got null/);
  assert.throws(() => asObj([], 'c'), FormatError);
});

test('extra keys are not errors and prototype names are not keys', () => {
  const o = asObj({ extra: 1 }, 'doc');
  assert.throws(() => str(o, 'toString', 'doc'), /missing key/);
});
