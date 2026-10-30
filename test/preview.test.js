// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewOf, upgradeOf, codePattern, PREVIEW_CODES, parseTa, formatTa, programTa } from '../src/core/preview.js';

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

test('parseTa: m:ss, h:mm:ss and "N s" text; anything else is null', () => {
  assert.equal(parseTa('0:44'), 44);
  assert.equal(parseTa('12:05'), 725);
  assert.equal(parseTa('1:02:03'), 3723);
  assert.equal(parseTa('4.5 s'), 4.5);
  assert.equal(parseTa('12 s'), 12);
  for (const bad of ['', 'x', '1:2', '4.5', '1:02:3:04', ' 0:44']) assert.equal(parseTa(bad), null, bad);
});

test('formatTa: m:ss, or h:mm:ss from an hour, rounded to whole seconds', () => {
  assert.equal(formatTa(0), '0:00');
  assert.equal(formatTa(59.6), '1:00');
  assert.equal(formatTa(725), '12:05');
  assert.equal(formatTa(3599), '59:59');
  assert.equal(formatTa(3600), '1:00:00');
  assert.equal(formatTa(3723), '1:02:03');
});

/** @param {...[string | null, number | null]} subs [ta, taSec] per sub-protocol */
const summary = (...subs) => /** @type {import('../src/core/preview.js').PreviewResult} */ ({
  ok: true, controller: [], upgrade: null, subs: subs.map(([ta, taSec], index) => ({ index, ta, taSec, items: [] })),
});

test('programTa: sub 0 text wins over its time_sec; later subs add their time_sec', () => {
  assert.deepEqual(programTa([summary(['0:44', 99], [null, 30], [null, null], [null, 6]), summary(['4.5 s', null])]), { sec: 84.5, without: 0 });
});

test('programTa: without a parseable text sub 0 uses its time_sec', () => {
  assert.deepEqual(programTa([summary([null, 10], [null, 20]), summary(['soon', 5])]), { sec: 35, without: 0 });
});

test('programTa: steps with neither text nor time_sec, a failed read or no protocol are counted as without', () => {
  const failed = /** @type {import('../src/core/preview.js').PreviewResult} */ ({ ok: false, error: 'x' });
  assert.deepEqual(programTa([summary(['1:00', null]), summary([null, null], [null, 50]), summary(), failed, null]), { sec: 60, without: 4 });
  assert.deepEqual(programTa([]), { sec: 0, without: 0 });
  // Sub 0 is looked up by index: without it the step has no TA.
  const noSub0 = summary([null, 5]);
  if (noSub0.ok) noSub0.subs[0].index = 1;
  assert.deepEqual(programTa([noSub0]), { sec: 0, without: 1 });
});

test('upgradeOf: CRLF to LF, trimmed; empty, blank, absent or non-text give null', () => {
  assert.equal(upgradeOf({ UpgradeInfo: ' Note\r\nline 2 ' }), 'Note\nline 2');
  assert.equal(upgradeOf({ UpgradeInfo: '' }), null);
  assert.equal(upgradeOf({ UpgradeInfo: ' \r\n\t ' }), null);
  assert.equal(upgradeOf({}), null);
  assert.equal(upgradeOf({ UpgradeInfo: 5 }), null);
  assert.equal(upgradeOf({ UpgradeInfo: null }), null);
});
