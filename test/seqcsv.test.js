// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportRows, upgradeRows, toCsv, toTsv } from '../src/core/seqcsv.js';

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
});

test('a plain number is not guarded; anything else formula-like still is', () => {
  assert.equal(toCsv([['-10', '+2.5', '-0.5']]), '-10,+2.5,-0.5\r\n');
  assert.equal(toTsv([['-10', '+2.5']]), '-10\t+2.5\n');
  assert.equal(toCsv([['-2+3', '-1e5', '-10 ms', '=1']]), "'-2+3,'-1e5,'-10 ms,'=1\r\n");
  assert.equal(toCsv([['\tx']]), "'\tx\r\n");
});

test('TSV flattens tabs and line breaks', () => {
  assert.equal(toTsv([['a\tb', 'c\r\nd', 'e']]), 'a b\tc  d\te\n');
});

/** @typedef {import('../src/core/upgradereport.js').UpgradeReport} UpgradeReport */

/** @param {string} step @param {string | null} sequence */
const noteUse = (step, sequence) => ({ ...use(step), sequence });

/** @param {import('../src/core/upgradereport.js').StepNotes[]} byStep @param {UpgradeReport['gaps']} [gaps] @returns {UpgradeReport} */
const upgrade = (byStep, gaps = []) => ({ byChange: [], byStep, gaps, files: 1, steps: byStep.length, programs: 1 });

const UP_HEADER = ['Category', 'Parameter', 'From', 'To', 'Unit', 'Text', 'Converted', 'File', 'Region', 'Exam', 'Program', 'Step', 'Sequence'];

test('upgrade rows: header, then conversions and changes in order', () => {
  const rows = upgradeRows(upgrade([{
    use: noteUse('s1', 'seq1'),
    conversions: [
      { date: '2020-01-02', changes: [{ parameter: 'tA', from: '1', to: '2', unit: 'ms', text: 'ignored' }, { parameter: 'tB', from: 'x', to: 'y', unit: '', text: '' }] },
      { date: null, changes: [{ parameter: 'tC', from: '3', to: '4', unit: 'mm', text: '' }] },
    ],
  }]));
  assert.deepEqual(rows[0], UP_HEADER);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1], ['Change', 'tA', '1', '2', 'ms', '', '2020-01-02', 'a.exar1', 'R', 'E', 'P', 's1', 'seq1']);
  assert.deepEqual(rows[2].slice(0, 2), ['Change', 'tB']);
  assert.deepEqual(rows[3], ['Change', 'tC', '3', '4', 'mm', '', '', 'a.exar1', 'R', 'E', 'P', 's1', 'seq1']);
});

test('upgrade rows: text line, no-changes and gap rows', () => {
  const rows = upgradeRows(upgrade(
    [{ use: noteUse('s1', null), conversions: [{ date: '2021-05-06', changes: [{ parameter: null, text: 'free text' }] }, { date: null, changes: [] }] }],
    [{ reason: 'unreadable', error: 'bad zip', use: use('s2') }, { reason: 'no-protocol', error: null, use: use('s3') }],
  ));
  assert.deepEqual(rows[1], ['Note text', '', '', '', '', 'free text', '2021-05-06', 'a.exar1', 'R', 'E', 'P', 's1', '']);
  assert.deepEqual(rows[2], ['No changes listed', '', '', '', '', '', '', 'a.exar1', 'R', 'E', 'P', 's1', '']);
  assert.deepEqual(rows[3], ['Not checked', '', '', '', '', 'Could not be read: bad zip', '', 'a.exar1', 'R', 'E', 'P', 's2', '']);
  assert.deepEqual(rows[4].slice(0, 6), ['Not checked', '', '', '', '', 'No protocol']);
});

test('upgrade rows: a negative from value is unguarded in CSV; multi-line text stays one quoted field', () => {
  const rows = upgradeRows(upgrade([{
    use: noteUse('s1', null),
    conversions: [{ date: null, changes: [{ parameter: 'tA', from: '-10', to: '5', unit: '', text: '' }, { parameter: null, text: 'line1\nline2' }] }],
  }]));
  const csv = toCsv(rows).split('\r\n');
  assert.ok(csv[1].startsWith('Change,tA,-10,5,'));
  assert.ok(toCsv(rows).includes('"line1\nline2"'));
});
