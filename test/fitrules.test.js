// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPolicy, collectInstances, fitRule, policyContext } from '../tools/cards/fitrules.js';
import { observationOf } from '../tools/cards/layout.js';
import { parseCatalog } from '../src/core/cards.js';

/** @typedef {import('../src/core/cardsource.js').CardSources} CardSources */
/** @typedef {import('../src/core/cardformulas.js').CardFormula} CardFormula */
/** @typedef {import('../tools/cards/fitrules.js').Instance} Instance */
/** @typedef {import('../tools/cards/fitrules.js').FitResult} FitResult */
/** @typedef {import('../tools/cards/fitrules.js').RuleJson} RuleJson */

const STD = '%SiemensSeq%\\alpha';
const STD2 = '%SiemensSeq%\\beta';
const STD3 = '%SiemensSeq%\\delta';
const CUST = '%CustomerSeq%\\gamma';

/** @param {Record<string, string>} asc @param {string} sequence @returns {CardSources} */
const sources = (asc, sequence) => ({
  asc: new Map(Object.entries(asc)), nBlocks: 1, pv: new Map(), ctrl: new Map(), eva: new Map(),
  sequence, seq: sequence.slice(sequence.lastIndexOf('\\') + 1),
});

/**
 * A printed line of a slot.
 * @param {string} text @param {Record<string, string>} [asc] @param {string} [sequence] @param {{ group?: number, label?: string }} [o]
 * @returns {Instance}
 */
function line(text, asc = {}, sequence = STD, { group, label = 'L' } = {}) {
  const category = sequence.startsWith('%Customer') ? 'customer' : 'standard';
  return { sequence, category, src: sources(asc, sequence), group: group ?? null, label, text, bang: null };
}

/** @param {RuleJson} rule @param {number} [textSequences] @param {string[]} [choiceKeys] @returns {FitResult} */
const fit = (rule, textSequences = 0, choiceKeys = []) => ({ rule, accuracy: null, textSequences, choiceKeys });

test('collectInstances groups printed lines by card and slot id', () => {
  const card = {
    name: 'C', params: [
      { label: 'TR', value: '100 ms', grouped: false }, { label: '! Gain', value: 'High ', grouped: false },
      { label: 'Slice group', value: '1 ', grouped: false }, { label: 'Slices', value: '4 ', grouped: true },
      { label: 'Slice group', value: '2 ', grouped: false }, { label: 'Slices', value: '6 ', grouped: true },
    ],
  };
  const o = observationOf({ path: [], header: { path: '', lines: [] }, cards: [card] }, sources({}, STD));
  const got = collectInstances([o], { slots: {} }).get('C');
  assert.deepEqual([...(got?.keys() ?? [])], ['TR', 'Gain', 'Slice group/#', 'Slice group/Slices']);
  assert.deepEqual(got?.get('Gain')?.map((i) => [i.label, i.text, i.bang, i.category]), [['Gain', 'High ', true, 'standard']]);
  assert.deepEqual(got?.get('Slice group/Slices')?.map((i) => [i.group, i.text]), [[0, '4 '], [1, '6 ']]);
});

test('fitRule fits a number: unit, global and per-sequence formats, accuracy by text and value', () => {
  const lines = [
    line('2.5 ms', { alTR: '2500' }), line('3 ms', { alTR: '3000' }), line('4 ms', { alTR: '4000' }),
    line('5.00 ms', { alTR: '5000' }, STD2), line('6.00 ms', { alTR: '6000' }, STD2), line('7 ms', { alTR: '7000' }, STD3),
    line('7.000 ms', { alTR: '7000' }, CUST), line('8.000 ms', { alTR: '8000' }, CUST),
  ];
  const r = fitRule({ kind: 'number', key: 'alTR', scale: 0.001, offset: 0 }, lines);
  assert.deepEqual(r.rule, { kind: 'number', key: 'alTR', scale: 0.001, offset: 0, unit: 'ms', format: 'trim1', formatBySequence: { [STD2]: 'fixed2' } });
  assert.deepEqual(r.accuracy, { lines: 6, text: 6, value: 6 }, 'no override where the global format does as well');
  assert.equal(r.textSequences, 0);
  const fixed = fitRule({ kind: 'number', key: 'alTR', scale: 0.001, offset: 0 }, [line('2.5 ms', { alTR: '2500' }), line('3 ms', { alTR: '3000' }), line('4.0 ms', { alTR: '4000' })]);
  assert.equal(fixed.rule.kind === 'number' && fixed.rule.format, 'fixed1', 'a tie goes to the format seen first');
  assert.deepEqual(fixed.accuracy, { lines: 3, text: 2, value: 3 }, '"3.0 ms" for a printed "3 ms" matches by value only');
});

test('fitRule stores a number default as the source value, only when it reproduces a print', () => {
  const shape = /** @type {const} */ ({ kind: 'number', key: 'lRep', scale: 1, offset: 1 });
  const kept = fitRule(shape, [line('3 ', { lRep: '2' }), line('1 ', {}), line('1 ', {})]);
  assert.equal(kept.rule.kind === 'number' && kept.rule.absent, 0);
  assert.deepEqual(kept.accuracy, { lines: 3, text: 3, value: 3 });
  const scaled = fitRule({ kind: 'number', key: 'x', scale: 0.001, offset: 0 }, [line('0.3 ms', { x: '300' }), line('0.3 ms', {})]);
  assert.equal(scaled.rule.kind === 'number' && scaled.rule.absent, 300);
  /** @param {Instance[]} ls */
  const absent = (ls) => { const r = fitRule(shape, ls).rule; return r.kind === 'number' ? r.absent : 'not a number'; };
  assert.equal(absent([line('3 ', { lRep: '2' }), line('Off ', {}), line('Off ', {}), line('1 ', {})]), undefined, 'a text default is never fitted');
  assert.equal(absent([line('3 ', { lRep: '2' }), line('2 ', {}), line('1 ', {}), line('2 ', {})]), 1, 'the most common default');
  assert.equal(absent([line('3.0 ', { lRep: '2' }), line('4.0 ', { lRep: '3' }), line('1 ', {})]), undefined, '"1" does not print as the fitted fixed1');
});

test('fitRule fits a lookup by majority per key, with absent keys', () => {
  const shape = /** @type {const} */ ({ kind: 'lookup', keys: ['ucMode', 'seq'] });
  const lines = [
    line('Off ', { ucMode: '1' }), line('Off ', { ucMode: '1' }), line('On ', { ucMode: '1' }),
    line('Fast ', { ucMode: '2' }), line('None ', {}), line('Secret ', { ucMode: '3' }, CUST),
  ];
  const r = fitRule(shape, lines);
  assert.deepEqual(r.rule, { kind: 'lookup', keys: ['ucMode', 'seq'], table: { '1\u001falpha': 'Off ', '2\u001falpha': 'Fast ', '<absent>\u001falpha': 'None ' } });
  assert.deepEqual(r.accuracy, { lines: 5, text: 4, value: 4 });
});

test('fitRule keeps raw, constant and unknown shapes', () => {
  const raw = fitRule({ kind: 'raw', key: 'tName', unit: 'mm' }, [line('a mm', { tName: '"a"' }), line('b', { tName: '"b"' })]);
  assert.deepEqual(raw, { rule: { kind: 'raw', key: 'tName', unit: 'mm' }, accuracy: { lines: 2, text: 1, value: 1 }, textSequences: 0, choiceKeys: [] });
  const constant = fitRule({ kind: 'constant' }, [line('On '), line('Off ', {}, STD2), line('On '), line('Site ', {}, CUST), line('Site ', {}, CUST)]);
  assert.deepEqual(constant, { rule: { kind: 'constant', text: 'On ' }, accuracy: { lines: 3, text: 2, value: 2 }, textSequences: 1, choiceKeys: [] });
  const spread = fitRule({ kind: 'constant' }, [1, 2, 3, 4, 5].map((n) => line(`T${n} `, {}, `%SiemensSeq%\\s${n}`)));
  assert.equal(spread.textSequences, 1, 'five sequences, five texts');
  const spreadCtx = policyContext([{ id: 'X', fit: spread }], [1, 2, 3, 4, 5].map((n) => `%SiemensSeq%\\s${n}`));
  assert.equal(spreadCtx.vocabulary.size, 0);
  assert.equal(applyPolicy({ id: 'X', fit: spread }, spreadCtx).reason, 'narrow text constant');
  const unknown = fitRule({ kind: 'unknown', why: 'print-time state', review: 'checked' }, [line('1 ')]);
  assert.deepEqual(unknown, { rule: { kind: 'unknown', why: 'print-time state' }, accuracy: { lines: 1, text: 0, value: 0 }, textSequences: 0, choiceKeys: [] });
  assert.deepEqual(fitRule({ kind: 'lookup', keys: ['ctrl:A'], choiceKeys: ['ctrl:A'] }, [line('x', {})]).choiceKeys, ['ctrl:A']);
  assert.deepEqual(fitRule({ kind: 'constant' }, [line('Site ', {}, CUST)]).rule, { kind: 'unknown', why: 'not printed by a standard or service sequence' });
});

test('fitRule fits formula variants globally and per sequence; an unregistered formula stays as named', () => {
  /** @type {CardFormula} */
  const half = (src, _g, variant) => {
    const x = Number(src.asc.get('x')) / 2;
    return variant === 'floor' ? String(Math.floor(x)) : variant === 'ceil' ? String(Math.ceil(x)) : null;
  };
  /** @type {CardFormula} */
  const labelled = (src) => ({ label: src.asc.get('d') ?? '', text: '1' });
  const formulas = new Map([['half', half], ['labelled', labelled]]);
  const lines = [line('1', { x: '3' }), line('2', { x: '5' }), line('3', { x: '5' }, STD2), line('9', { x: '17' }, CUST)];
  const r = fitRule({ kind: 'formula', name: 'half', variants: ['ceil', 'floor'] }, lines, formulas);
  assert.deepEqual(r.rule, { kind: 'formula', name: 'half', variant: 'floor', variantBySequence: { [STD2]: 'ceil' } });
  assert.deepEqual(r.accuracy, { lines: 3, text: 3, value: 3 });
  const l = fitRule({ kind: 'formula', name: 'labelled' }, [line('1', { d: 'R' }, STD, { label: 'R' }), line('1', { d: 'L' }, STD, { label: 'R' })], formulas);
  assert.deepEqual(l, { rule: { kind: 'formula', name: 'labelled' }, accuracy: { lines: 2, text: 1, value: 1 }, textSequences: 0, choiceKeys: [] });
  const named = { rule: { kind: 'formula', name: 'later' }, accuracy: null, textSequences: 0, choiceKeys: [] };
  assert.deepEqual(fitRule({ kind: 'formula', name: 'later', variants: ['a'] }, lines, formulas), named);
  assert.deepEqual(fitRule({ kind: 'formula', name: 'half', variants: ['ceil'] }, [line('9', { x: '17' }, CUST)], formulas), { ...named, rule: { kind: 'formula', name: 'half' } }, 'no standard/service lines');
  const groups = fitRule({ kind: 'formula', name: 'group_number' }, [line('1', {}, STD, { group: 0 }), line('2', {}, STD, { group: 1 })]);
  assert.deepEqual(groups.accuracy, { lines: 2, text: 2, value: 2 });
});

test('fitted rules parse as catalog rules', () => {
  const rules = [
    fitRule({ kind: 'number', key: 'k', scale: 1, offset: 1 }, [line('2 s', { k: '1' }), line('1 s', {}), line('3.0 s', { k: '2' }, STD2)]).rule,
    fitRule({ kind: 'lookup', keys: ['k'] }, [line('A', { k: '1' }), line('B', {})]).rule,
    fitRule({ kind: 'formula', name: 'group_number', variants: ['v'] }, [line('1', {}, STD, { group: 0 })]).rule,
    { kind: 'raw', key: 'k' }, { kind: 'constant', text: 'On' }, { kind: 'unknown', why: 'x' },
  ];
  const slots = rules.map((rule, n) => ({ id: `S${n}`, rule }));
  slots.push({ id: '@aa.x', rule: fitRule({ kind: 'formula', name: 'aa_axis' }, [line('1', {}, CUST)]).rule });
  const parsed = parseCatalog({ version: 1, cards: ['C'], sequences: {}, slots: { C: slots } });
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
});

test('policyContext collects vocabulary and varying label families', () => {
  const ctx = policyContext([
    { id: 'Mode', fit: fit({ kind: 'lookup', keys: ['k'], table: { 1: 'On ', 2: 'Off ', '<absent>': 'None ' } }) },
    { id: 'Identity', fit: fit({ kind: 'lookup', keys: ['k'], table: { 1: '1 ' } }) },
    { id: 'Plain', fit: fit({ kind: 'raw', key: 'k' }) },
    { id: 'Broad', fit: fit({ kind: 'constant', text: 'Auto ' }, 5) },
    { id: 'Narrow', fit: fit({ kind: 'constant', text: 'Site ' }, 4) },
    { id: 'Numbers', fit: fit({ kind: 'lookup', keys: ['k'], table: Object.fromEntries(Array.from({ length: 9 }, (_, n) => [String(n), `${n} mm`])) }) },
    { id: 'Slice group/TE 2#1', fit: fit({ kind: 'number', key: 'k', scale: 1, offset: 0, unit: 'ms', format: 'fixed0' }) },
    { id: 'Gone', fit: fit({ kind: 'unknown', why: 'x' }) },
    { id: 'Named', fit: fit({ kind: 'lookup', keys: ['tName'], table: { '"Site"': 'Head ' } }) },
    { id: 'Mixed', fit: fit({ kind: 'lookup', keys: ['k'], table: { 3: 'Fast ', '"Site"': 'Body ' } }) },
  ], [STD]);
  assert.deepEqual([...ctx.vocabulary].sort(), ['Auto ', 'Fast ', 'Off ', 'On '], 'no output of a text key');
  assert.deepEqual([...ctx.varyingFamilies].sort(), ['Mixed', 'Mode', 'TE'], 'not raw, identity, numeric or text-keyed lookups');
  assert.deepEqual([...ctx.sequences], [STD]);
});

test('applyPolicy keeps or drops constants', () => {
  const ctx = { vocabulary: new Set(['On ']), varyingFamilies: new Set(['TE']), sequences: new Set([STD]) };
  /** @param {string} id @param {string} text @param {number} sequences */
  const decide = (id, text, sequences) => applyPolicy({ id, fit: fit({ kind: 'constant', text }, sequences) }, ctx);
  assert.deepEqual(decide('X', '12 ', 5), { rule: { kind: 'constant', text: '12 ' }, reason: 'broad constant' });
  assert.deepEqual(decide('TE 3', '12 ms', 1), { rule: { kind: 'unknown', why: 'narrow numeric constant' }, reason: 'narrow numeric constant' });
  assert.deepEqual(decide('X', 'On ', 1), { rule: { kind: 'constant', text: 'On ' }, reason: 'constant in vocabulary' });
  assert.deepEqual(decide('TE 3', 'Var ', 1), { rule: { kind: 'constant', text: 'Var ' }, reason: 'constant of a varying label family' });
  assert.deepEqual(decide('X', 'Site ', 4), { rule: { kind: 'unknown', why: 'narrow text constant' }, reason: 'narrow text constant' });
});

test('a constant whose label family varies only by raw or dropped rules is narrow', () => {
  const others = [
    { id: 'Name 1', fit: fit({ kind: 'raw', key: 'k' }) },
    { id: 'Name 2', fit: fit({ kind: 'lookup', keys: ['k'], table: { '"a"': 'Head ', '"b"': 'Body ' } }) },
  ];
  const constant = { id: 'Name 3', fit: fit({ kind: 'constant', text: 'Site ' }, 1) };
  const ctx = policyContext([...others, constant], [STD]);
  assert.equal(applyPolicy(others[1], ctx).reason, 'lookup on a text key');
  assert.equal(applyPolicy(constant, ctx).reason, 'narrow text constant');
});

test('applyPolicy turns lookups into raw, drops numeric tables and unknown absent defaults', () => {
  const ctx = { vocabulary: new Set(['None ']), varyingFamilies: new Set(), sequences: new Set([STD]) };
  /** @param {string[]} keys @param {Record<string, string>} table */
  const decide = (keys, table) => applyPolicy({ id: 'X', fit: fit({ kind: 'lookup', keys, table }) }, ctx);
  const numbers = Object.fromEntries(Array.from({ length: 9 }, (_, n) => [String(n), `${n * 10} mm`]));
  assert.deepEqual(decide(['k'], numbers).rule, { kind: 'unknown', why: 'numeric lookup with more than 8 entries' });
  const eight = Object.fromEntries(Object.entries(numbers).slice(1));
  assert.equal(decide(['k'], eight).reason, 'lookup');
  const identity = Object.fromEntries(Array.from({ length: 9 }, (_, n) => [String(n), `${n} mm`]));
  assert.deepEqual(decide(['k'], identity), { rule: { kind: 'raw', key: 'k', unit: 'mm' }, reason: 'identity lookup as raw' }, 'identity before size');
  assert.deepEqual(decide(['k'], { '"a"': 'a ', '"b"': 'b ' }), { rule: { kind: 'raw', key: 'k', unit: '' }, reason: 'identity lookup as raw' });
  assert.deepEqual(decide(['k'], { 1: '1', 2: '2' }).rule, { kind: 'raw', key: 'k' });
  assert.deepEqual(decide(['k'], { 1: '1 mm', 2: '2 mm' }).rule, { kind: 'raw', key: 'k', unit: 'mm' });
  assert.equal(decide(['k'], { 1: '1', 2: '2 mm' }).reason, 'lookup', 'mixed units');
  assert.equal(decide(['k', 'j'], { '1\u001f1': '1' }).reason, 'lookup', 'two keys');
  assert.equal(decide(['k'], { 1: '1', '<absent>': 'None ' }).reason, 'lookup', 'an absent entry is no identity');
  assert.deepEqual(decide(['k', 'j'], { '1\u001f1': 'A ', '<absent>\u001f1': 'Site ', '<absent>\u001f2': 'None ' }), {
    rule: { kind: 'lookup', keys: ['k', 'j'], table: { '1\u001f1': 'A ', '<absent>\u001f2': 'None ' } },
    reason: 'lookup without absent defaults outside vocabulary',
  });
  assert.equal(decide(['k'], { '<absent>': 'Site ' }).reason, 'lookup with no entry left');
});

test('applyPolicy drops a lookup keyed on a measured value', () => {
  const ctx = policyContext([], [STD]);
  /** @param {string[]} keys @param {Record<string, string>} table */
  const decide = (keys, table) => applyPolicy({ id: 'X', fit: fit({ kind: 'lookup', keys, table }) }, ctx);
  assert.deepEqual(decide(['k'], { '12.5': 'L12.5 ', '<absent>': 'Isocenter ' }).rule, { kind: 'unknown', why: 'lookup on a measured value' });
  assert.equal(decide(['k', 'j'], { '1\u001f-0.25': 'A ', '1\u001f2': 'B ' }).reason, 'lookup on a measured value', 'any key, any entry');
  assert.equal(decide(['k'], { '2.0': 'A ', '3': 'B ', '1e3': 'C ' }).reason, 'lookup', 'whole numbers are codes');
  const ctxWith = policyContext([{ id: 'X', fit: fit({ kind: 'lookup', keys: ['k'], table: { '0.5': 'Half ', 1: 'One ' } }) }], [STD]);
  assert.ok(!ctxWith.vocabulary.has('Half '), 'no vocabulary from it');
});

test('applyPolicy keeps only lookup entries keyed by codes or standard/service sequence names', () => {
  const ctx = { vocabulary: new Set(['None ']), varyingFamilies: new Set(), sequences: new Set([STD]) };
  /** @param {string[]} keys @param {Record<string, string>} table @param {string[]} [choiceKeys] */
  const decide = (keys, table, choiceKeys = []) => applyPolicy({ id: 'X', fit: fit({ kind: 'lookup', keys, table }, 0, choiceKeys) }, ctx);
  const codes = { '-1': 'A', '2e+05': 'B', '0x1F': 'C', true: 'D', FALSE: 'E', '<absent>': 'None ' };
  assert.deepEqual(decide(['k'], codes), { rule: { kind: 'lookup', keys: ['k'], table: codes }, reason: 'lookup' });
  assert.deepEqual(decide(['tName'], { '"Site A"': 'X', '"Site B"': 'Y', '<absent>': 'None ' }).rule, { kind: 'unknown', why: 'lookup on a text key' });
  assert.equal(decide(['k'], { 'Head': 'X', 'Body': 'Y' }).reason, 'lookup on a text key', 'unquoted text too');
  const symbols = { Auto_2: 'A', MANUAL: 'M', '<absent>': 'None ' };
  assert.deepEqual(decide(['ctrl:Queue.Mode'], symbols, ['ctrl:Queue.Mode']), { rule: { kind: 'lookup', keys: ['ctrl:Queue.Mode'], table: symbols }, reason: 'lookup' }, 'a reviewed choice key');
  assert.equal(decide(['eva:EVA.Mode', 'k'], { 'MANUAL\u001f1': 'M' }, ['eva:EVA.Mode']).reason, 'lookup');
  assert.equal(decide(['ctrl:Queue.Name'], { t1_site_name: 'A', other_name: 'B' }).reason, 'lookup on a text key', 'identifier-shaped text on a key not reviewed');
  assert.equal(decide(['ctrl:Queue.Mode'], { 'Site A': 'B', '2nd': 'C' }, ['ctrl:Queue.Mode']).reason, 'lookup on a text key', 'spaced or not an identifier');
  assert.deepEqual(decide(['k'], { 1: 'A', '"Site"': 'B' }), { rule: { kind: 'lookup', keys: ['k'], table: { 1: 'A' } }, reason: 'lookup without text keys' });
  assert.deepEqual(decide(['seq', 'k'], { 'alpha\u001f1': 'A', 'gamma\u001f1': 'B', 'alpha\u001f"x"': 'C', 'alpha\u001f2': 'D' }).rule, {
    kind: 'lookup', keys: ['seq', 'k'], table: { 'alpha\u001f1': 'A', 'alpha\u001f2': 'D' },
  });
  assert.deepEqual(decide(['tSequenceFileName'], { [`""${STD}""`]: 'A', [`""${CUST}""`]: 'B' }).rule, {
    kind: 'lookup', keys: ['tSequenceFileName'], table: { [`""${STD}""`]: 'A' },
  });
  assert.equal(decide(['k'], { '"a"': 'A', '<absent>': 'Site ' }).reason, 'lookup on a text key');
  assert.equal(decide(['k'], { 1: 'A', '"x"': 'B', '<absent>': 'Site ' }).reason, 'lookup without text keys, without absent defaults outside vocabulary');
});

test('applyPolicy keeps the other kinds as they are', () => {
  const ctx = { vocabulary: new Set(), varyingFamilies: new Set(), sequences: new Set() };
  /** @type {RuleJson[]} */
  const rules = [
    { kind: 'number', key: 'k', scale: 1, offset: 0, unit: '', format: 'fixed0', absent: 3 },
    { kind: 'raw', key: 'k' }, { kind: 'formula', name: 'f' }, { kind: 'unknown', why: 'x' },
  ];
  for (const rule of rules) assert.deepEqual(applyPolicy({ id: 'X', fit: fit(rule) }, ctx), { rule, reason: rule.kind });
});
