// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportRows, toCsv, toTsv } from '../src/core/seqcsv.js';

/** @typedef {import('../src/core/seqreport.js').SequenceReport} SequenceReport */
/** @typedef {import('../src/core/seqreport.js').Use} Use */

/** @param {string} step @returns {Use} */
const use = (step) => ({ fileId: 'f1', fileName: 'a.exar1', path: ['R', 'E', 'P', step], stepKey: step, programKey: 'p' });

/** @type {SequenceReport} */
const report = {
  byReference: [
    { category: 'customer', entries: [{ ref: { key: 'tSequenceFileName', value: '%CustomerSeq%\\x', placeholder: '%CustomerSeq%' }, category: 'customer', programs: 1, uses: [use('s1'), use('s2')] }] },
    { category: 'standard', entries: [{ ref: { key: 'tFoo', value: 'a.dll', placeholder: null }, category: 'standard', programs: 1, uses: [use('s3')] }] },
  ],
  byProgram: [],
  gaps: [{ reason: 'unreadable', error: 'bad, "zip"', use: use('s4') }, { reason: 'no-protocol', error: null, use: use('s5') }],
  files: 1, protocols: 2, steps: 5,
};

test('header and row order: references by category, then gaps', () => {
  const rows = reportRows(report);
  assert.deepEqual(rows[0], ['Category', 'Placeholder', 'Parameter', 'Reference', 'File', 'Region', 'Exam', 'Program', 'Step']);
  assert.deepEqual(rows.map((r) => r[8]), ['Step', 's1', 's2', 's3', 's4', 's5']);
  assert.deepEqual(rows[1], ['Customer (upgrade risk)', '%CustomerSeq%', 'tSequenceFileName', '%CustomerSeq%\\x', 'a.exar1', 'R', 'E', 'P', 's1']);
  assert.deepEqual(rows[3].slice(0, 4), ['Standard', '', 'tFoo', 'a.dll']);
});

test('gap rows', () => {
  const rows = reportRows(report);
  assert.deepEqual(rows[4].slice(0, 4), ['Not checked', '', '', 'Could not be read: bad, "zip"']);
  assert.deepEqual(rows[5].slice(0, 4), ['Not checked', '', '', 'No protocol']);
});

test('CSV quotes commas, quotes and newlines, with CRLF', () => {
  assert.equal(toCsv([['a,b', 'say "hi"', 'x\ny', 'plain']]), '"a,b","say ""hi""","x\ny",plain\r\n');
  assert.equal(toCsv([['a'], ['b']]), 'a\r\nb\r\n');
});

test('formula guard in CSV and TSV', () => {
  assert.equal(toCsv([['=1+1', '+x', '-y', '@z', 'a-b']]), "'=1+1,'+x,'-y,'@z,a-b\r\n");
  assert.equal(toTsv([['=1+1', '-y', '@z', 'a=b']]), "'=1+1\t'-y\t'@z\ta=b\n");
  assert.equal(toCsv([['\tx']]), "'\tx\r\n");
});

test('TSV flattens tabs and line breaks', () => {
  assert.equal(toTsv([['a\tb', 'c\r\nd', 'e']]), 'a b\tc  d\te\n');
});
