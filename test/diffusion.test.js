// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import json from '../src/core/cardcatalog.json' with { type: 'json' };
import { MODE_NAMES, diffusionOf, isFreeVectorKey, shells } from '../src/core/diffusion.js';

const F = 'sDiffusion.sFreeDiffusionData.';
const header = [
  ['sDiffusion.dsScheme', '"x"'], [`${F}ulCoordinateSystem`, '1'], [`${F}ulNormalization`, '1'],
  [`${F}asDiffDirVector.__attribute__.size`, '0'],
];
/** @param {[string, string][]} extra */
const block = (...extra) => new Map([...header, ...extra]);
/** A free block with `n` directions and the given extra keys. */
const free = (/** @type {number} */ n, /** @type {[string, string][]} */ ...extra) => new Map([
  ...header, ['sDiffusion.ulMode', '128'], ['sDiffusion.lDiffDirections', String(n)],
  [`${F}asDiffDirVector.__attribute__.size`, String(n)], ...extra,
]);
const vec = (/** @type {number} */ i, /** @type {string} */ c, /** @type {string} */ v) => /** @type {[string, string]} */ ([`${F}asDiffDirVector[${i}].${c}`, v]);

/** @param {ReturnType<typeof diffusionOf>} d */
const freeSet = (d) => { assert.equal(d.kind, 'free'); return /** @type {any} */ (d).set; };
const NONE = { file: null, notes: [], builtIn: false };
/** @param {ReturnType<typeof diffusionOf>} d */
const errorOf = (d) => { assert.equal(d.kind, 'invalid'); return /** @type {any} */ (d).error; };

test('header-only and ulMode 1 blocks are none', () => {
  assert.deepEqual(diffusionOf(block()), { kind: 'none' });
  assert.deepEqual(diffusionOf(block(['sDiffusion.ulMode', '1'])), { kind: 'none' });
});

test('sparse vectors: absent components and b0 vectors are 0', () => {
  const set = freeSet(diffusionOf(free(3, vec(1, 'dSag', '0.5'), vec(1, 'dTra', '-1.0'), vec(2, 'dCor', '1'))));
  assert.deepEqual(set.vectors, [[0, 0, 0], [0.5, 0, -1], [0, 1, 0]]);
});

test('count mismatch, index beyond the count, empty table', () => {
  assert.match(errorOf(diffusionOf(free(3, [`${F}asDiffDirVector.__attribute__.size`, '2']))), /differs/);
  assert.match(errorOf(diffusionOf(free(2, vec(2, 'dSag', '1')))), /vector 2 lies beyond/);
  assert.match(errorOf(diffusionOf(new Map([['sDiffusion.ulMode', '128']]))), /no vectors/);
});

test('malformed, non-finite and exponent values', () => {
  assert.equal(errorOf(diffusionOf(free(4, vec(3, 'dCor', 'abc')))), 'vector 3 has a malformed dCor');
  for (const bad of ['NaN', 'Infinity', '1e999', '', '1.2.3', '0x10']) {
    assert.match(errorOf(diffusionOf(free(1, vec(0, 'dSag', bad)))), /malformed dSag/, bad);
  }
  const set = freeSet(diffusionOf(free(1, vec(0, 'dSag', '1.5e-1'), vec(0, 'dCor', '2E2'))));
  assert.deepEqual(set.vectors, [[0.15, 200, 0]]);
});

test('error messages never quote protocol text', () => {
  assert.doesNotMatch(errorOf(diffusionOf(free(1, vec(0, 'dSag', 'SECRET')))), /SECRET/);
});

test('hex and decimal integers', () => {
  const d = diffusionOf(new Map([
    ...free(2, vec(1, 'dSag', '1')),
    ['sDiffusion.ulMode', '0x80'], ['sDiffusion.lDiffDirections', '0x2'],
    [`${F}asDiffDirVector.__attribute__.size`, '2'],
  ]));
  assert.equal(freeSet(d).vectors.length, 2);
  assert.deepEqual(/** @type {any} */ (d).mode, { code: 128, name: 'Free' });
});

test('comments: .N and [N] forms, hex and decimal bytes, NUL cut, trailing trim', () => {
  const a = freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'),
    [`${F}sComment.0`, '0x44'], [`${F}sComment.1`, '0x56'], [`${F}sComment.2`, '83'],
    [`${F}sComment.3`, '0x0d'], [`${F}sComment.4`, '0x0a'])));
  assert.equal(a.origin.file, 'DVS');
  const b = freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'),
    [`${F}sComment[0]`, '0x61'], [`${F}sComment[1]`, '0x20'], [`${F}sComment[2]`, '0x62'],
    [`${F}sComment[4]`, '0x63'])));
  assert.equal(b.origin.file, 'a b'); // index 3 absent = NUL: cut there
  assert.deepEqual(freeSet(diffusionOf(free(1, vec(0, 'dSag', '1')))).origin, NONE);
  for (const bad of ['256', 'x', '-129', '0xffffff7f']) {
    const d = diffusionOf(free(1, vec(0, 'dSag', '1'), [`${F}sComment.0`, bad]));
    assert.deepEqual(freeSet(d).origin, NONE, bad);
  }
  assert.deepEqual(freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'), [`${F}sComment.100001`, '65']))).origin, NONE);
  // signed and sign-extended bytes
  const signed = freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'),
    [`${F}sComment.0`, '97'], [`${F}sComment.1`, '-61'], [`${F}sComment.2`, '0xffffffa4'])));
  assert.equal(signed.origin.file, 'a\u00e4');
  // UTF-8 and invalid UTF-8
  const utf = (/** @type {string[]} */ ...bytes) => freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'),
    ...bytes.map((b, i) => /** @type {[string, string]} */ ([`${F}sComment.${i}`, b]))))).origin.file;
  assert.equal(utf('0x61', '0xc3', '0xa4'), 'a\u00e4');
  assert.equal(utf('0x61', '0xe4'), 'a\ufffd');
});

/** The origin parsed from comment text, one byte per key. */
const originOf = (/** @type {string} */ text) => freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'),
  ...[...new TextEncoder().encode(text)].map((b, i) => /** @type {[string, string]} */ ([`${F}sComment.${i}`, String(b)]))))).origin;

test('a three-line comment is the file, notes and the built-in flag', () => {
  assert.deepEqual(originOf('test_unity_7dir.dvs\nSIEMENS\nInternal 6-directions set\n'), {
    file: 'test_unity_7dir.dvs', notes: ['SIEMENS', 'Internal 6-directions set'], builtIn: true,
  });
});

test('comment lines: CRLF, CR, blank lines and padding; one line has no notes', () => {
  assert.deepEqual(originOf('  a.dvs \r\n\r\n note one\r\n\n \rnote two\n\n'), { file: 'a.dvs', notes: ['note one', 'note two'], builtIn: false });
  assert.deepEqual(originOf('my_set.dvs\n'), { file: 'my_set.dvs', notes: [], builtIn: false });
  assert.deepEqual(originOf(' \r\n \n'), NONE);
  assert.equal(originOf('a\n sIeMeNs ').builtIn, true);
  assert.equal(originOf('a\n\u017fiemens').builtIn, false); // ASCII-only match
  assert.equal(originOf('a\ns\u0131emens').builtIn, false);
  assert.equal(originOf('SIEMENS').builtIn, false); // the first line is the file, not a note
});

test('at most 10 notes are kept', () => {
  const lines = ['f.dvs', ...Array.from({ length: 15 }, (_, i) => `n${i}`)];
  assert.deepEqual(originOf(lines.join('\n')).notes, lines.slice(1, 11));
});

test('MDDW is builtin with directions; unlabelled mode has a null name', () => {
  const d = diffusionOf(block(['sDiffusion.ulMode', '256'], ['sDiffusion.lDiffDirections', '30'],
    ['sDiffusion.lDiffWeightings', '2'], ['sDiffusion.alBValue[1]', '1000'], ['sDiffusion.alAverages[1]', '3']));
  assert.deepEqual(d, {
    kind: 'builtin', mode: { code: 256, name: 'MDDW' }, directions: 30,
    weightings: [{ b: 0, averages: null }, { b: 1000, averages: 3 }],
  });
  const u = diffusionOf(block(['sDiffusion.ulMode', '512']));
  assert.deepEqual(u, { kind: 'builtin', mode: { code: 512, name: null }, directions: null, weightings: [] });
});

test('a leftover table under a built-in mode is ignored', () => {
  const m = block(['sDiffusion.ulMode', '256'], ['sDiffusion.lDiffDirections', '30'],
    [`${F}asDiffDirVector.__attribute__.size`, '6'], vec(1, 'dSag', '1'));
  const d = diffusionOf(m);
  assert.equal(d.kind, 'builtin');
  assert.equal(/** @type {any} */ (d).directions, 30);
});

test('invalid settings', () => {
  const run = (/** @type {Map<string, string>} */ m) => /** @type {any} */ (diffusionOf(m));
  for (const bad of ['x', '-2', '1.5']) {
    const d = run(block(['sDiffusion.ulMode', bad]));
    assert.equal(d.kind, 'invalid');
    assert.equal(d.mode, null);
  }
  for (const bad of ['x', '-1']) {
    const d = run(block(['sDiffusion.ulMode', '256'], ['sDiffusion.lDiffDirections', bad]));
    assert.equal(d.kind, 'invalid');
    assert.deepEqual(d.mode, { code: 256, name: 'MDDW' });
  }
  const one = vec(0, 'dSag', '1');
  assert.match(errorOf(diffusionOf(free(1, one, [`${F}ulCoordinateSystem`, 'x']))), /ulCoordinateSystem is malformed/);
  assert.match(errorOf(diffusionOf(free(1, one, [`${F}ulNormalization`, '1.5']))), /ulNormalization is malformed/);
  assert.match(errorOf(diffusionOf(free(1, [`${F}asDiffDirVector[0].dFoo`, '1']))), /not recognised/);
  for (const size of ['-1', 'x']) assert.match(errorOf(diffusionOf(free(1, one, [`${F}asDiffDirVector.__attribute__.size`, size]))), /table size is malformed/);
  assert.match(errorOf(diffusionOf(free(100001))), /out of range/);
  const sizeOnly = free(2, vec(1, 'dSag', '1'));
  sizeOnly.delete('sDiffusion.lDiffDirections');
  assert.match(errorOf(diffusionOf(sizeOnly)), /differs/);
  for (const bad of ['x', '-1', '1001']) {
    assert.match(errorOf(diffusionOf(free(1, one, ['sDiffusion.lDiffWeightings', bad]))), /number of weightings/, bad);
  }
  assert.match(errorOf(diffusionOf(free(1, one, ['sDiffusion.lDiffWeightings', '1'], ['sDiffusion.alAverages[0]', 'x']))), /malformed averages/);
});

test('conventions: known, unknown and absent codes', () => {
  const ok = freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'))));
  assert.deepEqual(ok.conventions, { ok: true, coordinateSystem: 'xyz', normalisation: 'none' });
  const prs = freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'), [`${F}ulCoordinateSystem`, '2'])));
  assert.deepEqual(prs.conventions, { ok: true, coordinateSystem: 'prs', normalisation: 'none' });
  for (const [key, code] of [['ulCoordinateSystem', '3'], ['ulNormalization', '2']]) {
    const s = freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'), [F + key, code])));
    assert.equal(s.conventions.ok, false);
    assert.match(s.conventions.why, new RegExp(code));
  }
  for (const key of ['ulCoordinateSystem', 'ulNormalization']) {
    const m = free(1, vec(0, 'dSag', '1'));
    m.delete(F + key);
    const s = freeSet(diffusionOf(m));
    assert.equal(s.conventions.ok, false);
    assert.equal(key === 'ulCoordinateSystem' ? s.coordinateCode : s.normalisationCode, null);
  }
});

test('decimals detection', () => {
  const dec = (/** @type {string} */ v) => freeSet(diffusionOf(free(1, vec(0, 'dSag', v)))).decimals;
  assert.equal(dec('1'), 1);
  assert.equal(dec('0.5'), 1);
  assert.equal(dec('0.649'), 3);
  assert.equal(dec('-0.6491'), 4);
  assert.equal(dec('0.123456'), 6);
  assert.equal(dec('0.1234567891'), 10);
  const mixed = freeSet(diffusionOf(free(1, vec(0, 'dSag', '0.5'), vec(0, 'dTra', '0.123'))));
  assert.equal(mixed.decimals, 3);
});

test('weightings: absent b is 0 and absent averages is null', () => {
  const d = diffusionOf(free(1, vec(0, 'dSag', '1'), ['sDiffusion.lDiffWeightings', '2'], ['sDiffusion.alBValue[1]', '0xbb8']));
  assert.deepEqual(/** @type {any} */ (d).weightings, [{ b: 0, averages: null }, { b: 3000, averages: null }]);
  assert.match(errorOf(diffusionOf(free(1, vec(0, 'dSag', '1'), ['sDiffusion.lDiffWeightings', '1'], ['sDiffusion.alBValue[0]', 'x']))), /b-value/);
});

test('MODE_NAMES agrees with the catalog lookup', () => {
  /** @type {Record<string, string> | null} */
  let table = null;
  /** @param {any} o */
  const walk = (o) => {
    if (o && typeof o === 'object') {
      if (o.id === 'Diffusion mode' && o.rule?.kind === 'lookup') table = o.rule.table;
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(json);
  assert.ok(table);
  assert.deepEqual(
    [...MODE_NAMES].map(([k, v]) => [String(k), v]),
    Object.entries(/** @type {Record<string, string>} */ (table)).map(([k, v]) => [k, v.trim()]),
  );
});

test('isFreeVectorKey', () => {
  assert.ok(isFreeVectorKey(`${F}asDiffDirVector[3].dSag`));
  assert.ok(isFreeVectorKey(`${F}sComment.0`));
  assert.ok(isFreeVectorKey(`${F}sComment[0]`));
  assert.ok(!isFreeVectorKey(`${F}asDiffDirVector.__attribute__.size`));
  assert.ok(!isFreeVectorKey(`${F}lDiffDirections`));
  assert.ok(!isFreeVectorKey('sDiffusion.alBValue[1]'));
});

test('shells with and without bmax', () => {
  const set = freeSet(diffusionOf(free(4, vec(1, 'dSag', '1'), vec(2, 'dCor', '1'), vec(3, 'dTra', '0.70711'))));
  // squared lengths 0, 1, 1, 0.5
  assert.deepEqual(shells(set, 3000), [
    { b: 0, fraction: 0, count: 1 }, { b: 1500, fraction: 0.5, count: 1 }, { b: 3000, fraction: 1, count: 2 },
  ]);
  assert.deepEqual(shells(set, null), [
    { b: null, fraction: 0, count: 1 }, { b: null, fraction: 0.5, count: 1 }, { b: null, fraction: 1, count: 2 },
  ]);
  assert.equal(shells(set, 0)[1].b, null);
});

/** A set with one vector per squared length, along x. */
const along = (/** @type {number[]} */ n2s) => /** @type {any} */ ({ vectors: n2s.map((n) => [Math.sqrt(n), 0, 0]) });

test('shells: IVIM b-values stay separate, 3-decimal spread stays together', () => {
  const ivim = shells(along([0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 1]), 1000);
  assert.deepEqual(ivim.map((s) => s.b), [0, 10, 20, 30, 50, 80, 100, 1000]);
  const spread = shells(along([1.0249, 1.0251]), 1000);
  assert.equal(spread.length, 1);
  assert.equal(spread[0].count, 2);
  assert.equal(spread[0].b, 1025);
});
