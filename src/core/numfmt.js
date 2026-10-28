// @ts-check
/**
 * Number text as the scanner prints it. Pure.
 *
 * The scanner formats with MSVC printf, which rounds the exact binary value half away from zero.
 * `Number.prototype.toFixed` does the same (it works on the exact value and takes the larger
 * magnitude on a tie), so 1.25 gives "1.3" and 360/160 (2.25 exactly) gives "2.3", while 2.675
 * (stored just below) gives "2.67".
 */

/** `fixedN`: N decimals; `trimN`: up to N decimals, trailing zeros and a bare dot dropped. @typedef {`fixed${number}` | `trim${number}`} NumFormat */

/**
 * `x` with `d` decimals; a result that is zero has no minus sign ("-0.04" at 1 dp gives "0.0").
 * Non-finite values and magnitudes of 1e21 and up give JS's own text.
 * @param {number} x
 * @param {number} d 0 to 100
 */
export function fixed(x, d) {
  const s = x.toFixed(d);
  return s.startsWith('-') && !/[1-9]/.test(s) ? s.slice(1) : s;
}

/**
 * `x` as `format`; null for a format that is not `fixedN` or `trimN` with N from 0 to 100.
 * @param {number} x
 * @param {string} format
 * @returns {string | null}
 */
export function formatNumber(x, format) {
  const m = /^(fixed|trim)(\d{1,3})$/.exec(format);
  if (!m || Number(m[2]) > 100) return null;
  const s = fixed(x, Number(m[2]));
  if (m[1] === 'fixed' || !s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}
