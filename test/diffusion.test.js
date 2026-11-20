// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import json from '../src/core/cardcatalog.json' with { type: 'json' };
import { MODE_NAMES, diffusionOf, isFreeVectorKey, shells } from '../src/core/diffusion.js';
import { dvsFileName, dvsText } from '../src/core/dvs.js';
import { compareDiffusion, diffusionSummary } from '../src/core/diffusionsummary.js';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { createFileSource } from '../src/platform/source.js';
import { loadExar } from '../src/core/load.js';
import { displaySteps } from '../src/core/model.js';
import { loadSql } from './sqljs.js';
import { buildExar } from './fixture/builder.js';
import { diffusionSpec } from './fixture/spec.js';

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

/** The set parsed with comment text, one byte per key. */
const originSet = (/** @type {string} */ text) => freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'),
  ...[...new TextEncoder().encode(text)].map((b, i) => /** @type {[string, string]} */ ([`${F}sComment.${i}`, String(b)])))));
/** The origin parsed from comment text. */
const originOf = (/** @type {string} */ text) => originSet(text).origin;

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
  for (const key of ['sDiffusion.lDiffDirections', `${F}ulCoordinateSystem`, `${F}ulNormalization`, `${F}asDiffDirVector.__attribute__.size`]) {
    assert.ok(!isFreeVectorKey(key), key);
  }
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

test('the diffusion fixture: each step reads as its diffusion kind, and exports or refuses', async () => {
  const bytes = buildExar(diffusionSpec);
  const opened = openDb(await loadSql(), bytes);
  const res = await loadExar(opened.db, inflateRaw, { id: 'f1', name: 'diffusion.exar1', size: bytes.length });
  assert.ok(res.ok);
  const steps = res.file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs.flatMap((p) => displaySteps(p.body))));
  const source = createFileSource(opened, inflateRaw);
  try {
    /** @param {string} name */
    const diffusionOfStep = async (name) => {
      const step = steps.find((s) => s.label === name);
      assert.ok(step, name);
      const p = await source.protocol(/** @type {any} */ (step).detail.protocolBlob);
      assert.ok(p.ok, p.ok ? '' : p.error);
      assert.equal(p.blocks[0].get('tSequenceFileName'), '"%SiemensSeq%\\ep2d_diff"');
      return diffusionOf(p.blocks[0]);
    };

    const six = freeSet(await diffusionOfStep('DTI six directions'));
    assert.equal(six.vectors.length, 6);
    assert.deepEqual(six.conventions, { ok: true, coordinateSystem: 'prs', normalisation: 'none' });
    assert.deepEqual(six.origin, { file: 'dti_6dir.dvs', notes: [], builtIn: false });
    const text = dvsText(six);
    assert.ok(text.ok);
    assert.match(text.text, /\[directions=6\]\r\nCoordinateSystem = prs\r\n/);
    assert.equal(dvsFileName(six, 'x'), 'dti_6dir.dvs');

    const multi = await diffusionOfStep('Multi-shell ten directions');
    assert.equal(multi.kind, 'free');
    const set = freeSet(multi);
    assert.equal(set.vectors.length, 10);
    assert.deepEqual(set.vectors[0], [0, 0, 0]);
    assert.deepEqual(set.conventions, { ok: true, coordinateSystem: 'xyz', normalisation: 'none' });
    assert.equal(set.origin.file, 'multishell_10dir.dvs');
    assert.deepEqual(/** @type {any} */ (multi).weightings, [{ b: 0, averages: null }, { b: 3000, averages: null }]);
    assert.deepEqual(shells(set, 3000), [
      { b: 0, fraction: 0, count: 1 }, { b: 1500, fraction: 0.5, count: 3 }, { b: 3000, fraction: 1, count: 6 },
    ]);
    assert.ok(dvsText(set).ok);
    assert.equal(dvsFileName(set, 'x'), 'multishell_10dir.dvs');

    const editedD = await diffusionOfStep('Multi-shell ten directions edited');
    const edited = freeSet(editedD);
    assert.deepEqual(edited.vectors.filter((v, i) => v.join() !== set.vectors[i].join()), [[0.8, 0.6, 0]]);
    const pair = compareDiffusion(multi, editedD);
    assert.ok(pair);
    assert.equal(pair.verdict, '1 of 10 vectors differ (largest axis angle 16.3°)');
    assert.deepEqual(pair.differing, [{ index: 7, a: '0.6, 0.8, 0.0', b: '0.8, 0.6, 0.0' }]);
    assert.deepEqual(pair.notes, []);
    assert.equal(pair.fold, true);
    assert.ok(pair.rows.every((r) => r.same));
    assert.equal(compareDiffusion(multi, multi)?.verdict, 'Identical vector sets');

    for (const { name, code, directions } of [
      { name: 'MDDW thirty directions', code: 256, directions: 30 },
      { name: 'Trace three scans', code: 64, directions: 3 },
    ]) {
      const d = await diffusionOfStep(name);
      assert.equal(d.kind, 'builtin');
      assert.deepEqual(/** @type {any} */ (d).mode, { code, name: MODE_NAMES.get(code) });
      assert.equal(/** @type {any} */ (d).directions, directions);
    }

    const unverified = freeSet(await diffusionOfStep('Unverified normalisation'));
    assert.equal(unverified.vectors.length, 2);
    assert.equal(unverified.normalisationCode, 2);
    const refused = dvsText(unverified);
    assert.ok(!refused.ok);
    assert.match(refused.why, /normalisation/);

    const sub = freeSet(await diffusionOfStep('Scanner substitute set'));
    assert.equal(sub.vectors.length, 6);
    assert.deepEqual(sub.origin, { file: 'picked_7dir.dvs', notes: ['SIEMENS', 'Internal 6-directions set'], builtIn: true });
    assert.deepEqual(sub.vectors[1], [1, 0, -1]);
    assert.ok(dvsText(sub).ok);
    assert.equal(dvsFileName(sub, 'x'), 'siemens_internal_6dirs.dvs');
  } finally {
    source.close();
  }
});

/** @param {string} label @param {ReturnType<typeof diffusionSummary>} rows */
const row = (label, rows) => rows?.find((r) => r.label === label)?.text;
/** A free diffusion over vectors with the given norms (on the x axis), weightings b and origin. */
const freeOf = (/** @type {number[]} */ norms, /** @type {{ b: number, averages: number | null }[]} */ weightings, /** @type {any} */ over = {}) => ({
  kind: /** @type {const} */ ('free'),
  mode: { code: 128, name: 'Free' },
  set: {
    vectors: norms.map((n) => /** @type {[number, number, number]} */ ([Math.sqrt(n), 0, 0])), decimals: 1, coordinateCode: 1,
    normalisationCode: 1, conventions: /** @type {const} */ ({ ok: true, coordinateSystem: 'xyz', normalisation: 'none' }),
    origin: { file: null, notes: [], builtIn: false }, ...over,
  },
  weightings,
});

test('diffusionSummary: none has no rows', () => {
  assert.equal(diffusionSummary({ kind: 'none' }), null);
});

test('diffusionSummary: free rows with b-values, shells and source', () => {
  const d = freeOf([0, 0.25, 0.25, 0.25, 1, 1], [{ b: 0, averages: null }, { b: 3000, averages: 2 }], { origin: { file: 'C:\\x\\my.dvs', notes: [], builtIn: false } });
  const rows = diffusionSummary(d);
  assert.deepEqual(rows?.map((r) => r.label), ['Mode', 'Directions', 'b-values', 'Coordinate system', 'Normalisation', 'Source', 'Shells']);
  assert.equal(row('Mode', rows), 'Free');
  assert.equal(row('Directions', rows), '6');
  assert.equal(row('b-values', rows), '0, 3000 (2 averages)');
  assert.equal(row('Coordinate system', rows), 'xyz');
  assert.equal(row('Normalisation', rows), 'none');
  assert.equal(row('Source', rows), 'my.dvs');
  assert.equal(row('Shells', rows), 'b=0 ×1, 750 ×3, 3000 ×2');
});

test('diffusionSummary: without a positive bmax the shells are fractions', () => {
  const rows = diffusionSummary(freeOf([0, 0.25, 0.25, 1], [{ b: 0, averages: null }]));
  assert.equal(row('Shells', rows), '0 ×1, 0.25·bmax ×2, bmax ×1');
  assert.equal(row('Shells', diffusionSummary(freeOf([1], []))), 'bmax ×1');
  assert.equal(row('b-values', diffusionSummary(freeOf([1], []))), undefined);
});

test('diffusionSummary: never-seen codes and built-in source', () => {
  const rows = diffusionSummary(freeOf([1], [], {
    coordinateCode: 3, normalisationCode: 2, conventions: { ok: false, why: 'x' },
    origin: { file: 'a/b/pick.dvs', notes: ['SIEMENS'], builtIn: true },
  }));
  assert.equal(row('Coordinate system', rows), 'code 3 (never seen)');
  assert.equal(row('Normalisation', rows), 'code 2 (never seen)');
  assert.equal(row('Source', rows), 'scanner built-in set (selected file: pick.dvs)');
});

test('diffusionSummary: built-in, unlabelled and invalid modes', () => {
  const b = diffusionSummary({ kind: 'builtin', mode: { code: 256, name: 'MDDW' }, directions: null, weightings: [{ b: 1000, averages: null }] });
  assert.deepEqual(b?.map((r) => r.label), ['Mode', 'b-values']);
  const u = diffusionSummary({ kind: 'builtin', mode: { code: 7, name: null }, directions: 6, weightings: [] });
  assert.equal(row('Mode', u), 'mode 7');
  assert.equal(row('Directions', u), '6');
  assert.deepEqual(diffusionSummary({ kind: 'invalid', mode: null, error: 'bad' }), [{ label: 'Mode', text: 'unreadable' }, { label: 'Error', text: 'bad' }]);
  assert.equal(row('Error', diffusionSummary({ kind: 'invalid', mode: { code: 128, name: 'Free' }, error: 'e' })), 'e');
});

test('diffusionSummary: shells are left out unless b = bmax·|v|² holds', () => {
  const w = [{ b: 3000, averages: null }];
  assert.ok(row('Shells', diffusionSummary(freeOf([0, 1], w))));
  assert.equal(row('Shells', diffusionSummary(freeOf([0, 1], w, { origin: { file: null, notes: ['SIEMENS'], builtIn: true } }))), undefined);
  assert.equal(row('Shells', diffusionSummary(freeOf([0, 1], w, { normalisationCode: 2 }))), undefined);
  assert.equal(row('Shells', diffusionSummary(freeOf([0, 1], w, { normalisationCode: null }))), undefined);
  assert.equal(row('Shells', diffusionSummary(freeOf([0, 4], w))), undefined);
});

/** A free diffusion over the given vectors, with b-values 0 and 1000. */
const freeVectors = (/** @type {[number, number, number][]} */ vectors, /** @type {any} */ over = {}) => ({
  ...freeOf([], [{ b: 0, averages: null }, { b: 1000, averages: null }]),
  set: { ...freeOf([], []).set, comment: '', vectors, ...over },
});
const MDDW = /** @type {const} */ ({ kind: 'builtin', mode: { code: 256, name: 'MDDW' }, directions: 30, weightings: [{ b: 1000, averages: null }] });
/** @param {string} label @param {ReturnType<typeof compareDiffusion>} c */
const pairRow = (label, c) => c?.rows.find((r) => r.label === label);

test('compareDiffusion: identical sets, in the Summary row order', () => {
  const v = /** @type {[number, number, number][]} */ ([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  const c = compareDiffusion(freeVectors(v), freeVectors(v.map((x) => [...x])));
  assert.ok(c);
  assert.equal(c.verdict, 'Identical vector sets');
  assert.deepEqual(c.differing, []);
  assert.deepEqual(c.notes, []);
  assert.equal(c.differCount, 0);
  assert.equal(c.fold, true);
  const labels = c.rows.map((r) => r.label);
  assert.deepEqual(labels, ['Mode', 'Directions', 'b-values', 'Coordinate system', 'Normalisation', 'Source', 'Shells']);
  assert.deepEqual(diffusionSummary(freeVectors(v))?.map((r) => r.label), labels);
  assert.ok(c.rows.every((r) => r.same && r.a === r.b));
});

test('compareDiffusion: differing vectors, axis angles, sign flips and zero vectors', () => {
  const a = freeVectors([[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0]]);
  // sign flip (same axis: 0°), 90°, zero on B, non-zero on A's zero, equal
  const b = freeVectors([[-1, 0, 0], [1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 0]]);
  const c = compareDiffusion(a, b);
  assert.equal(c?.verdict, '4 of 5 vectors differ (largest axis angle 90.0°)');
  assert.deepEqual(c?.differing.map((d) => d.index), [0, 1, 2, 3]);
  assert.deepEqual(c?.differing[0], { index: 0, a: '1.0, 0.0, 0.0', b: '-1.0, 0.0, 0.0' });
  // a sign flip alone differs at 0.0°; a near-opposite vector is near the same axis
  assert.equal(compareDiffusion(freeVectors([[0, 0, 1]]), freeVectors([[0, 0, -1]]))?.verdict, '1 of 1 vectors differ (largest axis angle 0.0°)');
  const tilt = Math.sin(Math.PI / 180);
  assert.equal(compareDiffusion(freeVectors([[0, 0, 1]]), freeVectors([[tilt, 0, -Math.cos(Math.PI / 180)]]))?.verdict,
    '1 of 1 vectors differ (largest axis angle 1.0°)');
  // only zero-vector differences: no angle
  const z = compareDiffusion(freeVectors([[0, 0, 0], [1, 0, 0]]), freeVectors([[0, 0, 1], [1, 0, 0]]));
  assert.equal(z?.verdict, '1 of 2 vectors differ');
  // a length change along the same axis differs at 0.0°, whatever the lengths; b-values follow in Shells
  const s = compareDiffusion(freeVectors([[1e-200, 0, 0]]), freeVectors([[0.5, 0, 0]]));
  assert.equal(s?.verdict, '1 of 1 vectors differ (largest axis angle 0.0°)');
  assert.equal(pairRow('Shells', compareDiffusion(freeVectors([[1, 0, 0]]), freeVectors([[0.5, 0, 0]])))?.same, false);
  // the vectors are written with the larger number of decimals of the two sets
  const d = compareDiffusion(freeVectors([[0.5, 0, 0]]), freeVectors([[0.125, 0, 0]], { decimals: 3 }));
  assert.deepEqual(d?.differing, [{ index: 0, a: '0.500, 0.000, 0.000', b: '0.125, 0.000, 0.000' }]);
});

test('compareDiffusion: a differing coordinate system qualifies the verdict', () => {
  const v = /** @type {[number, number, number][]} */ ([[1, 0, 0]]);
  assert.equal(compareDiffusion(freeVectors(v), freeVectors(v, { coordinateCode: 2 }))?.verdict, 'Identical vector sets (coordinate systems differ)');
  assert.equal(compareDiffusion(freeVectors(v), freeVectors([[1, 0, 0], [0, 1, 0]], { coordinateCode: 2 }))?.verdict,
    'Different numbers of vectors (1 vs 2) (coordinate systems differ)');
});

test('compareDiffusion: more than 20 differing vectors are capped in the list', () => {
  const a = freeVectors(Array.from({ length: 25 }, () => /** @type {[number, number, number]} */ ([1, 0, 0])));
  const b = freeVectors(Array.from({ length: 25 }, () => /** @type {[number, number, number]} */ ([0, 1, 0])));
  const c = compareDiffusion(a, b);
  assert.equal(c?.verdict, '25 of 25 vectors differ (largest axis angle 90.0°)');
  assert.equal(c?.differCount, 25);
  assert.equal(c?.differing.length, 20);
  assert.equal(c?.differing[19].index, 19);
});

test('compareDiffusion: different counts', () => {
  const c = compareDiffusion(freeVectors([[1, 0, 0], [0, 1, 0]]), freeVectors([[1, 0, 0]]));
  assert.equal(c?.verdict, 'Different numbers of vectors (2 vs 1)');
  assert.deepEqual(c?.differing, []);
  assert.deepEqual(pairRow('Directions', c), { label: 'Directions', a: '2', b: '1', same: false });
});

test('compareDiffusion: stored comment and stored text differences are reported, never quoted', () => {
  const C = `${F}sComment.0`;
  const V = `${F}asDiffDirVector[1].dSag`;
  /** Two parsed sets: one vector (1, 0, 0) written as `x`, and a comment. */
  const parsed = (/** @type {string} */ x, /** @type {string} */ comment) => diffusionOf(free(1, vec(0, 'dSag', x),
    ...[...new TextEncoder().encode(comment)].map((b, i) => /** @type {[string, string]} */ ([`${F}sComment.${i}`, String(b)]))));
  // only the folder in the comment differs: same Source row, but the comment is noted
  const path = compareDiffusion(parsed('1', 'C:\\secretone\\set.dvs\n'), parsed('1', 'C:\\two\\set.dvs\n'), [C]);
  assert.equal(path?.verdict, 'Identical vector sets');
  assert.deepEqual(path?.notes, ['Stored comment text differs']);
  assert.equal(pairRow('Source', path)?.same, true);
  assert.equal(JSON.stringify(path).includes('secretone'), false);
  // "1" against "1.0": equal values, differing text
  const text = compareDiffusion(parsed('1', 'a.dvs'), parsed('1.0', 'a.dvs'), [V]);
  assert.equal(text?.verdict, 'Identical vector sets (values equal; stored text differs)');
  assert.deepEqual(text?.notes, []);
  // comment bytes that differ only in form (hex against decimal) decode equal
  const bytes = compareDiffusion(parsed('1', 'a.dvs'), parsed('1', 'a.dvs'), [C]);
  assert.deepEqual(bytes?.notes, ['Stored comments are equal as text; their stored bytes differ']);
  // without folded keys there is nothing to explain
  assert.equal(compareDiffusion(parsed('1', 'a'), parsed('1.0', 'a'))?.verdict, 'Identical vector sets');
});

test('compareDiffusion: free against built-in has rows only, and folds', () => {
  const c = compareDiffusion(freeVectors([[1, 0, 0]], { origin: { file: 'x/my.dvs', notes: [], builtIn: false } }), MDDW, [`${F}sComment.0`]);
  assert.ok(c);
  assert.equal(c.verdict, null);
  assert.deepEqual(c.notes, []);
  assert.equal(c.fold, true);
  assert.deepEqual(pairRow('Mode', c), { label: 'Mode', a: 'Free', b: 'MDDW', same: false });
  assert.deepEqual(pairRow('Source', c), { label: 'Source', a: 'my.dvs', b: null, same: false });
  assert.deepEqual(pairRow('Directions', c), { label: 'Directions', a: '1', b: '30', same: false });
});

test('compareDiffusion: none, built-in and invalid sides', () => {
  /** @type {import('../src/core/diffusion.js').Diffusion} */
  const none = { kind: 'none' };
  assert.equal(compareDiffusion(none, none), null);
  const bad = /** @type {const} */ ({ kind: 'invalid', mode: null, error: 'x' });
  assert.equal(compareDiffusion(bad, freeVectors([[1, 0, 0]])), null);
  assert.equal(compareDiffusion(MDDW, bad), null);
  const c = compareDiffusion(none, MDDW);
  assert.ok(c);
  assert.equal(c.fold, false);
  assert.equal(c.verdict, null);
  // rows meaningless for both sides are left out
  assert.deepEqual(c.rows.map((r) => [r.label, r.a, r.b]), [['Mode', 'none', 'MDDW'], ['Directions', null, '30'], ['b-values', null, '1000']]);
  assert.equal(compareDiffusion(MDDW, MDDW)?.rows.every((r) => r.same), true);
  assert.equal(compareDiffusion(none, freeVectors([[1, 0, 0]]))?.fold, true);
});

test('the stored comment is kept whole for comparison; unreadable is null', () => {
  assert.equal(originSet('a/b.dvs\r\n note \n').comment, 'a/b.dvs\r\n note \n');
  assert.equal(freeSet(diffusionOf(free(1, vec(0, 'dSag', '1')))).comment, '');
  assert.equal(freeSet(diffusionOf(free(1, vec(0, 'dSag', '1'), [`${F}sComment.0`, 'x']))).comment, null);
});

test('decimals from the raw text agree with the search, and 100k directions parse quickly', () => {
  const dec = (/** @type {string} */ v) => freeSet(diffusionOf(free(1, vec(0, 'dSag', v)))).decimals;
  for (const [raw, d] of /** @type {[string, number][]} */ ([
    ['0.50', 1], ['1.000', 1], ['-0.0', 1], ['.125', 3], ['5.', 1], ['1e-3', 3], ['1.5E2', 1],
    ['0.1000000000000000055511', 1], ['0.' + '0'.repeat(150) + '1', 100], ['123456789.123456789', 8],
  ])) assert.equal(dec(raw), d, raw);
  // the raw-text count agrees with the search over many values
  const search = (/** @type {number} */ v) => { let d = 0; while (d < 100 && Number(v.toFixed(d)) !== v) d++; return Math.max(1, d); };
  for (let i = 0; i < 2000; i++) {
    const raw = (Math.sin(i * 7.3) * 10 ** (i % 5)).toFixed(i % 12) + (i % 3 === 0 ? '00' : '');
    assert.equal(dec(raw), search(Number(raw)), raw);
  }
  const n = 100_000;
  const big = free(n, ...Array.from({ length: n }, (_, i) => vec(i, 'dSag', (i / n).toFixed(6))));
  const start = performance.now();
  const set = freeSet(diffusionOf(big));
  const ms = performance.now() - start;
  assert.equal(set.vectors.length, n);
  assert.equal(set.decimals, 5);
  assert.ok(ms < 5000, `${ms} ms`);
});
