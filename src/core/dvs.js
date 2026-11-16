// @ts-check
/**
 * Siemens .dvs text and file names for a stored diffusion vector set. Pure.
 *
 * The file has CRLF line endings, `#` comment lines, then `[directions=N]`, the coordinate system,
 * the normalisation and one `Vector[i] = ( x, y, z )` line per direction. The set's comment is
 * untrusted text: it is cleaned to printable ASCII on a single line, and no folder names, protocol
 * or step name are written. The first line appears as its base name; the other lines are written as
 * notes, with any folder part of a word dropped. A set the scanner took from its own built-in table is
 * labelled so, not named after the file that was picked. A set whose stored conventions are
 * unverified is refused, and so is one whose components would not read back exactly equal.
 */
import { fixed } from './numfmt.js';

/** @typedef {import('./diffusion.js').VectorSet} VectorSet */

const SOURCE_MAX = 200;
const STEM_MAX = 80;
const BUILT_IN_STEM = 'siemens_internal';
const DEFAULT_STEM = 'diffusion_vectors';

/**
 * Text as one printable ASCII line: line breaks and tabs become spaces, anything else unprintable
 * becomes `?`. Trimmed, not capped.
 * @param {string} text
 */
function oneLine(text) {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '?').trim();
}

/**
 * A note as one printable ASCII line, each word containing `/` or `\` cut to what follows its last
 * separator, so no folder names. Trimmed, not capped.
 * @param {string} note
 */
function noteOf(note) {
  return oneLine(note).split(' ').map((w) => w.split(/[/\\]/).pop() ?? '').join(' ').trim();
}

/**
 * The base name of a file (after the last `/` or `\`, so no folder names), as one printable ASCII
 * line; '' if none.
 * @param {string | null} file
 */
function baseNameOf(file) {
  return oneLine(file ?? '').split(/[/\\]/).pop()?.trim() ?? '';
}

/**
 * The .dvs file text, or the reason the set cannot be written faithfully.
 * @param {VectorSet} set
 * @returns {{ ok: true, text: string } | { ok: false, why: string }}
 */
export function dvsText(set) {
  const c = set.conventions;
  if (!c.ok) return { ok: false, why: c.why };
  const lines = [];
  for (const [i, vector] of set.vectors.entries()) {
    if (vector.some((v) => !Number.isFinite(v) || Math.abs(v) >= 1e21)) {
      return { ok: false, why: `vector ${i} has a component that is not a finite number below 1e21` };
    }
    const parts = vector.map((v) => fixed(v, set.decimals));
    if (parts.some((p, k) => Number(p) !== vector[k])) {
      return { ok: false, why: `vector ${i} cannot be written exactly with ${set.decimals} decimals` };
    }
    lines.push(`Vector[${i}] = ( ${parts.join(', ')} )`);
  }
  const { file, notes, builtIn } = set.origin;
  const source = baseNameOf(file).slice(0, SOURCE_MAX).trim();
  const sourceLine = builtIn
    ? `# Source: scanner built-in set${source === '' ? '' : ` (selected file: ${source})`}`
    : source === '' ? null : `# Source: ${source}`;
  const all = [
    '# Diffusion vector set exported by exar1view',
    ...(sourceLine === null ? [] : [sourceLine]),
    ...notes.map(noteOf).map((n) => n.slice(0, SOURCE_MAX).trim()).filter((n) => n !== '').map((n) => `# Note: ${n}`),
    `# Stored codes: coordinate system ${set.coordinateCode}, normalisation ${set.normalisationCode}`,
    `[directions=${set.vectors.length}]`,
    `CoordinateSystem = ${c.coordinateSystem}`,
    `Normalisation = ${c.normalisation}`,
    ...lines,
  ];
  return { ok: true, text: all.map((l) => `${l}\r\n`).join('') };
}

/**
 * A name stem limited to letters, digits, dot, underscore and hyphen, with no edge punctuation.
 * @param {string} raw
 */
function sanitizeStem(raw) {
  const edge = /^[._-]+|[._-]+$/g;
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').replace(edge, '').slice(0, STEM_MAX).replace(edge, '');
}

/**
 * The file name for the set: the source file's base name (or `fallback`, a step label) cleaned, or
 * `siemens_internal` for the scanner's built-in set, with `_<N>dirs` added unless the stem already
 * says `<N>dir`, and `.dvs`.
 * @param {VectorSet} set
 * @param {string} fallback
 */
export function dvsFileName(set, fallback) {
  const fromFile = () => sanitizeStem(baseNameOf(set.origin.file).replace(/\.(?:dvs|txt)$/i, ''));
  const stem = set.origin.builtIn ? BUILT_IN_STEM : fromFile() || sanitizeStem(fallback) || DEFAULT_STEM;
  const n = set.vectors.length;
  const named = new RegExp(`(?<!\\d)${n}dir`, 'i').test(stem);
  return `${named ? stem : `${stem}_${n}dirs`}.dvs`;
}
