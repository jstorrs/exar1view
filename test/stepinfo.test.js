// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stepFacts, stepTags, contrastNote, copyRefIndex, stepCopyRefs, copyRefLine, copyRefFact, copyTags,
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
      { source: 'o:a', target: 'o:b', group: 'SlicesAndAdjustmentVolume', broken: false, flags: { CopyPhaseEncodingDirection: true, CopySteps: false } },
      { source: 'o:b', target: 'o:a', group: 'Everything', broken: true, flags: {} },
    ],
  });
  const index = copyRefIndex(p);
  const refs = stepCopyRefs(a, index);
  assert.deepEqual(refs, [
    { direction: 'to', other: 'b', number: 1, group: 'SlicesAndAdjustmentVolume', scope: 'slices and adjustment volume', flags: ['copy phase encoding direction'], broken: false },
    { direction: 'from', other: 'b', number: 2, group: 'Everything', scope: 'everything', flags: [], broken: true },
  ]);
  assert.equal(copyRefLine(refs[0]), 'Copy reference 1: copies to b · slices and adjustment volume · copy phase encoding direction');
  assert.equal(copyRefLine(refs[1]), 'Copy reference 2: copied from b · everything (broken)');
  assert.deepEqual(stepCopyRefs(b, index).map((r) => [r.direction, r.other, r.number]), [['to', 'a', 2], ['from', 'a', 1]]);
  assert.deepEqual(stepCopyRefs(step('Pause', 'z', {}), index), []);
});

test('copy references: sources numbered in display order, branch steps included, destinations take their source number', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((n) => step('Measurement', n, MEAS));
  const split = step('Split', 'sp', { conditionId: 'c1' });
  const join = step('Join', 'jn', { conditionId: 'c1' });
  const fork = {
    type: /** @type {const} */ ('fork'), split, join,
    branches: [{ condition: condition, choice: condition.choices[0], isDefault: false, body: [{ type: /** @type {const} */ ('step'), step: c }] }],
  };
  const p = /** @type {Program} */ (/** @type {unknown} */ ({
    ...program([a, b]),
    body: [a, b].map((s) => ({ type: 'step', step: s })).concat([fork], [d, e].map((s) => ({ type: 'step', step: s }))),
    // Listed out of display order on purpose; display order is a, b, c (in the branch), d, e.
    copyRefs: [
      { source: 'o:b', target: 'o:e', group: 'Slices', broken: false, flags: {} },
      { source: 'o:a', target: 'o:b', group: 'Slices', broken: false, flags: {} },
      { source: 'o:c', target: 'o:d', group: 'Slices', broken: false, flags: {} },
      { source: 'o:a', target: 'o:c', group: 'Slices', broken: false, flags: {} },
    ],
  }));
  const index = copyRefIndex(p);
  const nums = (/** @type {Step} */ s) => stepCopyRefs(s, index).map((r) => `${r.direction}${r.number}`);
  assert.deepEqual(nums(a), ['to1', 'to1']);
  assert.deepEqual(nums(b), ['to2', 'from1']);
  assert.deepEqual(nums(c), ['to3', 'from1']);
  assert.deepEqual(nums(d), ['from3']);
  assert.deepEqual(nums(e), ['from2']);
  assert.deepEqual(stepCopyRefs(a, index).map(copyRefLine), ['Copy reference 1: copies to b · slices', 'Copy reference 1: copies to c · slices']);
});

test('copyRefLine shows control characters in the other label', () => {
  assert.equal(copyRefLine({ direction: 'to', other: 'a\u0007b', number: 1, group: 'G', scope: 'g', flags: [], broken: false }), 'Copy reference 1: copies to a␇b · g');
  assert.equal(copyRefLine({ direction: 'from', other: 'x', number: 1, group: 'G', scope: 'g\u202eh', flags: [], broken: false }), 'Copy reference 1: copied from x · g\\u202eh');
});

test('a source numbered once when two displayed steps share an ObjectId', () => {
  const a = step('Measurement', 'a', MEAS);
  const a2 = step('Measurement', 'a2', MEAS, { ids: { element: 'a2', instance: 'a2', object: 'o:a' } });
  const b = step('Measurement', 'b', MEAS);
  const c = step('Measurement', 'c', MEAS);
  const p = program([a, a2, b, c], { copyRefs: [
    { source: 'o:a', target: 'o:b', group: 'G', broken: false, flags: {} },
    { source: 'o:b', target: 'o:c', group: 'G', broken: false, flags: {} },
  ] });
  const index = copyRefIndex(p);
  assert.deepEqual(stepCopyRefs(b, index).map((r) => r.number), [2, 1]);
  assert.deepEqual(stepCopyRefs(c, index).map((r) => r.number), [2]);
});

test('copy tags: source with several destinations (one broken), both roles, two sources, facts line', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => step('Measurement', n, MEAS));
  const p = program([a, b, c, d], { copyRefs: [
    { source: 'o:a', target: 'o:b', group: 'Slices', broken: false, flags: {} },
    { source: 'o:a', target: 'o:c', group: 'Slices', broken: true, flags: {} },
    { source: 'o:b', target: 'o:d', group: 'Everything', broken: false, flags: { CopySteps: true } },
    { source: 'o:c', target: 'o:d', group: 'Everything', broken: false, flags: {} },
  ] });
  const index = copyRefIndex(p);
  assert.deepEqual(copyTags(stepCopyRefs(a, index)), [{
    role: 'source', number: 1, broken: true,
    title: 'Copy reference 1: copies to b · slices\nCopy reference 1: copies to c · slices (broken)',
    aria: 'copy reference 1 source, 2 destinations, broken',
  }]);
  assert.deepEqual(copyTags(stepCopyRefs(b, index)).map((t) => [t.role, t.number]), [['source', 2], ['destination', 1]]);
  const dTags = copyTags(stepCopyRefs(d, index));
  assert.deepEqual(dTags.map((t) => [t.role, t.number, t.aria]), [
    ['destination', 2, 'copy reference 2 destination, from b'], ['destination', 3, 'copy reference 3 destination, from c']]);
  assert.equal(copyRefLine(stepCopyRefs(d, index)[0]), 'Copy reference 2: copied from b · everything · copy steps');
  assert.equal(copyRefFact(stepCopyRefs(d, index)[0]), '2 · Copied from b · everything · copy steps');
  assert.deepEqual(copyTags([]), []);
});
