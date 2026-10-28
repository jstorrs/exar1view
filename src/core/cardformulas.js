// @ts-check
/**
 * The hand-written card formulas a catalog rule names (`{kind: "formula", name}`). Pure.
 *
 * A formula gets the protocol's sources, the group index (null outside a grouped slot) and the
 * rule's variant for the protocol's sequence (null when it has none). It returns the value text,
 * `{label, text}` for a slot whose label it computes (`@…` ids), or null when it does not apply.
 */

import { sourceNumber, sourceValue } from './cardsource.js';
import { fixed } from './numfmt.js';

/** @typedef {import('./cardsource.js').CardSources} CardSources */
/** @typedef {(src: CardSources, group: number | null, variant: string | null) => string | { label: string, text: string } | null} CardFormula */

/** @type {ReadonlyMap<string, CardFormula>} */
export const FORMULAS = new Map([
  // The header line of a grouped block: "Slice group" with value "1", "2", ...
  ['group_number', (_src, group) => (group === null ? null : String(group + 1))],
]);

/**
 * The scanner print's header line above the cards, as fields. `ta`: the Preview's time text as
 * it is (no adjustment for the Introduction setting or for triggering). `voxel` ("0.9×0.9×3.0")
 * or `voi` ("20 ×20 ×20") is set, by whether the protocol has a spectroscopy volume. `pat` is
 * the iPAT factor or "Off", null when the print has no PAT field. `sequence` is the sequence file
 * name, not the scanner's short name. `substep`: "1/n" for a protocol with n > 1 ASCCONV blocks.
 * @typedef {{ ta: string | null, pm: string | null, pat: string | null, voxel: string | null, voi: string | null, snr: string, sequence: string, substep: string | null }} CardHeader
 */

const PM = new Map([[1, 'FIX'], [2, 'REF'], [4, 'ISO']]);

/** @param {CardSources} src @param {string} key @param {number} dflt */
const num = (src, key, dflt) => sourceNumber(src, key) ?? dflt;

/**
 * @param {CardSources} src
 * @param {boolean} showPat whether the print has the PAT field (the "Resolution - iPAT" card is shown)
 * @returns {CardHeader}
 */
export function header(src, showPat) {
  const time = sourceValue(src, 'pv:sub.0.msr.time');
  const ta = time === null ? null : /^"(.*)"$/.exec(time)?.[1] ?? null;
  const pm = PM.get(num(src, 'ucTablePositioningMode', 0)) ?? null;
  const slice = 'sSliceArray.asSlice[0].';
  const isVoi = sourceValue(src, 'sSpecPara.sVoI.dThickness') !== null;
  const voi = isVoi
    ? ['dPhaseFOV', 'dReadoutFOV', 'dThickness'].map((k) => fixed(num(src, `sSpecPara.sVoI.${k}`, 0), 0)).join(' ×')
    : null;
  const base = num(src, 'sKSpace.lBaseResolution', 1);
  const x = num(src, `${slice}dReadoutFOV`, 0) / base / (num(src, 'sKSpace.uc2DInterpolation', 0) ? 2 : 1);
  const thick = num(src, `${slice}dThickness`, 0);
  const z = num(src, 'sKSpace.ucDimension', 2) === 4 ? thick / num(src, 'sKSpace.lImagesPerSlab', 1) : thick;
  const voxel = isVoi ? null : `${fixed(x, 1)}×${fixed(x, 1)}×${fixed(z, 1)}`;
  const off = num(src, 'sPat.ucPATMode', 1) === 1;
  const factor = num(src, 'sPat.lAccelFactPE', 1) * num(src, 'sPat.lAccelFact3D', 1) * num(src, 'sSliceAcceleration.lMultiBandFactor', 1);
  return {
    ta, pm, pat: showPat ? (off ? 'Off' : String(Math.trunc(factor))) : null, voxel, voi, snr: '1.00',
    sequence: src.seq, substep: src.nBlocks > 1 ? `1/${src.nBlocks}` : null,
  };
}
