// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryGroups, protocolGroups } from '../src/core/summarygroups.js';

/** @typedef {import('../src/core/preview.js').PreviewItem} PreviewItem */
/** @param {string} key @param {string} label @param {PreviewItem['value']} value @param {string} [unit] @returns {PreviewItem} */
const it = (key, label, value, unit = '') => ({ key, label, unit, value });
/** @param {PreviewItem[]} items */
const sub = (items) => ({ index: 0, ta: null, taSec: null, items });
const num = (/** @type {number} */ value) => /** @type {const} */ ({ kind: 'number', value });
const bool = (/** @type {boolean} */ value) => /** @type {const} */ ({ kind: 'bool', value });
const txt = (/** @type {string} */ value) => /** @type {const} */ ({ kind: 'text', value });

test('summaryGroups: fixed group order, table order within a group, empty groups omitted', () => {
  const g = summaryGroups(sub([
    it('sub.0.msr.zzz', 'Zed', num(1)),
    it('sub.0.msr.matrix', 'Base resolution', num(256)),
    it('sub.0.msr.te.0', 'TE', num(2.5), 'ms'),
    it('sub.0.msr.tr.0', 'TR', num(500), 'ms'),
    it('sub.0.msr.time', 'TA', txt('1:23')),
    it('sub.0.msr.sl_thick', 'Slice thickness', num(3), 'mm'),
    it('sub.0.msr.fat_sat', 'Fat suppr.', { kind: 'code', code: 35, text: 'None' }),
  ]), []);
  assert.deepEqual(g.map((x) => x.title), ['Contrast & timing', 'Geometry', 'Options', 'Other']);
  assert.deepEqual(g[0].items.map((x) => x.key), ['sub.0.msr.time', 'sub.0.msr.tr.0', 'sub.0.msr.te.0']);
  assert.deepEqual(g[1].items.map((x) => x.key), ['sub.0.msr.sl_thick', 'sub.0.msr.matrix']);
  assert.deepEqual(g[2].items.map((x) => x.key), ['sub.0.msr.fat_sat']);
  assert.deepEqual(g[3].items.map((x) => x.key), ['sub.0.msr.zzz']);
  assert.equal(summaryGroups(sub([it('sub.0.msr.tr.0', 'TR', num(1), 'ms')]), []).length, 1);
  assert.deepEqual(summaryGroups(sub([]), []), []);
});

test('summaryGroups: indexed keys sort numerically within their table slot', () => {
  const g = summaryGroups(sub([
    it('sub.0.msr.te.10', 'TE 11', num(11), 'ms'),
    it('sub.0.msr.te.2', 'TE 3', num(3), 'ms'),
  ]), []);
  assert.deepEqual(g[0].items.map((x) => x.key), ['sub.0.msr.te.2', 'sub.0.msr.te.10']);
});

test('summaryGroups: controller items join the Options group', () => {
  const g = summaryGroups(sub([it('sub.0.msr.h2o_sat', 'Water suppr.', { kind: 'code', code: 39, text: 'None' })]), [
    it('ctrl.Properties.AutoLoad.AutoStore', 'Auto store images', bool(true)),
    it('ctrl.MultiStep.IsMultistep', 'Set-n-Go Protocol', bool(false)),
    it('ctrl.Properties.Queue.WaitForUserToStart.0', 'Wait for user to start', bool(true)),
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].items.map((x) => x.key), [
    'sub.0.msr.h2o_sat', 'ctrl.MultiStep.IsMultistep', 'ctrl.Properties.Queue.WaitForUserToStart.0', 'ctrl.Properties.AutoLoad.AutoStore',
  ]);
});

test('summaryGroups: value text and raw', () => {
  const all = Object.fromEntries(summaryGroups(sub([
    it('sub.0.msr.tr.0', 'TR', num(2000.5), 'ms'),
    it('sub.0.msr.time', 'TA', txt('0:44')),
    it('sub.0.msr.fat_sat', 'Fat suppr.', { kind: 'code', code: 33, text: 'Fat sat.' }),
    it('sub.0.msr.h2o_sat', 'Water suppr.', { kind: 'code', code: 4242, text: null }),
    it('sub.0.msr.matrix', 'Base resolution', num(320)),
  ]), [it('ctrl.Properties.AutoLoad.LoadToViewer', 'Load to viewer', bool(false))]).flatMap((x) => x.items).map((x) => [x.key, x]));
  assert.deepEqual(all['sub.0.msr.tr.0'], { key: 'sub.0.msr.tr.0', label: 'TR', text: '2000.5 ms', raw: '2000.5' });
  assert.equal(all['sub.0.msr.time'].text, '0:44');
  assert.equal(all['sub.0.msr.matrix'].text, '320');
  assert.deepEqual([all['sub.0.msr.fat_sat'].text, all['sub.0.msr.fat_sat'].raw], ['Fat sat.', '33']);
  assert.deepEqual([all['sub.0.msr.h2o_sat'].text, all['sub.0.msr.h2o_sat'].raw], ['code 4242', '4242']);
  assert.deepEqual([all['ctrl.Properties.AutoLoad.LoadToViewer'].text, all['ctrl.Properties.AutoLoad.LoadToViewer'].raw], ['off', 'false']);
});

test('summaryGroups: blank label falls back to the map, else the key; blank unit falls back too', () => {
  const [g] = summaryGroups(sub([
    it('sub.0.msr.mag_field_strength', ' ', num(3)),
    it('sub.0.msr.mystery', ' ', num(1)),
  ]), []);
  assert.deepEqual(g.items[0], { key: 'sub.0.msr.mag_field_strength', label: 'Field', text: '3 T', raw: '3' });
  const other = summaryGroups(sub([it('sub.0.msr.mystery', ' ', num(1))]), []);
  assert.equal(other[0].title, 'Other');
  assert.equal(other[0].items[0].label, 'sub.0.msr.mystery');
});

test('summaryGroups: hidden keys never appear', () => {
  const g = summaryGroups(sub([
    it('sub.0.msr.time_sec', ' ', num(44)),
    it('sub.0.msr.aa_is_scout', ' ', bool(true)),
    it('sub.0.HEADER.SubProtocolCount', '', num(2)),
    it('sub.0.msr.tr.0', 'TR', num(1), 'ms'),
  ]), [
    it('ctrl.MultiStep.IsMultiStepReadOnly', '', bool(true)),
    it('ctrl.PerformanceCache.HasPostProcessing', 'x', bool(true)),
  ]);
  assert.deepEqual(g.flatMap((x) => x.items.map((i) => i.key)), ['sub.0.msr.tr.0']);
});

test('protocolGroups: a block per sub-protocol, titled only when there are several; controller with the first', () => {
  const ctrl = [it('ctrl.MultiStep.IsMultistep', 'Multi-step', bool(true))];
  const at = (/** @type {number} */ index, /** @type {PreviewItem[]} */ items) => ({ index, ta: null, taSec: null, items });
  const two = protocolGroups({ subs: [at(0, [it('sub.0.msr.tr.0', 'TR', num(1))]), at(1, [it('sub.1.msr.tr.0', 'TR', num(2))])], controller: ctrl });
  assert.deepEqual(two.map((b) => b.title), ['Sub-protocol 1 of 2', 'Sub-protocol 2 of 2']);
  assert.deepEqual(two.map((b) => b.groups.flatMap((g) => g.items.map((x) => x.key))),
    [['sub.0.msr.tr.0', 'ctrl.MultiStep.IsMultistep'], ['sub.1.msr.tr.0']]);
  const one = protocolGroups({ subs: [at(0, [it('sub.0.msr.tr.0', 'TR', num(1))])], controller: [] });
  assert.deepEqual(one.map((b) => b.title), [null]);
});

test('protocolGroups: the controller alone without sub-protocols; blocks showing nothing are dropped', () => {
  const ctrl = [it('ctrl.MultiStep.IsMultistep', 'Multi-step', bool(true))];
  const alone = protocolGroups({ subs: [], controller: ctrl });
  assert.deepEqual(alone.map((b) => [b.title, b.groups.map((g) => g.title)]), [[null, ['Options']]]);
  const hiddenOnly = { index: 0, ta: null, taSec: null, items: [it('sub.0.msr.time_sec', 'TA', num(44))] };
  assert.deepEqual(protocolGroups({ subs: [hiddenOnly], controller: [] }), []);
  assert.deepEqual(protocolGroups({ subs: [], controller: [] }), []);
});
