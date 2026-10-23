// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stepFacts, stepTags, contrastNote, copyRefIndex, stepCopyRefs, copyRefLine,
} from '../src/core/stepinfo.js';

/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/core/model.js').Program} Program */

/** @param {Step['kind']} kind @param {string} name @param {object} detail @param {Partial<Step>} [more] @returns {Step} */
const step = (kind, name, detail, more = {}) => /** @type {Step} */ ({
  key: `s:${name}`, ids: { element: name, instance: name, object: `o:${name}` }, label: name, comment: null,
  tags: {}, rank: 1, problems: [], kind, detail, ...more,
});
const MEAS = { protocolBlob: null, protocolHash: null, addInBlob: 'b', bodyPart: 'KNEE', laterality: null, imageComment: '', openBeforeStart: false };
const condition = {
  id: 'c1', kind: /** @type {const} */ ('Decision'), label: 'Contrast?', description: null,
  choices: [{ objectId: 'y', label: 'Yes' }, { objectId: 'n', label: 'No' }], defaultChoice: 'n',
};
/** @param {Step[]} steps @param {Partial<Program>} [more] @returns {Program} */
const program = (steps, more = {}) => ({
  key: 'p', ids: { element: 'p', object: 'p' }, label: 'P', comment: null, tags: {}, path: [],
  body: steps.map((s) => ({ type: 'step', step: s })), conditions: [condition], copyRefs: [], order: 'links', problems: [], ...more,
});

/** @param {import('../src/core/stepinfo.js').Fact[]} facts */
const asObject = (facts) => Object.fromEntries(facts.map((f) => [f.label, f.value]));

test('measurement facts: common fields, then body part, laterality, image comment, open before start, add-in', () => {
  const s = step('Measurement', 'pd', MEAS, { comment: 'note' });
  assert.deepEqual(asObject(stepFacts(s, program([s]))), {
    Kind: 'Measurement', Label: 'pd', Comment: 'note', Rank: '1', 'Body part': 'KNEE', Laterality: null,
    'Image comment': '', 'Open before start': 'no', 'Add-in': 'present',
  });
});

test('pause facts pretty-print the contrast agent JSON; contrastNote only when it is applied', () => {
  const s = step('Pause', 'inj', { applyContrastAgent: true, contrastAgentName: 'Gd', contrastAgent: '{"a":1}' });
  const f = asObject(stepFacts(s, program([s])));
  assert.equal(f['Apply contrast agent'], 'yes');
  assert.equal(f['Contrast agent'], '{\n  "a": 1\n}');
  assert.equal(contrastNote(s), 'Gd');
  assert.equal(contrastNote(step('Pause', 'x', { applyContrastAgent: true, contrastAgentName: '', contrastAgent: null })), 'contrast agent');
  assert.equal(contrastNote(step('Pause', 'x', { applyContrastAgent: false, contrastAgentName: 'Gd', contrastAgent: null })), null);
  assert.equal(contrastNote(step('Measurement', 'm', MEAS)), null);
});

test('decision, split and join facts name the condition and its choices, default marked', () => {
  const d = step('Decision', 'ask', { conditionId: 'c1', addInBlob: null, openBeforeStart: true });
  const f = asObject(stepFacts(d, program([d])));
  assert.equal(f.Condition, 'Decision: Contrast?');
  assert.equal(f.Choices, 'Yes, No (default)');
  assert.equal(f['Add-in'], 'none');
  const j = step('Join', 'j', { conditionId: 'gone' });
  assert.equal(asObject(stepFacts(j, program([j]))).Condition, 'gone (missing)');
  const s = step('Split', 's', { conditionId: null });
  assert.equal(asObject(stepFacts(s, program([s]))).Condition, null);
});

test('tags in file order', () => {
  assert.deepEqual(stepTags(step('Workflow', 'w', { addInBlob: null }, { tags: { b: '2', a: '1' } })), [['b', '2'], ['a', '1']]);
});

test('copy references: outgoing then incoming, other end resolved, set flags in words', () => {
  const a = step('Measurement', 'a', MEAS);
  const b = step('Measurement', 'b', MEAS);
  const p = program([a, b], {
    copyRefs: [
      { source: 'o:a', target: 'o:b', group: 'Slices', broken: false, flags: { CopyPhaseEncodingDirection: true, CopySteps: false } },
      { source: 'o:b', target: 'o:a', group: 'All', broken: true, flags: {} },
    ],
  });
  const index = copyRefIndex(p);
  const refs = stepCopyRefs(a, index);
  assert.deepEqual(refs, [
    { direction: 'to', other: 'b', group: 'Slices', flags: ['copy phase encoding direction'], broken: false },
    { direction: 'from', other: 'b', group: 'All', flags: [], broken: true },
  ]);
  assert.equal(copyRefLine(refs[0]), 'Copies to b');
  assert.equal(copyRefLine(refs[1]), 'Copied from b (broken)');
  assert.deepEqual(stepCopyRefs(b, index).map((r) => [r.direction, r.other]), [['to', 'a'], ['from', 'a']]);
  assert.deepEqual(stepCopyRefs(step('Pause', 'z', {}), index), []);
});

test('copyRefLine shows control characters in the other label', () => {
  assert.equal(copyRefLine({ direction: 'to', other: 'a\u0007b', group: 'G', flags: [], broken: false }), 'Copies to a␇b');
});
