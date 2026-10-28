// @ts-check
/**
 * The geometry texts of the printed cards: positions, orientations and phase-encoding directions
 * of slices, slabs, navigators, saturation regions and volumes. Pure.
 *
 * Vectors are in the protocol's patient axes (Sag, Cor, Tra), as ASCCONV stores them
 * (`sPosition.dSag` …, `sNormal.dTra`). A positive component points L, P, H.
 */
import { fixed } from './numfmt.js';

/** @typedef {readonly [number, number, number]} Vec3 */
/** @typedef {0 | 1 | 2} Axis */
/**
 * A normal's orientation as the print states it: the main axis, the second and third axis (by
 * the size of their components), and the two angles in degrees, `a2` towards the second axis
 * and `a3` towards the third.
 * @typedef {{ main: Axis, second: Axis, third: Axis, a2: number, a3: number }} Orientation
 */

/** The letters of the axes (Sagittal, Coronal, Transversal). */
export const AXIS_LETTERS = /** @type {const} */ (['S', 'C', 'T']);
const AXIS_NAMES = ['Sagittal', 'Coronal', 'Transversal'];
/** The direction letters of each axis: negative, positive. */
export const DIRECTIONS = /** @type {const} */ ([['R', 'L'], ['A', 'P'], ['F', 'H']]);
const DEG = 180 / Math.PI;

/** @param {Vec3} v @returns {Vec3} */
function unit(v) {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The axis of the largest component; near-ties (within 1e-6) go to Tra, then Cor, then Sag.
 * @param {Vec3} v
 * @returns {Axis}
 */
export function mainAxis(v) {
  const a = v.map(Math.abs);
  const max = Math.max(...a);
  return a[2] >= max - 1e-6 ? 2 : a[1] >= max - 1e-6 ? 1 : 0;
}

/**
 * A position as printed, "L12.3 P4.0 H0.5": a direction letter and the distance in mm, 1 decimal;
 * a distance that rounds to 0.0 takes the positive letter.
 * @param {Vec3} c
 */
export function positionText(c) {
  return c.map((x, i) => {
    const s = fixed(Math.abs(x), 1);
    return `${x >= 0 || s === '0.0' ? DIRECTIONS[i][1] : DIRECTIONS[i][0]}${s}`;
  }).join(' ');
}

/**
 * The orientation of a normal (any length but zero).
 * @param {Vec3} normal
 * @returns {Orientation}
 */
export function orientation(normal) {
  const n = unit(normal);
  const main = mainAxis(n);
  const [second, third] = /** @type {Axis[]} */ ([0, 1, 2]).filter((i) => i !== main).sort((i, j) => Math.abs(n[j]) - Math.abs(n[i]));
  const a2 = -Math.atan(n[second] / n[main]) * DEG;
  const a3 = -Math.asin(Math.max(-1, Math.min(1, n[third]))) * DEG * (n[main] >= 0 ? 1 : -1);
  return { main, second, third, a2, a3 };
}

/** Whether an orientation is tilted from its main axis by an angle that prints (1 decimal). @param {Orientation} o */
export function isOblique(o) {
  return fixed(o.a2, 1) !== '0.0' || fixed(o.a3, 1) !== '0.0';
}

/**
 * An orientation as printed: "Transversal" when it is not oblique, else "T > C-12.3" with
 * " > S4.5" when the third angle prints. `short`: the axes only, "T > C".
 * @param {Orientation} o
 * @param {boolean} [short]
 */
export function orientationText(o, short = false) {
  if (!isOblique(o)) return AXIS_NAMES[o.main];
  const [m, s2, s3] = [o.main, o.second, o.third].map((i) => AXIS_LETTERS[i]);
  if (short) return `${m} > ${s2}`;
  const t3 = fixed(o.a3, 1);
  return `${m} > ${s2}${fixed(o.a2, 1)}${t3 === '0.0' ? '' : ` > ${s3}${t3}`}`;
}

/**
 * The phase and readout directions of a slice with this normal and in-plane rotation (radians),
 * as the scanner derives them (its fGSLCalcPRS convention).
 * @param {Vec3} normal
 * @param {number} rotation
 * @returns {{ phase: Vec3, read: Vec3 }}
 */
export function phaseRead(normal, rotation) {
  const n = unit(normal);
  const [s, c, t] = n;
  const main = mainAxis(n);
  const p = unit(main === 0 ? [-c, s, 0] : main === 1 ? [c, -s, 0] : [0, t, -c]);
  const r = cross(n, p);
  const [cos, sin] = [Math.cos(rotation), Math.sin(rotation)];
  return {
    phase: [cos * p[0] - sin * r[0], cos * p[1] - sin * r[1], cos * p[2] - sin * r[2]],
    read: [sin * p[0] + cos * r[0], sin * p[1] + cos * r[1], sin * p[2] + cos * r[2]],
  };
}

/** A direction as printed, along its main axis: "A >> P" when it points P, else "P >> A". @param {Vec3} v */
export function directionText(v) {
  const i = mainAxis(v);
  const [neg, pos] = DIRECTIONS[i];
  return v[i] > 0 ? `${neg} >> ${pos}` : `${pos} >> ${neg}`;
}
