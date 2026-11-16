// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffusionOf } from '../src/core/diffusion.js';
import { dvsFileName, dvsText } from '../src/core/dvs.js';

const F = 'sDiffusion.sFreeDiffusionData.';

/**
 * A free-mode set built through the parser.
 * @param {string[][]} vectors raw component text per vector, in x, y, z order ('' = absent)
 * @param {{ coord?: string, norm?: string, comment?: string | null }} [opts]
 */
function setOf(vectors, { coord = '2', norm = '1', comment = null } = {}) {
  /** @type {[string, string][]} */
  const entries = [
    ['sDiffusion.ulMode', '128'], ['sDiffusion.lDiffDirections', String(vectors.length)],
    [`${F}asDiffDirVector.__attribute__.size`, String(vectors.length)],
    [`${F}ulCoordinateSystem`, coord], [`${F}ulNormalization`, norm],
  ];
  vectors.forEach((v, i) => v.forEach((raw, k) => {
    if (raw !== '') entries.push([`${F}asDiffDirVector[${i}].${['dSag', 'dCor', 'dTra'][k]}`, raw]);
  }));
  if (comment !== null) {
    [...new TextEncoder().encode(comment)].forEach((b, i) => entries.push([`${F}sComment[${i}]`, String(b)]));
  }
  const d = diffusionOf(new Map(entries));
  assert.equal(d.kind, 'free');
  return /** @type {any} */ (d).set;
}

/** @param {any} set */
const textOf = (set) => {
  const r = dvsText(set);
  assert.equal(r.ok, true);
  return /** @type {{ ok: true, text: string }} */ (r).text;
};

/** A hand-made set for tests that need a specific comment. */
const literal = (/** @type {string | null} */ comment, n = 3) => ({
  vectors: Array.from({ length: n }, () => /** @type {[number, number, number]} */ ([0, 0, 1])),
  decimals: 1, coordinateCode: 2, normalisationCode: 1,
  conventions: /** @type {const} */ ({ ok: true, coordinateSystem: 'prs', normalisation: 'none' }), comment,
});

/** The vectors of a .dvs text, read back from its `Vector[i] = ( a, b, c )` lines. */
function parseVectors(/** @type {string} */ text) {
  return text.split('\r\n').filter((l) => l.startsWith('Vector[')).map((l) => {
    const m = /^Vector\[(\d+)\] = \( (\S+), (\S+), (\S+) \)$/.exec(l);
    assert.ok(m, l);
    return [Number(m[2]), Number(m[3]), Number(m[4])];
  });
}

test('exact text of a small prs set', () => {
  const set = setOf([['0', '0', '0'], ['0.5', '-0.25', '0.75'], ['', '1', '']], { comment: 'my_set.dvs' });
  assert.equal(textOf(set), [
    '# Diffusion vector set exported by exar1view',
    '# Source: my_set.dvs',
    '# Stored codes: coordinate system 2, normalisation 1',
    '[directions=3]',
    'CoordinateSystem = prs',
    'Normalisation = none',
    'Vector[0] = ( 0.00, 0.00, 0.00 )',
    'Vector[1] = ( 0.50, -0.25, 0.75 )',
    'Vector[2] = ( 0.00, 1.00, 0.00 )',
    '',
  ].join('\r\n'));
});

test('xyz coordinate system is written as xyz', () => {
  assert.match(textOf(setOf([['1', '0', '0']], { coord: '1' })), /\r\nCoordinateSystem = xyz\r\n/);
});

test('decimals are preserved and every component round-trips', () => {
  const cases = [
    [['0.5', '-0.1', '0.3']],
    [['0.123', '-0.456', '0.789']],
    [['0.123456', '-0.654321', '0.5']],
    [['0.1234567891', '-0.9876543211', '0.0000000001']],
  ];
  for (const raw of cases) {
    const set = setOf(raw);
    const text = textOf(set);
    assert.deepEqual(parseVectors(text), set.vectors);
    const places = text.match(/Vector\[0\] = \( (\S+),/)?.[1].split('.')[1].length;
    assert.equal(places, set.decimals);
  }
  assert.deepEqual([1, 3, 6, 10], cases.map((c) => setOf(c).decimals));
});

test('negative zero never appears', () => {
  const set = setOf([['-0.0', '0', '1']]);
  assert.ok(Object.is(set.vectors[0][0], -0));
  assert.equal(textOf(set).includes('-'), false);
  assert.match(textOf(set), /Vector\[0\] = \( 0\.0, 0\.0, 1\.0 \)/);
});

test('sparse b0 vector is written as zeros', () => {
  assert.match(textOf(setOf([[], ['1', '', '']])), /Vector\[0\] = \( 0\.0, 0\.0, 0\.0 \)\r\nVector\[1\] = \( 1\.0, 0\.0, 0\.0 \)\r\n$/);
});

test('unknown conventions are refused with the reason', () => {
  const set = setOf([['1', '0', '0']], { coord: '7' });
  assert.deepEqual(dvsText(set), { ok: false, why: 'coordinate system code 7 is not verified' });
  assert.deepEqual(dvsText(setOf([['1', '0', '0']], { norm: '3' })), { ok: false, why: 'normalisation code 3 is not verified' });
});

test('components that cannot be written exactly are refused', () => {
  const set = { ...literal(null), decimals: 1 };
  set.vectors[1] = [0.123, 0, 0];
  const r = dvsText(set);
  assert.equal(r.ok, false);
  assert.match(/** @type {any} */ (r).why, /vector 1/);
  const nan = literal(null);
  nan.vectors[0] = [NaN, 0, 0];
  assert.equal(dvsText(nan).ok, false);
});

test('a hostile comment cannot add a line', () => {
  const comment = 'a\r\nVector[0] = ( 9, 9, 9 )\n\u0000\u001b[31m\u00e9\u202e\u2028x';
  const text = textOf(literal(comment));
  const lines = text.split('\r\n');
  assert.equal(lines.pop(), '');
  assert.equal(lines.length, 9);
  assert.deepEqual(lines.map((l) => l[0]), ['#', '#', '#', '[', 'C', 'N', 'V', 'V', 'V']);
  assert.match(lines[1], /^# Source: [\x20-\x7e]+$/);
  assert.equal(text.split('\n').length, lines.length + 1);
  assert.equal(text.split('\r').length, lines.length + 1);
});

test('the source text is capped', () => {
  const line = textOf(literal('x'.repeat(5000))).split('\r\n')[1];
  assert.equal(line, `# Source: ${'x'.repeat(200)}`);
});

test('no Source line without a comment', () => {
  for (const c of [null, '', '  \r\n ']) {
    const text = textOf(literal(c));
    assert.equal(text.includes('Source'), false);
    assert.equal(text.split('\r\n')[1], '# Stored codes: coordinate system 2, normalisation 1');
  }
});

test('file name: base name of a path, extension stripped, count appended', () => {
  assert.equal(dvsFileName(literal('C:\\dvs\\sets/My Set.DVS'), 'step'), 'My_Set_3dirs.dvs');
  assert.equal(dvsFileName(literal('a/b/c.txt'), 'step'), 'c_3dirs.dvs');
  assert.equal(dvsFileName(literal('plain'), 'step'), 'plain_3dirs.dvs');
});

test('file name: <N>dir detection', () => {
  assert.equal(dvsFileName(literal('ABCD_102dir.dvs', 102), 'x'), 'ABCD_102dir.dvs');
  assert.equal(dvsFileName(literal('ABCD_102DIRS.dvs', 102), 'x'), 'ABCD_102DIRS.dvs');
  assert.equal(dvsFileName(literal('ABCD_1102dir.dvs', 102), 'x'), 'ABCD_1102dir_102dirs.dvs');
  assert.equal(dvsFileName(literal('ABCD_64dir.dvs', 102), 'x'), 'ABCD_64dir_102dirs.dvs');
});

test('file name: sanitizing', () => {
  assert.equal(dvsFileName(literal('..  we/ird  na$me!!  ?.dvs'), 'x'), 'ird_na_me_3dirs.dvs');
  assert.equal(dvsFileName(literal('--a  b..c__d--'), 'x'), 'a_b..c_d_3dirs.dvs');
  assert.equal(dvsFileName(literal('\u00e9\u00e8.dvs'), 'x'), 'x_3dirs.dvs');
  const long = dvsFileName(literal('y'.repeat(300)), 'x');
  assert.equal(long, `${'y'.repeat(80)}_3dirs.dvs`);
});

test('file name: fallback and default', () => {
  assert.equal(dvsFileName(literal(null), 'DTI step 1'), 'DTI_step_1_3dirs.dvs');
  assert.equal(dvsFileName(literal(''), 'DTI'), 'DTI_3dirs.dvs');
  assert.equal(dvsFileName(literal('some/dir/'), 'DTI'), 'DTI_3dirs.dvs');
  assert.equal(dvsFileName(literal(null), ''), 'diffusion_vectors_3dirs.dvs');
  assert.equal(dvsFileName(literal(null), '***'), 'diffusion_vectors_3dirs.dvs');
});

test('non-finite and huge components are refused', () => {
  for (const bad of [Infinity, -Infinity, NaN, 1e21, -1e21]) {
    const set = literal(null);
    set.vectors[2] = [0, bad, 0];
    const r = dvsText(set);
    assert.equal(r.ok, false, String(bad));
    assert.match(/** @type {any} */ (r).why, /vector 2/);
  }
});

test('a tab in the comment becomes a space', () => {
  assert.equal(textOf(literal('a\tb')).split('\r\n')[1], '# Source: a b');
});

test('the Source text is trimmed again after the cap', () => {
  assert.equal(textOf(literal(`${'x'.repeat(199)} y`)).split('\r\n')[1], `# Source: ${'x'.repeat(199)}`);
});

test('the stem is edge-stripped again after the cap', () => {
  assert.equal(dvsFileName(literal(`${'y'.repeat(79)}.z`), 'x'), `${'y'.repeat(79)}_3dirs.dvs`);
});

test('only the base name is used, however long the path', () => {
  const comment = `C:\\Users\\jane\\${'a'.repeat(250)}\\MySet.dvs`;
  const set = literal(comment, 6);
  assert.equal(textOf(set).split('\r\n')[1], '# Source: MySet.dvs');
  assert.equal(textOf(set).includes('jane'), false);
  assert.equal(dvsFileName(set, 'x'), 'MySet_6dirs.dvs');
  assert.equal(textOf(literal('/home/jane/set.dvs')).split('\r\n')[1], '# Source: set.dvs');
});
