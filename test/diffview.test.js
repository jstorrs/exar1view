import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockName, compareStatus, diffRows, measurementPair, sequenceName } from '../src/core/diffview.js';
import { EMPTY_WORKSPACE, addFile } from '../src/core/workspace.js';

const SOURCE = { name: 'x.exar1', size: 1, lastModified: 0 };

const step = (key, kind, label) => ({
  key, kind, label, ids: { element: key, instance: key, object: key }, comment: null, tags: {}, rank: 0, problems: [],
  detail: { protocolBlob: `blob-${key}`, protocolHash: null, addInBlob: null, bodyPart: null, laterality: null, imageComment: null, openBeforeStart: null },
});

/** One file f1: region R › exam E › program P with steps m1, m2 (Measurement) and p (Pause). */
function workspace() {
  const program = {
    key: 'f1:p:1', ids: { element: '1', object: '1' }, label: 'P', comment: null, tags: {}, path: [], conditions: [],
    copyRefs: [], order: 'links', problems: [],
    body: [step('f1:s:m1', 'Measurement', 'M1'), step('f1:s:p', 'Pause', 'Wait'), step('f1:s:m2', 'Measurement', 'M2')]
      .map((s) => ({ type: 'step', step: s })),
  };
  const file = {
    id: 'f1', name: 'one.exar1', size: 1, baseline: 'b', changeset: { id: 'c', dateTime: '', comment: '' }, problems: [],
    regions: [{ key: 'f1:r:1', label: 'R', comment: null, exams: [{ key: 'f1:e:1', label: 'E', comment: null, programs: [program] }] }],
  };
  return addFile(EMPTY_WORKSPACE, file, SOURCE);
}

test('measurementPair: exactly two measurement steps, in the given order', () => {
  const ws = workspace();
  const pair = measurementPair(ws, ['f1:s:m2', 'f1:s:m1']);
  assert.ok(pair);
  assert.equal(pair.a.step.label, 'M2');
  assert.equal(pair.b.step.label, 'M1');
  assert.deepEqual(pair.a.path, ['R', 'E', 'P']);
  assert.equal(pair.a.file.name, 'one.exar1');
  assert.equal(pair.a.step.detail.protocolBlob, 'blob-f1:s:m2');
  assert.equal(measurementPair(ws, ['f1:s:m1']), null);
  assert.equal(measurementPair(ws, ['f1:s:m1', 'f1:s:m2', 'f1:s:p']), null);
  assert.equal(measurementPair(ws, ['f1:s:m1', 'f1:s:p']), null);
  assert.equal(measurementPair(ws, ['f1:s:m1', 'f1:p:1']), null);
  assert.equal(measurementPair(ws, ['f1:s:m1', 'f2:s:m2']), null);
});

test('compareStatus', () => {
  assert.equal(compareStatus(true, 0), 'Same protocol');
  assert.equal(compareStatus(false, 0), 'Same parameters, other text differs');
  assert.equal(compareStatus(false, 1), '1 parameter differs');
  assert.equal(compareStatus(false, 12), '12 parameters differ');
});

test('blockName', () => {
  assert.equal(blockName(0), 'Main');
  assert.equal(blockName(2), 'Sub-protocol 2');
});

test('sequenceName drops the quotes', () => {
  assert.equal(sequenceName([new Map([['tSequenceFileName', '"%SiemensSeq%\\tse"']])]), '%SiemensSeq%\\tse');
  assert.equal(sequenceName([new Map([['tSequenceFileName', 'raw']])]), 'raw');
  assert.equal(sequenceName([new Map()]), null);
  assert.equal(sequenceName([]), null);
});

const DIFFS = [
  { block: 0, key: 'sCoilSelectMeas.x', tier: 'churn', a: '1', b: '0' },
  { block: 0, key: 'ucMotionCorr', tier: 'other', a: null, b: '1' },
  { block: 0, key: 'alTR[0]', tier: 'key', a: '1', b: '2' },
  { block: 0, key: 'tProtocolName', tier: 'ignored', a: '"a"', b: '"b"' },
  { block: 1, key: 'lAverages', tier: 'key', a: '1', b: null },
];

const BOTH = { a: 2, b: 2 };
const val = (value) => ({ kind: 'value', value });
const DEFAULT = { kind: 'default' };

test('diffRows: by block, then tier; churn and ignored hidden and counted', () => {
  const { rows, hidden, empty } = diffRows(DIFFS, { query: '', showNoise: false, blocks: BOTH });
  assert.deepEqual(rows.map((r) => [r.block, r.key]), [['Main', 'alTR[0]'], ['Main', 'ucMotionCorr'], ['Sub-protocol 1', 'lAverages']]);
  assert.equal(hidden, 2);
  assert.equal(empty, null);
  assert.deepEqual(rows[2], { block: 'Sub-protocol 1', key: 'lAverages', tier: 'key', a: val('1'), b: DEFAULT });
});

test('diffRows: show churn/ignored', () => {
  const { rows, hidden } = diffRows(DIFFS, { query: '', showNoise: true, blocks: BOTH });
  assert.deepEqual(rows.map((r) => r.key), ['alTR[0]', 'ucMotionCorr', 'sCoilSelectMeas.x', 'tProtocolName', 'lAverages']);
  assert.equal(hidden, 0);
});

test('diffRows: the filter matches key substrings, ignoring case, and the hidden count follows it', () => {
  const opts = { showNoise: false, blocks: BOTH };
  assert.deepEqual(diffRows(DIFFS, { query: 'zzz', ...opts }).rows, []);
  const r = diffRows(DIFFS, { query: ' TR ', ...opts });
  assert.deepEqual(r.rows.map((x) => x.key), ['alTR[0]']);
  assert.equal(diffRows(DIFFS, { query: 'coil', ...opts }).hidden, 1);
  // Values do not match.
  assert.deepEqual(diffRows(DIFFS, { query: '"a"', ...opts, showNoise: true }).rows, []);
});

test('diffRows: a key missing from a block the side has is the default; a block it lacks is no-block', () => {
  const diffs = [
    { block: 0, key: 'alTR[0]', tier: 'key', a: '1', b: null },
    { block: 1, key: 'lAverages', tier: 'key', a: '2', b: null },
    { block: 2, key: 'lGain', tier: 'key', a: null, b: '3' },
  ];
  const { rows } = diffRows(diffs, { query: '', showNoise: false, blocks: { a: 3, b: 1 } });
  assert.deepEqual(rows.map((r) => [r.a, r.b]), [
    [val('1'), DEFAULT],
    [val('2'), { kind: 'no-block', block: 1 }],
    [{ kind: 'default' }, val('3')],
  ]);
  // Block 0 always exists, so a missing main-protocol key is never no-block.
  assert.deepEqual(diffRows(diffs.slice(0, 1), { query: '', showNoise: false, blocks: { a: 1, b: 1 } }).rows[0].b, DEFAULT);
});

test('diffRows: why the table is empty', () => {
  const opts = { showNoise: false, blocks: BOTH };
  assert.equal(diffRows([], { query: '', ...opts }).empty, 'No parameter differs');
  assert.equal(diffRows([], { query: 'x', ...opts }).empty, 'No parameter differs');
  assert.equal(diffRows(DIFFS, { query: 'zzz', ...opts }).empty, 'No differing parameter matches the filter');
  assert.equal(diffRows(DIFFS, { query: 'zzz', ...opts, showNoise: true }).empty, 'No differing parameter matches the filter');
  assert.equal(diffRows(DIFFS, { query: 'coil', ...opts }).empty, 'Only churn/ignored parameters match the filter');
  const noise = DIFFS.filter((d) => d.tier === 'churn' || d.tier === 'ignored');
  assert.equal(diffRows(noise, { query: '', ...opts }).empty, 'Only churn/ignored parameters differ');
  assert.equal(diffRows(noise, { query: '', ...opts, showNoise: true }).empty, null);
});
