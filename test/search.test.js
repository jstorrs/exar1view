// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterFile } from '../src/core/search.js';

/** @typedef {import('../src/core/model.js').ExarFile} ExarFile */
/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/core/model.js').Program} Program */
/** @typedef {import('../src/core/model.js').BodyNode} BodyNode */

/** @param {string} key @param {string} label @param {Step['kind']} [kind] @returns {Step} */
const step = (key, label, kind = 'Measurement') => /** @type {Step} */ ({
  key, ids: { element: key, instance: key, object: key }, label, comment: null, tags: {}, rank: null, problems: [],
  kind, detail: { conditionId: null },
});
/** @param {Step} s @returns {BodyNode} */
const node = (s) => ({ type: 'step', step: s });
/** @param {string} key @param {string} label @param {BodyNode[]} body @returns {Program} */
const program = (key, label, body) => ({
  key, ids: { element: key, object: key }, label, comment: null, tags: {}, path: [], body,
  conditions: [], copyRefs: [], order: 'links', problems: [],
});
const choice = { objectId: 'c', label: 'c' };
const condition = { id: 'c', kind: /** @type {const} */ ('Strategy'), label: 'c', description: null, choices: [choice], defaultChoice: null };

/** @param {string[]} keys */
const sorted = (keys) => [...keys].sort();

/** @type {ExarFile} */
const file = {
  id: 'f1', name: 't.exar1', size: 0, baseline: '', changeset: { id: '', dateTime: '', comment: '' }, problems: [],
  regions: [
    { key: 'r1', label: 'Brain', comment: null, exams: [
      { key: 'e1', label: 'Routine', comment: null, programs: [
        program('p1', 'Head', [node(step('s1', 'localizer')), node(step('s2', 'MPRAGE'))]),
        program('p2', 'Neck', [node(step('s3', 'tse'))]),
      ] },
      { key: 'e2', label: 'Research', comment: null, programs: [program('p3', 'Other', [])] },
    ] },
    { key: 'r2', label: 'Spine', comment: null, exams: [
      { key: 'e3', label: 'Full', comment: null, programs: [
        program('p4', 'Sag', [node(step('s4', 'T2')), {
          type: 'fork', split: step('s5', 'Split', 'Split'), join: step('s6', 'Join', 'Join'), condition,
          branches: [{ choice, isDefault: true, body: [node(step('s7', 'T2 fs')), node(step('s8', 'mprage fast'))] }],
        }]),
      ] },
    ] },
  ],
};

test('only the empty query means no filter', () => {
  assert.equal(filterFile(file, ''), null);
  const f = filterFile(file, '   ');
  assert.ok(f);
  assert.equal(f.matches.size, 0);
});

test('step match shows its program and ancestors, expands them and counts on the program', () => {
  const f = filterFile(file, 'mpr');
  assert.ok(f);
  assert.deepEqual(sorted(f.matches), ['s2', 's8']);
  assert.deepEqual(sorted(f.visible), ['e1', 'e3', 'p1', 'p4', 'r1', 'r2']);
  assert.deepEqual(sorted(f.expand), ['e1', 'e3', 'p1', 'p4', 'r1', 'r2']);
  assert.deepEqual([...f.stepHits], [['p1', 1], ['p4', 1]]);
});

test('steps inside fork branches are searched and counted', () => {
  const f = filterFile(file, 't2');
  assert.ok(f);
  assert.deepEqual(sorted(f.matches), ['s4', 's7']);
  assert.deepEqual([...f.stepHits], [['p4', 2]]);
});

test('container match shows its contents but only expands ancestors', () => {
  const f = filterFile(file, 'routine');
  assert.ok(f);
  assert.deepEqual([...f.matches], ['e1']);
  assert.deepEqual(sorted(f.visible), ['e1', 'p1', 'p2', 'r1']);
  assert.deepEqual([...f.expand], ['r1']);
  assert.equal(f.stepHits.size, 0);
});

test('region match shows whole subtree', () => {
  const f = filterFile(file, 'spine');
  assert.ok(f);
  assert.deepEqual(sorted(f.visible), ['e3', 'p4', 'r2']);
});

test('no hits gives an empty filter, not null', () => {
  const f = filterFile(file, 'zzz');
  assert.ok(f);
  assert.equal(f.visible.size, 0);
});

test('program-label match: ancestors expand, the program itself does not', () => {
  const f = filterFile(file, 'sag');
  assert.ok(f);
  assert.deepEqual([...f.matches], ['p4']);
  assert.deepEqual(sorted(f.visible), ['e3', 'p4', 'r2']);
  assert.deepEqual(sorted(f.expand), ['e3', 'r2']);
});

/** Labels differing only in whitespace. @type {ExarFile} */
const wsFile = {
  ...file,
  regions: [{ key: 'wr', label: 'R', comment: null, exams: [{ key: 'we', label: 'E', comment: null, programs: [
    program('wp1', 'COR VIBE BH', [node(step('w1', 'AX T2 '))]),
    program('wp2', 'COR VIBE  BH', [node(step('w2', 'AX T2'))]),
  ] }] }],
};

test('whitespace inside the query is significant', () => {
  const dbl = filterFile(wsFile, 'vibe  bh');
  assert.ok(dbl);
  assert.deepEqual([...dbl.matches], ['wp2']);
  const sgl = filterFile(wsFile, 'vibe bh');
  assert.ok(sgl);
  assert.deepEqual([...sgl.matches], ['wp1']);
});

test('trailing whitespace in the query is not trimmed', () => {
  const f = filterFile(wsFile, 't2 ');
  assert.ok(f);
  assert.deepEqual([...f.matches], ['w1']);
});
