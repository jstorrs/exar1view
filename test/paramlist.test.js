import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockTitle, keyIndex, paramSections } from '../src/core/paramlist.js';

const blocks = [
  new Map([['tSequenceFileName', '"%SiemensSeq%\\gre"'], ['sSliceArray.lSize', '1'], ['lAverages', '2']]),
  new Map([['sSliceArray.asSlice[0].dThickness', '3.0']]),
  new Map(),
];

test('keyIndex: lower-cased keys per block, in text order', () => {
  assert.deepEqual(keyIndex(blocks), [['tsequencefilename', 'sslicearray.lsize', 'laverages'], ['sslicearray.asslice[0].dthickness'], []]);
});

test('blockTitle: main protocol, then sub-protocols', () => {
  assert.equal(blockTitle(0), 'Main protocol');
  assert.equal(blockTitle(2), 'Sub-protocol 2');
});

test('paramSections: no query keeps every non-empty block whole', () => {
  assert.deepEqual(paramSections(keyIndex(blocks), ''), {
    sections: [{ block: 0, title: 'Main protocol', lines: [0, 1, 2] }, { block: 1, title: 'Sub-protocol 1', lines: [0] }],
    empty: null,
  });
});

test('paramSections: query ignores case and surrounding spaces; blocks without a match are left out', () => {
  assert.deepEqual(paramSections(keyIndex(blocks), '  SLICEARRAY. '), {
    sections: [{ block: 0, title: 'Main protocol', lines: [1] }, { block: 1, title: 'Sub-protocol 1', lines: [0] }],
    empty: null,
  });
  assert.deepEqual(paramSections(keyIndex(blocks), 'averages').sections, [{ block: 0, title: 'Main protocol', lines: [2] }]);
});

test('paramSections: why nothing is listed', () => {
  assert.deepEqual(paramSections(keyIndex(blocks), 'nope'), { sections: [], empty: 'No matching parameters' });
  assert.deepEqual(paramSections(keyIndex([new Map()]), ''), { sections: [], empty: 'No parameters' });
  assert.deepEqual(paramSections([], 'x'), { sections: [], empty: 'No parameters' });
});
