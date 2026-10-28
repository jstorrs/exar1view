// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCards, parseCatalog } from '../src/core/cards.js';
import { FORMULAS } from '../src/core/cardformulas.js';

/** @typedef {import('../src/core/cardsource.js').CardSources} CardSources */

/** @param {{ asc?: Record<string, string>, pv?: Record<string, string>, sequence?: string }} o @returns {CardSources} */
function sources({ asc = {}, pv = {}, sequence = '%SiemensSeq%\\alpha' }) {
  return {
    asc: new Map(Object.entries(asc)), nBlocks: 1, pv: new Map(Object.entries(pv)), ctrl: new Map(), eva: new Map(),
    sequence, seq: sequence.slice(sequence.lastIndexOf('\\') + 1),
  };
}

const CATALOG = {
  version: 1,
  cards: ['Routine', 'Contrast - Common', 'Contrast - Dynamic', 'System - Adjust Volume'],
  sequences: {
    '%SiemensSeq%\\alpha': { cards: ['Routine', 'Contrast - Common', 'Contrast - Dynamic'] },
    '%SiemensSeq%\\beta': { cards: ['Contrast - Common'], slots: { 'Contrast - Common': ['Fat suppr.', 'TR'] } },
    '%SiemensSeq%\\delta': { cards: ['System - Adjust Volume'] },
    '%SiemensSeq%\\epsilon': { cards: ['System - Adjust Volume'] },
  },
  slots: {
    Routine: [
      { id: 'Slice group/#', group: 'slice', rule: { kind: 'formula', name: 'group_number' } },
      { id: 'Slice group/Slices', group: 'slice', rule: { kind: 'number', key: 'sGroupArray.asGroup[#].nSize', scale: 1, offset: 0, unit: '', format: 'fixed0' } },
      { id: 'Slice group/Dist. factor', group: 'slice', rule: { kind: 'number', key: 'sGroupArray.asGroup[#].dDistFact', scale: 100, offset: 0, unit: '%', format: 'fixed0', absent: 0 } },
      { id: 'Slice group/Special', group: 'slice', when: { key: 'sGroupArray.asGroup[#].flag', present: true }, rule: { kind: 'constant', text: 'Yes ' } },
      { id: 'Slice group/Child', group: 'slice', parent: 'Slice group/Special', rule: { kind: 'constant', text: 'On ' } },
      { id: 'Coil', rule: { kind: 'raw', key: 'sCoil.tName' } },
      { id: 'Coil#1', rule: { kind: 'raw', key: 'sCoil.tName', unit: 'x' } },
      { id: 'Averages', rule: { kind: 'formula', name: 'not_written_yet' } },
      { id: 'Frequency', rule: { kind: 'unknown', why: 'print-time state' } },
    ],
    'Contrast - Common': [
      { id: 'TR', rule: { kind: 'number', key: 'alTR[0]', scale: 0.001, offset: 0, unit: 'ms', format: 'fixed1', formatBySequence: { '%SiemensSeq%\\beta': 'fixed2' } } },
      { id: 'TI', when: { key: 'sPrepPulses.ucInversion', nonzero: true }, rule: { kind: 'number', key: 'alTI[0]', scale: 0.001, offset: 0, unit: 'ms', format: 'trim1' } },
      { id: 'Fat suppr.', rule: { kind: 'lookup', keys: ['sPrepPulses.ucFatSat'], table: { '0x1': 'Weak', '0x2': 'Strong', '<absent>': 'None' } } },
      { id: 'Unfiltered images', parent: 'Fat suppr.', when: { key: 'sPrepPulses.ucFatSat', in: ['0x1'] }, rule: { kind: 'constant', text: 'Off ' } },
      { id: 'Mode', rule: { kind: 'lookup', keys: ['seq', 'sKSpace.ucDimension'], table: { 'alpha\u001f0x2': '2D' } } },
      { id: 'Dark blood', when: { key: 'pv:sub.0.msr.dark_blood', present: true }, rule: { kind: 'lookup', keys: ['pv:sub.0.msr.dark_blood'], table: { true: 'On ' } } },
      { id: 'Water suppr.', when: { key: 'sWater.uc', in: ['<absent>', '0x0'] }, rule: { kind: 'constant', text: 'None ' } },
    ],
    'Contrast - Dynamic': [
      { id: 'Measurements', when: { key: 'lRepetitions', present: true }, rule: { kind: 'number', key: 'lRepetitions', scale: 1, offset: 1, unit: '', format: 'fixed0' } },
    ],
    'System - Adjust Volume': [
      { id: 'Position', bang: { key: 'sAdjData.uiAdjVolumeValid', nonzero: true }, rule: { kind: 'constant', text: 'Isocenter ' } },
      { id: '@extent', bang: { key: 'sAdjData.uiAdjVolumeValid', nonzero: true }, rule: { kind: 'formula', name: 'extent', variant: 'round', variantBySequence: { '%SiemensSeq%\\delta': 'ceil' } } },
      { id: '@extent#1', rule: { kind: 'formula', name: 'extent_none' } },
      { id: 'Reset', rule: { kind: 'constant', text: 'Off ' } },
    ],
  },
};

function catalog() {
  const r = parseCatalog(structuredClone(CATALOG));
  if (!r.ok) throw new Error(r.error);
  return r.catalog;
}

/** @param {ReturnType<typeof buildCards>} out @param {string} name */
function linesOf(out, name) {
  const card = out.tabs.flatMap((t) => t.cards).find((c) => c.name === name);
  return card && card.lines.map((l) => [l.label, l.text, l.status]);
}

const ALPHA = {
  'sGroupArray.lSize': '2', 'sGroupArray.asGroup[0].nSize': '20', 'sGroupArray.asGroup[1].nSize': '5',
  'sGroupArray.asGroup[0].dDistFact': '0.3', 'sGroupArray.asGroup[0].flag': '1', 'sCoil.tName': '"Head_32"',
  'alTR[0]': '2500000', 'sPrepPulses.ucFatSat': '0x1', 'sKSpace.ucDimension': '0x2',
};

/** A catalog of one card `X` holding `slots`, printed by the default test sequence. @param {unknown[]} slots @param {string[]} [cards] */
function oneCard(slots, cards = ['X']) {
  const r = parseCatalog({ version: 1, cards, sequences: { '%SiemensSeq%\\alpha': { cards } }, slots: { [cards[0]]: slots } });
  if (!r.ok) throw new Error(r.error);
  return r.catalog;
}

test('a known sequence prints its cards in catalog order, grouped by tab', () => {
  const out = buildCards(catalog(), sources({ asc: ALPHA }));
  assert.equal(out.approximate, false);
  assert.deepEqual(out.tabs.map((t) => [t.tab, t.cards.map((c) => c.name)]), [
    ['Routine', ['Routine']],
    ['Contrast', ['Contrast - Common', 'Contrast - Dynamic']],
  ]);
  assert.deepEqual(linesOf(out, 'Contrast - Dynamic'), []); // a listed card shows even with no line
});

test('grouped slots repeat per group: header line, a when on a [#] key, a parent in the group', () => {
  const out = buildCards(catalog(), sources({ asc: ALPHA }));
  assert.deepEqual(linesOf(out, 'Routine'), [
    ['Slice group', '1', 'ok'], ['Slices', '20 ', 'ok'], ['Dist. factor', '30 %', 'ok'], ['Special', 'Yes ', 'ok'], ['Child', 'On ', 'ok'],
    ['Slice group', '2', 'ok'], ['Slices', '5 ', 'ok'], ['Dist. factor', '0 %', 'ok'],
    ['Coil', 'Head_32', 'ok'], ['Coil', 'Head_32 x', 'ok'],
  ]);
  assert.equal(out.omitted, 2); // the unregistered formula and the unknown rule
});

test('predicates, lookups, parents and per-sequence formats', () => {
  const out = buildCards(catalog(), sources({ asc: ALPHA }));
  assert.deepEqual(linesOf(out, 'Contrast - Common'), [
    ['TR', '2500.0 ms', 'ok'], ['Fat suppr.', 'Weak', 'ok'], ['Unfiltered images', 'Off ', 'ok'], ['Mode', '2D', 'ok'],
    ['Water suppr.', 'None ', 'ok'],
  ]);
  const other = buildCards(catalog(), sources({
    asc: { 'alTR[0]': '2500000', 'sPrepPulses.ucInversion': '0x1', 'alTI[0]': '300000', 'sKSpace.ucDimension': '0x4', 'sWater.uc': '0x1', 'lRepetitions': '9' },
    pv: { 'sub.0.msr.dark_blood': 'true' },
  }));
  assert.deepEqual(linesOf(other, 'Contrast - Common'), [
    ['TR', '2500.0 ms', 'ok'], ['TI', '300 ms', 'ok'], ['Fat suppr.', 'None', 'ok'], ['Mode', 'alpha | 0x4', 'raw'], ['Dark blood', 'On ', 'ok'],
  ]);
  assert.deepEqual(linesOf(other, 'Contrast - Dynamic'), [['Measurements', '10 ', 'ok']]);
});

test('a sequence narrows a card to its slots, in the card order, and picks its number format', () => {
  const out = buildCards(catalog(), sources({ asc: ALPHA, sequence: '%SiemensSeq%\\beta' }));
  assert.deepEqual(out.tabs, [{ tab: 'Contrast', cards: [{ name: 'Contrast - Common', lines: [
    { label: 'TR', text: '2500.00 ms', status: 'ok' }, { label: 'Fat suppr.', text: 'Weak', status: 'ok' },
  ] }] }]);
  assert.equal(out.omitted, 0);
});

test('a value missing from the sources counts as omitted unless the slot has a when', () => {
  const out = buildCards(catalog(), sources({ asc: { 'sGroupArray.lSize': '0' } }));
  assert.deepEqual(linesOf(out, 'Contrast - Common'), [['Fat suppr.', 'None', 'ok'], ['Water suppr.', 'None ', 'ok']]);
  assert.deepEqual(linesOf(out, 'Routine'), []); // no group, no coil
  assert.equal(out.omitted, 1 + 1 + 2 + 2); // TR; Mode (only seq is known); both coil lines; formula + unknown
});

test('bang prefixes "! " or two spaces; an @ formula gives the label, with its per-sequence variant', () => {
  const formulas = new Map([...FORMULAS, ['extent', (/** @type {any} */ _s, /** @type {any} */ _g, /** @type {string | null} */ v) => ({ label: 'A >> P', text: `${v} mm` })]]);
  const set = buildCards(catalog(), sources({ asc: { 'sAdjData.uiAdjVolumeValid': '1' }, sequence: '%SiemensSeq%\\delta' }), formulas);
  assert.deepEqual(linesOf(set, 'System - Adjust Volume'), [['! Position', 'Isocenter ', 'ok'], ['! A >> P', 'ceil mm', 'ok'], ['Reset', 'Off ', 'ok']]);
  assert.equal(set.omitted, 1); // extent_none is not registered
  const unset = buildCards(catalog(), sources({ sequence: '%SiemensSeq%\\epsilon' }), formulas);
  assert.deepEqual(linesOf(unset, 'System - Adjust Volume')?.slice(0, 2), [['  Position', 'Isocenter ', 'ok'], ['  A >> P', 'round mm', 'ok']]);
});

test('an unknown sequence shows only cards with a line from a stored value, and counts their omissions only', () => {
  const out = buildCards(catalog(), sources({ asc: { 'sAdjData.uiAdjVolumeValid': '1', 'alTR[0]': '1000000' }, sequence: '%SiemensSeq%\\gamma' }));
  assert.equal(out.approximate, true);
  assert.deepEqual(out.tabs.map((t) => t.cards.map((c) => c.name)), [['Contrast - Common']]);
  assert.equal(out.omitted, 1); // Mode; the dropped Routine and Adjust Volume cards' omissions do not count

  const r = parseCatalog({
    version: 1, cards: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], sequences: {},
    slots: {
      A: [{ id: 'a', when: { key: 'k', in: ['1'] }, rule: { kind: 'constant', text: 'x' } }],
      B: [{ id: 'b', rule: { kind: 'constant', text: 'x' } }],
      C: [{ id: 'c', rule: { kind: 'lookup', keys: ['m'], table: { '<absent>': 'None' } } }],
      D: [{ id: 'd', rule: { kind: 'number', key: 'm', scale: 1, offset: 0, unit: '', format: 'fixed0', absent: 0 } }],
      E: [{ id: 'e', rule: { kind: 'lookup', keys: ['seq', 'meta:n_asc'], table: { 'alpha\u001f1': 'Y' } } }],
      F: [{ id: 'f', when: { key: 'm', in: ['<absent>'] }, rule: { kind: 'constant', text: 'x' } }],
      G: [{ id: 'g', rule: { kind: 'lookup', keys: ['k', 'm'], table: {} } }],
    },
  });
  assert.ok(r.ok);
  const ev = buildCards(r.catalog, sources({ asc: { k: '1' }, sequence: '%Other%\\alpha' }));
  assert.deepEqual(ev.tabs.map((t) => t.tab), ['A', 'G']);
  assert.deepEqual(linesOf(ev, 'G'), [['g', '1 | —', 'raw']]); // never the <absent> sentinel
});

test('an @ slot whose formula is missing, gives text only, or throws is omitted; null is not applicable', () => {
  const cat = oneCard([
    { id: '@a', rule: { kind: 'formula', name: 'text_only' } },
    { id: '@b', rule: { kind: 'formula', name: 'throws' } },
    { id: '@c', rule: { kind: 'formula', name: 'nothing' } },
    { id: 'D', rule: { kind: 'formula', name: 'nothing' } },
  ]);
  const formulas = new Map([
    ['text_only', () => 'x'], ['throws', () => { throw new Error('boom'); }], ['nothing', () => null],
  ]);
  const out = buildCards(cat, sources({}), /** @type {any} */ (formulas));
  assert.deepEqual({ ...out, header: undefined }, { tabs: [{ tab: 'X', cards: [{ name: 'X', lines: [] }] }], omitted: 3, approximate: false, header: undefined });
});

test('a child line prints only after its parent printed', () => {
  const cat = oneCard([
    { id: 'Filter', when: { key: 'a', present: true }, rule: { kind: 'constant', text: 'On ' } },
    { id: 'Unfiltered images', parent: 'Filter', when: { key: 'b', present: true }, rule: { kind: 'constant', text: 'Off ' } },
    { id: 'Other', rule: { kind: 'constant', text: 'x' } },
  ]);
  assert.deepEqual(linesOf(buildCards(cat, sources({ asc: { b: '1' } })), 'X'), [['Other', 'x', 'ok']]);
  assert.deepEqual(linesOf(buildCards(cat, sources({ asc: { a: '1', b: '1' } })), 'X')?.map((l) => l[0]), ['Filter', 'Unfiltered images', 'Other']);
});

test('more groups than lSize allows are capped, and navigators without lSize print none', () => {
  const cat = oneCard([
    { id: 'Navigator/#', group: 'navigator', rule: { kind: 'formula', name: 'group_number' } },
    { id: 'Slab group/#', group: 'slab', rule: { kind: 'formula', name: 'group_number' } },
  ]);
  assert.deepEqual(linesOf(buildCards(cat, sources({})), 'X'), [['Slab group', '1', 'ok']]);
  assert.equal(linesOf(buildCards(cat, sources({ asc: { 'sGroupArray.lSize': '1e9' } })), 'X')?.length, 128);
});

test('parseCatalog names the path of the first bad part', () => {
  /** @param {(c: any) => void} edit */
  const err = (edit) => {
    const c = structuredClone(CATALOG);
    edit(c);
    const r = parseCatalog(c);
    return r.ok ? 'ok' : r.error;
  };
  const R = 'catalog.slots["Routine"]';
  const C = 'catalog.slots["Contrast - Common"]';
  const BETA = 'catalog.sequences["%SiemensSeq%\\\\beta"]';
  assert.equal(err(() => {}), 'ok');
  assert.equal(parseCatalog(null).ok, false);
  assert.equal(err((c) => { c.version = 2; }), 'catalog.version: expected 1');
  assert.equal(err((c) => { c.extra = 1; }), 'catalog: unknown field "extra"');
  assert.equal(err((c) => { c.cards.push('Routine'); }), 'catalog.cards[4]: duplicate card "Routine"');
  assert.equal(err((c) => { c.slots.Routine[5].rule.kind = 'regex'; }), `${R}[5].rule.kind: unknown rule kind "regex"`);
  assert.equal(err((c) => { c.slots.Routine[5].rule.text = 'x'; }), `${R}[5].rule: unknown field "text"`);
  assert.equal(err((c) => { c.slots.Routine[5].note = 'x'; }), `${R}[5]: unknown field "note"`);
  assert.equal(err((c) => { c.slots[`Contrast - Common`][1].when = { key: 'x', nonzero: 1 }; }), `${C}[1].when.nonzero: expected true`);
  assert.equal(err((c) => { c.slots[`Contrast - Common`][1].when.present = true; }), `${C}[1].when: expected exactly one of "in", "nonzero", "present"`);
  assert.equal(err((c) => { c.slots[`Contrast - Common`][1].when = { key: 'x' }; }), `${C}[1].when: expected exactly one of "in", "nonzero", "present"`);
  assert.equal(err((c) => { c.slots[`Contrast - Common`][1].when.not = true; }), `${C}[1].when: unknown field "not"`);
  assert.equal(err((c) => { c.slots[`Contrast - Common`][3].when.in = '0x1'; }), `${C}[3].when.in: expected an array`);
  assert.equal(err((c) => { c.slots[`Contrast - Common`][0].rule.formatBySequence['%SiemensSeq%\\beta'] = 'round1'; }),
    `${C}[0].rule.formatBySequence["%SiemensSeq%\\\\beta"]: unknown number format "round1"`);
  assert.equal(err((c) => { c.slots[`Contrast - Common`][3].parent = 'Mode'; }), `${C}[3].parent: no earlier slot "Mode"`);
  assert.equal(err((c) => { c.slots.Routine[5].parent = 'Slice group/Special'; }), `${R}[5].parent: "Slice group/Special" is in another group`);
  assert.equal(err((c) => { c.slots.Routine[0].group = 'shim'; }), `${R}[0].group: unknown group "shim"`);
  assert.equal(err((c) => { c.slots.Routine[0].id = 'Slices'; }), `${R}[0].id: a grouped id needs "Header/Label"`);
  assert.equal(err((c) => { c.slots.Routine.push({ id: 'Slice group/Late', group: 'slice', rule: { kind: 'constant', text: '' } }); }),
    `${R}[9].group: the run of group "slice" already ended`);
  assert.equal(err((c) => { c.slots.Routine[6].id = 'Coil'; }), `${R}[6].id: duplicate id "Coil"`);
  assert.equal(err((c) => { c.slots.Routine[5].id = '@coil'; }), `${R}[5].rule: an @ slot needs a formula`);
  assert.equal(err((c) => { c.slots.Routine[5].rule = { kind: 'lookup', keys: [], table: {} }; }), `${R}[5].rule.keys: expected at least one key`);
  assert.equal(err((c) => { c.slots.Routine[1].rule.scale = '1'; }), `${R}[1].rule.scale: expected a number`);
  assert.equal(err((c) => { c.sequences['%SiemensSeq%\\beta'].cards.push('Nope'); }), `${BETA}.cards[1]: unknown card "Nope"`);
  assert.equal(err((c) => { c.sequences['%SiemensSeq%\\beta'].note = ''; }), `${BETA}: unknown field "note"`);
  assert.equal(err((c) => { c.sequences['%SiemensSeq%\\beta'].slots.Routine = ['Coil']; }), `${BETA}.slots["Routine"]: unknown card "Routine"`);
  assert.equal(err((c) => { c.sequences['%SiemensSeq%\\beta'].slots['Contrast - Common'].push('TE'); }), `${BETA}.slots["Contrast - Common"]: unknown slot "TE"`);
  assert.equal(err((c) => { c.slots.Nope = []; }), 'catalog.slots["Nope"]: unknown card "Nope"');
});

test('buildCards never throws on odd sources', () => {
  const odd = sources({ asc: { 'sGroupArray.lSize': '-3', 'alTR[0]': '"x"', 'sPrepPulses.ucFatSat': '0x9' }, sequence: '' });
  const out = buildCards(catalog(), odd);
  assert.equal(out.approximate, true);
  assert.deepEqual(linesOf(out, 'Contrast - Common')?.[0], ['Fat suppr.', '0x9', 'raw']);
});
