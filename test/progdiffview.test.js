import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePrograms } from '../src/core/progdiff.js';
import {
  PROGRAM_COMPARE_HINT, collapseSame, compareCounts, compareRows, diffValue, measurementSides, programCompareStatus, programPair, rankWarning,
} from '../src/core/progdiffview.js';
import { EMPTY_WORKSPACE, addFile } from '../src/core/workspace.js';
import { cond, fork, node, program, step } from './helpers.js';

const SOURCE = { name: 'x.exar1', size: 1, lastModified: 0 };
const PAUSE = { applyContrastAgent: null, contrastAgentName: null, contrastAgent: null };
const MEAS = { protocolBlob: null, protocolHash: null, addInBlob: null, bodyPart: null, laterality: null, imageComment: null, openBeforeStart: null };
const pause = (name, more) => node(step('Pause', name, { detail: PAUSE, ...more }));
const conds = (body) => body.flatMap((n) => (n.type === 'fork' ? [n.condition, ...n.branches.flatMap((b) => conds(b.body))] : []));
const prog = (body, more) => program(body, { conditions: conds(body), ...more });
const rows = (a, b) => compareRows(comparePrograms(prog(a), prog(b)));
const shape = (rs) => rs.map((r) => `${r.type}:${r.depth}:${r.mark}`);
const marks = (rs) => rs.map((r) => r.mark);
const counts = (a, b) => compareCounts(rows(a, b));

/** A fork with two choices, one step in each branch. */
const forkOf = (more = {}) => fork('f', cond('c', 'Decision', ['x', 'y'], more), [[pause('p1')], [pause('p2')]]);

test('hint', () => assert.equal(PROGRAM_COMPARE_HINT, 'Select a program in each pane of split view'));

test('identical programs: every row is same, no differences', () => {
  const body = () => [pause('a'), forkOf(), pause('z')];
  const rs = rows(body(), body());
  assert.ok(rs.every((r) => r.mark === 'same'));
  assert.equal(rs[0].type, 'step');
  assert.equal(programCompareStatus(compareCounts(rs)), 'No differences in steps, decisions or branches');
});

test('row order, depth and keys for nested forks', () => {
  const inner = fork('i', cond('ci', 'Decision', ['u']), [[pause('deep')]]);
  const outer = fork('o', cond('co', 'Decision', ['x', 'y']), [[pause('p1'), inner], []]);
  const rs = rows([pause('top'), outer], [pause('top'), outer]);
  assert.deepEqual(shape(rs).map((s) => s.slice(0, -5)), [
    'step:0', 'split:0', 'condition:0', 'choice:1', 'step:1', 'split:1', 'condition:1', 'choice:2', 'step:2', 'join:1',
    'choice:1', 'join:0',
  ]);
  assert.equal(new Set(rs.map((r) => r.key)).size, rs.length);
  const choice = rs.filter((r) => r.type === 'choice' && r.depth === 1);
  assert.deepEqual(choice.map((r) => [r.a.isDefault, r.b.isDefault, r.a.empty, r.b.empty]), [[true, true, false, false], [false, false, true, true]]);
  // a step only in A in one place and only in B in another keeps distinct keys
  const k = rows([pause('s'), forkOf()], [forkOf(), pause('s')]);
  assert.equal(new Set(k.map((r) => r.key)).size, k.length);
});

test('step rows: pair marks, protocol, one-sided', () => {
  const m = (blob) => node(step('Measurement', 'm', { detail: { ...MEAS, protocolBlob: blob, protocolHash: blob } }));
  assert.deepEqual(marks(rows([m('1')], [m('2')])), ['changed']);
  assert.equal(rows([m('1')], [m('2')])[0].protocol, 'differs');
  assert.deepEqual(marks(rows([m('1')], [m('1')])), ['same']);
  assert.deepEqual(marks(rows([pause('a', { comment: 'x' })], [pause('a')])), ['changed']);
  const [r] = rows([pause('a')], []);
  assert.equal(r.mark, 'a');
  assert.equal(r.a.label, 'a');
  assert.equal(r.b, undefined);
  assert.equal(rows([], [pause('a')])[0].mark, 'b');
});

test('split and join differences are routed to their own rows', () => {
  const a = forkOf();
  const b = forkOf();
  b.split = { ...b.split, comment: 'sc' };
  b.join = { ...b.join, comment: 'jc' };
  const rs = rows([a], [b]);
  const by = (t) => rs.find((r) => r.type === t);
  assert.deepEqual(by('split').diffs.map((d) => d.field), ['Comment']);
  assert.deepEqual(by('join').diffs.map((d) => d.field), ['Comment']);
  assert.equal(by('split').mark, 'changed');
  assert.equal(by('join').mark, 'changed');
  assert.equal(by('condition').mark, 'same');

  const c = forkOf();
  c.join = { ...c.join, comment: 'jc' };
  const only = rows([a], [c]);
  assert.deepEqual(only.map((r) => r.mark), ['same', 'same', 'same', 'same', 'same', 'same', 'changed']);
});

test('condition row: changed only for Condition / Description / Choices', () => {
  const rs = rows([forkOf()], [forkOf({ description: 'd' })]);
  const c = rs.find((r) => r.type === 'condition');
  assert.equal(c.mark, 'changed');
  assert.ok(c.diffs.every((d) => ['Condition', 'Description', 'Choices'].includes(d.field)));
  assert.equal(rs.find((r) => r.type === 'split').mark, 'same');
  assert.deepEqual(compareCounts(rs), { changed: 1, onlyA: 0, onlyB: 0 });
  const lbl = forkOf();
  lbl.split = { ...lbl.split, label: 'renamed' };
  const rs2 = rows([forkOf()], [lbl]);
  assert.equal(rs2.find((r) => r.type === 'condition').mark, 'same');
  assert.equal(rs2.find((r) => r.type === 'split').diffs[0].field, 'Label');
});

test('one-sided fork: every row is one-sided', () => {
  const rs = rows([forkOf()], []);
  assert.ok(rs.length > 4);
  assert.ok(rs.every((r) => r.mark === 'a'));
  assert.ok(rs.every((r) => r.b === undefined));
  assert.deepEqual(counts([forkOf()], []), { changed: 0, onlyA: 1 + 2 + 2, onlyB: 0 });
});

test('choice rows: one-sided branch and default change', () => {
  const a = fork('f', cond('c', 'Decision', ['x', 'y']), [[pause('p1')], [pause('p2')]]);
  const b = fork('f', cond('c', 'Decision', ['x']), [[pause('p1')]]);
  const rs = rows([a], [b]);
  const ch = rs.filter((r) => r.type === 'choice');
  assert.deepEqual(ch.map((r) => r.mark), ['same', 'a']);
  assert.equal(rs[rs.indexOf(ch[1]) + 1].mark, 'a');

  const c = fork('f', cond('c', 'Decision', ['x', 'y']), [[pause('p1')], [pause('p2')]]);
  c.condition = { ...c.condition, defaultChoice: 'y' };
  c.branches[0].isDefault = false;
  c.branches[1].isDefault = true;
  const rs2 = rows([a], [c]);
  const ch2 = rs2.filter((r) => r.type === 'choice');
  assert.deepEqual(ch2.map((r) => r.mark), ['changed', 'changed']);
  assert.equal(ch2[0].diffs[0].field, 'Default');
  assert.deepEqual([ch2[0].a.isDefault, ch2[0].b.isDefault], [true, false]);
  // a default move is one change: the condition's, not one per choice row
  assert.equal(rs2.find((r) => r.type === 'condition').mark, 'changed');
  assert.deepEqual(compareCounts(rs2), { changed: 1, onlyA: 0, onlyB: 0 });
});

test('header row first and changed', () => {
  const rs = compareRows(comparePrograms(program([pause('a')], { comment: 'x' }), program([pause('a')])));
  assert.equal(rs[0].type, 'header');
  assert.equal(rs[0].mark, 'changed');
  assert.equal(rs[0].diffs[0].field, 'Comment');
  assert.equal(rs.length, 2);
  assert.equal(compareRows(comparePrograms(program([]), program([]))).length, 0);
});

test('collapseSame: runs of at least min collapse, structure breaks runs', () => {
  const same = (n) => Array.from({ length: n }, (_, i) => pause(`s${i}`));
  const run = (n) => rows(same(n), same(n));
  assert.deepEqual(collapseSame(run(4), false).map((r) => [r.type, r.count]), [['collapsed', 4]]);
  assert.equal(collapseSame(run(3), false).length, 3);
  assert.equal(collapseSame(run(3), false, 3).length, 1);
  const rs = run(4);
  assert.equal(collapseSame(rs, true).length, 4);
  assert.notEqual(collapseSame(rs, true), rs);
  assert.equal(collapseSame(rs, false)[0].key, `collapsed:${rs[0].key}`);
  assert.equal(collapseSame(rs, false)[0].depth, 0);

  // split/condition/choice/join rows break runs: 2 + 2 same steps around a fork, none collapse.
  const f = fork('f', cond('c', 'Decision', ['x']), [[]]);
  const body = [...same(2), f, ...same(2).map((n) => pause(n.step.label + 'b'))];
  const out = collapseSame(rows(body, body), false);
  assert.ok(out.every((r) => r.type !== 'collapsed'));
  // a changed step also breaks a run
  const x = [...same(3), pause('c', { comment: 'k' }), ...same(3).map((n) => pause(n.step.label + 'b'))];
  const y = [...same(3), pause('c'), ...same(3).map((n) => pause(n.step.label + 'b'))];
  assert.deepEqual(collapseSame(rows(x, y), false).map((r) => r.type), ['step', 'step', 'step', 'step', 'step', 'step', 'step']);
  // runs inside a branch take the branch's depth
  const g = fork('g', cond('cg', 'Decision', ['x']), [same(4).map((n) => pause(n.step.label + 'g'))]);
  const col = collapseSame(rows([g], [g]), false).find((r) => r.type === 'collapsed');
  assert.deepEqual([col.depth, col.count], [1, 4]);
});

test('compareCounts: a fork counts once; join-only and condition-only changes count once', () => {
  assert.deepEqual(counts([pause('a')], [pause('b')]), { changed: 0, onlyA: 1, onlyB: 1 });
  const j = forkOf();
  j.join = { ...j.join, comment: 'jc' };
  assert.deepEqual(counts([forkOf()], [j]), { changed: 1, onlyA: 0, onlyB: 0 });
  const everything = forkOf({ description: 'd' });
  everything.split = { ...everything.split, comment: 's' };
  everything.join = { ...everything.join, comment: 'j' };
  assert.deepEqual(counts([forkOf()], [everything]), { changed: 1, onlyA: 0, onlyB: 0 });
  const cd = forkOf({ description: 'd' });
  assert.deepEqual(counts([forkOf()], [cd]), { changed: 1, onlyA: 0, onlyB: 0 });
  // nested: inner join change counts for the inner fork only
  const inner = (c) => { const f = fork('i', cond('ci', 'Decision', ['u']), [[]]); f.join = { ...f.join, comment: c }; return f; };
  const outer = (c) => fork('o', cond('co', 'Decision', ['x']), [[inner(c)]]);
  assert.deepEqual(counts([outer(null)], [outer('k')]), { changed: 1, onlyA: 0, onlyB: 0 });
  // choices and header
  const a = fork('f', cond('c', 'Decision', ['x', 'y']), [[], []]);
  const b = fork('f', cond('c', 'Decision', ['x']), [[]]);
  assert.deepEqual(counts([a], [b]), { changed: 1, onlyA: 1, onlyB: 0 });
  const withHeader = compareRows(comparePrograms(program([], { comment: 'x' }), program([])));
  assert.deepEqual(compareCounts(withHeader), { changed: 1, onlyA: 0, onlyB: 0 });
});

test('compareCounts: an only-A fork inside a paired branch', () => {
  const inner = fork('i', cond('ci', 'Decision', ['u', 'v']), [[pause('q1')], [pause('q2')]]);
  const outer = (body) => fork('o', cond('co', 'Decision', ['x']), [body]);
  const rs = rows([outer([inner])], [outer([])]);
  assert.deepEqual(rs.filter((r) => r.mark === 'a').map((r) => r.depth), [1, 1, 2, 2, 2, 2, 1]);
  assert.deepEqual(compareCounts(rs), { changed: 0, onlyA: 1 + 2 + 2, onlyB: 0 });
});

test('compareCounts ignores collapsing', () => {
  const same = Array.from({ length: 5 }, (_, i) => pause(`s${i}`));
  const rs = rows([...same, pause('x', { comment: 'k' })], [...same, pause('x')]);
  const collapsed = collapseSame(rs, false);
  assert.ok(collapsed.some((r) => r.type === 'collapsed'));
  assert.deepEqual(compareCounts(collapsed), compareCounts(rs));
  assert.deepEqual(compareCounts(collapsed), { changed: 1, onlyA: 0, onlyB: 0 });
});

test('programCompareStatus', () => {
  assert.equal(programCompareStatus({ changed: 0, onlyA: 0, onlyB: 0 }), 'No differences in steps, decisions or branches');
  assert.equal(programCompareStatus({ changed: 2, onlyA: 0, onlyB: 1 }), '2 changed · 1 only in B');
  assert.equal(programCompareStatus({ changed: 1, onlyA: 3, onlyB: 4 }), '1 changed · 3 only in A · 4 only in B');
  assert.equal(programCompareStatus({ changed: 0, onlyA: 3, onlyB: 0 }), '3 only in A');
});

/** One file f1: region R › exam E › programs P1 (key f1:p:1) and P2 (f1:p:2), a step s:a in P1. */
function workspace() {
  const prog = (n, body) => program(body, { key: `f1:p:${n}`, label: `P${n}` });
  const file = {
    id: 'f1', name: 'one.exar1', size: 1, baseline: 'b', changeset: { id: 'c', dateTime: '', comment: '' }, problems: [],
    regions: [{ key: 'f1:r:1', label: 'R', comment: null, exams: [{ key: 'f1:e:1', label: 'E', comment: null,
      programs: [prog(1, [pause('a', { key: 'f1:s:a' })]), prog(2, [])] }] }],
  };
  return addFile(EMPTY_WORKSPACE, file, SOURCE);
}

test('programPair: exactly two different programs, in order', () => {
  const ws = workspace();
  const pair = programPair(ws, ['f1:p:2', 'f1:p:1']);
  assert.ok(pair);
  assert.equal(pair.a.program.label, 'P2');
  assert.equal(pair.b.program.label, 'P1');
  assert.deepEqual(pair.a.path, ['R', 'E']);
  assert.equal(pair.a.file.name, 'one.exar1');
  assert.equal(programPair(ws, ['f1:p:1']), null);
  assert.equal(programPair(ws, ['f1:p:1', 'f1:p:1']), null);
  assert.equal(programPair(ws, ['f1:p:1', 'f1:p:2', 'f1:p:1']), null);
  assert.equal(programPair(ws, ['f1:p:1', 'f1:s:a']), null);
  assert.equal(programPair(ws, ['f1:p:1', 'f2:p:1']), null);
  assert.equal(programPair(ws, []), null);
});

test('rankWarning names the side and never quotes text', () => {
  const side = (order) => ({ file: {}, path: [], program: program([], { order, label: 'SECRET' }) });
  assert.equal(rankWarning({ a: side('links'), b: side('links') }), null);
  assert.match(rankWarning({ a: side('rank'), b: side('links') }), /^Step order in A /);
  assert.match(rankWarning({ a: side('links'), b: side('rank') }), /^Step order in B /);
  assert.match(rankWarning({ a: side('rank'), b: side('rank') }), /^Step order in A and B /);
  assert.ok(!rankWarning({ a: side('rank'), b: side('rank') }).includes('SECRET'));
});

test('diffValue: none, empty, control characters, add-in content', () => {
  assert.equal(diffValue('Comment', null), '—');
  assert.equal(diffValue('Comment', ''), '(empty)');
  assert.equal(diffValue('Comment', 'a\nb'), 'a\nb');
  assert.equal(diffValue('Comment', 'a\u0001b'), 'a\u2401b');
  assert.equal(diffValue('Add-in', 'present'), 'present');
  assert.equal(diffValue('Add-in content', 'abc123'), 'differs');
});

test('measurementSides: paths end with the program label; only measurements pair', () => {
  const side = (name, label) => ({ file: { id: name, name }, path: ['R', 'E'], program: program([], { label }) });
  const pair = { a: side('fa', 'PA'), b: side('fb', 'PB') };
  const ma = step('Measurement', 'm1', { detail: MEAS });
  const mb = step('Measurement', 'm2', { detail: MEAS });
  const got = measurementSides(pair, ma, mb);
  assert.deepEqual(got?.a.path, ['R', 'E', 'PA']);
  assert.deepEqual(got?.b.path, ['R', 'E', 'PB']);
  assert.equal(got?.a.file, pair.a.file);
  assert.equal(got?.b.step, mb);
  assert.equal(measurementSides(pair, ma, step('Pause', 'p', { detail: PAUSE })), null);
});
