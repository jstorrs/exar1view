// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_WORKSPACE, addFile, removeFile } from '../src/core/workspace.js';
import { filterFile } from '../src/core/search.js';
import {
  initialState, isExpandedFn, buildRows, reconcile, anchorKey, keyToAction, applyAction,
  selectFile, setQuery, revealState, revealStepState, ancestorKeys, splitWhitespace,
} from '../src/core/treeview.js';

/** @typedef {import('../src/core/model.js').ExarFile} ExarFile */
/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/core/model.js').Program} Program */
/** @typedef {import('../src/core/model.js').Problem} Problem */
/** @typedef {import('../src/core/treeview.js').ViewState} ViewState */
/** @typedef {import('../src/core/search.js').Filter} Filter */

/** @param {string} key @param {string} label @param {Problem[]} [problems] @returns {Step} */
const step = (key, label, problems = []) => /** @type {Step} */ ({
  key, ids: { element: key, instance: key, object: key }, label, comment: null, tags: {}, rank: null, problems,
  kind: 'Pause', detail: { applyContrastAgent: null, contrastAgentName: null, contrastAgent: null },
});
/** @param {string} key @param {string} label @param {Step[]} steps @param {Problem[]} [problems] @returns {Program} */
const program = (key, label, steps, problems = []) => ({
  key, ids: { element: key, object: key }, label, comment: null, tags: {}, path: [],
  body: steps.map((s) => ({ type: 'step', step: s })), conditions: [], copyRefs: [], order: 'links', problems,
});
const warn = (/** @type {string} */ where) => /** @type {Problem} */ ({ level: 'warning', where, message: 'm' });
/** @param {string} id @param {ExarFile['regions']} regions @returns {ExarFile} */
const exar = (id, regions) => ({
  id, name: `${id}.exar1`, size: 0, baseline: '', changeset: { id: '', dateTime: '', comment: '' }, problems: [], regions,
});

const fileA = exar('f1', [
  { key: 'f1:r1', label: 'Brain', comment: null, exams: [
    { key: 'f1:e1', label: 'Routine', comment: null, programs: [
      program('f1:p1', 'Head', [step('f1:s1', 'localizer'), step('f1:s2', 'MPRAGE', [warn('f1:s2')])], [warn('f1:p1')]),
      program('f1:p2', 'Neck', [step('f1:s3', 'tse')]),
    ] },
    { key: 'f1:e2', label: 'Empty', comment: null, programs: [] },
  ] },
  { key: 'f1:r2', label: 'Spine', comment: null, exams: [
    { key: 'f1:e3', label: 'Full', comment: null, programs: [program('f1:p4', 'Sag', [step('f1:s4', 'T2')])] },
  ] },
]);
const fileB = exar('f2', [{ key: 'f2:rb', label: 'Other', comment: null, exams: [] }]);
const src = { name: 'x', size: 0, lastModified: 0 };
const ws = addFile(addFile(EMPTY_WORKSPACE, fileA, src), fileB, { ...src, name: 'y' });

/** @param {Partial<ViewState>} over @returns {ViewState} */
const st = (over = {}) => ({ ...initialState(), fileId: 'f1', ...over });
/** @param {ViewState} s @param {Filter | null} [f] */
const rowsOf = (s, f = null) => buildRows(fileA, isExpandedFn(s, f), f);
const keys = (/** @type {readonly {key:string}[]} */ rs) => rs.map((r) => r.key.slice(3));

test('buildRows: collapsed shows regions only; counts and expandable flags', () => {
  const rows = rowsOf(st());
  assert.deepEqual(keys(rows), ['r1', 'r2']);
  assert.deepEqual(rows.map((r) => [r.level, r.count, r.expandable, r.expanded]), [[1, 2, true, false], [1, 1, true, false]]);
});

test('buildRows: expansion shows exams and programs; programs and empty exams are not expandable', () => {
  const rows = rowsOf(st({ expanded: new Set(['f1:r1', 'f1:e1', 'f1:e2']) }));
  assert.deepEqual(keys(rows), ['r1', 'e1', 'p1', 'p2', 'e2', 'r2']);
  const p1 = rows.find((r) => r.key === 'f1:p1');
  assert.equal(p1?.expandable, false);
  assert.equal(p1?.count, 2);
  assert.equal(p1?.parentKey, 'f1:e1');
  assert.equal(rows.find((r) => r.key === 'f1:e2')?.expandable, false);
});

test('buildRows: problem counts include the steps\'; step hits count under a search', () => {
  const rows = rowsOf(st({ expanded: new Set(['f1:r1', 'f1:e1']) }));
  assert.deepEqual(rows.map((r) => r.problems), [0, 0, 2, 0, 0, 0]);
  const f = filterFile(fileA, 'e');
  const hit = rowsOf(st({ expanded: new Set(['f1:r1', 'f1:e1']) }), f);
  assert.equal(hit.find((r) => r.key === 'f1:p1')?.hits, 2);
  assert.equal(hit.find((r) => r.key === 'f1:p2')?.hits, 1);
  assert.ok(rows.every((r) => r.hits === 0));
});

test('filter expansion is a pure function of (query, user expansion), independent of typing history', () => {
  const f = filterFile(fileA, 'mprage');
  assert.deepEqual(keys(rowsOf(st(), f)), ['r1', 'e1', 'p1']);
  let s = st();
  for (const q of ['m', 'mp', 'mpr', 'mprage']) s = setQuery(ws, s, q);
  assert.deepEqual(keys(rowsOf(s, f)), ['r1', 'e1', 'p1']);
  // Leaving the filter restores the user's own (empty) expansion.
  s = setQuery(ws, s, '');
  assert.deepEqual(keys(rowsOf(s)), ['r1', 'r2']);
});

test('toggles during a filter are overrides, dropped when the query changes', () => {
  const f = filterFile(fileA, 'mprage');
  let s = setQuery(ws, st(), 'mprage');
  s = applyAction(ws, s, f, { type: 'collapse', key: 'f1:r1' });
  assert.deepEqual(keys(rowsOf(s, f)), ['r1']);
  assert.equal(s.expanded.has('f1:r1'), false);
  s = setQuery(ws, s, 'mprag');
  assert.equal(s.overrides.size, 0);
  assert.deepEqual(keys(rowsOf(s, filterFile(fileA, 'mprag'))), ['r1', 'e1', 'p1']);
});

test('leaving a filter keeps the path to the selection visible', () => {
  let s = setQuery(ws, st({ selected: 'f1:p4' }), 'sag');
  s = setQuery(ws, s, '');
  assert.deepEqual(keys(rowsOf(s)), ['r1', 'r2', 'e3', 'p4']);
});

test('ancestorKeys: nearest first, the file excluded; unknown key gives []', () => {
  assert.deepEqual(ancestorKeys(ws, 'f1:p2'), ['f1:e1', 'f1:r1']);
  assert.deepEqual(ancestorKeys(ws, 'f1:s2'), ['f1:p1', 'f1:e1', 'f1:r1']);
  assert.deepEqual(ancestorKeys(ws, 'f1:r1'), []);
  assert.deepEqual(ancestorKeys(ws, 'f1'), []);
  assert.deepEqual(ancestorKeys(ws, 'f1:nope'), []);
});

test('reconcile: a closed file falls back to the first file and clears selection', () => {
  const s = reconcile(ws, st({ fileId: 'f9', selected: 'f1:p1' }));
  assert.equal(s.fileId, 'f1');
  assert.equal(s.selected, null);
  const closed = reconcile(removeFile(ws, 'f1'), st({ selected: 'f1:p1' }));
  assert.equal(closed.fileId, 'f2');
  assert.equal(closed.selected, null);
  const none = reconcile(EMPTY_WORKSPACE, st({ selected: 'f1:p1' }));
  assert.deepEqual([none.fileId, none.selected], [null, null]);
  // Consistent state is returned as is.
  const ok = st({ selected: 'f1:p1' });
  assert.equal(reconcile(ws, ok), ok);
  const empty = initialState();
  assert.equal(reconcile(EMPTY_WORKSPACE, empty), empty);
});

test('reconcile: a selection in another file, a step or an unknown key is not kept', () => {
  assert.equal(reconcile(ws, st({ selected: 'f2:rb' })).selected, null);
  assert.equal(reconcile(ws, st({ selected: 'f1:s1' })).selected, null);
  assert.equal(reconcile(ws, st({ selected: 'f1' })).selected, null);
});

test('reconcile: expansion of closed files is forgotten', () => {
  const s = st({ expanded: new Set(['f1:r1', 'f2:rb']) });
  assert.equal(reconcile(ws, s), s);
  assert.deepEqual([...reconcile(removeFile(ws, 'f2'), s).expanded], ['f1:r1']);
  assert.deepEqual([...reconcile(EMPTY_WORKSPACE, s).expanded], []);
});

test('anchorKey: shown selection, hidden by collapse, hidden by filter, none', () => {
  const open = st({ expanded: new Set(['f1:r1', 'f1:e1']), selected: 'f1:p1' });
  assert.equal(anchorKey(ws, rowsOf(open), 'f1:p1'), 'f1:p1');
  assert.equal(anchorKey(ws, rowsOf(st({ expanded: new Set(['f1:r1']) })), 'f1:p1'), 'f1:e1');
  assert.equal(anchorKey(ws, rowsOf(st()), 'f1:p1'), 'f1:r1');
  assert.equal(anchorKey(ws, rowsOf(st(), filterFile(fileA, 'spine')), 'f1:p1'), null);
  assert.equal(anchorKey(ws, rowsOf(st()), null), null);
});

test('applyAction: collapsing an ancestor of the selection moves selection onto it', () => {
  const s = st({ expanded: new Set(['f1:r1', 'f1:e1']), selected: 'f1:p1' });
  const next = applyAction(ws, s, null, { type: 'collapse', key: 'f1:r1' });
  assert.equal(next.selected, 'f1:r1');
  assert.equal(next.expanded.has('f1:r1'), false);
  assert.equal(applyAction(ws, s, null, { type: 'collapse', key: 'f1:r2' }).selected, 'f1:p1');
  assert.equal(applyAction(ws, s, null, { type: 'expand', key: 'f1:r1' }), s);
});

test('applyAction: toggle and select; expanding above a hidden selection keeps it', () => {
  const s = st();
  const t = applyAction(ws, s, null, { type: 'toggle', key: 'f1:r2' });
  assert.ok(t.expanded.has('f1:r2'));
  assert.equal(applyAction(ws, t, null, { type: 'toggle', key: 'f1:r2' }).expanded.has('f1:r2'), false);
  assert.equal(applyAction(ws, s, null, { type: 'select', key: 'f1:e3' }).selected, 'f1:e3');
  assert.equal(applyAction(ws, s, null, { type: 'none' }), s);
  const hidden = st({ expanded: new Set(['f1:r1']), selected: 'f1:p1' });
  assert.equal(applyAction(ws, hidden, null, { type: 'expand', key: 'f1:e1' }).selected, 'f1:p1');
});

test('selectFile / revealState', () => {
  const s = selectFile(st({ selected: 'f1:p1' }), 'f2');
  assert.deepEqual([s.fileId, s.selected], ['f2', null]);
  const same = st();
  assert.equal(selectFile(same, 'f1'), same);
  const r = revealState(ws, st(), 'f1:p4');
  assert.equal(r.selected, 'f1:p4');
  assert.ok(r.expanded.has('f1:r2') && r.expanded.has('f1:e3'));
  assert.equal(revealState(ws, st(), 'f1:s1').selected, null);
  assert.equal(revealState(ws, st(), 'f1').selected, null);
  assert.equal(revealState(ws, st(), 'f2:rb').fileId, 'f2');
});

test('revealStepState switches file, expands to the program and clears the query', () => {
  const from = st({ fileId: 'f2', query: 'mprage' });
  const r = revealStepState(ws, from, 'f1:s4');
  assert.deepEqual([r.fileId, r.selected, r.query], ['f1', 'f1:p4', '']);
  assert.ok(r.expanded.has('f1:r2') && r.expanded.has('f1:e3'));
  const same = st();
  assert.equal(revealStepState(ws, same, 'f1:p1'), same);
  assert.equal(revealStepState(ws, same, 'f1:nope'), same);
});

test('revealState drops filter overrides so a revealed node is not hidden by an earlier collapse', () => {
  const f = filterFile(fileA, 'mprage');
  let s = setQuery(ws, st(), 'mprage');
  s = applyAction(ws, s, f, { type: 'collapse', key: 'f1:r1' });
  assert.deepEqual(keys(rowsOf(s, f)), ['r1']);
  const r = revealState(ws, s, 'f1:p1');
  assert.equal(r.overrides.size, 0);
  assert.deepEqual(keys(rowsOf(r, f)), ['r1', 'e1', 'p1']);
});

test('keyToAction: Up/Down, Home/End, with and without an anchor', () => {
  const rows = rowsOf(st({ expanded: new Set(['f1:r1']) })); // r1, e1, e2, r2
  assert.deepEqual(keyToAction('ArrowDown', rows, null), { type: 'select', key: 'f1:r1' });
  assert.deepEqual(keyToAction('ArrowUp', rows, null), { type: 'select', key: 'f1:r1' });
  assert.deepEqual(keyToAction('ArrowDown', rows, 'f1:r1'), { type: 'select', key: 'f1:e1' });
  assert.deepEqual(keyToAction('ArrowDown', rows, 'f1:r2'), { type: 'none' });
  assert.deepEqual(keyToAction('ArrowUp', rows, 'f1:r1'), { type: 'none' });
  assert.deepEqual(keyToAction('Home', rows, 'f1:e2'), { type: 'select', key: 'f1:r1' });
  assert.deepEqual(keyToAction('End', rows, 'f1:r1'), { type: 'select', key: 'f1:r2' });
});

test('keyToAction: navigation keys on empty rows do nothing', () => {
  for (const k of ['Home', 'End', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter']) {
    assert.deepEqual(keyToAction(k, [], null), { type: 'none' }, k);
  }
});

test('keyToAction: Left collapses, else goes to parent, else nothing', () => {
  const rows = rowsOf(st({ expanded: new Set(['f1:r1', 'f1:e1']) })); // r1 e1 p1 p2 e2 r2
  assert.deepEqual(keyToAction('ArrowLeft', rows, 'f1:r1'), { type: 'collapse', key: 'f1:r1' });
  assert.deepEqual(keyToAction('ArrowLeft', rows, 'f1:p1'), { type: 'select', key: 'f1:e1' });
  assert.deepEqual(keyToAction('ArrowLeft', rows, 'f1:r2'), { type: 'none' });
});

test('keyToAction: Right expands, else first child, else nothing', () => {
  const rows = rowsOf(st({ expanded: new Set(['f1:r1', 'f1:e1']) }));
  assert.deepEqual(keyToAction('ArrowRight', rows, 'f1:r2'), { type: 'expand', key: 'f1:r2' });
  assert.deepEqual(keyToAction('ArrowRight', rows, 'f1:r1'), { type: 'select', key: 'f1:e1' });
  assert.deepEqual(keyToAction('ArrowRight', rows, 'f1:p1'), { type: 'none' });
  assert.deepEqual(keyToAction('ArrowRight', rows, 'f1:e2'), { type: 'none' });
});

test('keyToAction: Enter/Space toggle expandable rows only; other keys are unhandled', () => {
  const rows = rowsOf(st({ expanded: new Set(['f1:r1', 'f1:e1']) }));
  assert.deepEqual(keyToAction('Enter', rows, 'f1:r1'), { type: 'toggle', key: 'f1:r1' });
  assert.deepEqual(keyToAction(' ', rows, 'f1:p1'), { type: 'none' });
  assert.equal(keyToAction('a', rows, 'f1:r1'), null);
  assert.equal(keyToAction('Tab', rows, 'f1:r1'), null);
});

test('buildRows: match and hasMatch flags', () => {
  const f = filterFile(fileA, 'neck');
  assert.ok(f);
  const rows = rowsOf(st(), f);
  assert.deepEqual(rows.map((r) => [r.key.slice(3), r.match, r.hasMatch]),
    [['r1', false, true], ['e1', false, true], ['p2', true, false]]);
  for (const r of rowsOf(st())) assert.deepEqual([r.match, r.hasMatch], [false, false]);
});

test('splitWhitespace: edges and internal runs are marked; text round-trips', () => {
  assert.deepEqual(splitWhitespace('AX T2 '), [{ text: 'AX T2', ws: false }, { text: ' ', ws: true }]);
  assert.deepEqual(splitWhitespace('COR VIBE  BH'),
    [{ text: 'COR VIBE', ws: false }, { text: '  ', ws: true }, { text: 'BH', ws: false }]);
  assert.deepEqual(splitWhitespace(' a b'), [{ text: ' ', ws: true }, { text: 'a b', ws: false }]);
  assert.deepEqual(splitWhitespace(''), []);
  for (const n of [' ', '  x  ', 'a\tb', 'plain']) assert.equal(splitWhitespace(n).map((p) => p.text).join(''), n);
});
