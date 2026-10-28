// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMULAS } from '../src/core/cardformulas.js';

/** @typedef {import('../src/core/cardsource.js').CardSources} CardSources */

/** @param {Record<string, string>} asc @returns {CardSources} */
function sources(asc) {
  return { asc: new Map(Object.entries(asc)), nBlocks: 1, pv: new Map(), ctrl: new Map(), eva: new Map(), sequence: '%SiemensSeq%\\alpha', seq: 'alpha' };
}

/** @param {string} name @param {Record<string, string>} asc @param {string | null} [variant] */
function run(name, asc, variant = null) {
  const f = FORMULAS.get(name);
  assert.ok(f, `${name} is registered`);
  return f(sources(asc), null, variant);
}

/** The three extent lines, in card order. @param {Record<string, string>} asc @param {string | null} [variant] */
const extents = (asc, variant = null) => ['phase', 'read', 'slice'].map((w) => run(`adj_extent:${w}`, asc, variant));

test('the adjust volume in Tune up shim mode is the default box at the isocenter', () => {
  assert.deepEqual(extents({}), [{ label: 'A >> P', text: '263 mm' }, { label: 'R >> L', text: '350 mm' }, { label: 'F >> H', text: '350 mm' }]);
  assert.equal(run('position:adj', {}), 'Isocenter ');
});

test('a stored adjust volume: its extents along its own phase, read and slice axes', () => {
  const asc = {
    'sAdjData.uiAdjVolumeValid': '0x1', 'sAdjData.sAdjVolume.sNormal.dSag': '1',
    'sAdjData.sAdjVolume.dPhaseFOV': '100.4', 'sAdjData.sAdjVolume.dReadoutFOV': '120', 'sAdjData.sAdjVolume.dThickness': '80.2',
  };
  assert.deepEqual(extents(asc), [{ label: 'A >> P', text: '100 mm' }, { label: 'F >> H', text: '120 mm' }, { label: 'R >> L', text: '80 mm' }]);
  assert.deepEqual(extents(asc, 'ceil').map((l) => l && typeof l === 'object' && l.text), ['101 mm', '120 mm', '81 mm']);
});

test('a coupled adjust volume follows slice group 1, or the VoI when there is one', () => {
  const asc = {
    'sAdjData.uiAdjShimMode': '2', 'sSliceArray.lSize': '3', 'sGroupArray.asGroup[0].nSize': '3', 'sGroupArray.asGroup[0].dDistFact': '0.2',
    'sSliceArray.asSlice[0].dThickness': '5', 'sSliceArray.asSlice[0].dPhaseFOV': '200', 'sSliceArray.asSlice[0].dReadoutFOV': '250',
  };
  assert.deepEqual(extents(asc).map((l) => l && typeof l === 'object' && l.text), ['200 mm', '250 mm', '17 mm']);
  const voi = { ...asc, 'sSpecPara.sVoI.dPhaseFOV': '20', 'sSpecPara.sVoI.dReadoutFOV': '15', 'sSpecPara.sVoI.dThickness': '10' };
  assert.deepEqual(extents(voi).map((l) => l && typeof l === 'object' && l.text), ['20 mm', '15 mm', '10 mm']);
});

test('the VoI position adds the table offset; none without a VoI', () => {
  const voi = { 'sSpecPara.sVoI.dThickness': '10', lScanRegionPosTra: '20' };
  assert.equal(run('position:voi', { ...voi, 'sSpecPara.sVoI.sPosition.dSag': '10', 'sSpecPara.sVoI.sPosition.dCor': '-5', 'sSpecPara.sVoI.sPosition.dTra': '2' }), 'L10.0 A5.0 H22.0 mm');
  assert.equal(run('position:voi', voi), 'Isocenter ');
  assert.equal(run('position:voi', {}), null);
});

test('bandwidth per pixel, by variant', () => {
  const asc = { 'sRXSPEC.alDwellTime[0]': '5000', 'sKSpace.lBaseResolution': '256' }; // 390.625 Hz/Px
  const got = ['round', 'round10', 'floor', 'ceil', 'half_round', 'exact6', null].map((v) => run('bandwidth', asc, v));
  assert.deepEqual(got, ['391 Hz/Px', '390 Hz/Px', '390 Hz/Px', '391 Hz/Px', '195 Hz/Px', '390.625000 Hz/Px', '391 Hz/Px']);
  assert.equal(run('bandwidth', { 'sKSpace.lBaseResolution': '256' }), null);
});

test('the filter summary lists the active filters in the print order', () => {
  const asc = { 'sNormalizeFilter.ucOn': '0x1', 'sRawFilter.ucOn': '1', 'sDistortionCorrFilter.ucMode': '2', 'sImageFilter.ucOn': '0x0' };
  assert.equal(run('filter_summary', asc), 'Raw filter, Distortion Corr.(2D), Normalize ');
  assert.equal(run('filter_summary', {}), 'None ');
});

test('averages: whole, fractional, and with one decimal', () => {
  assert.equal(run('averages', { lAverages: '2' }), '2 ');
  assert.equal(run('averages', { lAverages: '2' }, 'd1'), '2.0 ');
  assert.equal(run('averages', { lAverages: '1', dAveragesDouble: '1.5' }), '1.5 ');
  assert.equal(run('averages', { lAverages: '3', dAveragesDouble: '3.0' }), '3 ');
  assert.equal(run('averages', {}), '1 ');
});

test('table position and coil string', () => {
  assert.equal(run('table_dir', { lScanRegionPosTra: '-40' }), 'F ');
  assert.equal(run('table_mm', { lScanRegionPosTra: '-40' }), '40 mm');
  assert.equal(run('table_dir', {}), 'H ');
  assert.equal(run('table_mm', {}), '0 mm');
  assert.equal(run('coil_string', { 'sCoilSelectMeas.sCoilStringForConversion': '"A1-2;B3"' }), 'A1-2;B3 ');
  assert.equal(run('coil_string', {}), null);
});
