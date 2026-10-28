// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCards, parseCatalog } from '../src/core/cards.js';
import { header } from '../src/core/cardformulas.js';

/** @typedef {import('../src/core/cardsource.js').CardSources} CardSources */

/** @param {Record<string, string>} asc @param {Record<string, string>} [pv] @param {number} [nBlocks] @returns {CardSources} */
function sources(asc, pv = {}, nBlocks = 1) {
  return { asc: new Map(Object.entries(asc)), nBlocks, pv: new Map(Object.entries(pv)), ctrl: new Map(), eva: new Map(), sequence: '%SiemensSeq%\\alpha', seq: 'alpha' };
}

const IMAGING = {
  ucTablePositioningMode: '0x2', 'sSliceArray.asSlice[0].dReadoutFOV': '230', 'sSliceArray.asSlice[0].dThickness': '3',
  'sKSpace.lBaseResolution': '256', 'sKSpace.ucDimension': '0x2',
};

test('header of an imaging protocol', () => {
  const h = header(sources(IMAGING, { 'sub.0.msr.time': '"2:12"' }), true);
  assert.deepEqual(h, { ta: '2:12', pm: 'REF', pat: 'Off', voxel: '0.9×0.9×3.0', voi: null, snr: '1.00', sequence: 'alpha', substep: null });
});

test('the voxel of a 3D protocol with interpolation, the PAT factor and the substep', () => {
  const asc = {
    ...IMAGING, 'sKSpace.ucDimension': '0x4', 'sKSpace.lImagesPerSlab': '60', 'sKSpace.uc2DInterpolation': '1', 'sSliceArray.asSlice[0].dThickness': '120',
    'sPat.ucPATMode': '0x2', 'sPat.lAccelFactPE': '2', 'sPat.lAccelFact3D': '3', ucTablePositioningMode: '0x1',
  };
  const h = header(sources(asc, {}, 2), true);
  assert.equal(h.voxel, '0.4×0.4×2.0');
  assert.equal(h.pat, '6');
  assert.equal(h.pm, 'FIX');
  assert.equal(h.substep, '1/2');
  assert.equal(h.ta, null);
});

test('a spectroscopy volume gives a VoI and no voxel; PAT is hidden without the iPAT card', () => {
  const h = header(sources({ 'sSpecPara.sVoI.dPhaseFOV': '20', 'sSpecPara.sVoI.dReadoutFOV': '15.4', 'sSpecPara.sVoI.dThickness': '10' }), false);
  assert.equal(h.voxel, null);
  assert.equal(h.voi, '20 ×15 ×10');
  assert.equal(h.pat, null);
  assert.equal(h.pm, null);
});

test('buildCards shows PAT iff it shows the iPAT card', () => {
  const json = (/** @type {string[]} */ cards) => ({
    version: 1, cards: ['Routine', 'Resolution - iPAT'], sequences: { '%SiemensSeq%\\alpha': { cards } },
    slots: { Routine: [{ id: 'Coil', rule: { kind: 'constant', text: 'x ' } }], 'Resolution - iPAT': [{ id: 'PAT mode', rule: { kind: 'constant', text: 'None ' } }] },
  });
  const [withCard, without] = [['Routine', 'Resolution - iPAT'], ['Routine']].map((cards) => {
    const parsed = parseCatalog(json(cards));
    assert.ok(parsed.ok);
    return buildCards(parsed.catalog, sources(IMAGING)).header.pat;
  });
  assert.equal(withCard, 'Off');
  assert.equal(without, null);
});
