// @ts-check
/**
 * What the Summary tab's Diffusion section shows of a protocol's diffusion settings, as label/text
 * rows. Pure. Nothing here quotes protocol text except the source file's base name, cleaned by the
 * .dvs writer's own function (core/dvs.js sourceText).
 */
import { shells, COORDINATE_NAMES, NORMALISATION_NAMES } from './diffusion.js';
import { sourceText } from './dvs.js';

/** @typedef {import('./diffusion.js').Diffusion} Diffusion */
/** @typedef {import('./diffusion.js').VectorSet} VectorSet */
/** @typedef {{ label: string, text: string }} SummaryRow */

/** How far past 1 a squared length may be and still count as within the unit sphere. */
const UNIT_TOLERANCE = 1e-6;

/** @param {number | null} code @param {ReadonlyMap<number, string>} known */
const codeText = (code, known) => code === null ? 'not stated' : known.get(code) ?? `code ${code} (unverified)`;

/** @param {readonly { b: number, averages: number | null }[]} weightings */
function bValues(weightings) {
  return weightings.map((w) => w.averages === null ? `${w.b}` : `${w.b} (${w.averages} average${w.averages === 1 ? '' : 's'})`).join(', ');
}

/**
 * Shell counts as text: "b=0 ×1, 1500 ×3, 3000 ×6", or fractions of bmax without a positive one.
 * @param {VectorSet} set
 * @param {number | null} bmax
 */
function shellText(set, bmax) {
  const parts = shells(set, bmax).map((s) => {
    const level = s.b !== null ? `${s.b}` : s.fraction === 0 ? '0' : s.fraction === 1 ? 'bmax' : `${s.fraction}·bmax`;
    return `${level} ×${s.count}`;
  });
  return `${bmax !== null ? 'b=' : ''}${parts.join(', ')}`;
}

/**
 * b = bmax * |v|^2 holds only for unscaled vectors no longer than 1, so shells are shown only for a
 * stored (not substituted) set with the verified normalisation and no vector longer than 1.
 * @param {VectorSet} set
 */
const shellsHold = (set) => !set.origin.builtIn && set.normalisationCode === 1
  && set.vectors.every(([x, y, z]) => x * x + y * y + z * z <= 1 + UNIT_TOLERANCE);

/**
 * The rows of the Diffusion section; null when diffusion is off.
 * @param {Diffusion} d
 * @returns {SummaryRow[] | null}
 */
export function diffusionSummary(d) {
  if (d.kind === 'none') return null;
  /** @type {SummaryRow[]} */
  const rows = [{
    label: 'Mode',
    text: d.mode === null ? 'unreadable' : d.mode.name ?? `mode ${d.mode.code}`,
  }];
  if (d.kind === 'invalid') return [...rows, { label: 'Error', text: d.error }];
  if (d.kind === 'builtin') {
    if (d.directions !== null) rows.push({ label: 'Directions', text: `${d.directions}` });
  } else rows.push({ label: 'Directions', text: `${d.set.vectors.length}` });
  if (d.weightings.length > 0) rows.push({ label: 'b-values', text: bValues(d.weightings) });
  if (d.kind === 'free') {
    const top = Math.max(0, ...d.weightings.map((w) => w.b));
    rows.push(
      { label: 'Coordinate system', text: codeText(d.set.coordinateCode, COORDINATE_NAMES) },
      { label: 'Normalisation', text: codeText(d.set.normalisationCode, NORMALISATION_NAMES) },
      { label: 'Source', text: sourceText(d.set.origin) || 'not stated' },
    );
    if (shellsHold(d.set)) rows.push({ label: 'Shells', text: shellText(d.set, top > 0 ? top : null) });
  }
  return rows;
}
