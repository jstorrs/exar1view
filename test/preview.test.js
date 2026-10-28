// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewOf, codePattern, PREVIEW_CODES } from '../src/core/preview.js';

/** @param {string} label @param {unknown} value @param {string} [unit] */
const e = (label, value, unit = '') => ({ Label: label, Unit: unit, Value: value });
const DATA = '<EVAStringTable> { 2 500 "Choice A" 501 "Choice B" }';
/** @param {Record<string, unknown>} body */
const prot = (body) => /** @type {any} */ ({ type: 'EdfProtocolContent', body: { Data: DATA, UpgradeInfo: '', Preview: {}, ...body } });

test('codePattern: numeric key segments become #', () => {
  assert.equal(codePattern('sub.0.msr.sg.12.ori2'), 'sub.#.msr.sg.#.ori2');
  assert.equal(codePattern('ctrl.Properties.Queue.WaitForStartChoice'), 'ctrl.Properties.Queue.WaitForStartChoice');
});

test('PREVIEW_CODES: every key is a # pattern', () => {
  for (const k of Object.keys(PREVIEW_CODES)) assert.equal(codePattern(k), k);
});

test('previewOf: groups sub.N keys by N, sorted by index, ctrl.* to controller, others dropped', () => {
  const r = previewOf(prot({
    Preview: {
      'sub.1.msr.tr.0': e('TR', 2000.5, 'ms'),
      'ctrl.Flag': e('Flag', true),
      'sub.0.msr.name': e('Name', 'abc'),
      'sub.1.msr.matrix': e('Matrix', 256),
      'other.thing': e('Other', 1),
    },
  }));
  assert.ok(r.ok);
  assert.deepEqual(r.subs.map((s) => [s.index, s.items.map((i) => i.key)]),
    [[0, ['sub.0.msr.name']], [1, ['sub.1.msr.tr.0', 'sub.1.msr.matrix']]]);
  assert.deepEqual(r.subs[1].items[0], { key: 'sub.1.msr.tr.0', label: 'TR', unit: 'ms', value: { kind: 'number', value: 2000.5 } });
  assert.deepEqual(r.subs[0].items[0].value, { kind: 'text', value: 'abc' });
  assert.deepEqual(r.controller, [{ key: 'ctrl.Flag', label: 'Flag', unit: '', value: { kind: 'bool', value: true } }]);
});

test('previewOf: ta and taSec of a sub; absent gives null', () => {
  const r = previewOf(prot({
    Preview: {
      'sub.0.msr.time': e('TA', '0:44'), 'sub.0.msr.time_sec': e('TA', 44),
      'sub.1.msr.matrix': e('Matrix', 64),
    },
  }));
  assert.ok(r.ok);
  assert.deepEqual(r.subs.map((s) => [s.ta, s.taSec]), [['0:44', 44], [null, null]]);
});

test('previewOf: sequence codes decode through PREVIEW_CODES; unknown gives text null; other ints stay numbers', () => {
  const [code, text] = Object.entries(PREVIEW_CODES['sub.#.msr.sg.#.pe_dir'])[0];
  const r = previewOf(prot({
    Preview: {
      'sub.0.msr.sg.3.pe_dir': e('PE', Number(code)),
      'sub.0.msr.sg.0.pe_dir': e('PE', 999999),
      'sub.0.msr.matrix': e('Matrix', Number(code)),
      'sub.0.msr.fat_sat': e('Fat', 1.5),
    },
  }));
  assert.ok(r.ok);
  assert.deepEqual(r.subs[0].items.map((i) => i.value), [
    { kind: 'code', code: Number(code), text },
    { kind: 'code', code: 999999, text: null },
    { kind: 'number', value: Number(code) },
    { kind: 'number', value: 1.5 },
  ]);
});

test('previewOf: ctrl ints the string table knows are codes; unknown ones stay numbers', () => {
  const r = previewOf(prot({
    Preview: { 'ctrl.Properties.A': e('A', 501), 'ctrl.Properties.B': e('B', -1), 'ctrl.Properties.C': e('C', 'Text'), 'sub.0.msr.matrix': e('M', 500), 'ctrl.MultiStep.G': e('G', 500) },
  }));
  assert.ok(r.ok);
  assert.deepEqual(r.controller.map((i) => i.value), [
    { kind: 'code', code: 501, text: 'Choice B' }, { kind: 'number', value: -1 }, { kind: 'text', value: 'Text' }, { kind: 'number', value: 500 },
  ]);
  assert.deepEqual(r.subs[0].items[0].value, { kind: 'number', value: 500 });
});

test('previewOf: UpgradeInfo has CRLF as LF, is trimmed, and empty or absent is null', () => {
  const up = (/** @type {unknown} */ u) => { const r = previewOf(prot({ UpgradeInfo: u })); assert.ok(r.ok); return r.upgrade; };
  assert.equal(up('  line one\r\nline two\r\n '), 'line one\nline two');
  assert.equal(up(' \r\n'), null);
  assert.equal(up(''), null);
  assert.equal(up(null), null);
});

test('previewOf: errors name no document text', () => {
  assert.deepEqual(previewOf({ type: 'EdfAddInConfigContent', body: {} }), { ok: false, error: 'expected a protocol, found EdfAddInConfigContent' });
  const bad = [
    prot({ Preview: null }),
    prot({ Preview: { 'sub.0.secret': 5 } }),
    prot({ Preview: { 'sub.0.k': { Label: 'secret', Unit: 3, Value: 1 } } }),
    prot({ Preview: { 'sub.0.k': { Label: 'secret', Unit: 'secret', Value: ['secret'] } } }),
    prot({ Preview: { 'sub.0.k': e('secret', null) } }),
    prot({ Data: 7 }),
  ];
  for (const doc of bad) {
    const r = previewOf(doc);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && !r.error.includes('secret'));
  }
});
