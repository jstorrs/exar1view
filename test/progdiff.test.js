// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePrograms, lcs, diffFacts } from '../src/core/progdiff.js';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { loadExar } from '../src/core/load.js';
import { loadSql } from './sqljs.js';
import { buildExar } from './fixture/builder.js';
import { defaultSpec, variantSpec } from './fixture/spec.js';
import { step, node, cond, fork, program } from './helpers.js';

/** @typedef {import('../src/core/progdiff.js').NodeCmp} NodeCmp */
/** @typedef {import('../src/core/progdiff.js').BranchCmp} BranchCmp */
/** @typedef {import('../src/core/model.js').Program} Program */
/** @typedef {import('../src/core/model.js').BodyNode} BodyNode */

/** A measurement with protocol `blob`. */
const meas = (/** @type {string} */ name, /** @type {string | null} */ blob = `blob:${name}`, more = {}) => node(step('Measurement', name, {
  detail: { protocolBlob: blob, protocolHash: blob, addInBlob: null, bodyPart: null, laterality: null, imageComment: null, openBeforeStart: null },
  ...more,
}));
const pause = (/** @type {string} */ name, more = {}) => node(step('Pause', name, { detail: { applyContrastAgent: null, contrastAgentName: null, contrastAgent: null }, ...more }));

/** Program with `conditions` derived from the forks of the body (all levels). @param {BodyNode[]} body @param {Partial<Program>} [more] */
function prog(body, more = {}) {
  /** @type {import('../src/core/model.js').Condition[]} */
  const conditions = [];
  /** @param {BodyNode[]} nodes */
  const walk = (nodes) => nodes.forEach((n) => {
    if (n.type === 'fork') { conditions.push(n.condition); n.branches.forEach((b) => walk(b.body)); }
  });
  walk(body);
  return program(body, { conditions, ...more });
}

/** A compact rendering: =x same, ~x changed, -x only in A, +x only in B; forks as name(choice: ...; ...). @param {NodeCmp[]} body @returns {string} */
function brief(body) {
  return body.map((n) => {
    const mark = n.in === 'a' ? '-' : n.in === 'b' ? '+' : n.diffs.length > 0 || (n.type === 'step' && n.protocol === 'differs') ? '~' : '=';
    const side = n.in === 'b' ? n.b : n.a;
    if (n.type === 'step') return `${mark}${n.in === 'b' ? n.b.label : n.a.label}`;
    const f = /** @type {import('../src/core/progdiff.js').ForkNode} */ (side);
    return `${mark}${f.condition.label}(${n.branches.map((b) => `${b.in === 'both' ? (b.diffs.length ? '~' : '=') : b.in === 'a' ? '-' : '+'}${(b.in === 'b' ? b.b : b.a).choice.label}:${brief(b.body)}`).join(';')})`;
  }).join(' ');
}

const cmp = (/** @type {BodyNode[]} */ a, /** @type {BodyNode[]} */ b) => comparePrograms(prog(a), prog(b));

test('lcs: earliest matches, A skipped first, repeats in order, null never matches', () => {
  assert.deepEqual(lcs(['a', 'b', 'c'], ['a', 'b', 'c']), [[0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(lcs(['a', 'x', 'c'], ['a', 'c']), [[0, 0], [2, 1]]);
  assert.deepEqual(lcs(['a', 'a'], ['a']), [[0, 0]]);
  assert.deepEqual(lcs(['a', 'b', 'a'], ['b', 'a', 'a']), [[1, 0], [2, 1]]);
  assert.deepEqual(lcs(['x', 't'], ['t', 't']), [[1, 0]]);
  assert.deepEqual(lcs([null, 'a'], [null, 'a']), [[1, 1]]);
  assert.deepEqual(lcs([], ['a']), []);
});

test('diffFacts pairs by label, A first then B-only, and reports string/null differences', () => {
  const d = diffFacts(
    [{ label: 'X', value: '1' }, { label: 'Y', value: null }, { label: 'Z', value: 'z' }],
    [{ label: 'X', value: '2' }, { label: 'Y', value: null }, { label: 'W', value: 'w' }]);
  assert.deepEqual(d, [
    { field: 'X', a: '1', b: '2' },
    { field: 'Z', a: 'z', b: null },
    { field: 'W', a: null, b: 'w' },
  ]);
});

test('identical programs are all same', () => {
  const body = [meas('a'), fork('f', cond('c', 'Decision', ['x', 'y']), [[meas('b'), pause('p')], []]), meas('z')];
  const r = cmp(body, body);
  assert.deepEqual(r.header, []);
  assert.equal(brief(r.body), '=a =c(=x:=b =p;=y:) =z');
  assert.ok(r.body.every((n) => n.in === 'both' && n.diffs.length === 0));
});

test('an inserted step is B-only, a deleted one A-only', () => {
  assert.equal(brief(cmp([meas('a'), meas('c')], [meas('a'), meas('b'), meas('c')]).body), '=a +b =c');
  assert.equal(brief(cmp([meas('a'), meas('b'), meas('c')], [meas('a'), meas('c')]).body), '=a -b =c');
});

test('repeated labels pair in order; a gap lists A-only before B-only', () => {
  const rep = () => meas('t', null);
  assert.equal(brief(cmp([rep(), rep(), pause('q')], [rep(), pause('q')]).body), '=t -t =q');
  assert.equal(brief(cmp([pause('x'), pause('y')], [pause('u'), pause('v')]).body), '-x -y +u +v');
});

test('a rename is caught by the same protocol blob, with a Label diff', () => {
  const a = [meas('old', 'same-blob', { comment: 'c' })];
  const b = [meas('new', 'same-blob', { comment: 'c' })];
  const [n] = cmp(a, b).body;
  assert.ok(n.type === 'step' && n.in === 'both');
  assert.deepEqual(n.diffs, [{ field: 'Label', a: 'old', b: 'new' }]);
  assert.equal(n.protocol, 'same');
});

test('a null blob never weak-matches; different blobs do not either', () => {
  assert.equal(brief(cmp([meas('old', null)], [meas('new', null)]).body), '-old +new');
  assert.equal(brief(cmp([meas('old', 'x')], [meas('new', 'y')]).body), '-old +new');
});

test('a measurement with the same label and a changed or one-sided missing protocol is a changed pair; none on both sides is missing', () => {
  const [d] = cmp([meas('m', 'x')], [meas('m', 'y')]).body;
  assert.ok(d.type === 'step' && d.in === 'both');
  assert.equal(d.protocol, 'differs');
  assert.deepEqual(d.diffs, []);
  assert.equal(brief([d]), '~m');
  const [m] = cmp([meas('m', null)], [meas('m', 'y')]).body;
  assert.ok(m.type === 'step' && m.in === 'both');
  assert.equal(m.protocol, 'differs');
  assert.equal(brief([m]), '~m');
  const [z] = cmp([meas('m', null)], [meas('m', null)]).body;
  assert.ok(z.type === 'step' && z.in === 'both');
  assert.equal(z.protocol, 'missing');
  assert.equal(brief([z]), '=m');
  const [p] = cmp([pause('p')], [pause('p')]).body;
  assert.ok(p.type === 'step' && p.protocol === undefined);
});

test('a renamed condition is caught by its kind and choices', () => {
  const a = prog([fork('f', cond('old', 'Decision', ['x', 'y']), [[], []])]);
  const b = prog([fork('f', cond('new', 'Decision', ['x', 'y']), [[], []])]);
  const [n] = comparePrograms(a, b).body;
  assert.ok(n.type === 'fork' && n.in === 'both');
  assert.deepEqual(n.diffs.map((d) => d.field), ['Condition']);
  assert.equal(n.diffs[0].a, 'Decision: old');
  assert.equal(n.diffs[0].b, 'Decision: new');
  // A different kind or other choices is not a rename.
  const c = prog([fork('f', cond('new', 'Strategy', ['x', 'y']), [[], []])]);
  assert.equal(brief(comparePrograms(a, c).body), '-old(-x:;-y:) +new(+x:;+y:)');
});

test('branches pair by label whatever their order: A order, then B-only; the split shows the choice order', () => {
  const ca = cond('c', 'Decision', ['x', 'y']);
  const a = fork('f', ca, [[meas('1')], [meas('2')]]);
  const b = fork('f', cond('c', 'Decision', ['y', 'x', 'z']), [[meas('2')], [meas('1')], [meas('3')]]);
  const [n] = cmp([a], [b]).body;
  assert.ok(n.type === 'fork' && n.in === 'both');
  assert.deepEqual(n.diffs, [{ field: 'Choices', a: 'x (default), y', b: 'y (default), x, z' }]);
  assert.deepEqual(n.branches.map((br) => (br.in === 'b' ? br.b : br.a).choice.label), ['x', 'y', 'z']);
  assert.equal(brief([n]), '~c(~x:=1;~y:=2;+z:+3)');
});

test('an added and a removed choice leave one-sided branches, whole subtree one-sided', () => {
  const inner = fork('g', cond('g', 'Decision', ['p', 'q']), [[meas('deep')], []]);
  const a = fork('f', cond('c', 'Decision', ['x', 'y']), [[], [inner]]);
  const b = fork('f', cond('c', 'Decision', ['x', 'w']), [[], [meas('new')]]);
  const r = cmp([a], [b]);
  // Choices differ, so the conditions' weak keys differ, but the strong key (kind, label) matches.
  assert.equal(brief(r.body), '~c(=x:;-y:-g(-p:-deep;-q:);+w:+new)');
});

test('a changed default shows on the branches and in the Choices of the split', () => {
  const c = cond('c', 'Decision', ['x', 'y']);
  const a = fork('f', c, [[], []]);
  const b = fork('f', { ...c, defaultChoice: 'y' }, [[], []]);
  b.branches = b.branches.map((br, i) => ({ ...br, isDefault: i === 1 }));
  const [n] = cmp([a], [b]).body;
  assert.ok(n.type === 'fork' && n.in === 'both');
  assert.deepEqual(n.diffs, [{ field: 'Choices', a: 'x (default), y', b: 'x, y (default)' }]);
  assert.deepEqual(n.branches.map((br) => br.in === 'both' && br.diffs), [
    [{ field: 'Default', a: 'yes', b: 'no' }],
    [{ field: 'Default', a: 'no', b: 'yes' }],
  ]);
});

test('nested forks align recursively', () => {
  const inner = (/** @type {string} */ m) => fork('g', cond('g', 'Decision', ['p', 'q']), [[meas(m)], []]);
  const outer = (/** @type {BodyNode} */ i) => fork('f', cond('c', 'Strategy', ['x', 'y']), [[i, meas('tail')], [pause('w')]]);
  const r = cmp([outer(inner('m1'))], [outer(inner('m2'))]);
  assert.equal(brief(r.body), '=c(=x:=g(=p:-m1 +m2;=q:) =tail;=y:=w)');
});

test('empty branches and empty bodies compare as same', () => {
  const c = cond('c', 'Decision', ['x', 'y']);
  assert.deepEqual(cmp([], []).body, []);
  assert.equal(brief(cmp([fork('f', c, [[], []])], [fork('f', c, [[], []])]).body), '=c(=x:;=y:)');
  assert.equal(brief(cmp([], [fork('f', c, [[], []])]).body), '+c(+x:;+y:)');
});

test('renaming the split or join of a fork is a change', () => {
  const c = cond('c', 'Decision', ['x']);
  const fa = fork('f', c, [[]]);
  const fb = fork('f', c, [[]]);
  fb.split = { ...fb.split, label: 'Split2' };
  fb.join = { ...fb.join, label: 'Join2' };
  const [n] = cmp([fa], [fb]).body;
  assert.ok(n.in === 'both');
  assert.deepEqual(n.diffs, [
    { field: 'Label', a: 'f-split', b: 'Split2' },
    { field: 'Join Label', a: 'f-join', b: 'Join2' },
  ]);
});

test('copy references are compared per step: dropped, added and changed ones', () => {
  const ref = (/** @type {string} */ source, /** @type {string} */ target, /** @type {string} */ group, broken = false) => ({ source, target, group, broken, flags: { CopySlices: true } });
  const body = () => [meas('a'), meas('b'), meas('c')];
  const a = prog(body(), { copyRefs: [ref('o:a', 'o:b', 'G'), ref('o:a', 'o:c', 'G')] });
  const same = comparePrograms(a, prog(body(), { copyRefs: [ref('o:a', 'o:c', 'G'), ref('o:a', 'o:b', 'G')] }));
  assert.equal(brief(same.body), '=a =b =c');
  const dropped = comparePrograms(a, prog(body(), { copyRefs: [ref('o:a', 'o:b', 'G')] }));
  assert.equal(brief(dropped.body), '~a =b ~c');
  const [na] = dropped.body;
  assert.ok(na.in === 'both');
  assert.deepEqual(na.diffs, [{ field: 'Copies to c (G)', a: 'copy slices', b: null }]);
  const broke = comparePrograms(a, prog(body(), { copyRefs: [ref('o:a', 'o:b', 'G', true), ref('o:a', 'o:c', 'G')] }));
  assert.equal(brief(broke.body), '~a ~b =c');
});

test('comment and tag changes show on steps, forks (split and join) and the program header', () => {
  const a = prog([pause('p', { comment: 'one', tags: { K: 'v', G: 'g' } })], { comment: null, tags: { A: '1' } });
  const b = prog([pause('p', { comment: 'two', tags: { K: 'w' } })], { comment: 'hello', tags: {} });
  const r = comparePrograms(a, b);
  assert.deepEqual(r.header, [
    { field: 'Comment', a: null, b: 'hello' },
    { field: 'Tag A', a: '1', b: null },
  ]);
  const [n] = r.body;
  assert.ok(n.in === 'both');
  assert.deepEqual(n.diffs, [
    { field: 'Comment', a: 'one', b: 'two' },
    { field: 'Tag K', a: 'v', b: 'w' },
    { field: 'Tag G', a: 'g', b: null },
  ]);

  const c = cond('c', 'Decision', ['x']);
  const fa = fork('f', c, [[]]);
  const fb = fork('f', c, [[]]);
  fb.join = { ...fb.join, comment: 'j', tags: { T: '1' } };
  fb.split = { ...fb.split, comment: 's' };
  const [f] = cmp([fa], [fb]).body;
  assert.ok(f.in === 'both');
  assert.deepEqual(f.diffs, [
    { field: 'Comment', a: null, b: 's' },
    { field: 'Join Comment', a: null, b: 'j' },
    { field: 'Join Tag T', a: null, b: '1' },
  ]);
});

test('an add-in is present/absent, or differs by blob', () => {
  const m = (/** @type {string | null} */ addIn) => {
    const n = meas('m');
    if (n.type === 'step' && n.step.kind === 'Measurement') n.step.detail.addInBlob = addIn;
    return n;
  };
  const diffs = (/** @type {string | null} */ x, /** @type {string | null} */ y) => {
    const [n] = cmp([m(x)], [m(y)]).body;
    return n.in === 'both' ? n.diffs : null;
  };
  assert.deepEqual(diffs('h', 'h'), []);
  assert.deepEqual(diffs(null, null), []);
  assert.deepEqual(diffs(null, 'h'), [{ field: 'Add-in', a: 'none', b: 'present' }]);
  assert.deepEqual(diffs('h1', 'h2'), [{ field: 'Add-in content', a: 'h1', b: 'h2' }]);
});

test('swapping A and B mirrors the result of one example without shared gaps', () => {
  const c = cond('c', 'Decision', ['x', 'y']);
  const a = prog([meas('a'), meas('old', 'p'), fork('f', c, [[meas('1')], [pause('2')]]), pause('only-a')], { comment: 'x' });
  const b = prog([meas('a'), pause('only-b'), meas('new', 'p'), fork('f', c, [[meas('1', 'other')], []])], { tags: { T: '1' } });
  /** @param {unknown} v @returns {unknown} */
  const mirror = (v) => {
    if (Array.isArray(v)) return v.map(mirror);
    if (v === null || typeof v !== 'object') return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [
      k === 'a' ? 'b' : k === 'b' ? 'a' : k,
      k === 'in' ? (x === 'a' ? 'b' : x === 'b' ? 'a' : x) : mirror(x),
    ]));
  };
  const ab = comparePrograms(a, b);
  assert.equal(brief(ab.body), '=a +only-b ~old =c(=x:~1;=y:-2) -only-a');
  assert.deepEqual(comparePrograms(b, a), mirror(ab));
});

/** No one-sided node, no diffs, no changed protocol, at any depth. @param {NodeCmp[]} body @returns {boolean} */
const allSame = (body) => body.every((n) => n.in === 'both' && n.diffs.length === 0
  && (n.type === 'fork' ? n.branches.every((b) => b.in === 'both' && b.diffs.length === 0 && allSame(b.body)) : n.protocol !== 'differs'));

/** The programs of a built fixture, by label. @param {import('./fixture/spec.js').ExarSpec} spec */
async function programsOf(spec) {
  const bytes = buildExar(spec);
  const { db, close } = openDb(await loadSql(), bytes);
  try {
    const res = await loadExar(db, inflateRaw, { id: 'f1', name: 't.exar1', size: bytes.length }, () => {});
    assert.ok(res.ok);
    return new Map(res.file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs)).map((p) => [p.label, p]));
  } finally {
    close();
  }
}

test('the fixture and its variant: untouched programs are all same, the edited one is marked', async () => {
  const [pa, pb] = await Promise.all([programsOf(defaultSpec), programsOf(variantSpec)]);
  for (const [label, p] of pa) {
    if (label === 'Axial T2') continue;
    const q = /** @type {Program} */ (pb.get(label));
    const r = comparePrograms(p, q);
    assert.deepEqual(r.header, [], label);
    assert.ok(allSame(r.body), label);
  }

  const r = comparePrograms(/** @type {Program} */ (pa.get('Axial T2')), /** @type {Program} */ (pb.get('Axial T2')));
  assert.deepEqual(r.header, []);
  // The extra pause is added; the renamed T1 and the re-protocoled T2 fast are changed; Standard and
  // Fast swapped the default and are changed branches; the Choices of the split changed.
  assert.equal(brief(r.body), '=Survey +Wait a moment ~Variant('
    + '~Standard:=Contrast? =Contrast agent(=With contrast:=Inject contrast =T1 post;=Without contrast:~T1 native) =T2 TSE transversal'
    + ';~Fast:~T2 fast;=Skip:) =Send images');
  const variant = r.body.find((n) => n.type === 'fork');
  assert.ok(variant?.type === 'fork' && variant.in === 'both');
  assert.deepEqual(variant.diffs.map((d) => d.field), ['Choices']);
  const [standard, fast] = variant.branches;
  assert.ok(standard.in === 'both' && fast.in === 'both');
  assert.deepEqual(standard.diffs, [{ field: 'Default', a: 'yes', b: 'no' }]);
  assert.deepEqual(fast.diffs, [{ field: 'Default', a: 'no', b: 'yes' }]);
  const t2fast = fast.body[0];
  assert.ok(t2fast.type === 'step' && t2fast.in === 'both');
  assert.equal(t2fast.protocol, 'differs');
  assert.deepEqual(t2fast.diffs, []);
  const contrast = standard.body.find((n) => n.type === 'fork');
  const without = contrast?.type === 'fork' ? contrast.branches[1] : null;
  const t1 = without?.body[0];
  assert.ok(t1?.type === 'step' && t1.in === 'both');
  assert.equal(t1.protocol, 'same');
  assert.deepEqual(t1.diffs, [{ field: 'Label', a: 'T1 native', b: 'T1 native, renamed' }]);
});

/** The moved nodes of a comparison, pre-order, as `side:label:id`. @param {NodeCmp[]} body @returns {string[]} */
function movedOf(body) {
  return body.flatMap((n) => (n.type === 'fork'
    ? n.branches.flatMap((b) => movedOf(b.body))
    : n.moved ? [`${n.in}:${(n.in === 'b' ? n.b : n.a).label}:${n.moved.id}`] : []));
}

test('moved: a step reordered past others is marked on both sides', () => {
  const c = cmp([pause('x'), pause('y'), pause('z')], [pause('z'), pause('x'), pause('y')]);
  assert.equal(brief(c.body), '+z =x =y -z');
  assert.deepEqual(movedOf(c.body), ['b:z:0', 'a:z:0']);
});

test('moved: out of a branch and into a newly added branch', () => {
  const f = (/** @type {BodyNode[][]} */ bodies) => fork('f', cond('c', 'Decision', ['x', 'y'].slice(0, bodies.length)), bodies);
  assert.deepEqual(movedOf(cmp([f([[pause('m')], []])], [f([[], []]), pause('m')]).body), ['a:m:0', 'b:m:0']);
  assert.deepEqual(movedOf(cmp([pause('m'), f([[]])], [f([[], [pause('m')]])]).body), ['a:m:0', 'b:m:0']);
});

test('moved: changed fields are carried, the pair shares id and diffs', () => {
  const c = cmp([pause('x', { comment: 'one' }), pause('y')], [pause('y'), pause('x', { comment: 'two' })]);
  const moved = c.body.flatMap((n) => (n.type === 'step' && n.moved ? [n.moved] : []));
  assert.equal(moved.length, 2);
  assert.equal(moved[0], moved[1]);
  assert.deepEqual(moved[0].diffs, [{ field: 'Comment', a: 'one', b: 'two' }]);
});

test('moved: duplicates pair in order', () => {
  const c = cmp([pause('d', { comment: '1' }), pause('d', { comment: '2' }), pause('y'), pause('z'), pause('w')],
    [pause('y'), pause('z'), pause('w'), pause('d', { comment: '2' }), pause('d', { comment: '1' })]);
  const moved = c.body.flatMap((n) => (n.type === 'step' && n.in === 'a' && n.moved ? [n.moved] : []));
  assert.deepEqual(moved.map((m) => m.diffs), [[{ field: 'Comment', a: '1', b: '2' }], [{ field: 'Comment', a: '2', b: '1' }]]);
  assert.notEqual(moved[0].id, moved[1].id);
});

test('moved: never a Split or Join, never by the weak key alone, protocol carried', () => {
  const f = (/** @type {BodyNode[]} */ body) => fork('f', cond('c', 'Decision', ['x']), [body]);
  const rank = { order: /** @type {const} */ ('rank') };
  const split = (/** @type {string} */ n) => node(step('Split', n));
  const join = (/** @type {string} */ n) => node(step('Join', n));
  const ranked = comparePrograms(prog([split('S'), pause('x'), join('J'), pause('y'), pause('z')], rank), prog([pause('x'), pause('y'), pause('z'), split('S'), join('J')], rank));
  assert.deepEqual(movedOf(ranked.body), []);
  const forkWith = (/** @type {string} */ id, /** @type {string[]} */ choices) => {
    const fk = fork('same', cond(id, 'Decision', choices), choices.map(() => []));
    return fk;
  };
  assert.deepEqual(movedOf(cmp([forkWith('c1', ['x', 'y']), pause('q')], [pause('q'), forkWith('c2', ['u', 'v'])]).body), []);
  const renamed = cmp([meas('a', 'same'), pause('y')], [pause('y'), meas('b', 'same')]);
  assert.deepEqual(movedOf(renamed.body), []);
  const c = cmp([meas('a', 'p1'), pause('y')], [pause('y'), meas('a', 'p2')]);
  assert.deepEqual(c.body.flatMap((n) => (n.type === 'step' && n.moved ? [n.moved.protocol] : [])), ['differs', 'differs']);
});

test('moved: a plain insertion is not a move', () => {
  const a = [pause('x'), pause('y')];
  const b = [pause('x'), pause('y'), pause('n')];
  assert.deepEqual(movedOf(cmp(a, b).body), []);
});
