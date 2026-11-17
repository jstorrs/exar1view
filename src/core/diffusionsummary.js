// @ts-check
/**
 * What the Summary tab's Diffusion section shows of a protocol's diffusion settings, as label/text
 * rows, and the compare panel's side-by-side summary of two steps' settings and vector sets. Pure.
 * Nothing here quotes protocol text except the source file's base name, cleaned by the .dvs
 * writer's own function (core/dvs.js sourceText).
 */
import { shells, isFreeCommentKey, COORDINATE_NAMES, NORMALISATION_NAMES } from './diffusion.js';
import { sourceText } from './dvs.js';
import { fixed } from './numfmt.js';

/** @typedef {import('./diffusion.js').Diffusion} Diffusion */
/** @typedef {import('./diffusion.js').VectorSet} VectorSet */
/** @typedef {{ label: string, text: string }} SummaryRow */
/** A setting of each side; null where it does not apply to that side. @typedef {{ label: string, a: string | null, b: string | null, same: boolean }} CompareRow */
/** A differing vector as text, both sides with the same decimals. @typedef {{ index: number, a: string, b: string }} VectorDiff */
/**
 * @typedef {{
 *   rows: CompareRow[],
 *   verdict: string | null,
 *   differing: VectorDiff[],
 *   differCount: number,
 *   notes: string[],
 *   fold: boolean,
 * }} DiffusionComparison
 * `verdict` compares two free sets (null otherwise); `differing` lists the first 20 of the
 * `differCount` vectors that differ, for sets of equal size; `notes` say what else differs in the
 * stored vector and comment parameters. `fold` says those parameters belong to this summary rather
 * than the parameter table.
 */

/** How far past 1 a squared length may be and still count as within the unit sphere. */
const UNIT_TOLERANCE = 1e-6;

/** @param {number | null} code @param {ReadonlyMap<number, string>} known */
const codeText = (code, known) => code === null ? 'not stated' : known.get(code) ?? `code ${code} (never seen)`;

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
 * stored (not substituted) set with normalisation none (code 1) and no vector longer than 1.
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

/** The row order of both the Summary and the comparison (diffusionSummary emits rows in this order). */
const ROW_ORDER = ['Mode', 'Directions', 'b-values', 'Coordinate system', 'Normalisation', 'Source', 'Shells'];
const MAX_LISTED = 20;

/** @typedef {import('./diffusion.js').Vector} Vector */

/** @param {Vector} v @returns {Vector | null} the unit vector, null for a zero or non-finite one */
function unit([x, y, z]) {
  const n = Math.hypot(x, y, z);
  return n > 0 && Number.isFinite(n) ? [x / n, y / n, z / n] : null;
}

/**
 * The angle between the axes of two unit vectors in degrees, 0 to 90: ±v is the same diffusion
 * axis, so a sign flip gives 0. atan2 keeps small angles accurate; null if not finite.
 * @param {Vector} v @param {Vector} w
 */
function axisAngle([a, b, c], [x, y, z]) {
  const cross = Math.hypot(b * z - c * y, c * x - a * z, a * y - b * x);
  const theta = Math.atan2(cross, a * x + b * y + c * z) * 180 / Math.PI;
  return Number.isFinite(theta) ? Math.min(theta, 180 - theta) : null;
}

/**
 * The vector verdict for two free sets: exact equality, or how many corresponding vectors differ
 * (a sign flip differs) and the largest angle between their axes (a pair with a zero vector differs
 * but has no angle). `textDiffers` says the stored vector parameters differ in text, so equal
 * values are noted as such; a differing coordinate system qualifies the verdict.
 * @param {VectorSet} a @param {VectorSet} b @param {boolean} textDiffers
 * @returns {{ verdict: string, differing: VectorDiff[], differCount: number }}
 */
function compareSets(a, b, textDiffers) {
  const qualifier = a.coordinateCode === b.coordinateCode ? '' : ' (coordinate systems differ)';
  const n = a.vectors.length;
  if (n !== b.vectors.length) {
    return { verdict: `Different numbers of vectors (${n} vs ${b.vectors.length})${qualifier}`, differing: [], differCount: 0 };
  }
  const decimals = Math.max(a.decimals, b.decimals);
  const text = (/** @type {Vector} */ v) => v.map((c) => fixed(c, decimals)).join(', ');
  /** @type {VectorDiff[]} */
  const differing = [];
  let differCount = 0;
  /** @type {number | null} */
  let largest = null;
  for (const [index, v] of a.vectors.entries()) {
    const w = b.vectors[index];
    if (v.every((c, k) => c === w[k])) continue;
    differCount++;
    if (differing.length < MAX_LISTED) differing.push({ index, a: text(v), b: text(w) });
    const [uv, uw] = [unit(v), unit(w)];
    const theta = uv && uw ? axisAngle(uv, uw) : null;
    if (theta !== null) largest = Math.max(largest ?? 0, theta);
  }
  if (differCount === 0) {
    const verdict = textDiffers ? 'Identical vector sets (values equal; stored text differs)' : 'Identical vector sets';
    return { verdict: verdict + qualifier, differing, differCount };
  }
  const angleText = largest === null ? '' : ` (largest axis angle ${largest.toFixed(1)}°)`;
  return { verdict: `${differCount} of ${n} vectors differ${angleText}${qualifier}`, differing, differCount };
}

/**
 * Two steps' diffusion settings side by side, with a verdict on two free vector sets; null when
 * neither side has diffusion or either side's settings cannot be read (then nothing is folded).
 * `foldedKeys` are the main-block keys left out of the parameter table (vector and comment keys that
 * differ), so that differences in stored text alone are still reported.
 * @param {Diffusion} a
 * @param {Diffusion} b
 * @param {readonly string[]} [foldedKeys]
 * @returns {DiffusionComparison | null}
 */
export function compareDiffusion(a, b, foldedKeys = []) {
  if (a.kind === 'invalid' || b.kind === 'invalid' || (a.kind === 'none' && b.kind === 'none')) return null;
  /** @param {Diffusion} d */
  const fields = (d) => new Map((diffusionSummary(d) ?? [{ label: 'Mode', text: 'none' }]).map((r) => [r.label, r.text]));
  const fa = fields(a);
  const fb = fields(b);
  const rows = ROW_ORDER.flatMap((label) => {
    const va = fa.get(label) ?? null;
    const vb = fb.get(label) ?? null;
    return va === null && vb === null ? [] : [{ label, a: va, b: vb, same: va === vb }];
  });
  const fold = a.kind === 'free' || b.kind === 'free';
  if (a.kind !== 'free' || b.kind !== 'free') return { rows, verdict: null, differing: [], differCount: 0, notes: [], fold };
  const commentKeys = foldedKeys.filter(isFreeCommentKey).length;
  /** @type {string[]} */
  const notes = [];
  if (a.set.comment !== b.set.comment) notes.push('Stored comment text differs');
  else if (commentKeys > 0) notes.push('Stored comments are equal as text; their stored bytes differ');
  return { rows, ...compareSets(a.set, b.set, foldedKeys.length > commentKeys), notes, fold };
}
