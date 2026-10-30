// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_WORKSPACE, addFile } from '../src/core/workspace.js';
import { buildReport } from '../src/core/seqreport.js';
import { NO_KEYS, NO_MARKS, markedKeys, sameMarks, upgradeKeys } from '../src/core/seqmarks.js';

/** @typedef {import('../src/core/model.js').ExarFile} ExarFile */
/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/core/model.js').Program} Program */
/** @typedef {import('../src/core/seqrefs.js').ProtocolRefs} ProtocolRefs */

/** @param {string} key @param {string} blob @returns {Step} */
const step = (key, blob) => ({
  key, ids: { element: key, instance: key, object: key }, label: key, comment: null, tags: {}, rank: null, problems: [],
  kind: 'Measurement',
  detail: { protocolBlob: blob, protocolHash: null, addInBlob: null, bodyPart: null, laterality: null, imageComment: null, openBeforeStart: null },
});
/** @param {string} key @param {Step[]} steps @returns {Program} */
const program = (key, steps) => ({
  key, ids: { element: key, object: key }, label: key, comment: null, tags: {}, path: [],
  body: steps.map((s) => ({ type: 'step', step: s })), conditions: [], copyRefs: [], order: 'links', problems: [],
});

const user = { key: 'f1:t:1', label: 'USER' };
/** @type {ExarFile} */
const file = {
  id: 'f1', name: 'f1.exar1', size: 0, baseline: '', changeset: { id: '', dateTime: '', comment: '' }, problems: [],
  regions: [
    { key: 'f1:r:1', label: 'Brain', comment: null, tree: user, exams: [
      { key: 'f1:e:1', label: 'Routine', comment: null, programs: [
        program('f1:p:1', [step('f1:s:1', 'cust'), step('f1:s:2', 'std')]),
        program('f1:p:2', [step('f1:s:3', 'std')]),
      ] },
    ] },
    { key: 'f1:r:2', label: 'Spine', comment: null, tree: null, exams: [
      { key: 'f1:e:2', label: 'Full', comment: null, programs: [program('f1:p:3', [step('f1:s:4', 'local')])] },
      { key: 'f1:e:3', label: 'Other', comment: null, programs: [program('f1:p:4', [step('f1:s:5', 'svc')])] },
    ] },
  ],
};
const ws = addFile(EMPTY_WORKSPACE, file, { name: 'x', size: 0, lastModified: 0 });

/** @param {string} value @param {string | null} placeholder @returns {ProtocolRefs} */
const seq = (value, placeholder) => ({ ok: true, refs: [{ key: 'tSequenceFileName', value, placeholder }] });
const scans = new Map([['f1', new Map([
  ['cust', seq('%CustomerSeq%\\a', 'CustomerSeq')],
  ['std', seq('%SiemensSeq%\\b', 'SiemensSeq')],
  ['local', seq('C:\\local\\seq', null)],
  ['svc', seq('%ServiceSeq%\\c', 'ServiceSeq')],
])]]);

test('customer and unrecognised uses mark their steps, programs and every container above', () => {
  const marks = markedKeys(ws, buildReport([file], scans));
  assert.deepEqual([...marks].sort(), [
    'f1:e:1', 'f1:e:2', 'f1:p:1', 'f1:p:3', 'f1:r:1', 'f1:r:2', 'f1:s:1', 'f1:s:4', 'f1:t:1',
  ]);
});

test('nothing is marked before a scan, or for steps not read yet', () => {
  assert.equal(markedKeys(ws, buildReport([file], new Map())).size, 0);
  const partial = new Map([['f1', new Map([['local', seq('C:\\local\\seq', null)]])]]);
  assert.deepEqual([...markedKeys(ws, buildReport([file], partial))].sort(), ['f1:e:2', 'f1:p:3', 'f1:r:2', 'f1:s:4']);
});

test('upgrade notes mark their steps, programs and every container above', () => {
  assert.deepEqual([...upgradeKeys(file, new Set(['std']))].sort(), ['f1:e:1', 'f1:p:1', 'f1:p:2', 'f1:r:1', 'f1:s:2', 'f1:s:3', 'f1:t:1']);
  assert.deepEqual([...upgradeKeys(file, new Set(['local']))].sort(), ['f1:e:2', 'f1:p:3', 'f1:r:2', 'f1:s:4']);
  assert.equal(upgradeKeys(file, new Set()).size, 0);
});

test('sameMarks compares the records field by field, not by identity', () => {
  const custom = new Set(['f1:s:1']);
  assert.ok(sameMarks(NO_MARKS, { custom: NO_KEYS, upgrade: NO_KEYS }));
  assert.ok(sameMarks({ custom, upgrade: NO_KEYS }, { custom, upgrade: NO_KEYS }));
  assert.ok(!sameMarks({ custom, upgrade: NO_KEYS }, { custom: NO_KEYS, upgrade: custom }));
  assert.ok(!sameMarks({ custom, upgrade: NO_KEYS }, { custom: new Set(custom), upgrade: NO_KEYS }));
});
