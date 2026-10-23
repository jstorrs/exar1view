// Control and bidirectional characters made visible, as protocol_tools/visible.py visible_controls and visible_spaces do.
// Pure.

/* Lone surrogates only: in a `u` regex a paired surrogate is one code point, outside the range. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu;
/** The same, but newline and tab are left to the line breaks and indents of multi-line text. */
const TEXT_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu;
const SPACE_RUNS = /^ +| +$| {2,}/g;

/** @param {string} ch */
function picture(ch) {
  const cp = /** @type {number} */ (ch.codePointAt(0));
  if (cp < 0x20) return String.fromCodePoint(0x2400 + cp);
  if (cp === 0x7f) return '␡';
  return cp < 0x100 ? `\\x${cp.toString(16).padStart(2, '0')}` : `\\u${cp.toString(16).padStart(4, '0')}`;
}

/**
 * Control characters as their Unicode control pictures (DEL as ␡); C1 controls, the line and paragraph
 * separators, the bidirectional controls and lone surrogates as `\x9b` or `\u2028` escapes.
 * @param {string} text
 */
export const visibleControls = (text) => text.replace(CONTROLS, picture);

/**
 * Multi-line text (notes, save comments) with its controls made visible as `visibleControls` does, except that
 * newline and tab stay real, for an element that shows them (`white-space: pre-wrap`).
 * @param {string} text
 */
export const visibleText = (text) => text.replace(TEXT_CONTROLS, picture);

/** Control characters as pictures, and spaces that would vanish or collapse as `␣`. @param {string} text */
export const visibleSpaces = (text) => visibleControls(text).replace(SPACE_RUNS, (m) => '␣'.repeat(m.length));

/** A name, quoted. @param {string} name */
export const nameText = (name) => `"${visibleSpaces(name)}"`;
