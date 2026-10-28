// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardSources, sourceNumber, sourceValue } from '../src/core/cardsource.js';

const TEXT = `<XProtocol> {
  <Name> "MultiStep Controller"
  <ParamMap."Props"> { <ParamLong."Count"> { 3 } <ParamBool."Flag"> { true } }
}
<XProtocol> {
  <Name> "Eva"
  <ParamMap."EVA"> { <ParamLong."Mode"> { 2 } }
}
### ASCCONV BEGIN ###
tSequenceFileName = "%SiemensSeq%\\tse"
alTR[0] = 4000
alTR[1] = 5000
sGroupArray.asGroup[1].nSize = 3
lFlags = 0x1F
ucFlag = true
tName = "a b"
### ASCCONV END ###
### ASCCONV BEGIN ###
alTR[0] = 1
### ASCCONV END ###
`;

/** @param {import('../src/core/preview.js').PreviewValue} value @param {string} key */
const item = (key, value) => ({ key, label: key, unit: '', value });
/** @type {import('../src/core/preview.js').PreviewResult} */
const SUMMARY = {
  ok: true,
  upgrade: null,
  subs: [{
    index: 0, ta: null, taSec: null,
    items: [
      item('sub.0.msr.fat_sat', { kind: 'code', code: 33, text: 'Fat sat.' }),
      item('sub.0.msr.tr.0', { kind: 'number', value: 4420 }),
      item('sub.0.msr.te.0', { kind: 'number', value: 82.5 }),
      item('sub.0.msr.tiny', { kind: 'number', value: 0.00001 }),
      item('sub.0.msr.big', { kind: 'number', value: 1e16 }),
      item('sub.0.msr.flag', { kind: 'bool', value: true }),
      item('sub.0.msr.name', { kind: 'text', value: 'a "b"×\n' }),
    ],
  }, {
    index: 1, ta: null, taSec: null,
    items: [item('sub.1.msr.tr.0', { kind: 'number', value: 100 })],
  }],
  controller: [item('ctrl.Properties.Queue.WorkingMan', { kind: 'bool', value: false })],
};

const SRC = cardSources(TEXT, SUMMARY);

test('cardSources: ASCCONV block 0, block count, sequence', () => {
  assert.equal(SRC.nBlocks, 2);
  assert.equal(SRC.asc.get('alTR[0]'), '4000');
  assert.equal(SRC.asc.get('tName'), '"a b"');
  assert.equal(SRC.sequence, '%SiemensSeq%\\tse');
  assert.equal(SRC.seq, 'tse');
});

test('cardSources: controller and EVA values', () => {
  assert.equal(SRC.ctrl.get('Props.Count'), '3');
  assert.equal(SRC.eva.get('EVA.Mode'), '2');
});

test('cardSources: Preview values as JSON text, floats as Python writes them', () => {
  const t = (/** @type {string} */ k) => SRC.pv.get(k);
  assert.equal(t('sub.0.msr.fat_sat'), '33');
  assert.equal(t('sub.0.msr.tr.0'), '4420');
  assert.equal(t('sub.0.msr.te.0'), '82.5');
  assert.equal(t('sub.0.msr.tiny'), '1e-05');
  assert.equal(t('sub.0.msr.big'), '1e+16');
  assert.equal(t('sub.0.msr.flag'), 'true');
  assert.equal(t('sub.0.msr.name'), '"a \\"b\\"\\u00d7\\n"');
  assert.equal(t('sub.1.msr.tr.0'), '100');
  assert.equal(t('ctrl.Properties.Queue.WorkingMan'), 'false');
});

test('sourceValue: each namespace', () => {
  assert.equal(sourceValue(SRC, 'tSequenceFileName'), '"%SiemensSeq%\\tse"');
  assert.equal(sourceValue(SRC, 'pv:sub.0.msr.fat_sat'), '33');
  assert.equal(sourceValue(SRC, 'pv:ctrl.Properties.Queue.WorkingMan'), 'false');
  assert.equal(sourceValue(SRC, 'ctrl:Props.Flag'), 'true');
  assert.equal(sourceValue(SRC, 'eva:EVA.Mode'), '2');
  assert.equal(sourceValue(SRC, 'seq'), 'tse');
  assert.equal(sourceValue(SRC, 'meta:n_asc'), '2');
  assert.equal(sourceValue(SRC, 'alTR[2]'), null);
  assert.equal(sourceValue(SRC, 'pv:nope'), null);
});

test('sourceValue: [#] and .# take the group index; no group gives null', () => {
  assert.equal(sourceValue(SRC, 'alTR[#]', 1), '5000');
  assert.equal(sourceValue(SRC, 'sGroupArray.asGroup[#].nSize', 1), '3');
  assert.equal(sourceValue(SRC, 'sGroupArray.asGroup[#].nSize', 0), null);
  assert.equal(sourceValue(SRC, 'pv:sub.#.msr.tr.0', 1), '100');
  assert.equal(sourceValue(SRC, 'pv:sub.0.msr.tr.#', 0), '4420');
  assert.equal(sourceValue(SRC, 'alTR[#]'), null);
  assert.equal(sourceValue(SRC, 'alTR[#]', null), null);
});

test('sourceNumber: decimal, hex, booleans, quotes; null when absent or not a number', () => {
  assert.equal(sourceNumber(SRC, 'alTR[0]'), 4000);
  assert.equal(sourceNumber(SRC, 'lFlags'), 31);
  assert.equal(sourceNumber(SRC, 'ucFlag'), 1);
  assert.equal(sourceNumber(SRC, 'ctrl:Props.Flag'), 1);
  assert.equal(sourceNumber(SRC, 'pv:ctrl.Properties.Queue.WorkingMan'), 0);
  assert.equal(sourceNumber(SRC, 'pv:sub.0.msr.te.0'), 82.5);
  assert.equal(sourceNumber(SRC, 'alTR[#]', 1), 5000);
  assert.equal(sourceNumber(SRC, 'tName'), null);
  assert.equal(sourceNumber(SRC, 'missing'), null);
  assert.equal(sourceNumber(SRC, 'alTR[#]'), null);
  assert.equal(sourceNumber(SRC, 'pv:sub.0.msr.name'), null);
});

test('sourceNumber: quotes around a number are stripped', () => {
  const src = cardSources('### ASCCONV BEGIN ###\nq = "12.5"\nh = "0x10"\n### ASCCONV END ###\n', { ok: false, error: '' });
  assert.equal(sourceNumber(src, 'q'), 12.5);
  assert.equal(sourceNumber(src, 'h'), 16);
});

test('cardSources: no ASCCONV, no Preview, no text: empty, never throws', () => {
  for (const [text, summary] of /** @type {const} */ ([['', { ok: false, error: 'x' }], ['<XProtocol> { <Name> ', SUMMARY], ['### ASCCONV END ###', { ok: false, error: 'x' }]])) {
    const s = cardSources(text, summary);
    assert.equal(s.asc.size, 0);
    assert.equal(s.nBlocks, 0);
    assert.equal(s.sequence, '');
    assert.equal(s.seq, '');
    assert.equal(sourceValue(s, 'alTR[0]'), null);
    assert.equal(sourceValue(s, 'meta:n_asc'), '0');
  }
  assert.equal(cardSources('', { ok: false, error: 'x' }).pv.size, 0);
});

test('cardSources: a sequence name without a folder is its own last segment', () => {
  const s = cardSources('### ASCCONV BEGIN ###\ntSequenceFileName = "tfl"\n### ASCCONV END ###\n', { ok: false, error: '' });
  assert.equal(s.sequence, 'tfl');
  assert.equal(s.seq, 'tfl');
});
