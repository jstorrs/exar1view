// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpgradeReport } from '../src/core/upgradereport.js';

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

const seq = (/** @type {string} */ value) => ({ key: 'tSequenceFileName', value, placeholder: null });
/** @param {...import('../src/core/seqrefs.js').Reference} refs @returns {ProtocolRefs} */
const ok = (...refs) => ({ ok: true, refs });
const H = (/** @type {string} */ d) => `Protocol was converted on ${d} :`;

/** @param {Record<string, { refs?: Record<string, ProtocolRefs>, upgrades?: Record<string, string> }>} o */
const scans = (o) => new Map(Object.entries(o).map(([id, s]) => [id, {
  refs: new Map(Object.entries(s.refs ?? {})), upgrades: new Map(Object.entries(s.upgrades ?? {})),
}]));

const TE = 'TE: 11 --> 12 ms';
const NOTE = `${H('1/2/2010')}\n${TE}`;

test('a shared blob lists each step; sequence comes from the refs', () => {
  const f = file('f1', [program('f1:p:1', [node(step('f1:s:1', 'b1')), node(step('f1:s:2', 'b1'))])]);
  const r = buildUpgradeReport([f], scans({ f1: { refs: { b1: ok(seq('a\\b')) }, upgrades: { b1: NOTE } } }));
  assert.equal(r.byStep.length, 2);
  assert.equal(r.byStep[0].use.sequence, 'a\\b');
  assert.equal(r.byChange.length, 1);
  assert.deepEqual(r.byChange[0].uses.map((u) => u.use.stepKey), ['f1:s:1', 'f1:s:2']);
  assert.equal(r.byChange[0].programs, 1);
  assert.deepEqual(r.gaps, []);
});

test('sequence is null when the protocol names none, and that is not a gap', () => {
  const f = file('f1', [program('f1:p:1', [node(step('f1:s:1', 'b1'))])]);
  const r = buildUpgradeReport([f], scans({ f1: { refs: { b1: ok() }, upgrades: { b1: NOTE } } }));
  assert.equal(r.byStep[0].use.sequence, null);
  assert.deepEqual(r.gaps, []);
});

test('the same change in two files with different dates is one entry with each step\'s dates', () => {
  const files = [
    file('f1', [program('f1:p:1', [node(step('f1:s:1', 'b1'))])]),
    file('f2', [program('f2:p:1', [node(step('f2:s:1', 'b2'))])]),
  ];
  const r = buildUpgradeReport(files, scans({
    f1: { refs: { b1: ok() }, upgrades: { b1: `${H('1/2/2010')}\n${TE}\n${H('3/4/2012')}\n${TE}` } },
    f2: { refs: { b2: ok() }, upgrades: { b2: `${H('5/6/2014')}\n${TE}` } },
  }));
  assert.equal(r.byChange.length, 1);
  assert.deepEqual(r.byChange[0].uses.map((u) => [u.use.fileId, u.dates]), [['f1', ['1/2/2010', '3/4/2012']], ['f2', ['5/6/2014']]]);
  assert.equal(r.byChange[0].programs, 2);
  assert.equal(r.programs, 2);
  assert.equal(r.files, 2);
});

test('changes sort by parameter ignoring case, then text; text lines last', () => {
  const f = file('f1', [program('f1:p:1', [node(step('f1:s:1', 'b1'))])]);
  const note = `${H('1/2/2010')}\nzeta text\nTE: 2 --> 3 ms\nalpha text\nbeta: 1 --> 2\nTE: 1 --> 2 ms`;
  const r = buildUpgradeReport([f], scans({ f1: { refs: { b1: ok() }, upgrades: { b1: note } } }));
  assert.deepEqual(r.byChange.map((e) => e.change.text), ['beta: 1 --> 2', 'TE: 1 --> 2 ms', 'TE: 2 --> 3 ms', 'alpha text', 'zeta text']);
});

test('gaps: no protocol, not read, unreadable (even with a note); none appear in the entries', () => {
  const f = file('f1', [program('f1:p:1', [
    node(step('f1:s:1', null)), node(step('f1:s:2', 'b2')), node(step('f1:s:3', 'b3')),
  ])]);
  const r = buildUpgradeReport([f], scans({ f1: { refs: { b3: { ok: false, error: 'bad' } }, upgrades: { b2: NOTE, b3: NOTE } } }));
  assert.deepEqual(r.gaps.map((g) => [g.reason, g.error, g.use.stepKey]), [
    ['no-protocol', null, 'f1:s:1'], ['not-read', null, 'f1:s:2'], ['unreadable', 'bad', 'f1:s:3'],
  ]);
  assert.equal(r.byStep.length, 0);
  assert.equal(r.byChange.length, 0);
  assert.equal(r.steps, 3);
});

test('a read protocol without notes appears nowhere; non-measurement steps are skipped', () => {
  const f = file('f1', [program('f1:p:1', [node(step('f1:s:1', 'b1')), node(pause('f1:s:2'))])]);
  const r = buildUpgradeReport([f], scans({ f1: { refs: { b1: ok(seq('x')) } } }));
  assert.deepEqual([r.byStep, r.byChange, r.gaps], [[], [], []]);
  assert.equal(r.steps, 1);
  assert.equal(r.programs, 0);
});

test('a header-only note is in byStep with empty changes and not in byChange', () => {
  const f = file('f1', [program('f1:p:1', [node(step('f1:s:1', 'b1'))])]);
  const r = buildUpgradeReport([f], scans({ f1: { refs: { b1: ok() }, upgrades: { b1: H('1/2/2010') } } }));
  assert.equal(r.byStep.length, 1);
  assert.deepEqual(r.byStep[0].conversions, [{ date: '1/2/2010', changes: [] }]);
  assert.deepEqual(r.byChange, []);
});

test('a region with a tree puts its tree first in the path', () => {
  const f = file('f1', [program('f1:p:1', [node(step('f1:s:1', 'b1'))])]);
  f.regions[0].tree = { key: 'f1:t:1', label: 'USER' };
  const r = buildUpgradeReport([f], scans({ f1: { refs: { b1: ok() }, upgrades: { b1: NOTE } } }));
  assert.deepEqual(r.byStep[0].use.path.slice(0, 2), ['USER › Brain', 'Routine']);
});
