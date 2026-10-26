import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegions } from '../src/core/tree.js';
import { FormatError } from '../src/core/errors.js';

const NIL = '00000000-0000-0000-0000-000000000000';
/** A program document with no steps. */
const EMPTY_PROGRAM = {
  BodyPartExamined: '', Conditions: {}, FirstStepId: NIL, LastStepId: NIL, Laterality: '',
  LinksFrom: {}, LinksTo: {}, Ranks: {}, RelationsFrom: {}, RelationsTo: {},
};

/** Hand-built head data: directories, programs and strings as parsed instance rows. */
function world() {
  let n = 0;
  const guid = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const instances = new Map();
  const docs = new Map();
  const add = (type, body, extra = {}) => {
    const element = guid();
    const contentHash = `hash-${element}`;
    docs.set(contentHash, { ok: true, type: `${type}Content`, body });
    const row = { id: guid(), element, object: guid(), type, contentHash, tags: {}, parent: null, label: null, description: null, ...extra };
    instances.set(element, row);
    return row;
  };
  const text = (t) => add('EdfString', { Dates: {}, Texts: { en: t } }).element;
  return {
    instances,
    docs,
    add,
    /** A directory node; children are nodes, programs are rows. */
    dir: (label, dirs = [], programs = [], extra = {}) => ({
      row: add('EdfDirectory', { IsProtected: false }, { label: text(label), ...extra }), dirs, programs,
    }),
    prog: (label, extra = {}) => add('EdfProgram', EMPTY_PROGRAM, { label: text(label), ...extra }),
    text,
    /** Add the structure document for the tree under `root`. */
    structure(root, { rootId = root.row.object, extraSub = {}, extraProg = {} } = {}) {
      const subdirs = { ...extraSub };
      const subprograms = { ...extraProg };
      const walk = (node) => {
        subdirs[node.row.object] = [...(subdirs[node.row.object] ?? []), ...node.dirs.map((d) => d.row.object)];
        subprograms[node.row.object] = [...(subprograms[node.row.object] ?? []), ...node.programs.map((p) => p.element)];
        node.dirs.forEach(walk);
      };
      walk(root);
      return add('EdfStructure', { RootDirectoryId: rootId, SubdirectoryIds: subdirs, SubprogramElementIds: subprograms });
    },
    head: () => ({ fileId: 'f9', instances, docs }),
  };
}

const outline = (regions) =>
  regions.map((r) => [r.label, r.exams.map((e) => [e.label, e.programs.map((p) => p.label)])]);

test('Root > New Tree > region > exam > program', () => {
  const w = world();
  const p1 = w.prog('P1');
  const p2 = w.prog('P2');
  w.structure(w.dir('Root', [w.dir('New Tree', [
    w.dir('R1', [w.dir('E1', [], [p1, p2]), w.dir('E2')]),
    w.dir('R2', [w.dir('E3', [], [w.prog('P3')])]),
  ])]));
  const { regions, problems } = buildRegions(w.head());
  assert.deepEqual(problems, []);
  assert.deepEqual(outline(regions), [
    ['R1', [['E1', ['P1', 'P2']], ['E2', []]]],
    ['R2', [['E3', ['P3']]]],
  ]);
  assert.deepEqual(regions.map((r) => r.tree), [null, null]);
  assert.deepEqual(regions[0].exams[0].programs[0].path, ['R1', 'E1', 'P1']);
  assert.equal(regions[0].exams[0].programs[0].key, `f9:p:${p1.element}`);
});

test('directory and program comments come from the description string; empty is null', () => {
  const w = world();
  const withComment = w.prog('P1', { description: w.text('note') });
  const emptyComment = w.prog('P2', { description: w.text('') });
  w.structure(w.dir('Root', [w.dir('New Tree', [w.dir('R', [w.dir('E', [], [withComment, emptyComment], { description: w.text('exam note') })])])]));
  const { regions } = buildRegions(w.head());
  assert.equal(regions[0].exams[0].comment, 'exam note');
  assert.equal(regions[0].exams[0].programs[0].comment, 'note');
  assert.equal(regions[0].exams[0].programs[1].comment, null);
});

test('a program directly in a region goes to a synthetic exam, with a warning', () => {
  const w = world();
  w.structure(w.dir('Root', [w.dir('New Tree', [w.dir('R', [w.dir('E', [], [w.prog('P1')])], [w.prog('Loose')])])]));
  const { regions, problems } = buildRegions(w.head());
  assert.deepEqual(outline(regions), [['R', [['E', ['P1']], ['(programs directly in R)', ['Loose']]]]]);
  assert.deepEqual(regions[0].exams[1].programs[0].path, ['R', '(programs directly in R)', 'Loose']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /Root › New Tree › R/);
});

test('programs above region level get a synthetic region', () => {
  const w = world();
  w.structure(w.dir('Root', [w.dir('New Tree', [w.dir('R', [w.dir('E')])], [w.prog('InNewTree')])], [w.prog('InRoot')]));
  const { regions, problems } = buildRegions(w.head());
  assert.deepEqual(regions[0].exams[0].programs[0].path, ['(programs directly in Root)', 'InRoot']);
  assert.deepEqual(outline(regions), [
    ['(programs directly in Root)', [['(programs directly in Root)', ['InRoot']]]],
    ['(programs directly in New Tree)', [['(programs directly in New Tree)', ['InNewTree']]]],
    ['R', [['E', []]]],
  ]);
  assert.equal(problems.length, 2);
});

test('a directory below exam level gives its programs to the exam, with a warning', () => {
  const w = world();
  w.structure(w.dir('Root', [w.dir('New Tree', [w.dir('R', [w.dir('E', [w.dir('Deep', [w.dir('Deeper', [], [w.prog('P3')])], [w.prog('P2')])], [w.prog('P1')])])])]));
  const { regions, problems } = buildRegions(w.head());
  assert.deepEqual(outline(regions), [['R', [['E', ['P1', 'P2', 'P3']]]]]);
  assert.deepEqual(regions[0].exams[0].programs[2].path, ['R', 'E', 'Deep', 'Deeper', 'P3']);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.level === 'warning' && /below exam level/.test(p.message)));
});

test('several trees: regions are still the grandchildren of the root, each recording its tree', () => {
  const w = world();
  w.structure(w.dir('Root', [
    w.dir('New Tree'),
    w.dir('A', [w.dir('R1', [w.dir('E1', [], [w.prog('P1')])])]),
    w.dir('B', [w.dir('R2', [w.dir('E2')]), w.dir('R3')]),
  ]));
  const { regions, problems } = buildRegions(w.head());
  assert.deepEqual(problems, []);
  assert.deepEqual(outline(regions), [['R1', [['E1', ['P1']]]], ['R2', [['E2', []]]], ['R3', []]]);
  assert.deepEqual(regions.map((r) => r.tree?.label), ['A', 'B', 'B']);
  assert.ok(regions[0].tree?.key.startsWith('f9:t:'));
  assert.equal(regions[1].tree, regions[2].tree);
  assert.notEqual(regions[0].tree?.key, regions[1].tree?.key);
  assert.deepEqual(regions[0].exams[0].programs[0].path, ['A › R1', 'E1', 'P1']);
});

test('missing children, repeats and cycles are warnings and skipped', () => {
  const w = world();
  const shared = w.prog('Shared');
  const e1 = w.dir('E1', [], [shared]);
  const ghost = '00000000-0000-4000-8000-00000000ffff';
  const notAProgram = w.text('not a program');
  const e2 = w.dir('E2');
  const region = w.dir('R', [e1, e2]);
  const root = w.dir('Root', [w.dir('New Tree', [region])]);
  w.structure(root, {
    extraSub: { [region.row.object]: [ghost, e1.row.object, root.row.object] },   // missing, repeat, cycle
    extraProg: { [e2.row.object]: [shared.element, notAProgram, ghost] },          // repeat, wrong type, missing
  });
  const { regions, problems } = buildRegions(w.head());
  assert.deepEqual(outline(regions), [['R', [['E1', ['Shared']], ['E2', []]]]]);
  assert.equal(problems.length, 6);
  assert.ok(problems.every((p) => p.level === 'warning'));
});

test('a label that cannot be resolved shows a placeholder and a warning', () => {
  const w = world();
  const p = w.prog('P1');
  p.label = '00000000-0000-4000-8000-00000000ffff';
  w.structure(w.dir('Root', [w.dir('New Tree', [w.dir('R', [w.dir('E', [], [p])])])]));
  const { regions } = buildRegions(w.head());
  const program = regions[0].exams[0].programs[0];
  assert.equal(program.label, '(no label)');
  assert.equal(program.problems.length, 1);
  assert.equal(program.problems[0].where, program.key);
});

test('a missing or unusable structure is fatal', () => {
  const none = world();
  assert.throws(() => buildRegions(none.head()), FormatError);

  const two = world();
  const root = two.dir('Root');
  two.structure(root);
  two.structure(root);
  assert.throws(() => buildRegions(two.head()), /exactly one EdfStructure, found 2/);

  const noRoot = world();
  noRoot.structure(noRoot.dir('Root'), { rootId: '00000000-0000-4000-8000-00000000ffff' });
  assert.throws(() => buildRegions(noRoot.head()), /root directory .* is not in the head/);
});

test('programs and directories the walk never reaches are warned about; programs stay browsable', () => {
  const w = world();
  const orphan = w.prog('Orphan');
  const lostDir = w.dir('Lost', [], [w.prog('InLost')]);
  w.structure(w.dir('Root', [w.dir('New Tree', [w.dir('R', [w.dir('E')])])]));
  const { regions, problems } = buildRegions(w.head());
  const last = regions.at(-1);
  assert.equal(last.label, '(unplaced programs)');
  assert.deepEqual(last.exams[0].programs.map((p) => p.label).sort(), ['InLost', 'Orphan']);
  assert.deepEqual(last.exams[0].programs[0].path.length, 2);
  const where = problems.map((p) => p.where);
  assert.ok(where.includes(`directory ${lostDir.row.object}`));
  assert.ok(where.includes(`program ${orphan.element}`));
  assert.equal(problems.length, 3);
});

test('malformed structure lists are warnings, not fatal', () => {
  const w = world();
  const e = w.dir('E');
  const region = w.dir('R', [e]);
  const root = w.dir('Root', [w.dir('New Tree', [region])]);
  const st = w.structure(root);
  w.docs.get(st.contentHash).body.SubdirectoryIds[e.row.object] = 'nope';
  w.docs.get(st.contentHash).body.SubprogramElementIds[region.row.object] = [42];
  const { regions, problems } = buildRegions(w.head());
  assert.deepEqual(outline(regions), [['R', [['E', []]]]]);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.level === 'warning' && p.where.startsWith('directory ')));

  const missing = world();
  const s2 = missing.structure(missing.dir('Root'));
  delete missing.docs.get(s2.contentHash).body.SubdirectoryIds;
  const res = buildRegions(missing.head());
  assert.deepEqual(res.regions, []);
  assert.match(res.problems[0].message, /SubdirectoryIds is unusable/);
});

test('two directories with one ObjectId: the second is skipped with a warning', () => {
  const w = world();
  const p = w.prog('P');
  const e = w.dir('E', [], [p]);
  const region = w.dir('R', [e]);
  w.dir('Twin', [], [], { object: e.row.object });
  w.structure(w.dir('Root', [w.dir('New Tree', [region])]));
  const { regions, problems } = buildRegions(w.head());
  assert.deepEqual(outline(regions), [['R', [['E', ['P']]]]]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /same ObjectId/);
});
