// @ts-check
/**
 * Tiers of ASCCONV parameters: what defines "the same protocol" and what churns on re-save
 * (ported from protocol_tools/compare/tiers.py). Pure.
 *
 * The prefix lists are a curated first cut, meant to be edited. A key's tier is decided by prefix:
 * IGNORED prefixes win outright; otherwise the longest matching prefix across KEY and CHURN wins
 * (KEY on a tie), so a specific entry overrides a broader one in the other list (KEY
 * `sSliceArray.asSlice[0].dThickness` over CHURN `sSliceArray`; CHURN `sPrepPulses.lSatPos`
 * over KEY `sPrepPulses.`). A key matching nothing is OTHER.
 */

/**
 * Tiers in render order: key defines the protocol, other is unclassified, churn changes when a
 * protocol is scanned and re-saved, ignored is never meaningful.
 */
export const TIER_ORDER = /** @type {const} */ (['key', 'other', 'churn', 'ignored']);
/** @typedef {typeof TIER_ORDER[number]} Tier */

/** Timing, contrast, k-space, acceleration, and the sequence-specific parameter groups. */
export const KEY_PREFIXES = Object.freeze([
  'alTR[',
  'alTE[',
  'alTI[',
  'adFlipAngleDegree[',
  'sKSpace.',
  'lAverages',
  'sDiffusion.',
  'sPat.',
  'sSliceAcceleration.',
  'sRXSPEC.alDwellTime',
  'sFastImaging.',
  'lRepetitions',
  'lContrasts',
  'sPhysioImaging.',
  'sPrepPulses.',
  'sWipMemBlock.',
  'sAngio.',
  'sSpecPara.lVectorSize',
  'sSpecPara.dSpecWidth',
  'lCombinedEchoes',
  // Slice geometry that is protocol design rather than placement.
  'sSliceArray.asSlice[0].dThickness',
  'sSliceArray.asSlice[0].dReadoutFOV',
  'sSliceArray.asSlice[0].dPhaseFOV',
  'sSliceArray.lSize',
  'sSliceArray.ucMode',
  'sGroupArray.asGroup[0].dDistFact',
  'tSequenceFileName',
  'sFLASH',
  'sEFISPEC',
  'sAsl.',
  'sDynDiff',
  'lFinalMatrixSize',
]);

/** Coils, adjustments, positions, scan times, and scanner-specific hardware state. */
export const CHURN_PREFIXES = Object.freeze([
  'sCoilSelectMeas',
  'sTXSPEC',
  'sRXSPEC',
  'sSliceArray',
  'sAdjData',
  'lTotalScanTimeSec',
  'lScanTimeSec',
  'ucTablePositioningMode',
  'lScanRegionPosTra',
  'sSpecPara.sVoI',
  'sAAInitialOffset',
  'sNavigatorPara.sNavigatorArray',
  'sGroupArray',
  'sPrepPulses.lSatPos',
  'sRSatArray',
  'sPTXData',
  'sAutoAlign',
  'ulVersion',
  'ucEnableIntro',
  'sAdjFre',
  'sGRADSPEC.lOffset',
  'sGRADSPEC.asGPAData',
  'sGRADSPEC.flSensitivity',
  'sGRADSPEC.alShimCurrent',
  'sGRADSPEC.sEddyCompensation',
  'sGRADSPEC.bEddyCompensation',
  'sGRADSPEC.ucMode',
]);

export const IGNORED_PREFIXES = Object.freeze([
  'dRefSNR',
  'tProtocolName',
  'sProtConsistencyInfo',
  'ucReconstructionPrio',
]);

/**
 * Length of the longest prefix of `key` in `prefixes`, or 0 if none matches.
 * @param {string} key
 * @param {readonly string[]} prefixes
 */
const longestMatch = (key, prefixes) => Math.max(0, ...prefixes.filter((p) => key.startsWith(p)).map((p) => p.length));

/** @type {Map<string, Tier>} */
const memo = new Map();

/**
 * The tier of `key` under the prefix rules in the module comment.
 * @param {string} key
 * @returns {Tier}
 */
export function tierOf(key) {
  let tier = memo.get(key);
  if (tier === undefined) {
    tier = classify(key);
    memo.set(key, tier);
  }
  return tier;
}

/** @param {string} key @returns {Tier} */
function classify(key) {
  if (IGNORED_PREFIXES.some((p) => key.startsWith(p))) return 'ignored';
  const keyLen = longestMatch(key, KEY_PREFIXES);
  const churnLen = longestMatch(key, CHURN_PREFIXES);
  if (keyLen && keyLen >= churnLen) return 'key';
  return churnLen ? 'churn' : 'other';
}
