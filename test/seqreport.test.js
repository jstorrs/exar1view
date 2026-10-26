// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/core/seqreport.js';

/** @typedef {import('../src/core/model.js').ExarFile} ExarFile */
/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/core/model.js').BodyNode} BodyNode */
/** @typedef {import('../src/core/seqrefs.js').ProtocolRefs} ProtocolRefs */

/** @param {string} key @param {string | null} blob @returns {Step} */
const step = (key, blob) => ({
  key, ids: { element: key, instance: key, object: key }, label: `step ${key}`, comment: null, tags: {}, rank: null, problems: [],
  kind: 'Measurement',
  detail: { protocolBlob: blob, protocolHash: null, addInBlob: null, bodyPart: null, laterality: null, imageComment: null, openBeforeStart: null },
});

/** @param {string} key @returns {Step} */
const pause = (key) => /** @type {Step} */ (/** @type {unknown} */ ({
  ...step(key, null), kind: 'Pause', detail: { applyContrastAgent: null, contrastAgentName: null, contrastAgent: null },
}));

/** @param {string} key @param {BodyNode[]} body @returns {import('../src/core/model.js').Program} */
const program = (key, body) => ({
  key, ids: { element: key, object: key }, label: `prog ${key}`, comment: null, tags: {}, path: [],
  body, conditions: [], copyRefs: [], order: 'links', problems: [],
});

/** @param {Step} s @returns {BodyNode} */
const node = (s) => ({ type: 'step', step: s });

/** @param {string} id @param {import('../src/core/model.js').Program[]} programs @returns {ExarFile} */
const file = (id, programs) => /** @type {ExarFile} */ (/** @type {unknown} */ ({
  id, name: `${id}.exar1`,
  regions: [{ key: `${id}:r`, label: 'Brain', comment: null, exams: [{ key: `${id}:e`, label: 'Routine', comment: null, programs }] }],
}));

/** @param {string} key @param {string} value @param {string | null} placeholder @returns {import('../src/core/seqrefs.js').Reference} */
const ref = (key, value, placeholder) => ({ key, value, placeholder });
const seq = (/** @type {string} */ value, /** @type {string | null} */ ph) => ref('tSequenceFileName', value, ph);
/** @param {...import('../src/core/seqrefs.js').Reference} refs @returns {ProtocolRefs} */
const ok = (...refs) => ({ ok: true, refs });

/** @param {Record<string, Record<string, ProtocolRefs>>} o */
const scans = (o) => new Map(Object.entries(o).map(([id, m]) => [id, new Map(Object.entries(m))]));

const CUSTOMER = seq('%CustomerSeq%\\a', 'CustomerSeq');

test('one reference shared by two programs in two files is one entry, uses in tree order', () => {
  const files = [
    file('f1', [program('f1:p:1', [node(step('f1:s:1', 'b1'))])]),
    file('f2', [program('f2:p:1', [node(step('f2:s:1', 'b2')), node(step('f2:s:2', 'b2'))])]),
  ];
  const r = buildReport(files, scans({ f1: { b1: ok(CUSTOMER) }, f2: { b2: ok(CUSTOMER) } }));
  assert.equal(r.byReference.length, 1);
  const [entry] = r.byReference[0].entries;
  assert.equal(r.byReference[0].category, 'customer');
  assert.equal(entry.programs, 2);
  assert.deepEqual(entry.uses.map((u) => u.stepKey), ['f1:s:1', 'f2:s:1', 'f2:s:2']);
  assert.deepEqual(entry.uses[0].path, ['Brain', 'Routine', 'prog f1:p:1', 'step f1:s:1']);
  assert.equal(entry.uses[0].fileName, 'f1.exar1');
  assert.deepEqual(r.byProgram.map((p) => p.programKey), ['f1:p:1', 'f2:p:1']);
  assert.deepEqual(r.byProgram[1].refs[0].uses.length, 2);
});

test('a standard reference is grouped but absent from byProgram; no-sequence gap otherwise', () => {
  const siemens = seq('%SiemensSeq%\\x', 'SiemensSeq');
  const r = buildReport([file('f1', [program('p', [node(step('s', 'b'))])])], scans({ f1: { b: ok(siemens) } }));
  assert.deepEqual(r.byReference.map((g) => g.category), ['standard']);
  assert.deepEqual(r.byProgram, []);
  const other = buildReport([file('f1', [program('p', [node(step('s', 'b'))])])], scans({ f1: { b: ok(ref('sWipMemBlock.x', '%CustomerSeq%\\q', 'CustomerSeq')) } }));
  assert.deepEqual(other.gaps.map((g) => g.reason), ['no-sequence']);
  assert.equal(other.byReference[0].entries.length, 1, 'other refs of a no-sequence step still count');
});

test('each gap reason, with the error only for unreadable', () => {
  const files = [
    file('f1', [program('p1', [node(step('s1', null)), node(step('s2', 'missing')), node(step('s3', 'bad')), node(step('s4', 'empty'))])]),
    file('f2', [program('p2', [node(step('s5', 'b'))])]),
  ];
  const r = buildReport(files, scans({ f1: { bad: { ok: false, error: 'boom' }, empty: ok() } }));
  assert.deepEqual(r.gaps.map((g) => [g.reason, g.error, g.use.stepKey]), [
    ['no-protocol', null, 's1'], ['not-read', null, 's2'], ['unreadable', 'boom', 's3'], ['no-sequence', null, 's4'], ['not-read', null, 's5'],
  ]);
  assert.equal(r.protocols, 1);
  assert.equal(r.steps, 5);
});

test('groups follow category order and empty groups are omitted', () => {
  const r = buildReport([file('f1', [program('p', [node(step('s', 'b'))])])], scans({ f1: { b: ok(
    seq('%SiemensSeq%\\x', 'SiemensSeq'), seq('%ServiceSeq%\\y', 'ServiceSeq'), seq('%CustomerSeq%\\z', 'CustomerSeq'),
  ) } }));
  assert.deepEqual(r.byReference.map((g) => g.category), ['customer', 'service', 'standard']);
});

test('byProgram lists only customer and other refs, customer first, with this program uses', () => {
  const noPh = seq('C:\\local\\seq', null);
  const files = [file('f1', [
    program('p1', [node(step('s1', 'b')), node(step('s2', 'c'))]),
    program('p2', [node(step('s3', 'c'))]),
  ])];
  const r = buildReport(files, scans({ f1: { b: ok(noPh, CUSTOMER, seq('%SiemensSeq%\\x', 'SiemensSeq')), c: ok(CUSTOMER) } }));
  assert.deepEqual(r.byProgram.map((p) => [p.programKey, p.path, p.refs.map((e) => e.category)]), [
    ['p1', ['Brain', 'Routine', 'prog p1'], ['customer', 'other']],
    ['p2', ['Brain', 'Routine', 'prog p2'], ['customer']],
  ]);
  assert.equal(r.byProgram[0].refs[0].uses.length, 2);
  assert.equal(r.byProgram[1].refs[0].uses.length, 1);
  assert.equal(r.byReference[0].entries[0].programs, 2);
});

test('entries sort case-insensitively with a stable tie-break on value then key', () => {
  const r = buildReport([file('f1', [program('p', [node(step('s', 'b'))])])], scans({ f1: { b: ok(
    seq('%CustomerSeq%\\b', 'CustomerSeq'), seq('%CustomerSeq%\\B', 'CustomerSeq'), seq('%CustomerSeq%\\A', 'CustomerSeq'),
    ref('z', '%CustomerSeq%\\b', 'CustomerSeq'),
  ) } }));
  assert.deepEqual(r.byReference[0].entries.map((e) => [e.ref.value, e.ref.key]), [
    ['%CustomerSeq%\\A', 'tSequenceFileName'], ['%CustomerSeq%\\B', 'tSequenceFileName'],
    ['%CustomerSeq%\\b', 'tSequenceFileName'], ['%CustomerSeq%\\b', 'z'],
  ]);
});

test('branch steps are counted, other step kinds are not, and totals add up', () => {
  const fork = /** @type {BodyNode} */ (/** @type {unknown} */ ({
    type: 'fork', split: pause('sp'), join: pause('jn'), condition: {},
    branches: [{ choice: {}, isDefault: true, body: [node(step('in', 'b'))] }],
  }));
  const files = [file('f1', [program('p', [node(step('s', 'b')), fork])]), file('f2', [])];
  const r = buildReport(files, scans({ f1: { b: ok(CUSTOMER) } }));
  assert.deepEqual(r.byReference[0].entries[0].uses.map((u) => u.stepKey), ['s', 'in']);
  assert.deepEqual([r.files, r.protocols, r.steps, r.gaps.length], [2, 1, 2, 0]);
});
