import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildProgram, childIndex, MAX_FORK_DEPTH, MISSING_LABEL } from '../src/core/program.js';
import { displaySteps } from '../src/core/model.js';
import { UNRESOLVED_REF } from '../src/core/json.js';
import { shape } from './helpers.js';

const NIL = '00000000-0000-0000-0000-000000000000';
const COPY_NS = 'clr-namespace:syngo.MR.ExamDataFoundation.Data;assembly=syngo.MR.ExamDataFoundation.Data';

/** A deterministic GUID per name. */
const g = (name) => {
  const h = createHash('sha1').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const KINDS = { M: 'EdfMeasurementStep', P: 'EdfPauseStep', I: 'EdfInteractionStep', D: 'EdfDecisionStep', W: 'EdfWorkflowStep', S: 'EdfSplitStep', J: 'EdfJoinStep' };

/** Step document for a kind code M, P, I, W, D:<cond>, S:<cond> or J:<cond> (normalized: no `$` keys). */
function stepBody(kind) {
  const [code, cond] = kind.split(':');
  switch (code) {
    case 'M':
      return { BodyPartExamined: 'HEAD', ImageComment: '', Laterality: null, OpenBeforeStart: false, StudyParts: [], VoiceCommands: { Pause: '00:00:00', AreValid: true } };
    case 'P':
      return { ApplyContrastAgent: false, ContrastAgent: { Name: '', IsGiven: false }, ContrastAgentName: '' };
    case 'I':
      return { OpenBeforeStart: true };
    case 'W':
      return {};
    case 'D':
      return { ConditionId: g(cond), OpenBeforeStart: false };
    default:
      return { ConditionId: g(cond) };
  }
}

/**
 * A head holding one program, like the Python tests' `make`. Steps are [name, kind]; links are
 * [source, target] or [source, target, condition, choice]; conditions are
 * { name, choices, flags?: [Kind, IsDecicion, IsStrategy], description? } (no description: it
 * dangles); pairs are [split, join]. first/last default to the first and last step, null is nil.
 */
function make(steps, links, { conditions = [], pairs = [], relations = [], first, last } = {}) {
  const instances = new Map();
  const docs = new Map();
  const add = (name, type, body, extra = {}) => {
    const row = {
      id: g(`i:${name}`), element: g(`e:${name}`), object: g(name), type, contentHash: g(`h:${name}`),
      tags: {}, parent: null, label: null, description: null, ...extra,
    };
    instances.set(row.element, row);
    if (body !== undefined) docs.set(row.contentHash, { ok: true, type: `${type}Content`, body });
    return row;
  };
  const string = (name, text, parent, object = g(`o:${name}`)) =>
    add(name, 'EdfString', { Dates: {}, Texts: { '': text } }, { parent, object });
  const pe = g('e:program');
  const ref = (oid) => ({ FullName: 'syngo.MR.ExamDataFoundation.Data.EdfString', ObjectId: oid });

  const rawConditions = {};
  for (const c of conditions) {
    string(`${c.name} label`, c.name, pe, g(`${c.name} label`));
    for (const choice of c.choices) string(`choice ${choice}`, choice, pe, g(choice));
    if (c.description !== undefined) string(`${c.name} description`, c.description, pe, g(`${c.name} description`));
    const [Kind, IsDecicion, IsStrategy] = c.flags ?? [0, false, true];
    rawConditions[g(c.name)] = {
      Choices: c.choices.map((ch) => ref(g(ch))), Description: ref(g(`${c.name} description`)), Id: g(c.name),
      IsDecicion, IsStrategy, Kind, Label: ref(g(`${c.name} label`)), SelectionId: g(c.choices[0]),
    };
  }
  for (const [name, kind] of steps) {
    const label = string(`${name} label`, name, g(`e:${name}`));
    const row = add(name, KINDS[kind[0]], stepBody(kind), { parent: pe, object: g(name), label: label.element });
    if (kind === 'M') {
      add(`${name} protocol`, 'EdfProtocol', undefined, { parent: row.element, tags: { ContentHash: createHash('sha1').update(name).digest('hex') } });
    }
    if ('IDW'.includes(kind[0])) add(`${name} add-in`, 'EdfAddInConfig', undefined, { parent: row.element });
  }
  const link = ([source, target, cond, choice]) => ({
    ConditionId: cond ? g(cond) : NIL, SelectionId: choice ? g(choice) : NIL, SourceId: g(source), TargetId: g(target),
  });
  const allRelations = [
    ...pairs.map(([s, j]) => relation(s, j, 'SplitJoin')),
    ...pairs.map(([s, j]) => relation(j, s, 'SplitJoin')),
    ...relations,
  ];
  const names = steps.map(([n]) => n);
  const end = (v, fallback) => (v === null ? NIL : g(v === undefined ? fallback : v));
  const programLabel = string('program label', 'prog', pe);
  const body = {
    BodyPartExamined: '',
    Conditions: rawConditions,
    FirstStepId: names.length || first ? end(first, names[0]) : NIL,
    LastStepId: names.length || last ? end(last, names.at(-1)) : NIL,
    Laterality: null,
    LinksFrom: Object.fromEntries(names.map((n) => [g(n), []])),
    // the mirror holds Json.NET back-references, which must never be read
    LinksTo: Object.fromEntries(names.map((n) => [g(n), [UNRESOLVED_REF]])),
    Ranks: Object.fromEntries(names.map((n, i) => [g(n), { Rank: i, StepId: g(n) }])),
    RelationsFrom: Object.fromEntries(names.map((n) => [g(n), []])),
    RelationsTo: UNRESOLVED_REF,
  };
  for (const l of links) body.LinksFrom[g(l[0])]?.push(link(l));
  for (const r of allRelations) body.RelationsFrom[r.SourceId]?.push(r);
  const program = add('program', 'EdfProgram', body, { label: programLabel.element, tags: { Archive: 'True' } });
  return {
    instances, docs, program, body, stepCount: steps.length,
    build: () => buildProgram(program, { head: { fileId: 'f1', instances, docs }, children: childIndex(instances.values()), dirPath: ['New Tree'] }),
  };
}

function relation(source, target, kind, data = '', state = '', constraint = 0) {
  return { Constraint: constraint, Data: data, Kind: kind, SourceId: g(source), State: state, TargetId: g(target) };
}

function copyRef(source, target, { group = 'Slices', state = '', phase = 'False', extra = '' } = {}) {
  const data = `<EdfCopyReferenceParameters xmlns="${COPY_NS}" CopyPhaseEncodingDirection="${phase}" `
    + `CopySteps="False" Group="${group}" IgnoreLastStep="False" IgnoreMeasurements="False"${extra} />`;
  return relation(source, target, 'CopyReference', data, state, 1);
}

const allProblems = (p) => [...p.problems, ...displaySteps(p.body).flatMap((s) => s.problems)];

// --- well-formed programs ------------------------------------------------------------------------

test('linear', () => {
  const b = make([['a', 'M'], ['b', 'P'], ['c', 'I'], ['d', 'W']], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
  const p = b.build();
  assert.deepEqual(allProblems(p), []);
  assert.equal(p.order, 'links');
  assert.deepEqual(shape(p.body), ['a', 'b', 'c', 'd']);
  assert.deepEqual([p.label, p.comment, p.path, p.tags], ['prog', null, ['New Tree', 'prog'], { Archive: 'True' }]);
  const steps = displaySteps(p.body);
  assert.deepEqual(steps.map((s) => [s.kind, s.rank]), [['Measurement', 0], ['Pause', 1], ['Interaction', 2], ['Workflow', 3]]);
  const [m, pause, interaction, workflow] = steps;
  const protocol = [...b.instances.values()].find((r) => r.type === 'EdfProtocol');
  assert.deepEqual(m.detail, {
    protocolBlob: protocol.contentHash, protocolHash: protocol.tags.ContentHash, addInBlob: null,
    bodyPart: 'HEAD', laterality: '', imageComment: '', openBeforeStart: false,
  });
  assert.deepEqual(m.ids, { element: g('e:a'), instance: g('i:a'), object: g('a') });
  assert.equal(m.key, `f1:s:${g('e:a')}`);
  assert.deepEqual(pause.detail, { applyContrastAgent: false, contrastAgentName: '', contrastAgent: '{"IsGiven":false,"Name":""}' });
  assert.deepEqual(interaction.detail, { addInBlob: g('h:c add-in'), openBeforeStart: true });
  assert.deepEqual(workflow.detail, { addInBlob: g('h:d add-in') });
});

test('nested forks: Strategy outside, Decision inside, branches in choice order', () => {
  const b = make(
    [['a', 'M'], ['s1', 'S:C1'], ['dec', 'D:C2'], ['s2', 'S:C2'], ['c', 'M'], ['d', 'M'], ['j2', 'J:C2'], ['e', 'P'], ['j1', 'J:C1'], ['f', 'M']],
    [
      ['a', 's1'], ['s1', 'dec', 'C1', 'x'], ['s1', 'e', 'C1', 'y'], ['dec', 's2'],
      ['s2', 'd', 'C2', 'q'], // LinksFrom order differs from Choices order
      ['s2', 'c', 'C2', 'p'], ['c', 'j2'], ['d', 'j2'], ['j2', 'j1'], ['e', 'j1'], ['j1', 'f'],
    ],
    { conditions: [{ name: 'C1', choices: ['x', 'y'], description: 'Pick one' }, { name: 'C2', choices: ['p', 'q'], flags: [1, true, false] }], pairs: [['s1', 'j1'], ['s2', 'j2']] },
  );
  const p = b.build();
  assert.deepEqual(allProblems(p), []);
  assert.deepEqual(shape(p.body), ['a', ['s1', [['dec', ['s2', [['c'], ['d']], 'j2']], ['e']], 'j1'], 'f']);
  assert.deepEqual(displaySteps(p.body).map((s) => s.label), ['a', 's1', 'dec', 's2', 'c', 'd', 'j2', 'e', 'j1', 'f']);
  const outer = p.body[1];
  const inner = outer.branches[0].body[1];
  assert.deepEqual([outer.condition.kind, outer.condition.description], ['Strategy', 'Pick one']);
  assert.deepEqual([inner.condition.kind, inner.condition.description], ['Decision', null]); // dangling Description
  assert.deepEqual(inner.condition.choices, [{ objectId: g('p'), label: 'p' }, { objectId: g('q'), label: 'q' }]);
  assert.equal(inner.condition.defaultChoice, g('p'));
  assert.deepEqual(inner.branches.map((br) => br.isDefault), [true, false]);
  assert.equal(outer.branches[0].body[0].step.detail.conditionId, inner.condition.id);
  assert.deepEqual(p.conditions, [outer.condition, inner.condition]);
});

test('an empty branch links straight to the join', () => {
  const p = make(
    [['s', 'S:C'], ['m', 'M'], ['j', 'J:C']],
    [['s', 'm', 'C', 'yes'], ['s', 'j', 'C', 'no'], ['m', 'j']],
    { conditions: [{ name: 'C', choices: ['yes', 'no'] }], pairs: [['s', 'j']] },
  ).build();
  assert.deepEqual(allProblems(p), []);
  assert.deepEqual(shape(p.body), [['s', [['m'], []], 'j']]);
});

test('one condition shared by two forks; unused conditions are kept', () => {
  const p = make(
    [['s1', 'S:C'], ['a', 'M'], ['j1', 'J:C'], ['s2', 'S:C'], ['b', 'M'], ['j2', 'J:C']],
    [['s1', 'a', 'C', 'u'], ['s1', 'j1', 'C', 'v'], ['a', 'j1'], ['j1', 's2'], ['s2', 'j2', 'C', 'u'], ['s2', 'b', 'C', 'v'], ['b', 'j2']],
    { conditions: [{ name: 'C', choices: ['u', 'v'] }, { name: 'unused', choices: ['w'] }], pairs: [['s1', 'j1'], ['s2', 'j2']] },
  ).build();
  assert.deepEqual(allProblems(p), []);
  assert.deepEqual(shape(p.body), [['s1', [['a'], []], 'j1'], ['s2', [[], ['b']], 'j2']]);
  assert.equal(p.body[0].condition, p.body[1].condition);
  assert.deepEqual(p.conditions.map((c) => c.label), ['C', 'unused']);
});

test('an empty program', () => {
  const p = make([], [], { conditions: [{ name: 'C', choices: ['u'] }], first: null, last: null }).build();
  assert.deepEqual([p.body, p.order, p.problems, p.conditions.length], [[], 'links', [], 1]);
});

test('copy references: sorted by display order, broken and flags kept, Kind "" skipped', () => {
  const p = make([['m2', 'M'], ['m1', 'M'], ['m3', 'M']], [['m1', 'm2'], ['m2', 'm3']], {
    relations: [
      copyRef('m2', 'm3', { group: 'Everything', state: 'Broken' }),
      relation('m2', 'm1', ''),
      copyRef('m1', 'm3', { phase: 'True' }),
      copyRef('m1', 'm2'),
      relation('m1', 'm3', ''),
    ],
    first: 'm1', last: 'm3',
  }).build();
  assert.deepEqual(allProblems(p), []);
  assert.deepEqual(p.copyRefs.map((c) => [c.source, c.target, c.group, c.broken, c.flags.CopyPhaseEncodingDirection]), [
    [g('m1'), g('m2'), 'Slices', false, false],
    [g('m1'), g('m3'), 'Slices', false, true],
    [g('m2'), g('m3'), 'Everything', true, false],
  ]);
  assert.deepEqual(Object.keys(p.copyRefs[0].flags).sort(), ['CopyPhaseEncodingDirection', 'CopySteps', 'IgnoreLastStep', 'IgnoreMeasurements']);
});

// --- leniency ------------------------------------------------------------------------------------

const copyCase = (rel) => make([['m1', 'M'], ['m2', 'M'], ['p', 'P']], [['m1', 'm2'], ['m2', 'p']], { relations: [rel] }).build();

for (const [name, rel, pattern] of [
  ['a boolean spelled otherwise', copyRef('m1', 'm2', { phase: 'true' }), /CopyPhaseEncodingDirection must be True or False/],
  ['an unknown attribute', copyRef('m1', 'm2', { extra: ' Extra="1"' }), /unexpected attributes Extra/],
  ['a wrong namespace', relation('m1', 'm2', 'CopyReference', '<EdfCopyReferenceParameters Group="Slices" />', '', 1), /namespace/],
  ['element content', relation('m1', 'm2', 'CopyReference', copyRef('m1', 'm2').Data.replace(' />', '><x/></EdfCopyReferenceParameters>'), '', 1), /not one empty/],
  ['an unknown State', copyRef('m1', 'm2', { state: 'Mended' }), /unknown copy-reference State/],
  ['a Pause endpoint', copyRef('m1', 'p'), /endpoint .* is a Pause/],
  ['an endpoint outside the program', copyRef('m1', 'elsewhere'), /not a step of this program/],
  ['an unknown relation Kind', relation('m1', 'm2', 'Mystery'), /unknown Kind/],
]) {
  test(`a copy reference with ${name} is a warning and skipped`, () => {
    const p = copyCase(rel);
    assert.equal(p.order, 'links');
    assert.deepEqual(p.copyRefs, []);
    assert.equal(p.problems.length, 1);
    assert.equal(p.problems[0].level, 'warning');
    assert.match(p.problems[0].message, pattern);
    assert.match(p.problems[0].message, /skipped$/);
  });
}

/** s(C: yes/no), m, j with the given links and pairs. */
const fork = (links, pairs = [['s', 'j']]) =>
  make([['s', 'S:C'], ['m', 'M'], ['j', 'J:C']], links, { conditions: [{ name: 'C', choices: ['yes', 'no'] }], pairs });

const forkLinks = [['s', 'm', 'C', 'yes'], ['s', 'j', 'C', 'no'], ['m', 'j']];
const mutated = (b, fn) => {
  fn(b);
  return b;
};

const crossed = () => make(
  [['s1', 'S:A'], ['s2', 'S:B'], ['m', 'M'], ['j2', 'J:B'], ['j1', 'J:A']],
  [['s1', 's2', 'A', 'a'], ['s2', 'm', 'B', 'b'], ['m', 'j1'], ['j2', 'j1']],
  { conditions: [{ name: 'A', choices: ['a'] }, { name: 'B', choices: ['b'] }], pairs: [['s1', 'j1'], ['s2', 'j2']] },
);

for (const [name, b, pattern] of [
  ['a cycle', make([['a', 'M'], ['b', 'M']], [['a', 'b'], ['b', 'a']]), /reached twice/],
  ['an unreachable step', make([['a', 'M'], ['b', 'M'], ['c', 'M']], [['a', 'b']], { last: 'b' }), /unreachable steps/],
  ['two out-links', make([['a', 'M'], ['b', 'M'], ['c', 'M']], [['a', 'b'], ['a', 'c'], ['b', 'c']]), /2 out-links/],
  ['a LastStepId elsewhere', make([['a', 'M'], ['b', 'M']], [['a', 'b']], { last: 'a' }), /walk ends at/],
  ['a nil FirstStepId', make([['a', 'M']], [], { first: null, last: null }), /nil FirstStepId/],
  ['a FirstStepId that is not a step', make([['a', 'M']], [], { first: 'zz' }), /FirstStepId .* is not a step/],
  ['a link to an unknown step', make([['a', 'M'], ['b', 'M']], [['a', 'zz']]), /link to unknown step/],
  ['a conditional link from a non-split', make([['a', 'M'], ['b', 'M']], [['a', 'b', 'C', 'u']], { conditions: [{ name: 'C', choices: ['u'] }] }), /conditional link from a non-split/],
  ['a missing choice link', fork([['s', 'm', 'C', 'yes'], ['m', 'j']]), /do not match the choices/],
  ['a duplicate choice link', fork([['s', 'm', 'C', 'yes'], ['s', 'j', 'C', 'yes'], ['m', 'j']]), /duplicate choice link/],
  ['an unpaired split', fork([['s', 'm', 'C', 'yes'], ['s', 'j', 'C', 'no'], ['m', 'j']], []), /unpaired split/],
  ['a branch that ends early', fork([['s', 'm', 'C', 'yes'], ['s', 'j', 'C', 'no']]), /ends before reaching its join/],
  ['crossing forks', crossed(), /reached outside its fork/],
  ['SplitJoin recorded in one direction only', mutated(fork(forkLinks), (b) => { b.body.RelationsFrom[g('j')] = []; }), /not recorded in both directions/],
  ['a split paired twice', fork(forkLinks, [['s', 'j'], ['s', 'j']]), /split [0-9a-f-]+ is paired more than once/],
  ['a join paired with two splits', make(
    [['s1', 'S:C'], ['s2', 'S:C'], ['j', 'J:C']], [['s1', 's2', 'C', 'yes'], ['s2', 'j', 'C', 'yes']],
    { conditions: [{ name: 'C', choices: ['yes'] }], pairs: [['s1', 'j'], ['s2', 'j']] },
  ), /join [0-9a-f-]+ is paired with 2 splits/],
  ['SplitJoin between a measurement and a join', fork(forkLinks, [['s', 'j'], ['m', 'j']]), /relates a Measurement and a Join/],
  ['a split and join with different conditions', make(
    [['s', 'S:C'], ['j', 'J:D']], [['s', 'j', 'C', 'yes']],
    { conditions: [{ name: 'C', choices: ['yes'] }, { name: 'D', choices: ['other'] }], pairs: [['s', 'j']] },
  ), new RegExp(`^steps are shown in rank order: split ${g('s')} and join ${g('j')} carry different conditions$`)],
  ['two steps sharing an ObjectId', mutated(make([['a', 'M'], ['b', 'M']], [['a', 'b']]), (b) => {
    b.instances.get(g('e:b')).object = g('a');
    delete b.body.Ranks[g('b')];
  }), /two steps share an ObjectId/],
  ['a split link keyed by another condition', fork([['s', 'm', 'D', 'yes'], ['s', 'j', 'C', 'no'], ['m', 'j']]), /link not keyed by condition/],
  ['a link with a ConditionId but no SelectionId', mutated(make([['a', 'M'], ['b', 'M']], [['a', 'b']]), (b) => {
    b.body.LinksFrom[g('a')][0].ConditionId = g('C');
  }), /must be both nil or both set/],
]) {
  test(`${name}: steps in rank order with exactly one warning`, () => {
    const p = b.build();
    assert.equal(p.order, 'rank');
    assert.equal(p.problems.length, 1);
    assert.equal(p.problems[0].level, 'warning');
    assert.equal(p.problems[0].where, p.key);
    assert.match(p.problems[0].message, /^steps are shown in rank order: /);
    assert.match(p.problems[0].message, pattern);
    assert.ok(p.body.every((n) => n.type === 'step'));
    const ranks = p.body.map((n) => n.step.rank);
    assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y));
    assert.equal(p.body.length, b.stepCount);
  });
}

test('rank order breaks ties by label', () => {
  const b = make([['b', 'M'], ['a', 'M'], ['c', 'M']], [['b', 'a']], { last: 'a' });
  b.body.Ranks[g('c')].Rank = 0;
  const p = b.build();
  assert.equal(p.order, 'rank');
  assert.deepEqual(shape(p.body), ['b', 'c', 'a']);
});

test('an unreadable step document: the step stays, with an error; order is unaffected', () => {
  const b = make([['a', 'M'], ['b', 'P']], [['a', 'b']]);
  b.docs.set(b.instances.get(g('e:a')).contentHash, { ok: false, message: 'invalid JSON at character 3' });
  const p = b.build();
  assert.equal(p.order, 'links');
  assert.deepEqual(p.problems, []);
  const [a] = displaySteps(p.body);
  assert.equal(a.kind, 'Measurement');
  assert.equal(a.label, 'a');
  assert.equal(a.detail.bodyPart, null);
  assert.equal(a.detail.protocolBlob, g('h:a protocol'));
  assert.deepEqual(a.problems.map((x) => [x.level, x.where]), [['error', a.key]]);
  assert.match(a.problems[0].message, /EdfMeasurementStep .*: invalid JSON/);
});

test('an unreadable split document falls back to rank order', () => {
  const b = fork([['s', 'm', 'C', 'yes'], ['s', 'j', 'C', 'no'], ['m', 'j']]);
  b.docs.delete(b.instances.get(g('e:s')).contentHash);
  const p = b.build();
  assert.equal(p.order, 'rank');
  assert.equal(p.problems.length, 1);
  assert.equal(displaySteps(p.body).find((s) => s.label === 's').problems[0].level, 'error');
});

test('an unreadable program document: an error, and the steps in rank order', () => {
  const b = make([['a', 'M'], ['b', 'P']], [['a', 'b']]);
  b.docs.delete(b.program.contentHash);
  const p = b.build();
  assert.equal(p.order, 'rank');
  assert.deepEqual(p.problems.map((x) => x.level), ['error', 'warning']);
  assert.deepEqual(shape(p.body), ['a', 'b']);
  assert.ok(displaySteps(p.body).every((s) => s.rank === null));
});

test('a missing condition string shows a placeholder and a warning; the fork still works', () => {
  const b = fork([['s', 'm', 'C', 'yes'], ['s', 'j', 'C', 'no'], ['m', 'j']]);
  for (const [k, row] of b.instances) if (row.object === g('C label') || row.object === g('no')) b.instances.delete(k);
  const p = b.build();
  assert.equal(p.order, 'links');
  const [c] = p.conditions;
  assert.equal(c.label, MISSING_LABEL);
  assert.deepEqual(c.choices.map((ch) => ch.label), ['yes', MISSING_LABEL]);
  assert.equal(p.problems.length, 2);
  assert.ok(p.problems.every((x) => x.level === 'warning' && /not a child of the program/.test(x.message)));
  assert.deepEqual(shape(p.body), [['s', [['m'], []], 'j']]);
});

for (const flags of [[1, false, true], [0, true, false], [2, true, true]]) {
  test(`condition flags ${flags} make an 'Other' condition with a warning`, () => {
    const p = make([['a', 'M']], [], { conditions: [{ name: 'C', choices: ['u'], flags }] }).build();
    assert.equal(p.conditions[0].kind, 'Other');
    assert.equal(p.problems.length, 1);
    assert.match(p.problems[0].message, /combination/);
  });
}

test('a SelectionId that is not a choice: no default, a warning', () => {
  const b = make([['a', 'M']], [], { conditions: [{ name: 'C', choices: ['u'] }] });
  b.body.Conditions[g('C')].SelectionId = g('elsewhere');
  const p = b.build();
  assert.equal(p.conditions[0].defaultChoice, null);
  assert.match(p.problems[0].message, /SelectionId is not one of the choices/);
});

test('a malformed condition is skipped with a warning; its splits fall back to rank order', () => {
  const b = fork([['s', 'm', 'C', 'yes'], ['s', 'j', 'C', 'no'], ['m', 'j']]);
  b.body.Conditions[g('C')].Choices = 'nope';
  const p = b.build();
  assert.deepEqual(p.conditions, []);
  assert.equal(p.order, 'rank');
  assert.equal(p.problems.length, 2); // the condition and the fallback
  assert.match(p.problems[0].message, /^condition [0-9a-f-]+: "Choices" must be an array, got string; skipped$/);
  // the split and join name a condition the program no longer has
  assert.ok(displaySteps(p.body).filter((s) => s.kind === 'Split' || s.kind === 'Join').every((s) => /unknown condition/.test(s.problems[0].message)));
});

test('a measurement without a protocol, and a protocol without a ContentHash tag, are warnings', () => {
  const b = make([['a', 'M'], ['b', 'M']], [['a', 'b']]);
  b.instances.delete(g('e:a protocol'));
  b.instances.get(g('e:b protocol')).tags = {};
  const p = b.build();
  const [a, bb] = displaySteps(p.body);
  assert.equal(a.detail.protocolBlob, null);
  assert.match(a.problems[0].message, /Measurement step with 0 protocols/);
  assert.equal(bb.detail.protocolBlob, g('h:b protocol'));
  assert.equal(bb.detail.protocolHash, null);
  assert.match(bb.problems[0].message, /ContentHash tag/);
});

test('nonsense program documents never throw', () => {
  for (const body of [{}, { Conditions: 1, Ranks: [], LinksFrom: 'x', RelationsFrom: null, FirstStepId: 3 }]) {
    const b = make([['a', 'M']], []);
    b.docs.set(b.program.contentHash, { ok: true, type: 'EdfProgramContent', body });
    const p = b.build();
    assert.equal(p.order, 'rank');
    assert.ok(p.problems.length > 0);
    assert.ok(p.problems.every((x) => x.where === p.key));
  }
});

/** `depth` forks, each inside the single branch of the one before, around one Pause. */
function nested(depth) {
  const steps = [];
  const links = [];
  const pairs = [];
  for (let i = 0; i < depth; i++) {
    steps.push([`s${i}`, 'S:C'], [`j${i}`, 'J:C']);
    links.push([`s${i}`, i + 1 < depth ? `s${i + 1}` : 'm', 'C', 'c']);
    links.push([`j${i}`, ...(i ? [`j${i - 1}`] : [])].length === 2 ? [`j${i}`, `j${i - 1}`] : null);
    pairs.push([`s${i}`, `j${i}`]);
  }
  steps.push(['m', 'P']);
  links.push(['m', `j${depth - 1}`]);
  return make(steps, links.filter(Boolean), { conditions: [{ name: 'C', choices: ['c'] }], pairs, first: 's0', last: 'j0' });
}

test(`forks nested ${MAX_FORK_DEPTH} deep are walked; deeper falls back to rank order`, () => {
  const ok = nested(MAX_FORK_DEPTH).build();
  assert.deepEqual([ok.order, ok.problems], ['links', []]);
  assert.equal(displaySteps(ok.body).length, 2 * MAX_FORK_DEPTH + 1);
  for (const depth of [MAX_FORK_DEPTH + 1, 3000]) {
    const p = nested(depth).build();
    assert.equal(p.order, 'rank');
    assert.equal(p.problems.length, 1);
    assert.match(p.problems[0].message, new RegExp(`^steps are shown in rank order: split [0-9a-f-]+: forks nest more than ${MAX_FORK_DEPTH} deep$`));
    assert.equal(p.body.length, 2 * depth + 1);
  }
});

for (const [name, data, group] of [
  ['single-quoted attributes', `<EdfCopyReferenceParameters xmlns='${COPY_NS}' CopyPhaseEncodingDirection='False' CopySteps='False' Group='Slices' IgnoreLastStep='False' IgnoreMeasurements='False' />`, 'Slices'],
  ['an explicit close tag', copyRef('m1', 'm2').Data.replace(' />', '></EdfCopyReferenceParameters>'), 'Slices'],
  ['an entity in Group', copyRef('m1', 'm2', { group: 'A&amp;B&lt;&gt;&quot;&apos;' }).Data, 'A&B<>"\''],
]) {
  test(`copy-reference XML with ${name} is read`, () => {
    const p = copyCase(relation('m1', 'm2', 'CopyReference', data, '', 1));
    assert.deepEqual(p.problems, []);
    assert.equal(p.copyRefs[0].group, group);
  });
}

for (const [name, mutate, pattern] of [
  ['a non-string Id', (c) => { c.Id = 7; }, /Id is missing or differs from its key/],
  ['a malformed choice reference', (c) => { c.Choices[1] = 'nope'; }, /Choices\[1\]: expected a JSON object, got string; skipped$/],
  ['a missing SelectionId', (c) => { delete c.SelectionId; }, /missing key "SelectionId"/],
  ['a missing label reference', (c) => { delete c.Label; }, /^condition [0-9a-f-]+ Label: expected a JSON object/],
]) {
  test(`a condition with ${name} gives exactly one warning`, () => {
    const b = make([['a', 'M']], [], { conditions: [{ name: 'C', choices: ['u', 'v'] }] });
    mutate(b.body.Conditions[g('C')]);
    const p = b.build();
    assert.equal(p.problems.length, 1, JSON.stringify(p.problems));
    assert.match(p.problems[0].message, pattern);
  });
}

test('problem messages never repeat document text', () => {
  const b = make([['a', 'M'], ['b', 'M']], [['a', 'b']], { conditions: [{ name: 'C', choices: ['u'] }] });
  b.body.Ranks['SECRET 1'] = { Rank: 0, StepId: 'SECRET 1' };
  b.body.Conditions['SECRET 2'] = {};
  b.body.RelationsFrom['SECRET 3'] = [];
  b.body.Conditions[g('C')].Choices[0].ObjectId = 'SECRET 4';
  b.body.Conditions[g('C')].Id = 'SECRET 5';
  b.body.LinksFrom['SECRET 6'] = [];
  const p = b.build();
  assert.equal(p.order, 'rank');
  assert.ok(p.problems.length >= 5);
  assert.ok(!JSON.stringify(p.problems).includes('SECRET'), JSON.stringify(p.problems));
});
