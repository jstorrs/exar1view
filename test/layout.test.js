// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardLines, fitLayout, observationOf, slotOf } from '../tools/cards/layout.js';
import { parseCatalog } from '../src/core/cards.js';

/** @typedef {import('../src/core/cardsource.js').CardSources} CardSources */
/** @typedef {import('../tools/cards/prints.js').PrintCard} PrintCard */
/** @typedef {import('../tools/cards/layout.js').Observation} Observation */

/** @param {{ asc?: Record<string, string>, pv?: Record<string, string>, sequence?: string }} o @returns {CardSources} */
function sources({ asc = {}, pv = {}, sequence = '%SiemensSeq%\\alpha' }) {
  return {
    asc: new Map(Object.entries(asc)), nBlocks: 1, pv: new Map(Object.entries(pv)), ctrl: new Map(), eva: new Map(),
    sequence, seq: sequence.slice(sequence.lastIndexOf('\\') + 1),
  };
}

/** A card from `Label` lines; `^Label` is a grouped line. @param {string} name @param {string[]} labels @returns {PrintCard} */
const card = (name, labels) => ({
  name, params: labels.map((l) => ({ label: l.replace(/^\^/, ''), value: 'v', grouped: l.startsWith('^') })),
});

/** @param {PrintCard[]} cards @param {Parameters<typeof sources>[0]} [src] @returns {Observation} */
const obs = (cards, src = {}) => observationOf({ path: [], header: { path: '', lines: [] }, cards }, sources(src));

/** The layout with a rule on every slot, as catalog JSON. @param {ReturnType<typeof fitLayout>} fitted */
function withRules({ cards, sequences, slots }) {
  return {
    version: 1, cards, sequences,
    slots: Object.fromEntries(Object.entries(slots).map(([c, ss]) => [c, ss.map((s) => ({
      ...s, rule: s.id.startsWith('@') ? { kind: 'formula', name: s.id.slice(1) } : { kind: 'unknown', why: 'x' },
    }))])),
  };
}

test('slotOf normalizes printed labels', () => {
  assert.deepEqual(slotOf('Routine', 'TR', 0, false, null), { id: 'TR', group: null, bang: null });
  assert.deepEqual(slotOf('Routine', 'TE', 2, false, null), { id: 'TE#2', group: null, bang: null });
  assert.deepEqual(slotOf('Filter', '! Intensity', 0, false, null), { id: 'Intensity', group: null, bang: true });
  assert.deepEqual(slotOf('Filter', '  Intensity', 0, false, null), { id: 'Intensity', group: null, bang: false });
  assert.deepEqual(slotOf('X', ' Lead', 0, false, null), { id: ' Lead', group: null, bang: null });
  assert.deepEqual(slotOf('Routine', 'Slice group', 0, false, 'Slice group'), { id: 'Slice group/#', group: 'slice', bang: null });
  assert.deepEqual(slotOf('Routine', 'Slices', 1, true, 'Slice group'), { id: 'Slice group/Slices#1', group: 'slice', bang: null });
  assert.deepEqual(slotOf('Sat', 'Thickness', 0, true, 'Sat. region'), { id: 'Sat. region/Thickness', group: 'sat', bang: null });
});

test('slotOf turns AutoAlign and Adjust Volume labels into formula slots', () => {
  const aa = (/** @type {string} */ l) => slotOf('Geometry - AutoAlign', l, 0, false, null).id;
  assert.deepEqual(['L', 'R', 'A', 'P', 'F', 'H'].map(aa), ['@aa.x', '@aa.x', '@aa.y', '@aa.y', '@aa.z', '@aa.z']);
  assert.deepEqual(['T > C', 'S > T', '> S', '> C'].map(aa), ['@aa.angle2', '@aa.angle2', '@aa.angle3', '@aa.angle3']);
  assert.equal(slotOf('Routine', 'L', 0, false, null).id, 'L');
  const adj = (/** @type {string} */ l, k = 0) => slotOf('System - Adjust Volume', l, k, false, null);
  assert.deepEqual(adj('! R >> L'), { id: '@adj.phase', group: null, bang: true });
  assert.deepEqual([adj('  A >> P', 1), adj('  F >> H', 2), adj('  R >> L', 3), adj('  Rotation')].map((s) => s.id),
    ['@adj.read', '@adj.slice', '@adj.slice#1', 'Rotation']);
  // Extents are by position, whatever their axis.
  const lines = (/** @type {string[]} */ ls) => cardLines(card('System - Adjust Volume', ls)).map((l) => l.id);
  assert.deepEqual(lines(['  Rotation', '  A >> P', '  R >> L', '  F >> H', 'Reset']), ['Rotation', '@adj.phase', '@adj.read', '@adj.slice', 'Reset']);
  assert.deepEqual(lines(['  Rotation', '  F >> H', '  A >> P', '  R >> L']), ['Rotation', '@adj.phase', '@adj.read', '@adj.slice']);
});

test('cardLines numbers repeats, group instances and children', () => {
  const lines = cardLines(card('Routine', ['Slice group', '^Slices', '^Slices', 'Slice group', '^Slices', 'TE', 'Mode', 'Unfiltered images', 'TE']));
  assert.deepEqual(lines.map((l) => [l.id, l.group, l.index, l.parent]), [
    ['Slice group/#', 'slice', 0, null], ['Slice group/Slices', 'slice', 0, null], ['Slice group/Slices#1', 'slice', 0, null],
    ['Slice group/#', 'slice', 1, null], ['Slice group/Slices', 'slice', 1, null],
    ['TE', null, null, null], ['Mode', null, null, null], ['Unfiltered images', null, null, 'Mode'], ['TE#1', null, null, null],
  ]);
  // A header with no grouped line after it is a plain line.
  assert.deepEqual(cardLines(card('X', ['Navigator', 'TR'])).map((l) => [l.id, l.group]), [['Navigator', null], ['TR', null]]);
  // With the layout's slots, a child resolves to the slot of its parent.
  const slots = [{ id: 'A' }, { id: 'Unfiltered images', parent: 'A' }, { id: 'B' }, { id: 'Unfiltered images#1', parent: 'B' }];
  assert.deepEqual(cardLines(card('F', ['B', 'Unfiltered images']), slots).map((l) => l.id), ['B', 'Unfiltered images#1']);
});

test('observationOf categorizes the sequence', () => {
  assert.equal(obs([], { sequence: '%SiemensSeq%\\tse' }).category, 'standard');
  assert.equal(obs([], { sequence: '%CustomerSeq%\\mine' }).category, 'customer');
  assert.equal(obs([], { sequence: '%ServiceSeq%\\svc' }).category, 'service');
  assert.equal(obs([], { sequence: '' }).category, 'other');
});

test('fitLayout merges card and slot orders across prints', () => {
  const fitted = fitLayout([
    obs([card('Routine', ['TR', 'TE', 'Averages']), card('System', ['Shim'])]),
    obs([card('Routine', ['TR', 'TI', 'TE']), card('Contrast', ['Flip']), card('System', ['Shim'])]),
    obs([card('Contrast', ['Flip']), card('System', ['Shim', 'Coil'])]),
  ]);
  assert.deepEqual(fitted.cards, ['Routine', 'Contrast', 'System']);
  assert.deepEqual(fitted.slots.Routine.map((s) => s.id), ['TR', 'TI', 'TE', 'Averages']);
  assert.deepEqual(fitted.slots.System.map((s) => s.id), ['Shim', 'Coil']);
  assert.deepEqual(fitted.report, { cycles: [], splitRuns: 0, parentFixes: 0 });
});

test('fitLayout keeps each group kind in one run and reports cycles', () => {
  const fitted = fitLayout([
    obs([card('Routine', ['Slice group', '^Slices', '^Position', 'Slice group', '^Slices', 'TR', 'TE'])]),
    obs([card('Routine', ['Slab group', '^Slabs', 'Slice group', '^Slices', '^Gap', '^Position', 'TE', 'TR'])]),
  ]);
  assert.deepEqual(fitted.slots.Routine, [
    { id: 'Slab group/#', group: 'slab' }, { id: 'Slab group/Slabs', group: 'slab' },
    { id: 'Slice group/#', group: 'slice' }, { id: 'Slice group/Slices', group: 'slice' },
    { id: 'Slice group/Gap', group: 'slice' }, { id: 'Slice group/Position', group: 'slice' },
    { id: 'TR' }, { id: 'TE' },
  ]);
  assert.deepEqual(fitted.report.cycles, [{ scope: 'Routine', broken: 1 }]);
});

test('fitLayout gives each child its own slot under its parent', () => {
  const fitted = fitLayout([
    obs([card('Filter', ['Normalize', 'Unfiltered images', 'Smoothing', 'Mode'])], { asc: { n: '1' } }),
    obs([card('Filter', ['Normalize', 'Smoothing', 'Unfiltered images', 'Mode', 'Unfiltered images'])], { asc: { s: '1', m: '1' } }),
    obs([card('Filter', ['Normalize', 'Smoothing', 'Mode'])]),
  ]);
  assert.deepEqual(fitted.slots.Filter.map(({ id, parent }) => [id, parent]), [
    ['Normalize', undefined], ['Unfiltered images', 'Normalize'], ['Smoothing', undefined],
    ['Unfiltered images#1', 'Smoothing'], ['Mode', undefined], ['Unfiltered images#2', 'Mode'],
  ]);
  const when = Object.fromEntries(fitted.slots.Filter.map((s) => [s.id, s.when]));
  assert.deepEqual(when['Unfiltered images'], { key: 'n', present: true });
  assert.deepEqual(when['Unfiltered images#1'], { key: 'm', present: true });
});

test('fitLayout fits bang predicates and keeps AutoAlign letters as one slot', () => {
  const fitted = fitLayout([
    obs([card('Geometry - AutoAlign', ['Initial Position', 'L', 'P', 'H', 'Initial Orientation', 'T > C', '> S'])]),
    obs([card('Geometry - AutoAlign', ['Initial Position', 'R', 'A', 'F', 'Initial Orientation'])]),
    obs([card('Adjust', ['! Position', '  Gain'])], { asc: { 'sAdjData.uiAdjVolumeValid': '1' } }),
    obs([card('Adjust', ['  Position', '  Gain'])]),
    obs([card('Adjust', ['! Position', '  Gain'])], { asc: { 'sAdjData.uiAdjVolumeValid': '1' } }),
  ]);
  assert.deepEqual(fitted.slots['Geometry - AutoAlign'].map((s) => s.id),
    ['Initial Position', '@aa.x', '@aa.y', '@aa.z', 'Initial Orientation', '@aa.angle2', '@aa.angle3']);
  assert.deepEqual(fitted.slots['Geometry - AutoAlign'].find((s) => s.id === '@aa.x')?.when, undefined);
  assert.deepEqual(fitted.slots.Adjust, [
    { id: 'Position', bang: { key: 'sAdjData.uiAdjVolumeValid', present: true } },
    { id: 'Gain', bang: { key: 'seq', in: [] } },
  ]);
});

test('fitLayout fits presence from the form that agrees best', () => {
  const code = (/** @type {string} */ fat, /** @type {boolean} */ shown) => obs(
    [card('Contrast', shown ? ['TR', 'Fat suppr.', 'TE'] : ['TR', 'TE'])],
    { asc: { 'sPrepPulses.ucFatSat': fat, 'sPrepPulses.dTime': fat === '0x1' ? '0' : '2' } },
  );
  const inFit = fitLayout([code('0x1', false), code('0x2', true), code('0x4', true), code('0x8', false), code('0x1', false)]);
  assert.deepEqual(inFit.slots.Contrast.find((s) => s.id === 'Fat suppr.')?.when, { key: 'sPrepPulses.ucFatSat', in: ['0x2', '0x4'] });

  // `in` is only for code-like keys: a plain number key gets `nonzero`.
  const num = (/** @type {string} */ ti) => obs([card('Contrast', ti === '0' ? ['TR'] : ['TR', 'TI'])], { asc: { 'alTI[0]': ti } });
  const nzFit = fitLayout([num('0'), num('300'), num('0'), num('800'), num('5')]);
  assert.deepEqual(nzFit.slots.Contrast.find((s) => s.id === 'TI')?.when, { key: 'alTI[0]', nonzero: true });

  // A slot that always prints has no predicate.
  assert.equal(nzFit.slots.Contrast.find((s) => s.id === 'TR')?.when, undefined);
});

test('fitLayout fits grouped presence on templated keys', () => {
  const g = (/** @type {string[]} */ shift) => obs(
    [card('Routine', shift.flatMap((s) => ['Slice group', '^Slices', ...(s === '0' ? [] : ['^Shift'])]))],
    { asc: Object.fromEntries(shift.map((s, i) => [`sGroupArray.asGroup[${i}].dShift`, s])) },
  );
  const fitted = fitLayout([g(['0', '3']), g(['2']), g(['0'])]);
  assert.deepEqual(fitted.slots.Routine.find((s) => s.id === 'Slice group/Shift'),
    { id: 'Slice group/Shift', group: 'slice', when: { key: 'sGroupArray.asGroup[#].dShift', nonzero: true } });
});

test('fitLayout fits cards and slots only for standard and service sequences', () => {
  const fitted = fitLayout([
    obs([card('Routine', ['TR', 'TE']), card('System', ['Shim'])], { sequence: '%SiemensSeq%\\tse' }),
    obs([card('Routine', ['TR', 'TE']), card('System', ['Shim'])], { sequence: '%SiemensSeq%\\tse' }),
    obs([card('Routine', ['TR'])], { sequence: '%SiemensSeq%\\tse' }),
    obs([card('Routine', ['TR', 'TI'])], { sequence: '%ServiceSeq%\\svc' }),
    obs([card('Routine', ['TR', 'TI', 'TE'])], { sequence: '%CustomerSeq%\\own' }),
  ]);
  assert.deepEqual(fitted.sequences, {
    '%SiemensSeq%\\tse': { cards: ['Routine', 'System'], slots: { Routine: ['TR', 'TE'] } },
    '%ServiceSeq%\\svc': { cards: ['Routine'], slots: { Routine: ['TR', 'TI'] } },
  });
});

test('the fitted layout parses as a catalog once each slot has a rule', () => {
  const fitted = fitLayout([
    obs([card('Routine', ['Slice group', '^Slices', 'Slice group', '^Slices', 'TR', 'TE', 'TE'])], { asc: { 'sPrepPulses.ucFatSat': '0x1' } }),
    obs([card('Routine', ['Slab group', '^Slabs', 'TR', 'TE']), card('Filter', ['Mode', 'Unfiltered images', '! Intensity'])],
      { sequence: '%SiemensSeq%\\beta', asc: { 'sPrepPulses.ucFatSat': '0x2' } }),
    obs([card('Geometry - AutoAlign', ['L', 'A', 'H', 'T > C', '> S']), card('Filter', ['Mode', '  Intensity'])], { sequence: '%CustomerSeq%\\x' }),
  ]);
  const parsed = parseCatalog(withRules(fitted));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
});
