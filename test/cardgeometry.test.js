// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionText, isOblique, mainAxis, orientation, orientationText, phaseRead, positionText } from '../src/core/cardgeometry.js';
import { FORMULAS } from '../src/core/cardformulas.js';

/** @typedef {import('../src/core/cardgeometry.js').Vec3} Vec3 */

/** @param {Record<string, string>} asc @returns {import('../src/core/cardsource.js').CardSources} */
const sources = (asc) => ({ asc: new Map(Object.entries(asc)), nBlocks: 1, pv: new Map(), ctrl: new Map(), eva: new Map(), sequence: '', seq: '' });

/** @param {string} name @param {Record<string, string>} asc @param {number | null} [group] @param {string | null} [variant] */
function run(name, asc, group = null, variant = null) {
  const f = FORMULAS.get(name);
  if (!f) throw new Error(`no formula ${name}`);
  return f(sources(asc), group, variant);
}

const deg = (/** @type {number} */ a) => (a * Math.PI) / 180;

test('positions: a letter per axis, 1 decimal half away from zero; what rounds to 0.0 takes the positive letter', () => {
  assert.equal(positionText([1.25, -3.5, 7]), 'L1.3 A3.5 H7.0');
  assert.equal(positionText([-12.34, 0, -0.04]), 'R12.3 P0.0 H0.0');
  assert.equal(positionText([0, 0, -0.05]), 'L0.0 P0.0 F0.1');
});

test('the main axis is the largest component; near-ties go to Tra, then Cor, then Sag', () => {
  assert.equal(mainAxis([0.6, -0.8, 0]), 1);
  assert.equal(mainAxis([Math.SQRT1_2, 0, -Math.SQRT1_2]), 2);
  assert.equal(mainAxis([0.6, 0.6 + 1e-7, 0]), 1);
  assert.equal(mainAxis([0.6 + 1e-7, 0.6, 0]), 1);
  assert.equal(mainAxis([0.6 + 1e-5, 0.6, 0]), 0);
});

test('orientation: the axis name, or the main axis tilted towards the second and third', () => {
  assert.equal(orientationText(orientation([0, 0, 2])), 'Transversal');
  assert.equal(orientationText(orientation([0, -1, 0])), 'Coronal');
  assert.equal(orientationText(orientation([1, 0, 0.0001])), 'Sagittal'); // 0.0057° prints as 0.0
  const single = orientation([0, Math.sin(deg(10)), Math.cos(deg(10))]);
  assert.deepEqual([single.main, single.second, single.third], [2, 1, 0]);
  assert.equal(orientationText(single), 'T > C-10.0');
  assert.equal(orientationText(single, true), 'T > C');
  // atan(0.5 / 0.7071) = 35.26°, asin(0.5) = 30°; the tie between S and C keeps axis order
  assert.equal(orientationText(orientation([0.5, -0.5, Math.SQRT1_2])), 'T > S-35.3 > C30.0');
  // a negative main component flips both angles
  assert.equal(orientationText(orientation([0, 0.5, -Math.sqrt(0.75)])), 'T > C30.0');
  assert.equal(isOblique(orientation([0, 0, 1])), false);
  assert.equal(isOblique(single), true);
});

test('phase and readout directions follow the main axis, turned by the in-plane rotation', () => {
  /** @param {Vec3} n @param {number} rot */
  const pr = (n, rot) => { const { phase, read } = phaseRead(n, rot); return [directionText(phase), directionText(read)]; };
  assert.deepEqual(pr([0, 0, 1], 0), ['A >> P', 'L >> R']);
  assert.deepEqual(pr([0, 0, 1], deg(90)), ['R >> L', 'A >> P']);
  assert.deepEqual(pr([0, 0, 1], deg(180)), ['P >> A', 'R >> L']);
  assert.deepEqual(pr([1, 0, 0], 0), ['A >> P', 'F >> H']);
  assert.deepEqual(pr([0, 1, 0], 0), ['R >> L', 'H >> F']);
});

const GROUP = {
  'sSliceArray.lSize': '3', 'sGroupArray.anMember[0]': '0', 'sGroupArray.anMember[1]': '1', 'sGroupArray.anMember[2]': '2',
  'sGroupArray.asGroup[0].nSize': '2', 'sGroupArray.asGroup[1].nLow': '2', 'sGroupArray.asGroup[1].nSize': '1',
  'sSliceArray.asSlice[0].sPosition.dTra': '10.0', 'sSliceArray.asSlice[1].sPosition.dTra': '20.0',
  'sSliceArray.asSlice[0].sPosition.dSag': '-4.0', 'sSliceArray.asSlice[1].sPosition.dSag': '-4.0',
  'sSliceArray.asSlice[0].sNormal.dCor': '1.0', 'sSliceArray.asSlice[0].dInPlaneRot': String(deg(90)),
  'lScanRegionPosTra': '-5',
};

test('a slice group: the mean of its slices plus the table offset on H/F, its first slice\'s normal', () => {
  assert.equal(run('group_number', GROUP, 1), '2');
  assert.equal(run('position:slice', GROUP, 0), 'R4.0 P0.0 H10.0 mm');
  assert.equal(run('orientation:slice', GROUP, 0), 'Coronal ');
  assert.equal(run('pe_dir:slab', GROUP, 0), 'F >> H '); // coronal (phase R >> L, read H >> F) turned by 90°
  assert.equal(run('rotation:slice', GROUP, 0), '90.00 deg');
  // all positions exactly 0: Isocenter, whatever the table offset; no normal: transversal
  assert.equal(run('position:slice', GROUP, 1), 'Isocenter ');
  assert.equal(run('orientation:slice', GROUP, 1), 'Transversal ');
  assert.equal(run('pe_dir:slice', GROUP, 1), 'A >> P ');
  assert.equal(run('position:slice', GROUP, null), null);
  assert.equal(run('position:slice', { 'sSliceArray.lSize': '0' }, 0), null);
});

test('navigators, saturation regions and inversions by group index', () => {
  const asc = {
    'sNavigatorArray.asElm[1].sCuboid.sPosition.dCor': '-20.0', 'sNavigatorArray.asElm[1].sCuboid.dInPlaneRot': '-0.5',
    'sRSatArray.asElm[0].sPosition.dSag': '30.0', 'sRSatArray.asElm[0].sNormal.dSag': '1.0', lScanRegionPosTra: '7',
  };
  assert.equal(run('position:navigator', asc, 1), 'L0.0 A20.0 H7.0 mm');
  assert.equal(run('rotation:navigator', asc, 1), '-28.65 deg');
  assert.equal(run('position:navigator', asc, 0), 'Isocenter ');
  assert.equal(run('position:satregion', asc, 0), 'L30.0 P0.0 H7.0 mm');
  assert.equal(run('orientation:satregion', asc, 0), 'Sagittal ');
  assert.equal(run('orientation:inversion', asc, 0), 'Transversal ');
});

test('the adjust volume: a box at the isocenter, the stored volume, or slice group 1', () => {
  const adj = { 'sAdjData.sAdjVolume.sPosition.dTra': '12.0', 'sAdjData.sAdjVolume.sNormal.dSag': '1.0', 'sAdjData.sAdjVolume.dInPlaneRot': '0.0', lScanRegionPosTra: '3' };
  assert.equal(run('position:adj', adj), 'Isocenter ');
  assert.equal(run('orientation:adj', adj), 'Transversal ');
  const explicit = { ...adj, 'sAdjData.uiAdjVolumeValid': '0x1' };
  assert.equal(run('position:adj', explicit), 'L0.0 P0.0 H15.0 mm');
  assert.equal(run('orientation:adj', explicit), 'Sagittal ');
  assert.equal(run('rotation:adj', explicit), '0.00 deg');
  assert.equal(run('position:adj', { ...GROUP, 'sAdjData.uiAdjShimMode': '2' }), 'R4.0 P0.0 H10.0 mm');
  const voi = { 'sAdjData.uiAdjShimMode': '2', 'sSpecPara.sVoI.dThickness': '20.0', 'sSpecPara.sVoI.sPosition.dCor': '-1.0' };
  assert.equal(run('position:adj', voi), 'L0.0 A1.0 H0.0 mm');
});

test('AutoAlign: position without table offset or unit, axis lines labelled by the offset position', () => {
  const aa = 'sAAInitialOffset.SliceInformation';
  const flat = { [`${aa}.sPosition.dSag`]: '-2.25', [`${aa}.sPosition.dTra`]: '4.0', [`${aa}.sNormal.dTra`]: '1.0', lScanRegionPosTra: '-10' };
  assert.equal(run('position:aa', flat), 'R2.3 P0.0 H4.0 ');
  assert.deepEqual(run('aa_axis:x', flat, null, 'd1'), { label: 'R', text: '2.3 mm' });
  assert.deepEqual(run('aa_axis:x', flat, null, 'd0'), { label: 'R', text: '2 mm' });
  assert.deepEqual(run('aa_axis:y', flat), { label: 'P', text: '0.0 mm' });
  assert.deepEqual(run('aa_axis:z', flat, null, 'd1'), { label: 'F', text: '4.0 mm' }); // 4 - 10 < 0
  assert.equal(run('orientation:aa', flat), 'Transversal ');
  assert.equal(run('aa_angle2', flat), null);
  assert.equal(run('aa_angle3', flat), null);
  assert.equal(run('position:aa', {}), 'Isocenter ');

  const tilted = { [`${aa}.sNormal.dSag`]: '0.5', [`${aa}.sNormal.dCor`]: '-0.5', [`${aa}.sNormal.dTra`]: String(Math.SQRT1_2), [`${aa}.dInPlaneRot`]: String(deg(-12.5)) };
  assert.equal(run('orientation:aa', tilted), 'T > S  ');
  assert.deepEqual(run('aa_angle2', tilted), { label: 'T > S', text: '-35.3 ' });
  assert.deepEqual(run('aa_angle3', tilted), { label: '> C', text: '30.0 ' });
  assert.equal(run('rotation:aa', tilted), '-12.50 deg');
});
