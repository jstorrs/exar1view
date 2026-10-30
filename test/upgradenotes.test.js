// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotes } from '../src/core/upgradenotes.js';

const H = (/** @type {string} */ d) => `Protocol was converted on ${d} :`;
/** @param {string} line */
const one = (line) => parseNotes(`${H('1/2/2010')}\n${line}`)[0].changes[0];

test('number with unit', () => {
  assert.deepEqual(one('TE:  11   -->   12  ms'), { parameter: 'TE', from: '11', to: '12', unit: 'ms', text: 'TE: 11 --> 12 ms' });
});

test('no unit', () => {
  assert.deepEqual(one('Excitation:  Slice-sel.  -->  Standard'), { parameter: 'Excitation', from: 'Slice-sel.', to: 'Standard', unit: '', text: 'Excitation: Slice-sel. --> Standard' });
  assert.deepEqual(one('GreSSSpoil:  1.0  -->  0.0'), { parameter: 'GreSSSpoil', from: '1.0', to: '0.0', unit: '', text: 'GreSSSpoil: 1.0 --> 0.0' });
});

test('empty from', () => {
  assert.deepEqual(one('Echo spacing:          -->     2.5  ms'), { parameter: 'Echo spacing', from: '', to: '2.5', unit: 'ms', text: 'Echo spacing: --> 2.5 ms' });
});

test('multi-part values and odd units', () => {
  assert.deepEqual(one('Voxel size:  0.7×0.5×4.0  -->  0.9×0.6×4.0  mm'), { parameter: 'Voxel size', from: '0.7×0.5×4.0', to: '0.9×0.6×4.0', unit: 'mm', text: 'Voxel size: 0.7×0.5×4.0 --> 0.9×0.6×4.0 mm' });
  assert.equal(one('Gradient:  1  -->  2  µs/(mT/m)').unit, 'µs/(mT/m)');
  assert.equal(one('BW:  100  -->  200  Hz/Px').unit, 'Hz/Px');
});

test('a plain number after spaces is not a unit', () => {
  assert.deepEqual(one('Matrix:  256  -->  320'), { parameter: 'Matrix', from: '256', to: '320', unit: '', text: 'Matrix: 256 --> 320' });
  assert.equal(one('X:  a  -->  b  12').unit, '');
});

test('same change with different spacing has equal text', () => {
  assert.equal(one('TE:11-->12  ms').text, one('TE:   11    -->   12      ms').text);
});

test('blocks with the same date merge and dedupe, in first-appearance order', () => {
  const a = `${H('1/1/2010')}\nTE:  1  -->  2  ms\n`;
  const b = `${H('2/2/2011')}\nTR:  3  -->  4  ms\n`;
  assert.deepEqual(parseNotes(a + b + a + 'TA:  5  -->  6  s\n'), [
    { date: '1/1/2010', changes: [
      { parameter: 'TE', from: '1', to: '2', unit: 'ms', text: 'TE: 1 --> 2 ms' },
    ] },
    { date: '2/2/2011', changes: [
      { parameter: 'TR', from: '3', to: '4', unit: 'ms', text: 'TR: 3 --> 4 ms' },
    ] },
  ].map((c, i) => (i === 0 ? { ...c, changes: [...c.changes, { parameter: 'TA', from: '5', to: '6', unit: 's', text: 'TA: 5 --> 6 s' }] } : c)));
});

test('a change running into the next header', () => {
  const r = parseNotes(`${H('3/3/2011')}\nCoil elements:   Unknown coil element   -->   BC${H('4/4/2012')}\nTE:  1  -->  2  ms`);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { date: '3/3/2011', changes: [{ parameter: 'Coil elements', from: 'Unknown coil element', to: 'BC', unit: '', text: 'Coil elements: Unknown coil element --> BC' }] });
  assert.equal(r[1].date, '4/4/2012');
  assert.equal(r[1].changes[0].text, 'TE: 1 --> 2 ms');
});

test('preamble and non-change lines are kept as text', () => {
  const r = parseNotes(`Some   preamble\n${H('1/2/2010')}\n\n  Not a   change  \n`);
  assert.deepEqual(r, [
    { date: null, changes: [{ parameter: null, text: 'Some preamble' }] },
    { date: '1/2/2010', changes: [{ parameter: null, text: 'Not a change' }] },
  ]);
});

test('header-only block has no changes', () => {
  assert.deepEqual(parseNotes(H('1/2/2010')), [{ date: '1/2/2010', changes: [] }]);
});

test('empty or blank text has no conversions', () => {
  assert.deepEqual(parseNotes(''), []);
  assert.deepEqual(parseNotes('  \n '), []);
});
