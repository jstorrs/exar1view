// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_WORKSPACE, nextFileId, addFile, removeFile, findDuplicate, fileById, lookup, labelPath,
  programProblems, fileProblems,
} from '../src/core/workspace.js';

/** @typedef {import('../src/core/model.js').ExarFile} ExarFile */
/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/core/model.js').Program} Program */
/** @typedef {import('../src/core/model.js').Problem} Problem */

/** @param {string} key @param {string} label @param {Problem[]} [problems] @returns {Step} */
const step = (key, label, problems = []) => ({
  key, ids: { element: key, instance: key, object: key }, label, comment: null, tags: {}, rank: null, problems,
  kind: 'Measurement',
  detail: { protocolBlob: null, protocolHash: null, addInBlob: null, bodyPart: null, laterality: null, imageComment: null, openBeforeStart: null },
});

/** @param {string} key @param {string} label @param {Step[]} steps @param {Problem[]} [problems] @returns {Program} */
const program = (key, label, steps, problems = []) => ({
  key, ids: { element: key, object: key }, label, comment: null, tags: {}, path: [],
  body: steps.map((s) => ({ type: 'step', step: s })), conditions: [], copyRefs: [], order: 'links', problems,
});

/** @param {string} id @returns {ExarFile} */
const file = (id) => ({
  id, name: `${id}.exar1`, size: 10, baseline: 'b', changeset: { id: 'c', dateTime: '', comment: '' },
  problems: [{ level: 'warning', where: 'directory 7', message: 'odd' }],
  regions: [{ key: `${id}:r:1`, label: 'Brain', comment: null, exams: [
    { key: `${id}:e:1`, label: 'Routine', comment: null, programs: [
      program(`${id}:p:1`, 'Head', [
        step(`${id}:s:1`, 'localizer'),
        step(`${id}:s:2`, 'MPRAGE', [{ level: 'error', where: `${id}:s:2`, message: 'no protocol' }]),
      ], [{ level: 'warning', where: `${id}:p:1`, message: 'unordered' }]),
    ] },
  ] }],
});

const src = (/** @type {string} */ name, size = 10, lastModified = 1) => ({ name, size, lastModified });

test('ids are issued in order and never reused after a close', () => {
  let ws = EMPTY_WORKSPACE;
  assert.equal(nextFileId(ws), 'f1');
  ws = addFile(ws, file('f1'), src('a'));
  assert.equal(nextFileId(ws), 'f2');
  ws = addFile(ws, file('f2'), src('b'));
  ws = removeFile(ws, 'f2');
  assert.deepEqual(ws.files.map((f) => f.id), ['f1']);
  assert.equal(nextFileId(ws), 'f3');
  ws = removeFile(ws, 'f1');
  assert.equal(ws.files.length, 0);
  assert.equal(nextFileId(ws), 'f3');
});

test('addFile / removeFile return new workspaces and leave the input alone', () => {
  const a = addFile(EMPTY_WORKSPACE, file('f1'), src('a'));
  assert.equal(EMPTY_WORKSPACE.files.length, 0);
  assert.equal(addFile(a, file('f1'), src('again')), a, 'an id already open is not added twice');
  assert.equal(removeFile(a, 'f9'), a);
  const b = addFile(a, file('f2'), src('b'));
  assert.equal(removeFile(b, 'f1').sources.has('f1'), false);
  assert.equal(b.sources.get('f2')?.name, 'b');
  assert.equal(fileById(b, 'f2')?.id, 'f2');
  assert.equal(fileById(b, null), null);
});

test('findDuplicate matches name, size and lastModified', () => {
  const ws = addFile(EMPTY_WORKSPACE, file('f1'), src('a.exar1', 10, 5));
  assert.equal(findDuplicate(ws, src('a.exar1', 10, 5))?.id, 'f1');
  assert.equal(findDuplicate(ws, src('a.exar1', 11, 5)), null);
  assert.equal(findDuplicate(ws, src('a.exar1', 10, 6)), null);
  assert.equal(findDuplicate(ws, src('b.exar1', 10, 5)), null);
  assert.equal(findDuplicate(removeFile(ws, 'f1'), src('a.exar1', 10, 5)), null);
});

test('lookup finds every level with its ancestors, by the key prefix', () => {
  const ws = addFile(addFile(EMPTY_WORKSPACE, file('f1'), src('a')), file('f2'), src('b'));
  const f = lookup(ws, 'f2');
  assert.equal(f?.level, 'file');
  assert.equal(f?.node.id, 'f2');
  const s = lookup(ws, 'f2:s:2');
  assert.ok(s && s.level === 'step');
  assert.equal(s.node.label, 'MPRAGE');
  assert.deepEqual(s.ancestors.map((a) => ('label' in a ? a.label : a.id)), ['f2', 'Brain', 'Routine', 'Head']);
  assert.deepEqual(labelPath(s), ['Brain', 'Routine', 'Head', 'MPRAGE']);
  assert.equal(lookup(ws, 'f1:e:1')?.level, 'exam');
  assert.equal(lookup(ws, 'f3:r:1'), undefined);
  assert.equal(lookup(ws, 'f1:r:nope'), undefined);
  assert.equal(lookup(removeFile(ws, 'f2'), 'f2:s:2'), undefined);
});

test('problems: a program carries its steps\'; a file lists all with paths for node keys', () => {
  const ws = addFile(EMPTY_WORKSPACE, file('f1'), src('a'));
  const p = /** @type {Program} */ (lookup(ws, 'f1:p:1')?.node);
  assert.deepEqual(programProblems(p).map((x) => x.message), ['unordered', 'no protocol']);
  assert.deepEqual(fileProblems(ws, ws.files[0]), [
    { level: 'warning', where: 'directory 7', message: 'odd' },
    { level: 'warning', where: 'Brain › Routine › Head', message: 'unordered' },
    { level: 'error', where: 'Brain › Routine › Head › MPRAGE', message: 'no protocol' },
  ]);
});
