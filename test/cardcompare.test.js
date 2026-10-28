// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardRows, cardStatus, compareCards, sameValue } from '../src/core/cardcompare.js';

/** @typedef {import('../src/core/cards.js').Cards} Cards */
/** @typedef {import('../src/core/cards.js').CardLine} CardLine */
/** @typedef {import('../src/core/cardformulas.js').CardHeader} CardHeader */

/** @type {CardHeader} */
const HEADER = { ta: '2:12', pm: 'REF', pat: null, voxel: '0.9×0.9×3.0', voi: null, snr: '1.00', sequence: 'alpha', substep: null };

/**
 * A line: `[label, text]`, with a group and the raw status as asked.
 * @param {string} label @param {string} text @param {number | null} [group] @param {boolean} [raw]
 * @returns {CardLine}
 */
const line = (label, text, group = null, raw = false) => ({ label, text, status: raw ? 'raw' : 'ok', group });

/**
 * Cards from `{ tab: { card: lines } }`.
 * @param {Record<string, Record<string, CardLine[]>>} tabs @param {Partial<CardHeader>} [hd]
 * @returns {Cards}
 */
const cards = (tabs, hd = {}) => ({
  tabs: Object.entries(tabs).map(([tab, cs]) => ({ tab, cards: Object.entries(cs).map(([name, lines]) => ({ name, lines })) })),
  omitted: 0, approximate: false, header: { ...HEADER, ...hd },
});

/** Each tab's cards as `tab/card: label a|b` strings. @param {import('../src/core/cardcompare.js').CardComparison['tabs']} tabs */
const flat = (tabs) => tabs.flatMap((t) => t.cards.flatMap((c) => c.rows.map((r) =>
  `${t.tab}/${c.name}: ${r.label} ${r.a?.text ?? '-'}|${r.b?.text ?? '-'}${r.same ? '' : ' *'}`)));

test('sameValue: whitespace and printed precision of an equal number do not matter', () => {
  assert.ok(sameValue('3.0 mm', '3 mm'));
  assert.ok(sameValue('0.9×0.9×3.0', '0.9×0.9×3'));
  assert.ok(sameValue('On ', 'On'));
  assert.ok(sameValue('a  b', ' a b'));
});

test('sameValue: other numbers, units, separators or digits split apart differ', () => {
  assert.ok(!sameValue('2.5 ms', '2.6 ms'));
  assert.ok(!sameValue('3 mm', '3 ms'));
  assert.ok(!sameValue('1/2', '1/3'));
  assert.ok(!sameValue('10', '1 0'));
  assert.ok(!sameValue('2.25', '2.3'));
});

test('cardStatus', () => {
  assert.equal(cardStatus(0), 'No card line differs');
  assert.equal(cardStatus(1), '1 card line differs');
  assert.equal(cardStatus(3), '3 card lines differ');
});

test('header rows: the sequence is labelled, voxel and VoI are one-sided rows, differences counted', () => {
  const c = compareCards(cards({}), cards({}, { voxel: null, voi: '20 ×20 ×20', ta: '2:12 ', sequence: 'beta' }));
  assert.deepEqual(c.header.map((r) => `${r.label} ${r.a?.text ?? '-'}|${r.b?.text ?? '-'}${r.same ? '' : ' *'}`), [
    'TA 2:12|2:12 ', 'PM REF|REF', 'Voxel size 0.9×0.9×3.0 mm|- *', 'VoI -|20 ×20 ×20 mm *', 'Rel. SNR 1.00|1.00', 'Sequence alpha|beta *',
  ]);
  assert.deepEqual(c.header[0].a, { text: '2:12', raw: false, flag: false });
  assert.equal(c.differ, 3);
});

test('a card or a tab on one side only; a B-only tab after its predecessor', () => {
  const a = cards({ Routine: { Routine: [line('TR', '100 ms')] }, Physio: { Physio: [line('Trigger', 'Off')] } });
  const b = cards({
    Routine: { Routine: [line('TR', '100.0 ms')], 'Routine - Extra': [line('Averages', '1')] },
    Contrast: { Contrast: [line('TE', '5 ms')] }, Physio: { Physio: [line('Trigger', 'Off')] },
  });
  const c = compareCards(a, b);
  assert.deepEqual(c.tabs.map((t) => t.tab), ['Routine', 'Contrast', 'Physio']);
  assert.deepEqual(flat(c.tabs), [
    'Routine/Routine: TR 100 ms|100.0 ms', 'Routine/Routine - Extra: Averages -|1 *', 'Contrast/Contrast: TE -|5 ms *', 'Physio/Physio: Trigger Off|Off',
  ]);
  assert.equal(c.differ, 2);
});

test('cards with no line on either side and tabs left empty are dropped', () => {
  const c = compareCards(cards({ X: { X: [] }, Y: { Y: [line('A', '1')], Z: [] } }), cards({ X: { X: [] } }));
  assert.deepEqual(c.tabs, [{ tab: 'Y', cards: [{ name: 'Y', rows: [{ label: 'A', a: { text: '1', raw: false, flag: false }, b: null, same: false }] }] }]);
});

test('two slice groups against three pair by group', () => {
  const groups = (/** @type {number} */ n) => Array.from({ length: n }, (_, g) => [line('Slice group', String(g + 1), g), line('Slices', '10', g)]).flat();
  const c = compareCards(cards({ G: { G: groups(2) } }), cards({ G: { G: groups(3) } }));
  assert.deepEqual(flat(c.tabs), [
    'G/G: Slice group 1|1', 'G/G: Slices 10|10', 'G/G: Slice group 2|2', 'G/G: Slices 10|10',
    'G/G: Slice group -|3 *', 'G/G: Slices -|10 *',
  ]);
});

test('a conditional line in group 0 of A and group 1 of B gives two one-sided rows', () => {
  const a = [line('Slice group', '1', 0), line('Dist. factor', '20 %', 0), line('Slice group', '2', 1)];
  const b = [line('Slice group', '1', 0), line('Slice group', '2', 1), line('Dist. factor', '20 %', 1)];
  const c = compareCards(cards({ G: { G: a } }), cards({ G: { G: b } }));
  assert.deepEqual(flat(c.tabs), ['G/G: Slice group 1|1', 'G/G: Dist. factor 20 %|- *', 'G/G: Slice group 2|2', 'G/G: Dist. factor -|20 % *']);
});

test('the same label outside a group and in group 0 are separate rows', () => {
  const lines = [line('Slices', '10'), line('Slices', '10', 0)];
  const c = compareCards(cards({ G: { G: lines } }), cards({ G: { G: [lines[1]] } }));
  assert.deepEqual(flat(c.tabs), ['G/G: Slices 10|- *', 'G/G: Slices 10|10']);
});

test('a repeated label pairs by occurrence; the "! " mark counts, raw does not', () => {
  const a = [line('  Fat sat.', 'On'), line('Coil', 'H'), line('Coil', 'N'), line('Mode', 'x', null, true)];
  const b = [line('! Fat sat.', 'On'), line('Coil', 'H'), line('Coil', 'N '), line('Mode', 'x')];
  const c = compareCards(cards({ T: { T: a } }), cards({ T: { T: b } }));
  assert.deepEqual(flat(c.tabs), ['T/T: Fat sat. On|On *', 'T/T: Coil H|H', 'T/T: Coil N|N ', 'T/T: Mode x|x']);
  const [fat, , , mode] = c.tabs[0].cards[0].rows;
  assert.deepEqual([fat.a?.flag, fat.b?.flag], [false, true]);
  assert.deepEqual([mode.a?.raw, mode.b?.raw], [true, false]);
  assert.equal(c.differ, 1);
});

test('cardRows: differing rows by default, all with showAll, the query on labels only', () => {
  const c = compareCards(
    cards({ Routine: { Routine: [line('TR', '100 ms'), line('TE', '5 ms')] } }),
    cards({ Routine: { Routine: [line('TR', '100 ms'), line('TE', '6 ms')] } }, { ta: '3:00' }),
  );
  const shown = (/** @type {string} */ query, /** @type {boolean} */ showAll) => {
    const r = cardRows(c, { query, showAll });
    return [...r.header.map((x) => x.label), ...flat(r.tabs)];
  };
  assert.deepEqual(shown('', false), ['TA', 'Routine/Routine: TE 5 ms|6 ms *']);
  assert.deepEqual(shown('', true), ['TA', 'PM', 'Voxel size', 'Rel. SNR', 'Sequence', 'Routine/Routine: TR 100 ms|100 ms', 'Routine/Routine: TE 5 ms|6 ms *']);
  assert.deepEqual(shown(' t ', true), ['TA', 'Routine/Routine: TR 100 ms|100 ms', 'Routine/Routine: TE 5 ms|6 ms *']);
  assert.deepEqual(shown('routine', true), []);
  assert.equal(cardRows(c, { query: '', showAll: false }).empty, null);
});

test('cardRows: the empty messages', () => {
  const same = compareCards(cards({ R: { R: [line('TR', '100 ms')] } }), cards({ R: { R: [line('TR', '100 ms')] } }));
  const differ = compareCards(cards({ R: { R: [line('TR', '100 ms')] } }), cards({ R: { R: [line('TR', '200 ms')] } }));
  assert.equal(cardRows(same, { query: '', showAll: false }).empty, 'No card line differs');
  assert.equal(cardRows(same, { query: '', showAll: true }).empty, null);
  assert.equal(cardRows(differ, { query: 'zzz', showAll: false }).empty, 'No differing line matches the filter');
  assert.equal(cardRows(same, { query: 'tr', showAll: false }).empty, 'No differing line matches the filter');
  assert.equal(cardRows(differ, { query: 'zzz', showAll: true }).empty, 'No line matches the filter');
  const none = compareCards(cards({}), cards({}));
  assert.ok(none.header.length > 0);
  assert.equal(cardRows(none, { query: '', showAll: false }).empty, 'No card of the catalog applies to either protocol');
  assert.equal(cardRows(none, { query: '', showAll: true }).empty, null);
});
