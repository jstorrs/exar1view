// Ported from protocols tests/test_params.py (the tier cases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHURN_PREFIXES, IGNORED_PREFIXES, KEY_PREFIXES, TIER_ORDER, tierOf } from '../src/core/tiers.js';

for (const [key, tier] of [
  ['sSliceArray.asSlice[0].dThickness', 'key'],
  ['sSliceArray.asSlice[0].sPosition.dTra', 'churn'],
  ['sRXSPEC.alDwellTime[0]', 'key'],
  ['sRXSPEC.lGain', 'churn'],
  ['sPrepPulses.ucFatSat', 'key'],
  ['sPrepPulses.lSatPos[0]', 'churn'],
  ['dRefSNR_VOI', 'ignored'],
  ['sProtConsistencyInfo.flGMax', 'ignored'],
  ['tProtocolName', 'ignored'],
  ['alTR[0]', 'key'],
  ['ucMotionCorr', 'other'],
  ['', 'other'],
]) {
  test(`tierOf(${JSON.stringify(key)}) is ${tier}`, () => {
    assert.equal(tierOf(key), tier);
    assert.equal(tierOf(key), tier); // memoised
  });
}

test('render order', () => {
  assert.deepEqual(TIER_ORDER, ['key', 'other', 'churn', 'ignored']);
});

test('prefix lists are consistent', () => {
  for (const prefixes of [KEY_PREFIXES, CHURN_PREFIXES, IGNORED_PREFIXES]) {
    assert.equal(new Set(prefixes).size, prefixes.length);
  }
  for (const ignored of IGNORED_PREFIXES) {
    for (const other of [...KEY_PREFIXES, ...CHURN_PREFIXES]) {
      assert.ok(!ignored.startsWith(other) && !other.startsWith(ignored), `${ignored} / ${other}`);
    }
  }
  // A KEY/CHURN duplicate would be decided by the tie rule, not by intent.
  assert.deepEqual(KEY_PREFIXES.filter((p) => CHURN_PREFIXES.includes(p)), []);
});

test('the prefix lists are frozen', () => {
  assert.ok(Object.isFrozen(KEY_PREFIXES) && Object.isFrozen(CHURN_PREFIXES) && Object.isFrozen(IGNORED_PREFIXES));
});
