// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenBody, stepRows, stepRowLabel, copyRefMarks, rankReason } from '../src/core/body.js';
import { displaySteps } from '../src/core/model.js';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { loadExar } from '../src/core/load.js';
import { loadSql } from './sqljs.js';
import { buildExar } from './fixture/builder.js';
import { step, node, cond, fork, program } from './helpers.js';

/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/core/model.js').Program} Program */
/** @typedef {import('../src/core/model.js').Condition} Condition */
/** @typedef {import('../src/core/model.js').BodyNode} BodyNode */

const inner = cond('contrast', 'Decision', ['with', 'without']);
const outer = cond('variant', 'Strategy', ['standard', 'fast', 'skip']);
const branching = program([
  node(step('Measurement', 'survey')),
  fork('f1', outer, [
    [node(step('Decision', 'ask')), fork('f2', inner, [[node(step('Pause', 'inject')), node(step('Measurement', 't1post'))], [node(step('Measurement', 't1'))]])],
    [node(step('Measurement', 't2fast'))],
    [],
  ]),
  node(step('Workflow', 'send')),
]);

test('a fork gives split, condition, per branch a choice row and its rows, then join', () => {
  const rows = flattenBody(branching);
  const brief = rows.map((r) => {
    if (r.type === 'step') return `${r.depth} ${r.step.label}`;
    if (r.type === 'condition') return `${r.depth} [${r.condition.kind} ${r.condition.label}]`;
    return `${r.depth} <${r.choice.label}${r.isDefault ? ' default' : ''}${r.empty ? ' empty' : ''}>`;
  });
  assert.deepEqual(brief, [
    '0 survey',
    '0 f1-split',
    '0 [Strategy variant]',
    '1 <standard default>',
    '1 ask',
    '1 f2-split',
    '1 [Decision contrast]',
    '2 <with default>',
    '2 inject',
    '2 t1post',
    '2 <without>',
    '2 t1',
    '1 f2-join',
    '1 <fast>',
    '1 t2fast',
    '1 <skip empty>',
    '0 f1-join',
    '0 send',
  ]);
});

test('row keys are unique; step rows carry the step key and their innermost branch', () => {
  const rows = flattenBody(branching);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
  const steps = stepRows(rows);
  assert.deepEqual(steps.map((r) => r.key).slice(0, 3), ['s:survey', 's:f1-split', 's:ask']);
  const at = (/** @type {string} */ label) => steps.find((r) => r.step.label === label);
  assert.equal(at('survey')?.branch, null);
  assert.equal(at('f1-split')?.branch, null);
  assert.equal(at('ask')?.branch?.choice.label, 'standard');
  assert.equal(at('inject')?.branch?.condition.label, 'contrast');
  assert.equal(at('f2-join')?.branch?.choice.label, 'standard');
});

test('step rows are the display steps, Split and Join included', () => {
  assert.deepEqual(stepRows(flattenBody(branching)).map((r) => r.step), displaySteps(branching.body));
});

test('stepRowLabel names the condition of a fork, its empty choices and the branch a step is in', () => {
  const rows = stepRows(flattenBody(branching));
  const label = (/** @type {string} */ name) => stepRowLabel(/** @type {import('../src/core/body.js').StepRow} */ (rows.find((r) => r.step.label === name)));
  assert.equal(label('survey'), 'Measurement, survey');
  assert.equal(label('f1-split'), 'Split, f1-split, Strategy variant, no steps for skip');
  assert.equal(label('f1-join'), 'Join, f1-join, Strategy variant');
  assert.equal(label('ask'), 'Decision, ask, in variant: standard (default)');
  assert.equal(label('f2-split'), 'Split, f2-split, Decision contrast, in variant: standard (default)');
  assert.equal(label('t1'), 'Measurement, t1, in contrast: without');
  assert.equal(label('t2fast'), 'Measurement, t2fast, in variant: fast');
});

test('an empty body has no rows', () => {
  assert.deepEqual(flattenBody(program([])), []);
});

test('copyRefMarks groups references by source and target ObjectId', () => {
  const p = program([], {
    copyRefs: [
      { source: 'o:a', target: 'o:b', group: 'G', broken: false, flags: {} },
      { source: 'o:a', target: 'o:c', group: 'G', broken: true, flags: {} },
    ],
  });
  const m = copyRefMarks(p);
  assert.equal(m.get('o:a')?.outgoing.length, 2);
  assert.equal(m.get('o:a')?.incoming.length, 0);
  assert.equal(m.get('o:c')?.incoming[0].broken, true);
  assert.equal(m.has('o:d'), false);
});

test('rankReason: null in link order, the warning text after its prefix in rank order', () => {
  assert.equal(rankReason(branching), null);
  const p = program([], {
    order: 'rank',
    problems: [{ level: 'warning', where: 'p', message: 'steps are shown in rank order: link to a missing step' }],
  });
  assert.equal(rankReason(p), 'link to a missing step');
  assert.equal(rankReason(program([], { order: 'rank' })), '');
});

test('rankReason of the fixture rank-order program, read by the real reader', async () => {
  const bytes = buildExar();
  const { db, close } = openDb(await loadSql(), bytes);
  /** @type {Awaited<ReturnType<typeof loadExar>>} */
  let res;
  try {
    res = await loadExar(db, inflateRaw, { id: 'f1', name: 'test.exar1', size: bytes.length }, () => {});
  } finally {
    close();
  }
  assert.ok(res.ok);
  const programs = res.file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs));
  const p = programs.find((q) => q.order === 'rank');
  assert.ok(p);
  const warning = p.problems.find((q) => q.message.startsWith('steps are shown in rank order: '));
  assert.ok(warning);
  const reason = rankReason(p);
  assert.ok(reason);
  assert.equal(reason, warning.message.slice('steps are shown in rank order: '.length));
});
