// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_LABEL, CATEGORY_ORDER, categoryOf, extractReferences } from '../src/core/seqrefs.js';

const BEGIN = '### ASCCONV BEGIN object=MrProtDataImpl@MrProtocolData version=51130001 converter=%MEASCONST%/ConverterList/Prot_Converter.txt ###';
const END = '### ASCCONV END ###';

/** XProtocol text shaped like a real export, one ASCCONV block per line list. */
const protocol = (/** @type {string[][]} */ ...blocks) => [
  '<XProtocol> ', '{', '  <Name> "PhoenixMetaProtocol" ',
  ...blocks.flatMap((lines, i) => [`  <ParamString."Protocol${i}"> { "" }`, BEGIN, ...lines, END]),
  '}', '',
].join('\n');

const pad = (/** @type {string} */ k, /** @type {string} */ v) => `${k.padEnd(40)} = ${v}`;

test('standard main sequence', () => {
  const text = protocol([pad('tSequenceFileName', '"%SiemensSeq%\\tse"'), pad('lFoo', '3')]);
  assert.deepEqual(extractReferences(text), [
    { key: 'tSequenceFileName', value: '%SiemensSeq%\\tse', placeholder: 'SiemensSeq' },
  ]);
});

test('customer sequence and customer default protocol', () => {
  const text = protocol([
    pad('tSequenceFileName', '"%CustomerSeq%\\cust_tse_v2"'),
    pad('tdefaultEVAProt', '"%CustomerEvaDefProt%\\DTI\\DTI_990.evp"'),
  ]);
  assert.deepEqual(extractReferences(text), [
    { key: 'tSequenceFileName', value: '%CustomerSeq%\\cust_tse_v2', placeholder: 'CustomerSeq' },
    { key: 'tdefaultEVAProt', value: '%CustomerEvaDefProt%\\DTI\\DTI_990.evp', placeholder: 'CustomerEvaDefProt' },
  ]);
});

test('blocks repeating a reference give one', () => {
  const line = pad('tSequenceFileName', '"%CustomerSeq%\\foo"');
  assert.equal(extractReferences(protocol([line], [line])).length, 1);
});

test('same key with a different value is a separate reference', () => {
  const refs = extractReferences(protocol(
    [pad('tSequenceFileName', '"%CustomerSeq%\\a"')], [pad('tSequenceFileName', '"%CustomerSeq%\\b"')]));
  assert.deepEqual(refs.map((r) => r.value), ['%CustomerSeq%\\a', '%CustomerSeq%\\b']);
});

test('doubled quotes', () => {
  assert.deepEqual(extractReferences('tSequenceFileName = ""%CustomerSeq%\\foo""\n'), [
    { key: 'tSequenceFileName', value: '%CustomerSeq%\\foo', placeholder: 'CustomerSeq' },
  ]);
});

test('CRLF line endings', () => {
  const text = protocol([pad('tSequenceFileName', '"%ServiceSeq%\\rf_noise_spectrum"'), pad('lFoo', '3')]).replace(/\n/g, '\r\n');
  assert.deepEqual(extractReferences(text), [
    { key: 'tSequenceFileName', value: '%ServiceSeq%\\rf_noise_spectrum', placeholder: 'ServiceSeq' },
  ]);
});

test('trailing comment is ignored', () => {
  assert.deepEqual(extractReferences('tSequenceFileName = "%AdjustSeq%\\x" # note "quoted"\n'), [
    { key: 'tSequenceFileName', value: '%AdjustSeq%\\x', placeholder: 'AdjustSeq' },
  ]);
});

test('tSequenceFileName without a placeholder is kept, as other', () => {
  const refs = extractReferences('tSequenceFileName = "C:\\seq\\foo"\n');
  assert.deepEqual(refs, [{ key: 'tSequenceFileName', value: 'C:\\seq\\foo', placeholder: null }]);
  assert.equal(categoryOf(refs[0].placeholder), 'other');
});

test('indented key and tabs around the equals sign', () => {
  assert.equal(extractReferences('\t  tdefaultEVAProt\t=\t"%SiemensEvaDefProt%\\a.evp"\n').length, 1);
});

test('empty tSequenceFileName gives no reference', () => {
  assert.deepEqual(extractReferences('tSequenceFileName = ""\n'), []);
});

test('lines that are not key = "value" assignments give none', () => {
  const text = protocol([pad('sWipMemBlock.tFree', '"a#b = c"'), pad('tOther', '"plain"')])
    + '<ParamString."tSequenceFileName"> { "%SiemensSeq%\\gre" }\n';
  assert.deepEqual(extractReferences(text), []);
});

test('the converter on the BEGIN line is not a reference', () => {
  assert.deepEqual(extractReferences(protocol([])), []);
});

test('categoryOf', () => {
  /** @type {[string | null, string][]} */
  const table = [
    [null, 'other'],
    ['customerseq', 'customer'],
    ['CustomerEvaDefProt', 'customer'],
    ['ServiceSeq', 'service'],
    ['SiemensSeq', 'standard'],
    ['AdjustSeq', 'standard'],
    ['MEASCONST', 'standard'],
    ['Unknown', 'other'],
  ];
  for (const [placeholder, category] of table) assert.equal(categoryOf(placeholder), category, String(placeholder));
});

test('every category has a label', () => {
  assert.deepEqual(Object.keys(CATEGORY_LABEL).sort(), [...CATEGORY_ORDER].sort());
});
